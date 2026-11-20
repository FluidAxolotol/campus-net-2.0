// ============================================================
// 管理后台业务接口
// 所有查询/写入都带 req.currentSchool.id（来自管理员会话），
// 跨校资源一律 404，不暴露“东西存在但你没权限”。
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { pool, query, queryOne, withTransaction } from '../../db/pool.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { parse, numericId, paginationFrom } from '../../utils/validate.js';
import {
  formatRegistration, formatExam, formatPost, formatCorrection,
  formatResetRequest, formatAudit, formatApp, formatSchool,
} from '../../utils/serializers.js';
import { hashPassword, generateTempPassword } from '../../utils/crypto.js';
import { AppError } from '../../utils/errors.js';
import { writeAudit } from './audit.js';

export const adminRouter = Router();

// 后台整体做一个宽松限流，避免脚本狂刷
adminRouter.use(rateLimit('admin-api', 60 * 1000, 300));

// ---------------- 工作台 ----------------
adminRouter.get('/overview', async (req, res) => {
  const schoolId = req.currentSchool.id;
  const row = await queryOne(
    `SELECT
       (SELECT COUNT(*) FROM users WHERE school_id = ? AND status = 'pending') AS pending_users,
       (SELECT COUNT(*) FROM users WHERE school_id = ? AND status = 'active') AS active_users,
       (SELECT COUNT(*) FROM exams WHERE school_id = ? AND status = 'pending') AS pending_exams,
       (SELECT COUNT(*) FROM exams WHERE school_id = ? AND status = 'approved') AS approved_exams,
       (SELECT COUNT(*) FROM posts WHERE school_id = ? AND status = 'published') AS published_posts,
       (SELECT COUNT(*) FROM corrections WHERE school_id = ? AND status = 'open') AS open_corrections,
       (SELECT COUNT(*) FROM password_reset_requests WHERE school_id = ? AND status = 'open') AS open_resets,
       (SELECT COUNT(*) FROM apps WHERE school_id = ? AND status = 'active') AS active_apps`,
    Array(8).fill(schoolId),
  );

  res.json({
    data: {
      school: formatSchool(req.currentSchool),
      stats: {
        pendingUsers: Number(row.pending_users) || 0,
        activeUsers: Number(row.active_users) || 0,
        pendingExams: Number(row.pending_exams) || 0,
        approvedExams: Number(row.approved_exams) || 0,
        publishedPosts: Number(row.published_posts) || 0,
        openCorrections: Number(row.open_corrections) || 0,
        openResets: Number(row.open_resets) || 0,
        activeApps: Number(row.active_apps) || 0,
      },
    },
  });
});

