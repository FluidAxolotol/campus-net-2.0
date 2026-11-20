// ============================================================
// 统一业务错误
// 路由/service 只负责抛错，最后由 errorHandler 转成
// { error: { code, message, details?, requestId } }
// ============================================================

export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const errors = {
  unauthorized: () => new AppError(401, 'UNAUTHENTICATED', '请先登录'),
  forbidden: (message = '没有权限') => new AppError(403, 'FORBIDDEN', message),
  notFound: (message = '资源不存在') => new AppError(404, 'NOT_FOUND', message),
  validation: (fields) => new AppError(422, 'VALIDATION_FAILED', '请检查填写内容', fields),
  csrf: () => new AppError(403, 'CSRF_INVALID', '页面令牌已过期，请刷新后重试'),
  rateLimited: () => new AppError(429, 'RATE_LIMITED', '操作太频繁，请稍后再试'),
  conflict: (code, message) => new AppError(409, code, message),
};
