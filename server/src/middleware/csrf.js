// ============================================================
// CSRF 双提交令牌
// Cookie 里一份、请求头里一份，两边相等才放行。
// 恶意站点能自动带 Cookie，但拿不到页面里的令牌，也就伪造不了请求头。
// ============================================================

import { randomToken, safeEqual } from '../utils/crypto.js';
import { config } from '../config/env.js';
import { AppError } from '../utils/errors.js';

export const CSRF_COOKIE = 'campus_csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function cookieOptions() {
  return {
    httpOnly: false,        // 前端必须能读出来放进请求头
    sameSite: 'lax',
    secure: config.isProd,  // 生产 HTTPS 下只走加密连接
    path: '/',
    maxAge: 2 * 60 * 60 * 1000,
  };
}

// GET /api/csrf：没有令牌就发一个，有就复用
export function issueCsrfToken(req, res, next) {
  try {
    const existing = req.cookies?.[CSRF_COOKIE];
    const token = typeof existing === 'string' && existing.length >= 20
      ? existing
      : randomToken(24);
    res.cookie(CSRF_COOKIE, token, cookieOptions());
    res.json({ data: { token } });
  } catch (error) {
    next(error);
  }
}

// 所有写请求都要过这一关；GET/HEAD/OPTIONS 只读，放行
export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get('X-CSRF-Token');
  if (
    typeof cookieToken !== 'string'
    || typeof headerToken !== 'string'
    || !cookieToken
    || !headerToken
    || !safeEqual(cookieToken, headerToken)
  ) {
    return next(new AppError(403, 'CSRF_INVALID', '页面令牌已过期，请刷新后重试'));
  }
  return next();
}