// ---------------- 注册审核 / 用户管理 ----------------
adminRouter.get('/registrations', async (req, res) => {
  const schoolId = req.currentSchool.id;
  const status = parse(
    z.enum(['pending', 'active', 'rejected', 'disabled']),
    req.query.status || 'pending',
  );
  const { page, pageSize, offset } = paginationFrom(req.query);

  const [rows, countRow] = await Promise.all([
    query(
      `SELECT u.id, u.school_id, u.student_no, u.email, u.display_name,
              u.degree, u.enroll_year, u.college, u.bio, u.status,
              u.reject_reason, u.created_at, u.reviewed_at,
              s.name AS school_name, s.code AS school_code, s.email_domain
         FROM users u
         JOIN schools s ON s.id = u.school_id
        WHERE u.school_id = ? AND u.status = ?
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      [schoolId, status],
    ),
    queryOne(
      'SELECT COUNT(*) AS n FROM users WHERE school_id = ? AND status = ?',
      [schoolId, status],
    ),
  ]);

  const total = Number(countRow?.n) || 0;
  res.json({
    data: rows.map(formatRegistration),
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  });
});

adminRouter.post('/registrations/:id/approve', async (req, res) => {
  const id = parse(numericId, req.params.id);
  const schoolId = req.currentSchool.id;

  await withTransaction(async (conn) => {
    const [result] = await conn.execute(
      `UPDATE users
          SET status = 'active', reject_reason = NULL,
              reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(3)
        WHERE id = ? AND school_id = ? AND status = 'pending'`,
      [req.admin.id, id, schoolId],
    );
    if (result.affectedRows !== 1) {
      throw new AppError(404, 'REGISTRATION_NOT_FOUND', '待审核用户不存在');
    }
    await writeAudit(conn, {
      schoolId,
      actorType: 'admin',
      actorId: req.admin.id,
      action: 'user.approve',
      targetType: 'user',
      targetId: id,
      ip: req.ip,
    });
  });

  res.json({ data: { message: '已通过审核，该用户现在可以登录' } });
});

const rejectSchema = z.object({
  reason: z.string().trim().min(1, '请填写驳回原因').max(200, '原因最多 200 字'),
});

adminRouter.post('/registrations/:id/reject', async (req, res) => {
  const id = parse(numericId, req.params.id);
  const schoolId = req.currentSchool.id;
  const input = parse(rejectSchema, req.body);

  await withTransaction(async (conn) => {
    const [result] = await conn.execute(
      `UPDATE users
          SET status = 'rejected', reject_reason = ?,
              reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(3)
        WHERE id = ? AND school_id = ? AND status = 'pending'`,
      [input.reason, req.admin.id, id, schoolId],
    );
    if (result.affectedRows !== 1) {
      throw new AppError(404, 'REGISTRATION_NOT_FOUND', '待审核用户不存在');
    }
    await writeAudit(conn, {
      schoolId,
      actorType: 'admin',
      actorId: req.admin.id,
      action: 'user.reject',
      targetType: 'user',
      targetId: id,
      detail: { reason: input.reason },
      ip: req.ip,
    });
  });

  res.json({ data: { message: '已驳回该注册申请' } });
});

const userStatusSchema = z.object({
  status: z.enum(['active', 'disabled']),
});

adminRouter.post('/users/:id/status', async (req, res) => {
  const id = parse(numericId, req.params.id);
  const schoolId = req.currentSchool.id;
  const input = parse(userStatusSchema, req.body);

  await withTransaction(async (conn) => {
    const [result] = await conn.execute(
      'UPDATE users SET status = ? WHERE id = ? AND school_id = ?',
      [input.status, id, schoolId],
    );
    if (result.affectedRows !== 1) {
      throw new AppError(404, 'USER_NOT_FOUND', '用户不存在');
    }
    if (input.status === 'disabled') {
      // 停用立即生效：删掉这个用户的所有会话
      await conn.execute('DELETE FROM user_sessions WHERE user_id = ?', [id]);
    }
    await writeAudit(conn, {
      schoolId,
      actorType: 'admin',
      actorId: req.admin.id,
      action: input.status === 'active' ? 'user.enable' : 'user.disable',
      targetType: 'user',
      targetId: id,
      ip: req.ip,
    });
  });

  res.json({ data: { message: input.status === 'active' ? '已启用该用户' : '已停用该用户' } });
});

// ---------------- 真题审核 ----------------
adminRouter.get('/exams', async (req, res) => {
  const schoolId = req.currentSchool.id;
  const status = parse(
    z.enum(['pending', 'approved', 'rejected']),
    req.query.status || 'pending',
  );
  const { page, pageSize, offset } = paginationFrom(req.query);

  const [rows, countRow] = await Promise.all([
    query(
      `SELECT e.id, e.title, e.subject, e.college, e.semester, e.exam_type,
              e.has_answer, e.status, e.download_count, e.review_note, e.created_at,
              e.file_id, e.uploader_id,
              f.original_name AS file_name, f.mime_type, f.size_bytes,
              u.display_name AS uploader_name
         FROM exams e
         JOIN files f ON f.id = e.file_id AND f.school_id = e.school_id
         JOIN users u ON u.id = e.uploader_id AND u.school_id = e.school_id
        WHERE e.school_id = ? AND e.status = ?
        ORDER BY e.created_at ASC, e.id ASC
        LIMIT ${pageSize} OFFSET ${offset}`,
      [schoolId, status],
    ),
    queryOne(
      'SELECT COUNT(*) AS n FROM exams WHERE school_id = ? AND status = ?',
      [schoolId, status],
    ),
  ]);

  const total = Number(countRow?.n) || 0;
  res.json({
    data: rows.map(formatExam),
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  });
});

const reviewSchema = z.object({
  action: z.enum(['approve', 'reject']),
  note: z.string().trim().max(255, '备注最多 255 字').optional().default(''),
});

adminRouter.post('/exams/:id/review', async (req, res) => {
  const id = parse(numericId, req.params.id);
  const schoolId = req.currentSchool.id;
  const input = parse(reviewSchema, req.body);
  if (input.action === 'reject' && !input.note) {
    throw new AppError(422, 'VALIDATION_FAILED', '驳回时请填写原因', { note: '请填写驳回原因' });
  }

  await withTransaction(async (conn) => {
    const [rows] = await conn.execute(
      'SELECT id, status FROM exams WHERE id = ? AND school_id = ? FOR UPDATE',
      [id, schoolId],
    );
    if (!rows.length) throw new AppError(404, 'EXAM_NOT_FOUND', '真题不存在');
    if (rows[0].status !== 'pending') {
      throw new AppError(409, 'EXAM_ALREADY_REVIEWED', '这条真题已经审核过了');
    }

    const nextStatus = input.action === 'approve' ? 'approved' : 'rejected';
    await conn.execute(
      `UPDATE exams
          SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP(3)
        WHERE id = ? AND school_id = ?`,
      [nextStatus, input.note || null, req.admin.id, id, schoolId],
    );
    await writeAudit(conn, {
      schoolId,
      actorType: 'admin',
      actorId: req.admin.id,
      action: `exam.${input.action}`,
      targetType: 'exam',
      targetId: id,
      detail: { note: input.note },
      ip: req.ip,
    });
  });

  res.json({ data: { message: input.action === 'approve' ? '已通过审核' : '已驳回' } });
});

// ---------------- 社区管理 ----------------
adminRouter.get('/posts', async (req, res) => {
  const schoolId = req.currentSchool.id;
  const status = parse(
    z.enum(['published', 'hidden', 'deleted']),
    req.query.status || 'published',
  );
  const { page, pageSize, offset } = paginationFrom(req.query);

  const [rows, countRow] = await Promise.all([
    query(
      `SELECT p.id, p.board_id, p.author_id, p.title, p.content, p.status,
              p.like_count, p.comment_count, p.created_at,
              b.code AS board_code, b.name AS board_name,
              u.display_name AS author_name,
              0 AS liked_by_me
         FROM posts p
         JOIN boards b ON b.id = p.board_id AND b.school_id = p.school_id
         JOIN users u ON u.id = p.author_id AND u.school_id = p.school_id
        WHERE p.school_id = ? AND p.status = ?
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      [schoolId, status],
    ),
    queryOne(
      'SELECT COUNT(*) AS n FROM posts WHERE school_id = ? AND status = ?',
      [schoolId, status],
    ),
  ]);

  const total = Number(countRow?.n) || 0;
  res.json({
    data: rows.map(formatPost),
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  });
});

