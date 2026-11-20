// ============================================================
// 管理员认证业务：密码 + TOTP（腾讯身份验证器）
// 首次登录：改密 + 绑定 TOTP；
// 日常登录：密码 + 6 位动态码；
// 恢复码：丢失验证器时重新绑定。
// ============================================================

import QRCode from 'qrcode';
import { config } from '../../config/env.js';
import { query, queryOne, withTransaction } from '../../db/pool.js';
import {
  verifyPassword, hashPassword, sha256Hex,
  encryptSecret, decryptSecret,
  generateTotpSecret, verifyTotp, buildOtpAuthUrl,
  generateRecoveryCodes, hashRecoveryCode,
} from '../../utils/crypto.js';
import { AppError } from '../../utils/errors.js';
import { writeAudit } from '../admin/audit.js';

export function formatAdmin(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    totpConfirmed: Boolean(row.totp_confirmed),
    mustChangePassword: Boolean(row.must_change_password),
    status: row.status,
  };
}

export async function adminLogin({ username, password }) {
  const admin = await queryOne(
    `SELECT id, username, display_name, password_hash, status,
            must_change_password, totp_confirmed, totp_secret_encrypted,
            failed_login_attempts, locked_until
       FROM admins
      WHERE username = ?
      LIMIT 1`,
    [username.trim()],
  );
  if (!admin) {
    throw new AppError(401, 'ADMIN_INVALID', '管理员账号或密码错误');
  }
  if (admin.status !== 'active') {
    throw new AppError(403, 'ADMIN_DISABLED', '管理员账号已停用');
  }
  if (admin.locked_until && new Date(admin.locked_until).getTime() > Date.now()) {
    throw new AppError(423, 'ADMIN_LOCKED', '密码错误次数过多，请 15 分钟后再试');
  }

  const ok = await verifyPassword(password, admin.password_hash);
  if (!ok) {
    await query(
      `UPDATE admins
          SET failed_login_attempts = failed_login_attempts + 1,
              locked_until = CASE
                WHEN failed_login_attempts + 1 >= ?
                  THEN DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE)
                ELSE locked_until
              END
        WHERE id = ?`,
      [config.maxLoginFailures, config.lockMinutes, admin.id],
    );
    throw new AppError(401, 'ADMIN_INVALID', '管理员账号或密码错误');
  }

  await query(
    'UPDATE admins SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
    [admin.id],
  );

  const stage = (admin.must_change_password || !admin.totp_confirmed)
    ? 'setup_required'
    : 'totp_required';
  return { admin, stage };
}

// 保证管理员一定有一把 TOTP 密钥；首次 seed 后就应该存在
async function ensureTotpSecret(admin) {
  if (admin.totp_secret_encrypted) return decryptSecret(admin.totp_secret_encrypted);
  const secret = generateTotpSecret();
  await query(
    `UPDATE admins
        SET totp_secret_encrypted = ?, totp_confirmed = 0, must_change_password = 1
      WHERE id = ?`,
    [encryptSecret(secret), admin.id],
  );
  return secret;
}

export async function getTotpSetup(admin) {
  const row = await queryOne(
    `SELECT id, username, display_name, totp_secret_encrypted
       FROM admins WHERE id = ? LIMIT 1`,
    [admin.id],
  );
  if (!row) throw new AppError(401, 'ADMIN_UNAUTHENTICATED', '管理员不存在');

  const secret = await ensureTotpSecret(row);
  const otpauthUrl = buildOtpAuthUrl(secret, row.username, '校内网2.0');
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
    width: 260,
    margin: 1,
    errorCorrectionLevel: 'M',
  });
  return {
    secret,
    otpauthUrl,
    qrDataUrl,
    account: row.username,
    issuer: '校内网2.0',
    hint: '打开微信「腾讯身份验证器」小程序 → 扫一扫 → 添加账户',
  };
}

function assertNewPassword(newPassword) {
  if (!/^(?=.*[A-Za-z])(?=.*\d).{8,64}$/.test(newPassword)) {
    throw new AppError(422, 'VALIDATION_FAILED', '请检查填写内容', {
      newPassword: '密码需 8–64 位，且同时包含字母和数字',
    });
  }
}

