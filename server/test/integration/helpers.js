// ============================================================
// 集成测试辅助
// 独立测试库 campus2_test：每次测试前清表重建，不碰演示库。
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import supertest from 'supertest';
import { app } from '../../src/app.js';
import { config, serverRoot } from '../../src/config/env.js';
import { pool, query, queryOne } from '../../src/db/pool.js';
import {
  hashPassword, encryptSecret, generateTotp, generateTotpSecret,
} from '../../src/utils/crypto.js';
import { makeDemoPdf } from '../../scripts/seed-lib.js';

export const agent = () => supertest.agent(app);

export async function resetDatabase() {
  if (config.db.name !== 'campus2_test') {
    throw new Error(`拒绝清空非测试库：${config.db.name}`);
  }
  const connection = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.name,
    multipleStatements: true,
    timezone: 'Z',
  });
  try {
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    const [tables] = await connection.query(
      `SELECT table_name AS name
         FROM information_schema.tables
        WHERE table_schema = ?`,
      [config.db.name],
    );
    for (const table of tables) {
      await connection.query(`DROP TABLE IF EXISTS \`${table.name}\``);
    }
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    const schema = await fs.readFile(path.join(serverRoot, 'sql/001_init.sql'), 'utf8');
    await connection.query(schema);
  } finally {
    await connection.end();
  }
  await fs.mkdir(config.uploadDir, { recursive: true });
}

export async function seedBase() {
  await query(
    `INSERT INTO schools (id, name, code, email_domain, status) VALUES
      (1, '中山大学', 'sysu', 'mail.sysu.edu.cn', 'active'),
      (2, '华南理工大学', 'scut', 'mail.scut.edu.cn', 'active')`,
  );
  await query(
    `INSERT INTO boards (school_id, code, name, sort_order) VALUES
      (1, 'secondhand', '二手交易', 10),
      (2, 'secondhand', '二手交易', 10)`,
  );

  const passwordHash = await hashPassword('Student@2026');
  const alice = await insertUser({
    schoolId: 1, studentNo: '23331001', email: 'alice@mail.sysu.edu.cn',
    displayName: '小张', passwordHash,
  });
  const carol = await insertUser({
    schoolId: 2, studentNo: '20230001', email: 'carol@mail.scut.edu.cn',
    displayName: 'Carol', passwordHash,
  });

  await query(
    `INSERT INTO apps (school_id, title, category, summary, icon, steps, views, status)
     VALUES (1, '本校工具一号', '学习', '只属于中山大学的工具', '🧭', JSON_ARRAY(), 10, 'active'),
            (2, '华工工具一号', '学习', '只属于华南理工的工具', '🧭', JSON_ARRAY(), 20, 'active')`,
  );

  const totpSecret = generateTotpSecret();
  const adminPasswordHash = await hashPassword('Admin@2026');
  await query(
    `INSERT INTO admins
       (id, username, display_name, password_hash, totp_secret_encrypted,
        totp_confirmed, must_change_password, status)
     VALUES (1, 'testadmin', '测试管理员', ?, ?, 1, 0, 'active')`,
    [adminPasswordHash, encryptSecret(totpSecret)],
  );
  await query(
    `INSERT INTO users
       (school_id, student_no, email, display_name, password_hash, degree, enroll_year, status)
     VALUES (1, '23331999', 'pending@mail.sysu.edu.cn', '待审核', ?, '本科', 2025, 'pending')`,
    [passwordHash],
  );

  return { alice, carol, totpSecret };
}

async function insertUser({ schoolId, studentNo, email, displayName, passwordHash }) {
  const result = await query(
    `INSERT INTO users
       (school_id, student_no, email, display_name, password_hash, degree, enroll_year, college, status)
     VALUES (?, ?, ?, ?, ?, '本科', 2023, '计算机学院', 'active')`,
    [schoolId, studentNo, email, displayName, passwordHash],
  );
  return result.insertId;
}

export async function createExamWithFile({ schoolId, uploaderId, title, status = 'approved' }) {
  const storageKey = `${crypto.randomUUID()}.pdf`;
  const pdf = makeDemoPdf('Test Exam', ['Integration test file']);
  await fs.mkdir(config.uploadDir, { recursive: true });
  await fs.writeFile(path.join(config.uploadDir, storageKey), pdf);

  const fileResult = await query(
    `INSERT INTO files
       (school_id, uploader_id, storage_key, original_name, mime_type, size_bytes, sha256)
     VALUES (?, ?, ?, ?, 'application/pdf', ?, ?)`,
    [
      schoolId,
      uploaderId,
      storageKey,
      `${title}.pdf`,
      pdf.length,
      crypto.createHash('sha256').update(pdf).digest('hex'),
    ],
  );
  const examResult = await query(
    `INSERT INTO exams
       (school_id, file_id, uploader_id, title, subject, college, semester,
        exam_type, has_answer, status)
     VALUES (?, ?, ?, ?, '数据结构', '计算机学院', '2025 春', '期末', 1, ?)`,
    [schoolId, fileResult.insertId, uploaderId, title, status],
  );
  return examResult.insertId;
}

export async function getCsrf(authAgent) {
  const response = await authAgent.get('/api/csrf').expect(200);
  return response.body.data.token;
}

export async function loginUser(authAgent, account, password = 'Student@2026', rememberMe = false) {
  const token = await getCsrf(authAgent);
  return authAgent
    .post('/api/auth/login')
    .set('X-CSRF-Token', token)
    .send({ account, password, rememberMe });
}

export async function loginAdmin(authAgent, { schoolId = 1, secret, username = 'testadmin', password = 'Admin@2026' } = {}) {
  const token = await getCsrf(authAgent);
  const start = await authAgent
    .post('/api/admin/auth/login')
    .set('X-CSRF-Token', token)
    .send({ schoolId, username, password });
  if (start.status !== 200) return { start, verify: null, code: null };
  if (start.body.data.stage !== 'totp_required') return { start, verify: null, code: null };

  const code = generateTotp(secret);
  const verifyToken = await getCsrf(authAgent);
  const verify = await authAgent
    .post('/api/admin/auth/verify')
    .set('X-CSRF-Token', verifyToken)
    .send({ code });
  return { start, verify, code };
}

export async function closePool() {
  await pool.end();
}

export { query, queryOne };