const postStatusSchema = z.object({
  status: z.enum(['published', 'hidden', 'deleted']),
});

adminRouter.post('/posts/:id/status', async (req, res) => {
  const id = parse(numericId, req.params.id);
  const schoolId = req.currentSchool.id;
  const input = parse(postStatusSchema, req.body);

  await withTransaction(async (conn) => {
    const [result] = await conn.execute(
      'UPDATE posts SET status = ? WHERE id = ? AND school_id = ?',
      [input.status, id, schoolId],
    );
    if (result.affectedRows !== 1) {
      throw new AppError(404, 'POST_NOT_FOUND', '帖子不存在');
    }
    await writeAudit(conn, {
      schoolId,
      actorType: 'admin',
      actorId: req.admin.id,
      action: `post.${input.status}`,
      targetType: 'post',
      targetId: id,
      ip: req.ip,
    });
  });

  res.json({ data: { message: '帖子状态已更新' } });
});

// ---------------- 纠错反馈 ----------------
adminRouter.get('/corrections', async (req, res) => {
  const schoolId = req.currentSchool.id;
  const status = parse(
    z.enum(['open', 'resolved', 'ignored']),
    req.query.status || 'open',
  );
  const { page, pageSize, offset } = paginationFrom(req.query);

  const [rows, countRow] = await Promise.all([
    query(
      `SELECT c.id, c.target_type, c.target_id, c.user_id, c.content,
              c.status, c.admin_note, c.created_at, c.resolved_at,
              u.display_name AS user_name,
              a.title AS target_title
         FROM corrections c
         JOIN users u ON u.id = c.user_id AND u.school_id = c.school_id
         LEFT JOIN apps a
           ON c.target_type = 'app' AND a.id = c.target_id AND a.school_id = c.school_id
        WHERE c.school_id = ? AND c.status = ?
        ORDER BY c.created_at ASC, c.id ASC
        LIMIT ${pageSize} OFFSET ${offset}`,
      [schoolId, status],
    ),
    queryOne(
      'SELECT COUNT(*) AS n FROM corrections WHERE school_id = ? AND status = ?',
      [schoolId, status],
    ),
  ]);

  const total = Number(countRow?.n) || 0;
  res.json({
    data: rows.map(formatCorrection),
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  });
});

