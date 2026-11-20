// ============================================================
// 统一错误出口
// 路由里不写 res.status(500)；所有错误最后都变成一种 JSON 形状。
// ============================================================

import multer from 'multer';
import { config } from '../config/env.js';

export function apiNotFound(req, res) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: '接口不存在',
      requestId: req.id,
    },
  });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  let status = Number(error.status) || 500;
  let code = error.code || 'INTERNAL_ERROR';
  let message = error.message || '服务器开小差了';
  let details = error.details;

  // multer 的“文件过大 / 字段名不匹配”转成业务错误码
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      status = 413;
      code = 'FILE_TOO_LARGE';
      message = '文件超过 20MB 限制';
    } else {
      status = 422;
      code = 'UPLOAD_INVALID';
      message = '上传格式不正确';
    }
  }

  // express.json() 解析失败
  if (error.type === 'entity.parse.failed') {
    status = 400;
    code = 'JSON_INVALID';
    message = '请求体不是合法 JSON';
  }

  if (status >= 500) {
    message = config.isProd ? '服务器开小差了，请稍后再试' : message;
    console.error(`[${req.id}] unhandled error`, error);
  }

  res.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      requestId: req.id,
    },
  });
}
