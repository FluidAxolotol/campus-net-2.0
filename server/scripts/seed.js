// ============================================================
// 写入本地演示数据（幂等）
// 顺序：管理员 → 学校 → 版块 → 应用 → 用户 → 帖子 → 真题 → 纠错
// 用法：npm run seed
// ============================================================

import { config } from '../src/config/env.js';
import { pool } from '../src/db/pool.js';
import { ensureUploadDir } from '../src/utils/files.js';
import { ensureAdminAccount, seedDemoData } from './seed-lib.js';

async function main() {
  await ensureUploadDir();

  const admin = await ensureAdminAccount({
    username: config.adminSeed.username,
    displayName: config.adminSeed.displayName,
    password: config.adminSeed.password,
  });
  const data = await seedDemoData();

  console.log('==============================================');
  console.log('演示数据已就绪');
  console.log(`学校：${data.schools.map((s) => s.name).join(' / ')}`);
  console.log(`管理员：${config.adminSeed.username} / ${config.adminSeed.password}`);
  console.log(`  首次登录：${admin.mustChangePassword ? '需要改密并扫码绑定腾讯身份验证器' : '已完成初始化'}`);
  console.log(`演示学生：alice@mail.sysu.edu.cn / ${config.seedUserPassword}`);
  console.log(`待审核学生：pending@mail.sysu.edu.cn / ${config.seedUserPassword}`);
  console.log('==============================================');

  await pool.end();
}

main().catch((error) => {
  console.error('[seed] 失败：', error);
  process.exit(1);
});
