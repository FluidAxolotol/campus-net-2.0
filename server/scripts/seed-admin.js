// 只创建初始管理员，不写演示内容。
// 用法：npm run seed:admin
// 已存在同名管理员则跳过；不会覆盖密码。

import { config } from '../src/config/env.js';
import { pool } from '../src/db/pool.js';
import { ensureAdminAccount } from './seed-lib.js';

async function main() {
  const result = await ensureAdminAccount({
    username: config.adminSeed.username,
    displayName: config.adminSeed.displayName,
    password: config.adminSeed.password,
  });

  if (result.created) {
    console.log(`[seed:admin] 已创建管理员 ${config.adminSeed.username}`);
    console.log(`[seed:admin] 初始密码：${config.adminSeed.password}`);
    console.log('[seed:admin] 首次登录必须修改密码并扫码绑定腾讯身份验证器');
  } else {
    console.log(`[seed:admin] 已存在管理员 ${config.adminSeed.username}，跳过`);
  }
  await pool.end();
}

main().catch((error) => {
  console.error('[seed:admin] 失败：', error);
  process.exit(1);
});