/**
 * 完成首次设置：验证动态码 → 修改密码 → 生成恢复码。
 * 这三件事在同一个事务里完成。
 */
export async function completeAdminSetup({ adminId, schoolId, newPassword, code, ip }) {
  assertNewPassword(newPassword);

  const admin = await queryOne(
    `SELECT id, username, password_hash, totp_secret_encrypted, must_change_password
       FROM admins WHERE id = ? LIMIT 1`,
    [adminId],
  );
  if (!admin || !admin.totp_secret_encrypted) {
    throw new AppError(401, 'ADMIN_UNAUTHENTICATED', '管理员不存在或未生成 TOTP 密钥');
  }
  if (await verifyPassword(newPassword, admin.password_hash)) {
    throw new AppError(422, 'PASSWORD_UNCHANGED', '新密码不能与当前密码相同', {
      newPassword: '请换一个新密码',
    });
  }

  const secret = decryptSecret(admin.totp_secret_encrypted);
  const totp = verifyTotp(secret, code);
  if (!totp.valid) {
    throw new AppError(401, 'TOTP_INVALID', '动态码不正确或已过期');
  }

  const passwordHash = await hashPassword(newPassword);
  const recoveryCodes = generateRecoveryCodes(8);

  await withTransaction(async (conn) => {
    await conn.execute(
      `UPDATE admins
          SET password_hash = ?, must_change_password = 0, totp_confirmed = 1,
              last_totp_step = ?
        WHERE id = ?`,
      [passwordHash, totp.step, adminId],
    );
    await conn.execute('DELETE FROM admin_recovery_codes WHERE admin_id = ?', [adminId]);
    for (const recoveryCode of recoveryCodes) {
      await conn.execute(
        'INSERT INTO admin_recovery_codes (admin_id, code_hash) VALUES (?, ?)',
        [adminId, hashRecoveryCode(recoveryCode)],
      );
    }
    await writeAudit(conn, {
      schoolId,
      actorType: 'admin',
      actorId: adminId,
      action: 'admin.setup',
      detail: { note: '完成首次改密与 TOTP 绑定' },
      ip,
    });
  });

  return { recoveryCodes };
}

export async function verifyAdminTotp(adminId, code) {
  const admin = await queryOne(
    `SELECT id, totp_secret_encrypted, totp_confirmed, must_change_password, last_totp_step
       FROM admins WHERE id = ? LIMIT 1`,
    [adminId],
  );
  if (!admin) throw new AppError(401, 'ADMIN_UNAUTHENTICATED', '管理员不存在');
  if (!admin.totp_confirmed || admin.must_change_password) {
    throw new AppError(403, 'ADMIN_SETUP_REQUIRED', '请先完成首次密码修改与动态码绑定');
  }
  if (!admin.totp_secret_encrypted) {
    throw new AppError(403, 'ADMIN_SETUP_REQUIRED', '管理员尚未绑定动态码');
  }

  const secret = decryptSecret(admin.totp_secret_encrypted);
  const totp = verifyTotp(secret, code);
  if (!totp.valid) {
    throw new AppError(401, 'TOTP_INVALID', '动态码不正确或已过期');
  }
  if (admin.last_totp_step !== null && totp.step <= Number(admin.last_totp_step)) {
    throw new AppError(401, 'TOTP_REPLAY', '这个动态码已经用过，请等下一个');
  }

  // 原子更新：并发提交同一个码时，只有一个能成功
  const result = await query(
    `UPDATE admins
        SET last_totp_step = ?
      WHERE id = ?
        AND (last_totp_step IS NULL OR last_totp_step < ?)`,
    [totp.step, adminId, totp.step],
  );
  if (result.affectedRows !== 1) {
    throw new AppError(401, 'TOTP_REPLAY', '这个动态码已经用过，请等下一个');
  }
  return true;
}