const correctionStatusSchema = z.object({
  status: z.enum(['resolved', 'ignored']),
  note: z.string().trim().max(255, '备注最多 255 字').optional().default(''),
});

adminRouter.post('/corrections/:id/status', async (req, res) => {
  const id = parse(numericId, req.params.id);
  const schoolId = req.currentSchool.id;
  const input = parse(correctionStatusSchema, req.body);

  await withTransaction(async (conn) => {
    const [result] = await conn.execute(
      `UPDATE corrections
          SET status = ?, admin_note = ?, resolved_by = ?, resolved_at = UTC_TIMESTAMP(3)
        WHERE id = ? AND school_id = ? AND status = 'open'`,
      [input.status, input.note || null, req.admin.id, id, schoolId],
    );
    if (result.affectedRows !== 1) {
      throw new AppError(404, 'CORRECTION_NOT_FOUND', '待处理的纠错不存在');
    }
    await writeAudit(conn, {
      schoolId,
      actorType: 'admin',
      actorId: req.admin.id,
      action: `correction.${input.status}`,
      targetType: 'correction',
      targetId: id,
      ip: req.ip,
    });
  });

  res.json({ data: { message: '纠错已处理' } });
});

// ---------------- 找回密码申请 ----------------
adminRouter.get('/reset-requests', async (req, res) => {
  const schoolId = req.currentSchool.id;
  const status = parse(
    z.enum(['open', 'done', 'ignored']),
    req.query.status || 'open',
  );
  const { page, pageSize, offset } = paginationFrom(req.query);

  const [rows, countRow] = await Promise.all([
    query(
      `SELECT r.id, r.user_id, r.note, r.status, r.created_at, r.handled_at,
              u.display_name, u.student_no, u.email
         FROM password_reset_requests r
         JOIN users u ON u.id = r.user_id AND u.school_id = r.school_id
        WHERE r.school_id = ? AND r.status = ?
        ORDER BY r.created_at ASC, r.id ASC
        LIMIT ${pageSize} OFFSET ${offset}`,
      [schoolId, status],
    ),
    queryOne(
      'SELECT COUNT(*) AS n FROM password_reset_requests WHERE school_id = ? AND status = ?',
      [schoolId, status],
    ),
  ]);

  const total = Number(countRow?.n) || 0;
  res.json({
    data: rows.map(formatResetRequest),
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  });
});

const handleResetSchema = z.object({
  action: z.enum(['reset', 'ignore']),
});

