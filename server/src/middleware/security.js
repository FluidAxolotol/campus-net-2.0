// ============================================================
// 基础安全响应头
// CSP 允许本站样式与内联 <style>（现有页面大量使用），
// 但禁止内联 <script>，前端逻辑全部走 /assets/js/ 模块。
// ============================================================

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
      "font-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join('; '),
  );
  next();
}