/**
 * 恢复码登录：验证一次性恢复码，作废旧 TOTP 密钥并生成新密钥。
 * 之后必须重新扫码绑定、设置新密码。
 */
export async function useRecoveryCode(adminId, schoolId, code, ip) {
  const codeHash = hashRecoveryCode(code);
  const row = await queryOne(
    `SELECT id FROM admin_recovery_codes
      WHERE admin_id = ? AND code_hash = ? AND used_at IS NULL
      LIMIT 1`,
    [adminId, codeHash],
  );
  if (!row) {
    throw new AppError(401, 'RECOVERY_INVALID', '恢复码无效或已经使用过');
  }

  const newSecret = generateTotpSecret();
  await withTransaction(async (conn) => {
    const [updateResult] = await conn.execute(
      'UPDATE admin_recovery_codes SET used_at = UTC_TIMESTAMP(3) WHERE id = ? AND used_at IS NULL',
      [row.id],
    );
    if (updateResult.affectedRows !== 1) {
      throw new AppError(401, 'RECOVERY_INVALID', '恢复码已被使用');
    }
    await conn.execute(
      `UPDATE admins
          SET totp_secret_encrypted = ?, totp_confirmed = 0,
              must_change_password = 1, last_totp_step = NULL
        WHERE id = ?`,
      [encryptSecret(newSecret), adminId],
    );
    await writeAudit(conn, {
      schoolId,
      actorType: 'admin',
      actorId: adminId,
      action: 'admin.recovery_used',
      detail: { note: '使用恢复码，强制重新绑定 TOTP' },
      ip,
    });
  });
  return true;
}

export async function changeAdminPassword(adminId, currentSessionId, currentPassword, newPassword, code, ip, schoolId) {
  assertNewPassword(newPassword);
  const admin = await queryOne(
    `SELECT id, password_hash, totp_secret_encrypted, totp_confirmed,
            must_change_password, last_totp_step
       FROM admins WHERE id = ? LIMIT 1`,
    [adminId],
  );
  if (!admin) throw new AppError(401, 'ADMIN_UNAUTHENTICATED', '管理员不存在');
  if (!await verifyPassword(currentPassword, admin.password_hash)) {
    throw new AppError(401, 'CURRENT_PASSWORD_INVALID', '当前密码不正确');
  }
  if (await verifyPassword(newPassword, admin.password_hash)) {
    throw new AppError(422, 'PASSWORD_UNCHANGED', '新密码不能与当前密码相同', {
      newPassword: '请换一个新密码',
    });
  }
  if (!admin.totp_secret_encrypted || !admin.totp_confirmed) {
    throw new AppError(403, 'ADMIN_SETUP_REQUIRED', '请先绑定动态码');
  }

  const secret = decryptSecret(admin.totp_secret_encrypted);
  const totp = verifyTotp(secret, code);
  if (!totp.valid) throw new AppError(401, 'TOTP_INVALID', '动态码不正确或已过期');
  if (admin.last_totp_step !== null && totp.step <= Number(admin.last_totp_step)) {
    throw new AppError(401, 'TOTP_REPLAY', '这个动态码已经用过，请等下一个');
  }

  const passwordHash = await hashPassword(newPassword);
  await withTransaction(async (conn) => {
    const [result] = await conn.execute(
      `UPDATE admins
          SET password_hash = ?, last_totp_step = ?
        WHERE id = ?
          AND (last_totp_step IS NULL OR last_totp_step < ?)`,
      [passwordHash, totp.step, adminId, totp.step],
    );
    if (result.affectedRows !== 1) {
      throw new AppError(401, 'TOTP_REPLAY', '动态码已被使用');
    }
    await writeAudit(conn, {
      schoolId,
      actorType: 'admin',
      actorId: adminId,
      action: 'admin.password_change',
      ip,
    });
  });

  // 其他设备上的管理员会话全部失效
  const currentSessionHash = sha256Hex(currentSessionId);
  await query(
    'DELETE FROM admin_sessions WHERE admin_id = ? AND id <> ?',
    [adminId, currentSessionHash],
  );
  return true;
}
