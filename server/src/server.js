// ============================================================
// 启动入口：
//   1. 准备上传目录；
//   2. 先验证数据库能连上；
//   3. 只监听 127.0.0.1（公网入口是 Nginx）；
//   4. 优雅退出。
// ============================================================

import { app } from './app.js';
import { config } from './config/env.js';
import { pool, pingDatabase } from './db/pool.js';
import { ensureUploadDir } from './utils/files.js';
import { cleanupExpiredSessions } from './middleware/mysql-session-store.js';

async function main() {
  await ensureUploadDir();

  const dbOk = await pingDatabase();
  if (!dbOk) throw new Error('数据库健康检查失败');

  const server = app.listen(config.port, '127.0.0.1', () => {
    console.log(`[campus2] env=${config.env} listen=127.0.0.1:${config.port}`);
    console.log(`[campus2] db=${config.db.host}:${config.db.port}/${config.db.name}`);
    console.log(`[campus2] uploads=${config.uploadDir}`);
  });

  // 每小时清理一次过期会话，避免会话表无限增长
  const sessionCleaner = setInterval(() => {
    cleanupExpiredSessions().catch((error) => {
      console.error('[campus2] 清理过期会话失败', error.message);
    });
  }, 60 * 60 * 1000);
  sessionCleaner.unref?.();

  async function shutdown(signal) {
    console.log(`[campus2] 收到 ${signal}，正在关闭…`);
    clearInterval(sessionCleaner);
    server.close(async () => {
      try {
        await pool.end();
      } finally {
        process.exit(0);
      }
    });
    // 兜底：10 秒内没关完就强制退出
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[campus2] 启动失败：', error);
  process.exit(1);
});
