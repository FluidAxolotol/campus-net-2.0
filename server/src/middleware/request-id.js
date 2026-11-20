// ============================================================
// 请求 ID：让 Nginx、Node、错误响应能用同一个 id 串起来
// ============================================================

import { randomUUID } from 'node:crypto';

export function requestId(req, res, next) {
  const incoming = req.get('X-Request-Id');
  req.id = typeof incoming === 'string' && incoming.length <= 64
    ? incoming
    : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

export function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    // 健康检查每几秒一次，记录它会淹没真正的业务日志
    if (req.path === '/api/health') return;

    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const actor = req.admin
      ? `admin:${req.admin.id}`
      : req.user
        ? `user:${req.user.id}`
        : 'guest';
    console.log(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${elapsedMs.toFixed(1)}ms req=${req.id} actor=${actor}`,
    );
  });

  next();
}
