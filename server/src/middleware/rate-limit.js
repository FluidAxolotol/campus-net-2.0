// ============================================================
// 极简内存限流器（固定窗口）
// 单机课程项目够用；多实例时应换成 Redis 等共享存储。
// ============================================================

import { config } from '../config/env.js';
import { AppError } from '../utils/errors.js';

const buckets = new Map();

// 每分钟清理一次过期桶，防止 Map 越来越大
const cleaner = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000);
cleaner.unref?.();

/**
 * @param {string} name 限流名称，用来区分不同接口
 * @param {number} windowMs 时间窗口
 * @param {number} max 窗口内允许次数
 */
export function rateLimit(name, windowMs, max) {
  return (req, res, next) => {
    if (config.rateLimitDisabled) return next();

    // req.ip 在信任代理后是 X-Forwarded-For 中的真实客户端 IP
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return next(new AppError(429, 'RATE_LIMITED', '操作太频繁，请稍后再试', { retryAfter }));
    }
    return next();
  };
}
