// ============================================================
// MySQL 连接池与事务封装
// 连接池 = 复用连接 + 限制并发 + 统一生命周期。
// ============================================================

import mysql from 'mysql2/promise';
import { config } from '../config/env.js';

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: 'Z',
  supportBigNumbers: true,
  bigNumberStrings: false,
  decimalNumbers: true,
});

// 每条连接建立后，把会话时区固定为 UTC。
// 这样 CURRENT_TIMESTAMP(3) 与 UTC_TIMESTAMP(3) 对得上，会话过期判断不会错。
pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00'");
});

export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}

/**
 * 事务：同一个业务操作里的多条 SQL 共享同一条连接。
 * 任何一步抛错就 ROLLBACK；最后无论在哪儿退出都 release。
 */
export async function withTransaction(fn) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // 回滚失败时保留原始错误，交给上层日志
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function pingDatabase() {
  const rows = await query('SELECT 1 AS ok');
  return rows[0]?.ok === 1;
}
