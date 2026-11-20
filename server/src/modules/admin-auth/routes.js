// ============================================================
// 管理员认证接口（独立于用户登录）
// 阶段：setup_required → active / totp_required → active
// 管理员 Cookie 名：campus_admin_sid
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { pool, query, queryOne } from '../../db/pool.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import {
  regenerateSession, saveSession, destroySession,
} from '../../middleware/session.js';
import {
  requireAdminStage, requireAdminActive,
} from '../../middleware/auth.js';
import { parse, numericId } from '../../utils/validate.js';
import { formatSchool } from '../../utils/serializers.js';
import { AppError } from '../../utils/errors.js';
import { writeAudit } from '../admin/audit.js';
import {
  adminLogin, formatAdmin, getTotpSetup, completeAdminSetup,
  verifyAdminTotp, useRecoveryCode, changeAdminPassword,
} from './service.js';

export const adminAuthRouter = Router();

async function activeSchool(schoolId) {
  const school = await queryOne(
    'SELECT id, name, code, email_domain, status FROM schools WHERE id = ? LIMIT 1',
    [schoolId],
  );
  if (!school || school.status !== 'active') {
    throw new AppError(403, 'SCHOOL_DISABLED', '所选学校不存在或已停用');
  }
  return school;
}

const loginSchema = z.object({
  schoolId: numericId,
  username: z.string().trim().min(1, '请输入管理员账号').max(64, '账号过长'),
  password: z.string().min(1, '请输入密码').max(64, '密码过长'),
});

adminAuthRouter.post(
  '/login',
  rateLimit('admin-login', 10 * 60 * 1000, 10),
  async (req, res) => {
    const input = parse(loginSchema, req.body);
    const school = await activeSchool(input.schoolId);
    const { admin, stage } = await adminLogin(input);

    await regenerateSession(req);
    req.session.adminId = admin.id;
    req.session.stage = stage;
    req.session.currentSchoolId = school.id;
    await saveSession(req);

    res.json({
      data: {
        stage,
        admin: formatAdmin(admin),
        school: formatSchool(school),
      },
    });
  },
);

adminAuthRouter.get(
  '/setup',
  requireAdminStage('setup_required'),
  rateLimit('admin-setup-qr', 60 * 1000, 20),
  async (req, res) => {
    if (!req.session.currentSchoolId) {
      throw new AppError(403, 'ADMIN_NO_SCHOOL', '请返回登录页重新选择学校');
    }
    const school = await activeSchool(req.session.currentSchoolId);
    const setup = await getTotpSetup(req.admin);
    res.json({ data: { ...setup, school: formatSchool(school), stage: 'setup_required' } });
  },
);

const setupSchema = z.object({
  newPassword: z.string().min(8, '新密码至少 8 位').max(64, '新密码最多 64 位'),
  code: z.string().regex(/^\d{6}$/, '请输入 6 位动态码'),
});

adminAuthRouter.post(
  '/setup',
  requireAdminStage('setup_required'),
  rateLimit('admin-setup', 10 * 60 * 1000, 10),
  async (req, res) => {
    const input = parse(setupSchema, req.body);
    const schoolId = req.session.currentSchoolId;
    if (!schoolId) throw new AppError(403, 'ADMIN_NO_SCHOOL', '请返回登录页重新选择学校');
    const school = await activeSchool(schoolId);

    const { recoveryCodes } = await completeAdminSetup({
      adminId: req.admin.id,
      schoolId,
      newPassword: input.newPassword,
      code: input.code,
      ip: req.ip,
    });

    const adminId = req.admin.id;
    await regenerateSession(req);
    req.session.adminId = adminId;
    req.session.stage = 'active';
    req.session.currentSchoolId = schoolId;
    await saveSession(req);

    const fresh = await queryOne(
      'SELECT id, username, display_name, totp_confirmed, must_change_password, status FROM admins WHERE id = ?',
      [adminId],
    );
    res.json({
      data: {
        stage: 'active',
        admin: formatAdmin(fresh),
        school: formatSchool(school),
        recoveryCodes,
        message: '设置完成，恢复码只显示这一次，请离线保存',
      },
    });
  },
);

const verifySchema = z.object({
  code: z.string().regex(/^\d{6}$/, '请输入 6 位动态码'),
});