adminRouter.post('/reset-requests/:id/handle', async (req, res) => {
  const id = parse(numericId, req.params.id);
  const schoolId = req.currentSchool.id;
  const input = parse(handleResetSchema, req.body);

  if (input.action === 'ignore') {
    const result = await query(
      `UPDATE password_reset_requests
          SET status = 'ignored', handled_by = ?, handled_at = UTC_TIMESTAMP(3)
        WHERE id = ? AND school_id = ? AND status = 'open'`,
      [req.admin.id, id, schoolId],
    );
    if (result.affectedRows !== 1) {
      throw new AppError(404, 'RESET_NOT_FOUND', '找回申请不存在或已处理');
    }
    await writeAudit(pool, {
      schoolId,
      actorType: 'admin',
      actorId: req.admin.id,
      action: 'reset.ignore',
      targetType: 'password_reset_request',
      targetId: id,
      ip: req.ip,
    });
    return res.json({ data: { message: '已忽略该申请' } });
  }

  const requestRow = await queryOne(
    `SELECT r.id, r.user_id, u.display_name, u.student_no, u.email
       FROM password_reset_requests r
       JOIN users u ON u.id = r.user_id AND u.school_id = r.school_id
      WHERE r.id = ? AND r.school_id = ? AND r.status = 'open'
      LIMIT 1`,
    [id, schoolId],
  );
  if (!requestRow) throw new AppError(404, 'RESET_NOT_FOUND', '找回申请不存在或已处理');

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  await withTransaction(async (conn) => {
    await conn.execute('UPDATE users SET password_hash = ? WHERE id = ? AND school_id = ?', [
      passwordHash, requestRow.user_id, schoolId,
    ]);
    // 重置后踢掉所有旧会话
    await conn.execute('DELETE FROM user_sessions WHERE user_id = ?', [requestRow.user_id]);
    await conn.execute(
      `UPDATE password_reset_requests
          SET status = 'done', handled_by = ?, handled_at = UTC_TIMESTAMP(3)
        WHERE id = ? AND school_id = ?`,
      [req.admin.id, id, schoolId],
    );
    await writeAudit(conn, {
      schoolId,
      actorType: 'admin',
      actorId: req.admin.id,
      action: 'reset.password',
      targetType: 'user',
      targetId: requestRow.user_id,
      detail: { requestId: id },
      ip: req.ip,
    });
  });

  res.json({
    data: {
      message: '密码已重置。临时密码只显示这一次，请通过线下渠道转交。',
      tempPassword,
      user: {
        displayName: requestRow.display_name,
        studentNo: requestRow.student_no,
        email: requestRow.email,
      },
    },
  });
});

// ---------------- 应用与路径 ----------------
adminRouter.get('/apps', async (req, res) => {
  const schoolId = req.currentSchool.id;
  const { page, pageSize, offset } = paginationFrom(req.query);
  const [rows, countRow] = await Promise.all([
    query(
      `SELECT id, school_id, title, category, summary, icon, steps, views, status, created_at
         FROM apps
        WHERE school_id = ?
        ORDER BY status ASC, views DESC, id DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      [schoolId],
    ),
    queryOne('SELECT COUNT(*) AS n FROM apps WHERE school_id = ?', [schoolId]),
  ]);
  const total = Number(countRow?.n) || 0;
  res.json({
    data: rows.map(formatApp),
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  });
});

adminRouter.post('/apps/:id/status', async (req, res) => {
  const id = parse(numericId, req.params.id);
  const schoolId = req.currentSchool.id;
  const input = parse(z.object({ status: z.enum(['active', 'hidden']) }), req.body);

  await withTransaction(async (conn) => {
    const [result] = await conn.execute(
      'UPDATE apps SET status = ? WHERE id = ? AND school_id = ?',
      [input.status, id, schoolId],
    );
    if (result.affectedRows !== 1) throw new AppError(404, 'APP_NOT_FOUND', '应用不存在');
    await writeAudit(conn, {
      schoolId,
      actorType: 'admin',
      actorId: req.admin.id,
      action: `app.${input.status}`,
      targetType: 'app',
      targetId: id,
      ip: req.ip,
    });
  });
  res.json({ data: { message: '应用状态已更新' } });
});

// ---------------- 审计日志 ----------------
adminRouter.get('/audit-logs', async (req, res) => {
  const schoolId = req.currentSchool.id;
  const { page, pageSize, offset } = paginationFrom(req.query);
  const [rows, countRow] = await Promise.all([
    query(
      `SELECT id, actor_type, actor_id, action, target_type, target_id,
              detail, ip, created_at
         FROM audit_logs
        WHERE school_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      [schoolId],
    ),
    queryOne('SELECT COUNT(*) AS n FROM audit_logs WHERE school_id = ?', [schoolId]),
  ]);
  const total = Number(countRow?.n) || 0;
  res.json({
    data: rows.map(formatAudit),
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  });
});
