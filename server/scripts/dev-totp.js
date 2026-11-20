// ============================================================
// 本地开发辅助：生成当前 6 位 TOTP
// 用法：npm run dev:totp -- <Base32密钥>
// 也可以不传密钥，从数据库读取 demo 管理员的加密密钥。
// 生产环境直接拒绝执行。
// ============================================================

import { config } from '../src/config/env.js';
import { pool, queryOne } from '../src/db/pool.js';
import { decryptSecret, generateTotp } from '../src/utils/crypto.js';

async function main() {
  if (config.isProd) {
    console.error('[dev:totp] 生产环境禁止使用；请用腾讯身份验证器');
    process.exit(1);
  }

  let secret = process.argv[2];
  if (!secret) {
    const admin = await queryOne(
      'SELECT totp_secret_encrypted FROM admins WHERE username = ? LIMIT 1',
      [config.adminSeed.username],
    );
    if (!admin?.totp_secret_encrypted) {
      console.error('数据库里没有管理员 TOTP 密钥，请传一个 Base32 密钥作为参数');
      process.exit(1);
    }
    secret = decryptSecret(admin.totp_secret_encrypted);
  }

  console.log(generateTotp(secret));
  await pool.end();
}

main().catch((error) => {
  console.error('[dev:totp] 失败：', error);
  process.exit(1);
});