adminAuthRouter.post(
  '/verify',
  requireAdminStage('totp_required'),
  rateLimit('admin-verify', 5 * 60 * 1000, 20),
  async (req, res) => {
    const input = parse(verifySchema, req.body);
    const schoolId = req.session.currentSchoolId;
    if (!schoolId) throw new AppError(403, 'ADMIN_NO_SCHOOL', '请返回登录页重新选择学校');
    const school = await activeSchool(schoolId);

    await verifyAdminTotp(req.admin.id, input.code);

    const adminId = req.admin.id;
    await regenerateSession(req);
    req.session.adminId = adminId;
    req.session.stage = 'active';
    req.session.currentSchoolId = schoolId;
    await saveSession(req);

    const fresh = await queryOne(
      'SELECT id, username, display_name, totp_confirmed, must_change_password, status FROM admins WHERE id = ?',
      [adminId],
    );
    res.json({
      data: {
        stage: 'active',
        admin: formatAdmin(fresh),
        school: formatSchool(school),
      },
    });
  },
);

adminAuthRouter.post(
  '/recovery',
  requireAdminStage('totp_required'),
  rateLimit('admin-recovery', 60 * 60 * 1000, 5),
  async (req, res) => {
    const input = parse(z.object({
      code: z.string().min(8, '请输入恢复码').max(32, '恢复码过长'),
    }), req.body);
    const schoolId = req.session.currentSchoolId;
    if (!schoolId) throw new AppError(403, 'ADMIN_NO_SCHOOL', '请返回登录页重新选择学校');

    await useRecoveryCode(req.admin.id, schoolId, input.code, req.ip);
    req.session.stage = 'setup_required';
    await saveSession(req);
    res.json({
      data: {
        stage: 'setup_required',
        message: '恢复码已使用。请重新扫描二维码绑定验证器，并设置新密码。',
      },
    });
  },
);

adminAuthRouter.get('/me', async (req, res) => {
  if (!req.session?.adminId || !req.admin) {
    throw new AppError(401, 'ADMIN_UNAUTHENTICATED', '请先登录管理后台');
  }
  let school = null;
  if (req.session.currentSchoolId) {
    const row = await queryOne(
      'SELECT id, name, code, email_domain, status FROM schools WHERE id = ? LIMIT 1',
      [req.session.currentSchoolId],
    );
    if (row) school = formatSchool(row);
  }
  res.json({
    data: {
      stage: req.session.stage || null,
      admin: formatAdmin(req.admin),
      school,
    },
  });
});

adminAuthRouter.post('/logout', async (req, res) => {
  if (req.session) {
    try {
      await destroySession(req);
    } catch {
      // 已过期也视为退出成功
    }
  }
  res.clearCookie('campus_admin_sid', { path: '/' });
  res.status(204).end();
});

adminAuthRouter.post(
  '/switch-school',
  requireAdminStage('active'),
  rateLimit('admin-switch-school', 60 * 1000, 20),
  async (req, res) => {
    const input = parse(z.object({ schoolId: numericId }), req.body);
    const school = await activeSchool(input.schoolId);
    const previousSchoolId = req.session.currentSchoolId ?? null;

    req.session.currentSchoolId = school.id;
    await saveSession(req);

    await writeAudit(pool, {
      schoolId: school.id,
      actorType: 'admin',
      actorId: req.admin.id,
      action: 'admin.switch_school',
      targetType: 'school',
      targetId: school.id,
      detail: { previousSchoolId },
      ip: req.ip,
    });
    res.json({ data: { school: formatSchool(school) } });
  },
);

const passwordSchema = z.object({
  currentPassword: z.string().min(1, '请输入当前密码').max(64),
  newPassword: z.string().min(8, '新密码至少 8 位').max(64),
  code: z.string().regex(/^\d{6}$/, '请输入 6 位动态码'),
});

adminAuthRouter.post(
  '/password',
  requireAdminActive,
  rateLimit('admin-password', 60 * 60 * 1000, 5),
  async (req, res) => {
    const input = parse(passwordSchema, req.body);
    await changeAdminPassword(
      req.admin.id,
      req.sessionID,
      input.currentPassword,
      input.newPassword,
      input.code,
      req.ip,
      req.currentSchool.id,
    );
    res.json({ data: { message: '密码已更新，其他设备的管理员会话已失效' } });
  },
);
