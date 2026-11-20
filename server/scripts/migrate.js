// ============================================================
// 数据库迁移：按文件名顺序执行 server/sql/*.sql
// 已执行的版本记录在 schema_migrations，可重复运行，不会重复建表。
// 用法：npm run migrate
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { config, serverRoot } from '../src/config/env.js';

const DB_NAME_RE = /^[A-Za-z0-9_]+$/;
const SQL_DIR = path.join(serverRoot, 'sql');

async function main() {
  if (!DB_NAME_RE.test(config.db.name)) {
    throw new Error('DB_NAME 只能包含字母、数字和下划线');
  }

  // 先不带库名连接，尝试创建数据库（Docker 已创建时可以忽略权限错误）
  try {
    const adminConnection = await mysql.createConnection({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      multipleStatements: true,
    });
    await adminConnection.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.db.name}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
    await adminConnection.end();
  } catch (error) {
    console.log(`[migrate] 跳过自动建库：${error.message}`);
  }

  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.name,
    multipleStatements: true,
    charset: 'utf8mb4',
    timezone: 'Z',
  });

  try {
    await connection.query("SET time_zone = '+00:00'");
    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(64) NOT NULL PRIMARY KEY,
        applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [appliedRows] = await connection.query('SELECT version FROM schema_migrations');
    const applied = new Set(appliedRows.map((row) => row.version));

    const files = (await fs.readdir(SQL_DIR))
      .filter((name) => name.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`[migrate] skip   ${file}`);
        continue;
      }
      const sql = await fs.readFile(path.join(SQL_DIR, file), 'utf8');
      console.log(`[migrate] apply  ${file}`);
      await connection.query(sql);
      await connection.query('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
    }
    console.log('[migrate] 完成');
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('[migrate] 失败：', error);
  process.exit(1);
});
