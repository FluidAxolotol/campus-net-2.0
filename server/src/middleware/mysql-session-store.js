// ============================================================
// express-session 的 MySQL Store
// 数据库里存的是 SHA-256(sid)，不是原始 sid。
// 即使数据库泄露，攻击者也拿不到可以使用的 Cookie。
// ============================================================

import session from 'express-session';
import { pool } from '../db/pool.js';
import { sha256Hex } from '../utils/crypto.js';

const ALLOWED_TABLES = new Set(['user_sessions', 'admin_sessions']);
const ALLOWED_ID_FIELDS = new Set(['user_id', 'admin_id']);

export class MysqlSessionStore extends session.Store {
  constructor({ table, idField, sessionKey, defaultTtlMs }) {
    super();
    if (!ALLOWED_TABLES.has(table) || !ALLOWED_ID_FIELDS.has(idField)) {
      throw new Error('Session Store 配置非法');
    }
    // idField 是数据库列名（user_id / admin_id），
    // sessionKey 是 express-session 里保存的字段名（userId / adminId）。
    this.table = table;
    this.idField = idField;
    this.sessionKey = sessionKey;
    this.defaultTtlMs = defaultTtlMs;
  }

  get(sid, callback) {
    const hashedId = sha256Hex(sid);
    pool.execute(
      `SELECT data FROM ${this.table}
        WHERE id = ? AND expires_at > UTC_TIMESTAMP(3)
        LIMIT 1`,
      [hashedId],
    )
      .then(([rows]) => {
        if (!rows.length) return callback(null, null);
        const raw = rows[0].data;
        // mysql2 可能已经把 JSON 列解析成对象，也可能返回字符串
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return callback(null, data);
      })
      .catch((error) => callback(error));
  }

  set(sid, sessionData, callback) {
    try {
      const hashedId = sha256Hex(sid);
      const actorId = sessionData[this.sessionKey];
      if (!actorId) {
        // 未登录的空会话不应该落库（saveUninitialized=false 时通常不会走到这里）
        return callback(null);
      }
      const expiresAt = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires)
        : new Date(Date.now() + this.defaultTtlMs);
      const json = JSON.stringify(sessionData);

      pool.execute(
        `INSERT INTO ${this.table} (id, ${this.idField}, data, expires_at, last_seen_at)
         VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE
           data = ?,
           expires_at = ?,
           last_seen_at = UTC_TIMESTAMP(3)`,
        [hashedId, actorId, json, expiresAt, json, expiresAt],
      )
        .then(() => callback(null))
        .catch((error) => callback(error));
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sessionData, callback) {
    try {
      const hashedId = sha256Hex(sid);
      const expiresAt = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires)
        : new Date(Date.now() + this.defaultTtlMs);
      pool.execute(
        `UPDATE ${this.table}
            SET expires_at = ?, last_seen_at = UTC_TIMESTAMP(3)
          WHERE id = ?`,
        [expiresAt, hashedId],
      )
        .then(() => callback(null))
        .catch((error) => callback(error));
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback) {
    pool.execute(`DELETE FROM ${this.table} WHERE id = ?`, [sha256Hex(sid)])
      .then(() => callback(null))
      .catch((error) => callback(error));
  }

  length(callback) {
    pool.execute(`SELECT COUNT(*) AS n FROM ${this.table} WHERE expires_at > UTC_TIMESTAMP(3)`)
      .then(([rows]) => callback(null, Number(rows[0].n)))
      .catch((error) => callback(error));
  }

  clear(callback) {
    pool.execute(`DELETE FROM ${this.table}`)
      .then(() => callback(null))
      .catch((error) => callback(error));
  }
}

export async function cleanupExpiredSessions() {
  await pool.execute('DELETE FROM user_sessions WHERE expires_at <= UTC_TIMESTAMP(3)');
  await pool.execute('DELETE FROM admin_sessions WHERE expires_at <= UTC_TIMESTAMP(3)');
}
