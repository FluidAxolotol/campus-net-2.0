// ============================================================
// 环境变量集中读取
// 代码里不直接散落 process.env，所有默认值、校验都在这里。
// ============================================================

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// 当前文件在 server/src/config/env.js，向上两级就是 server/
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const serverRoot = path.resolve(__dirname, '../..');

// 先读 server/.env；测试环境再读 server/.env.test 覆盖。
// dotenv 默认不会覆盖已经存在的变量，所以命令行/系统变量优先级最高。
dotenv.config({ path: path.join(serverRoot, '.env') });
if (process.env.NODE_ENV === 'test') {
  dotenv.config({ path: path.join(serverRoot, '.env.test'), override: true });
}

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const isTest = env.NODE_ENV === 'test';

function required(name, devFallback = '') {
  const value = env[name] ?? devFallback;
  if (!value && isProd) {
    throw new Error(`生产环境缺少必需的环境变量：${name}`);
  }
  return value;
}

function bool(name, fallback = false) {
  if (env[name] === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(env[name]).toLowerCase());
}

function int(name, fallback) {
  const n = Number.parseInt(env[name] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

const totpEncryptionKey = required(
  'TOTP_ENCRYPTION_KEY',
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
);
if (!/^[0-9a-fA-F]{64}$/.test(totpEncryptionKey)) {
  throw new Error('TOTP_ENCRYPTION_KEY 必须是 64 位十六进制字符串（32 字节）');
}

const uploadDir = env.UPLOAD_DIR || './uploads';

export const config = {
  env: env.NODE_ENV || 'development',
  isProd,
  isTest,
  port: int('PORT', 3100),
  publicOrigin: env.PUBLIC_ORIGIN || 'http://localhost:8088',

  // 数据库
  db: {
    host: env.DB_HOST || '127.0.0.1',
    port: int('DB_PORT', 3308),
    name: env.DB_NAME || 'campus2',
    user: env.DB_USER || 'campus2',
    password: env.DB_PASSWORD || 'campus2_pass',
  },

  // 两套会话必须使用不同密钥；生产缺一就启动失败
  sessionSecret: required('SESSION_SECRET', 'dev-user-session-secret-change-me-please-1234567890'),
  adminSessionSecret: required('ADMIN_SESSION_SECRET', 'dev-admin-session-secret-change-me-please-0987654321'),

  // TOTP 密钥加密
  totpEncryptionKey: Buffer.from(totpEncryptionKey, 'hex'),

  // 会话时长
  userSessionTtlMs: 12 * 60 * 60 * 1000,        // 12 小时无操作过期
  rememberMeTtlMs: 7 * 24 * 60 * 60 * 1000,      // 记住我 7 天
  adminSessionTtlMs: 30 * 60 * 1000,             // 管理员 30 分钟无操作过期

  // 文件
  uploadDir: path.isAbsolute(uploadDir) ? uploadDir : path.resolve(serverRoot, uploadDir),
  maxFileSize: 20 * 1024 * 1024,                 // 业务上限 20MB
  maxMultipartSize: 21 * 1024 * 1024,            // multipart 留 1MB 余量
  useXAccel: bool('USE_X_ACCEL', false),

  // 开发/测试便捷开关
  rateLimitDisabled: bool('RATE_LIMIT_DISABLED', false),

  // 首次管理员种子
  adminSeed: {
    username: env.ADMIN_USERNAME || 'campusadmin',
    displayName: env.ADMIN_DISPLAY_NAME || '平台管理员',
    password: env.ADMIN_DEFAULT_PASSWORD || 'Admin@2026',
  },
  seedUserPassword: env.SEED_USER_PASSWORD || 'Student@2026',

  // 静态文件目录（开发时由 Express 兜底；生产由 Nginx 提供）
  webDir: path.resolve(serverRoot, '../web'),

  // 密码 / 登录策略
  passwordMinLength: 8,
  passwordMaxLength: 64,
  maxLoginFailures: 5,
  lockMinutes: 15,
};
