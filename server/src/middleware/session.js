// ============================================================
// 两套完全独立的会话：用户 campus_sid / 管理员 campus_admin_sid
// 两套 Store、两套密钥、两个 Cookie 名；用户 Cookie 进不了后台。
// ============================================================

import session from 'express-session';
import { config } from '../config/env.js';
import { MysqlSessionStore } from './mysql-session-store.js';

export const userSessionStore = new MysqlSessionStore({
  table: 'user_sessions',
  idField: 'user_id',
  sessionKey: 'userId',
  defaultTtlMs: config.userSessionTtlMs,
});

export const adminSessionStore = new MysqlSessionStore({
  table: 'admin_sessions',
  idField: 'admin_id',
  sessionKey: 'adminId',
  defaultTtlMs: config.adminSessionTtlMs,
});

export const userSession = session({
  name: 'campus_sid',
  secret: config.sessionSecret,
  store: userSessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true, // 每次请求续期，活跃用户不中途掉线
  cookie: {
    httpOnly: true,       // JavaScript 读不到，降低 XSS 偷会话风险
    sameSite: 'lax',      // 跨站写请求默认不带 Cookie
    secure: config.isProd,
    path: '/',
    // 默认不设 maxAge：关闭浏览器即失效；勾选“记住我”时登录路由会改成 7 天
  },
});

export const adminSession = session({
  name: 'campus_admin_sid',
  secret: config.adminSessionSecret,
  store: adminSessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
    maxAge: config.adminSessionTtlMs, // 30 分钟无操作过期
  },
});

// express-session 的回调 API 用起来啰嗦，包一层 Promise 方便 async/await
export function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

export function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

export function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}
