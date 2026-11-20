// ============================================================
// 用户认证接口
// POST /api/auth/register
// POST /api/auth/login
// POST /api/auth/logout
// GET  /api/auth/me
// POST /api/auth/password-reset-request
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { config } from '../../config/env.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import {
  regenerateSession, saveSession, destroySession,
} from '../../middleware/session.js';
import { requireUser } from '../../middleware/auth.js';
import {
  parse, numericId, emailSchema, passwordSchema, displayNameSchema,
  studentNoSchema, optionalTrimmed,
} from '../../utils/validate.js';
import { formatUser } from '../../utils/serializers.js';
import {
  registerUser, loginUser, createPasswordResetRequest, getProfileStats,
} from './service.js';

export const authRouter = Router();

const registerSchema = z.object({
  schoolId: numericId,
  studentNo: studentNoSchema,
  email: emailSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
  degree: z.enum(['本科', '硕士', '博士'], { message: '学历阶段无效' }),
  enrollYear: z.coerce.number().int().min(2000, '入学年份无效').max(2035, '入学年份无效'),
  college: optionalTrimmed(80, '学院名称最多 80 个字符'),
});

authRouter.post(
  '/register',
  rateLimit('register', 60 * 60 * 1000, 10),
  async (req, res) => {
    const input = parse(registerSchema, req.body);
    const result = await registerUser(input);
    res.status(201).json({
      data: {
        ...result,
        message: '注册申请已提交，管理员审核通过后即可登录',
      },
    });
  },
);

const loginSchema = z.object({
  account: z.string().trim().min(1, '请输入学号或校园邮箱').max(160, '账号过长'),
  password: z.string().min(1, '请输入密码').max(64, '密码过长'),
  rememberMe: z.boolean().optional().default(false),
});

authRouter.post(
  '/login',
  rateLimit('user-login', 10 * 60 * 1000, 30),
  async (req, res) => {
    const input = parse(loginSchema, req.body);
    const user = await loginUser(input);

    // 防会话固定：登录前如果已有 sid，先销毁换新的
    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.cookie.maxAge = input.rememberMe ? config.rememberMeTtlMs : null;
    await saveSession(req);

    res.json({
      data: {
        user: formatUser(user),
        rememberMe: input.rememberMe,
      },
    });
  },
);

authRouter.post('/logout', async (req, res) => {
  if (req.session) {
    try {
      await destroySession(req);
    } catch {
      // 会话本来就不存在时也当作退出成功
    }
  }
  res.clearCookie('campus_sid', { path: '/' });
  res.status(204).end();
});

authRouter.get('/me', requireUser, async (req, res) => {
  const stats = await getProfileStats(req.user.id, req.user.schoolId);
  res.json({ data: { user: req.user, stats } });
});

const resetRequestSchema = z.object({
  schoolId: numericId,
  account: z.string().trim().min(1, '请输入学号或校园邮箱').max(160, '账号过长'),
  note: optionalTrimmed(255, '备注最多 255 个字符'),
});

authRouter.post(
  '/password-reset-request',
  rateLimit('password-reset', 60 * 60 * 1000, 5),
  async (req, res) => {
    const input = parse(resetRequestSchema, req.body);
    await createPasswordResetRequest(input);
    res.json({
      data: {
        message: '已提交找回申请。若信息匹配，管理员会联系你并发放临时密码。',
      },
    });
  },
);
