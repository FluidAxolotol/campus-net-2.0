// ============================================================
// 公开学校列表：注册、游客选校用，只返回必要字段
// ============================================================

import { Router } from 'express';
import { query } from '../../db/pool.js';
import { formatSchool } from '../../utils/serializers.js';

export const schoolsRouter = Router();

schoolsRouter.get('/', async (req, res) => {
  const rows = await query(
    `SELECT id, name, code, email_domain, status
       FROM schools
      WHERE status = 'active'
      ORDER BY id ASC`,
  );
  res.json({ data: rows.map(formatSchool) });
});
