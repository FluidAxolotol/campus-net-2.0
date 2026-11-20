// ============================================================
// Express 装配线
// 请求顺序：请求 id → 日志 → 安全头 → JSON → Cookie → CSRF
//           → 会话 → 路由 → 404 → 统一错误处理
// 顺序就是语义：越靠前越先执行，任何一站都能提前返回。
// ============================================================

import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config/env.js';
import { pingDatabase } from './db/pool.js';
import { requestId, requestLogger } from './middleware/request-id.js';
import { securityHeaders } from './middleware/security.js';
import { csrfProtection, issueCsrfToken } from './middleware/csrf.js';
import { userSession, adminSession } from './middleware/session.js';
import { attachUser, attachAdmin, requireAdminActive } from './middleware/auth.js';
import { apiNotFound, errorHandler } from './middleware/error.js';

import { schoolsRouter } from './modules/schools/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { adminAuthRouter } from './modules/admin-auth/routes.js';
import { homeRouter } from './modules/home/routes.js';
import { appsRouter } from './modules/apps/routes.js';
import { examsRouter } from './modules/exams/routes.js';
import { qaRouter } from './modules/qa/routes.js';
import { boardsRouter, postsRouter } from './modules/posts/routes.js';
import { profileRouter } from './modules/profile/routes.js';
import { adminRouter } from './modules/admin/routes.js';

export const app = express();

// 生产环境由 Nginx 反代，信任一层代理头（真实 IP / 协议）
if (config.isProd) app.set('trust proxy', 1);

app.disable('x-powered-by');
app.use(requestId);
app.use(requestLogger);
app.use(securityHeaders);

// 普通 JSON 请求体限制 1MB；文件上传走 /api/exams 的 multipart，不走这里
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// 健康检查：同时验证 HTTP 与 MySQL
app.get('/api/health', async (req, res) => {
  try {
    await pingDatabase();
    res.json({ data: { status: 'ok', db: 'ok', env: config.env } });
  } catch (error) {
    res.status(503).json({ data: { status: 'degraded', db: 'down' } });
  }
});

// 所有写请求校验 CSRF 双提交令牌
app.use('/api', csrfProtection);

// 前端用这个接口拿令牌（会同时 Set-Cookie）
app.get('/api/csrf', issueCsrfToken);

// 用户会话与管理员会话分开：
//   /api/admin/* 只加载 campus_admin_sid；
//   其他 /api/* 只加载 campus_sid。
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/admin')) return next();
  return userSession(req, res, next);
});
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/admin')) return next();
  return attachUser(req, res, next);
});
app.use('/api/admin', adminSession, attachAdmin);

// ---------------- 业务路由 ----------------
app.use('/api/schools', schoolsRouter);
app.use('/api/auth', authRouter);
app.use('/api/admin/auth', adminAuthRouter);

app.use('/api/home', homeRouter);
app.use('/api/apps', appsRouter);
app.use('/api/exams', examsRouter);
app.use('/api/exams', qaRouter);       // /api/exams/:id/questions
app.use('/api/boards', boardsRouter);
app.use('/api/posts', postsRouter);
app.use('/api/profile', profileRouter);

// 后台业务接口必须先完成 TOTP 并选择学校
app.use('/api/admin', requireAdminActive, adminRouter);

// 未匹配的 /api 请求统一 JSON 404
app.use('/api', apiNotFound);

// 开发时由 Express 兜底静态页面；生产静态文件只由 Nginx 提供
if (!config.isProd) {
  app.use(express.static(config.webDir));
}

// 非 API 的未知路径：明确 404，不伪装成 200
app.use((req, res) => {
  res.status(404).type('text/plain; charset=utf-8').send('404 Not Found');
});

// 统一错误出口，必须放在最后
app.use(errorHandler);

export default app;
