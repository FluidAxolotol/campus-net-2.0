// ============================================================
// 用户认证业务
// 路由只负责 HTTP 与会话；查库、验密、状态检查、失败计数都在这里。
// ============================================================

import { config } from '../../config/env.js';
import { query, queryOne } from '../../db/pool.js';
import { hashPassword, verifyPassword, sha256Hex } from '../../utils/crypto.js';
import { AppError } from '../../utils/errors.js';

const ALLOWED_DEGREES = new Set(['本科', '硕士', '博士']);

export async function registerUser(input) {
  const school = await queryOne(
    'SELECT id, name, email_domain, status FROM schools WHERE id = ? LIMIT 1',
    [input.schoolId],
  );
  if (!school || school.status !== 'active') {
    throw new AppError(422, 'SCHOOL_INVALID', '学校不存在或已停用', { schoolId: '学校无效' });
  }

  if (!ALLOWED_DEGREES.has(input.degree)) {
    throw new AppError(422, 'VALIDATION_FAILED', '请检查填写内容', { degree: '学历阶段无效' });
  }
  if (input.enrollYear < 2000 || input.enrollYear > 2035) {
    throw new AppError(422, 'VALIDATION_FAILED', '请检查填写内容', { enrollYear: '入学年份无效' });
  }

  const email = input.email.toLowerCase();
  const domainOk = email.endsWith(`@${school.email_domain}`)
    || email.endsWith(`.${school.email_domain}`);
  if (!domainOk) {
    throw new AppError(422, 'EMAIL_DOMAIN_INVALID', `请使用本校校园邮箱（@${school.email_domain}）`, {
      email: `邮箱后缀必须是 @${school.email_domain}`,
    });
  }

  const [emailExists, studentExists] = await Promise.all([
    queryOne('SELECT id FROM users WHERE email = ? LIMIT 1', [email]),
    queryOne(
      'SELECT id FROM users WHERE school_id = ? AND student_no = ? LIMIT 1',
      [input.schoolId, input.studentNo],
    ),
  ]);
  if (emailExists) {
    throw new AppError(409, 'EMAIL_EXISTS', '这个邮箱已经注册过了', { email: '邮箱已注册' });
  }
  if (studentExists) {
    throw new AppError(409, 'STUDENT_NO_EXISTS', '这个学号在本校已经注册过了', {
      studentNo: '学号已注册',
    });
  }

  const passwordHash = await hashPassword(input.password);
  const result = await query(
    `INSERT INTO users
       (school_id, student_no, email, display_name, password_hash,
        degree, enroll_year, college, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      input.schoolId,
      input.studentNo,
      email,
      input.displayName,
      passwordHash,
      input.degree,
      input.enrollYear,
      input.college || null,
    ],
  );

  return {
    id: result.insertId,
    status: 'pending',
    schoolName: school.name,
    email,
  };
}

export async function loginUser({ account, password }) {
  const normalized = String(account).trim();
  let rows;

  if (normalized.includes('@')) {
    rows = await query(
      `SELECT u.*, s.name AS school_name, s.code AS school_code,
              s.status AS school_status, s.email_domain
         FROM users u
         JOIN schools s ON s.id = u.school_id
        WHERE u.email = ?
        LIMIT 1`,
      [normalized.toLowerCase()],
    );
  } else {
    // 学号没有全局唯一约束，可能在不同学校重复
    rows = await query(
      `SELECT u.*, s.name AS school_name, s.code AS school_code,
              s.status AS school_status, s.email_domain
         FROM users u
         JOIN schools s ON s.id = u.school_id
        WHERE u.student_no = ?
        LIMIT 2`,
      [normalized],
    );
  }

  if (rows.length > 1) {
    throw new AppError(409, 'AMBIGUOUS_ACCOUNT', '该学号在多个学校存在，请改用校园邮箱登录');
  }
  if (rows.length === 0) {
    // 不透露账号是否存在，统一使用 AUTH_INVALID
    throw new AppError(401, 'AUTH_INVALID', '账号或密码错误');
  }

  const user = rows[0];

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    throw new AppError(423, 'USER_LOCKED', '密码错误次数过多，请 15 分钟后再试');
  }

  const passwordOk = await verifyPassword(password, user.password_hash);
  if (!passwordOk) {
    await query(
      `UPDATE users
          SET failed_login_attempts = failed_login_attempts + 1,
              locked_until = CASE
                WHEN failed_login_attempts + 1 >= ?
                  THEN DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE)
                ELSE locked_until
              END
        WHERE id = ?`,
      [config.maxLoginFailures, config.lockMinutes, user.id],
    );
    throw new AppError(401, 'AUTH_INVALID', '账号或密码错误');
  }

  // 密码正确后才检查状态，避免把“该账号存在但被禁用”暴露给未验证的人
  if (user.status === 'pending') {
    throw new AppError(403, 'USER_PENDING', '账号正在等待管理员审核，请耐心等待');
  }
  if (user.status === 'rejected') {
    throw new AppError(403, 'USER_REJECTED', '注册申请已被驳回', {
      reason: user.reject_reason || '',
    });
  }
  if (user.status === 'disabled') {
    throw new AppError(403, 'USER_DISABLED', '账号已被停用，请联系学校管理员');
  }
  if (user.school_status !== 'active') {
    throw new AppError(403, 'SCHOOL_DISABLED', '所属学校已停用');
  }

  await query(
    'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?',
    [user.id],
  );

  return user;
}

export async function changeUserPassword(userId, currentSessionId, currentPassword, newPassword) {
  const user = await queryOne('SELECT id, password_hash FROM users WHERE id = ? LIMIT 1', [userId]);
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', '请重新登录');

  const ok = await verifyPassword(currentPassword, user.password_hash);
  if (!ok) {
    throw new AppError(401, 'CURRENT_PASSWORD_INVALID', '当前密码不正确');
  }
  if (currentPassword === newPassword) {
    throw new AppError(422, 'PASSWORD_UNCHANGED', '新密码不能与当前密码相同', {
      newPassword: '请换一个新密码',
    });
  }

  const passwordHash = await hashPassword(newPassword);
  await query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);

  // 改密后踢掉其他设备；当前会话保留
  const currentSessionHash = sha256Hex(currentSessionId);
  await query(
    'DELETE FROM user_sessions WHERE user_id = ? AND id <> ?',
    [userId, currentSessionHash],
  );
  return true;
}

export async function getProfileStats(userId, schoolId) {
  const [examRow, postRow, likeRow] = await Promise.all([
    queryOne(
      'SELECT COUNT(*) AS n FROM exams WHERE school_id = ? AND uploader_id = ?',
      [schoolId, userId],
    ),
    queryOne(
      "SELECT COUNT(*) AS n FROM posts WHERE school_id = ? AND author_id = ? AND status = 'published'",
      [schoolId, userId],
    ),
    queryOne(
      `SELECT COALESCE(SUM(like_count), 0) AS n
         FROM posts
        WHERE school_id = ? AND author_id = ? AND status = 'published'`,
      [schoolId, userId],
    ),
  ]);
  return {
    uploads: Number(examRow?.n) || 0,
    posts: Number(postRow?.n) || 0,
    likesReceived: Number(likeRow?.n) || 0,
  };
}

export async function createPasswordResetRequest({ schoolId, account, note }) {
  // 无论账号是否存在，对外都返回同样的成功响应，避免枚举用户
  const normalized = String(account).trim();
  const school = await queryOne(
    'SELECT id, status FROM schools WHERE id = ? LIMIT 1',
    [schoolId],
  );
  if (!school || school.status !== 'active') return { accepted: true };

  const user = normalized.includes('@')
    ? await queryOne(
      'SELECT id FROM users WHERE school_id = ? AND email = ? LIMIT 1',
      [schoolId, normalized.toLowerCase()],
    )
    : await queryOne(
      'SELECT id FROM users WHERE school_id = ? AND student_no = ? LIMIT 1',
      [schoolId, normalized],
    );

  if (user) {
    const existing = await queryOne(
      `SELECT id FROM password_reset_requests
        WHERE user_id = ? AND status = 'open'
          AND created_at > DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 24 HOUR)
        LIMIT 1`,
      [user.id],
    );
    if (!existing) {
      await query(
        `INSERT INTO password_reset_requests (school_id, user_id, note)
         VALUES (?, ?, ?)`,
        [schoolId, user.id, note ? String(note).slice(0, 255) : null],
      );
    }
  }
  return { accepted: true };
}
