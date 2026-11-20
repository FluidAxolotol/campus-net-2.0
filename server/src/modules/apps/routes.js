// ============================================================
// 应用中心 / 办事入口
// 列表与详情对游客开放；纠错反馈必须登录，且只能反馈本校内容。
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../../db/pool.js';
import { resolveSchool } from '../../utils/school.js';
import { formatApp } from '../../utils/serializers.js';
import { parse, paginationFrom, numericId } from '../../utils/validate.js';
import { requireUser } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { AppError } from '../../utils/errors.js';

export const appsRouter = Router();

appsRouter.get('/', async (req, res) => {
  const school = await resolveSchool(req);
  const { page, pageSize, offset } = paginationFrom(req.query);
  const category = String(req.query.category || '').trim().slice(0, 40);
  const keyword = String(req.query.q || '').trim().slice(0, 80);

  const where = ["school_id = ?", "status = 'active'"];
  const params = [school.id];
  if (category && category !== '全部') {
    where.push('category = ?');
    params.push(category);
  }
  if (keyword) {
    where.push('(title LIKE ? OR summary LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = where.join(' AND ');

  const [rows, countRow] = await Promise.all([
    query(
      `SELECT id, school_id, title, category, summary, icon, steps, views, status, created_at
         FROM apps
        WHERE ${whereSql}
        ORDER BY views DESC, id DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    ),
    queryOne(`SELECT COUNT(*) AS n FROM apps WHERE ${whereSql}`, params),
  ]);

  const total = Number(countRow?.n) || 0;
  res.json({
    data: rows.map(formatApp),
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  });
});

appsRouter.get('/:id', async (req, res) => {
  const school = await resolveSchool(req);
  const id = parse(numericId, req.params.id);

  const app = await queryOne(
    `SELECT id, school_id, title, category, summary, icon, steps, views, status, created_at
       FROM apps
      WHERE id = ? AND school_id = ? AND status = 'active'
      LIMIT 1`,
    [id, school.id],
  );
  if (!app) throw new AppError(404, 'APP_NOT_FOUND', '这个工具不存在或已下架');

  await query('UPDATE apps SET views = views + 1 WHERE id = ? AND school_id = ?', [id, school.id]);
  app.views = Number(app.views) + 1;

  res.json({ data: { app: formatApp(app), school: { id: school.id, name: school.name } } });
});

const correctionSchema = z.object({
  content: z.string().trim().min(5, '请至少写 5 个字说明问题').max(500, '反馈最多 500 字'),
});

appsRouter.post(
  '/:id/corrections',
  requireUser,
  rateLimit('correction', 60 * 60 * 1000, 10),
  async (req, res) => {
    const schoolId = req.user.schoolId;
    const id = parse(numericId, req.params.id);
    const input = parse(correctionSchema, req.body);

    const app = await queryOne(
      "SELECT id FROM apps WHERE id = ? AND school_id = ? AND status = 'active' LIMIT 1",
      [id, schoolId],
    );
    if (!app) throw new AppError(404, 'APP_NOT_FOUND', '这个工具不存在或已下架');

    const result = await query(
      `INSERT INTO corrections (school_id, target_type, target_id, user_id, content)
       VALUES (?, 'app', ?, ?, ?)`,
      [schoolId, id, req.user.id, input.content],
    );
    res.status(201).json({
      data: {
        id: result.insertId,
        message: '纠错已提交，管理员会尽快核实，谢谢你',
      },
    });
  },
);
