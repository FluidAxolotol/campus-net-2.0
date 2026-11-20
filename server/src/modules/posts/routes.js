// ============================================================
// 校园社区：版块、帖子列表、发帖、点赞
// 游客可阅读；发帖/点赞必须登录；所有数据按学校隔离。
// 评论与收藏属于 P1，P0 未实现，所以 comment_count 保持 0。
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../../db/pool.js';
import { resolveSchool } from '../../utils/school.js';
import { formatPost } from '../../utils/serializers.js';
import { parse, paginationFrom, numericId } from '../../utils/validate.js';
import { requireUser } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { AppError } from '../../utils/errors.js';

export const boardsRouter = Router();
export const postsRouter = Router();

boardsRouter.get('/', async (req, res) => {
  const school = await resolveSchool(req);
  const rows = await query(
    `SELECT b.id, b.code, b.name, b.sort_order,
            COUNT(p.id) AS post_count
       FROM boards b
       LEFT JOIN posts p
         ON p.board_id = b.id
        AND p.school_id = b.school_id
        AND p.status = 'published'
      WHERE b.school_id = ?
      GROUP BY b.id, b.code, b.name, b.sort_order
      ORDER BY b.sort_order ASC, b.id ASC`,
    [school.id],
  );
  res.json({
    data: rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      postCount: Number(row.post_count) || 0,
    })),
  });
});

postsRouter.get('/', async (req, res) => {
  const school = await resolveSchool(req);
  const { page, pageSize, offset } = paginationFrom(req.query);
  const userId = req.user?.id ?? 0;
  const boardId = req.query.boardId ? parse(numericId, req.query.boardId) : null;
  const sort = parse(z.enum(['latest', 'hot']), req.query.sort || 'latest');
  const keyword = String(req.query.q || '').trim().slice(0, 80);

  const where = ["p.school_id = ?", "p.status = 'published'"];
  const params = [school.id];
  if (boardId) {
    where.push('p.board_id = ?');
    params.push(boardId);
  }
  if (keyword) {
    where.push('(p.title LIKE ? OR p.content LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = where.join(' AND ');
  const orderSql = sort === 'hot'
    ? 'p.like_count DESC, p.created_at DESC, p.id DESC'
    : 'p.created_at DESC, p.id DESC';

  const [rows, countRow] = await Promise.all([
    query(
      `SELECT p.id, p.board_id, p.author_id, p.title, p.content, p.status,
              p.like_count, p.comment_count, p.created_at,
              b.code AS board_code, b.name AS board_name,
              u.display_name AS author_name,
              EXISTS(
                SELECT 1 FROM post_likes pl
                 WHERE pl.post_id = p.id AND pl.user_id = ?
              ) AS liked_by_me
         FROM posts p
         JOIN boards b ON b.id = p.board_id AND b.school_id = p.school_id
         JOIN users u ON u.id = p.author_id AND u.school_id = p.school_id
        WHERE ${whereSql}
        ORDER BY ${orderSql}
        LIMIT ${pageSize} OFFSET ${offset}`,
      [userId, ...params],
    ),
    queryOne(`SELECT COUNT(*) AS n FROM posts p WHERE ${whereSql}`, params),
  ]);

  const total = Number(countRow?.n) || 0;
  res.json({
    data: rows.map(formatPost),
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  });
});

const createPostSchema = z.object({
  boardId: numericId,
  title: z.string().trim().min(4, '标题至少 4 个字').max(160, '标题最多 160 字'),
  content: z.string().trim().min(1, '请写点正文').max(5000, '正文最多 5000 字'),
});

postsRouter.post(
  '/',
  requireUser,
  rateLimit('post-create', 60 * 60 * 1000, 10),
  async (req, res) => {
    const input = parse(createPostSchema, req.body);

    const board = await queryOne(
      'SELECT id FROM boards WHERE id = ? AND school_id = ? LIMIT 1',
      [input.boardId, req.user.schoolId],
    );
    if (!board) throw new AppError(404, 'BOARD_NOT_FOUND', '版块不存在');

    const result = await query(
      `INSERT INTO posts (school_id, board_id, author_id, title, content, status)
       VALUES (?, ?, ?, ?, ?, 'published')`,
      [req.user.schoolId, input.boardId, req.user.id, input.title, input.content],
    );

    const row = await queryOne(
      `SELECT p.id, p.board_id, p.author_id, p.title, p.content, p.status,
              p.like_count, p.comment_count, p.created_at,
              b.code AS board_code, b.name AS board_name,
              u.display_name AS author_name,
              0 AS liked_by_me
         FROM posts p
         JOIN boards b ON b.id = p.board_id AND b.school_id = p.school_id
         JOIN users u ON u.id = p.author_id AND u.school_id = p.school_id
        WHERE p.id = ? AND p.school_id = ?`,
      [result.insertId, req.user.schoolId],
    );

    res.status(201).json({ data: { post: formatPost(row) } });
  },
);

postsRouter.post(
  '/:id/like',
  requireUser,
  rateLimit('post-like', 60 * 60 * 1000, 300),
  async (req, res) => {
    const id = parse(numericId, req.params.id);
    const schoolId = req.user.schoolId;
    const userId = req.user.id;

    const result = await withTransaction(async (conn) => {
      const [postRows] = await conn.execute(
        `SELECT id, like_count
           FROM posts
          WHERE id = ? AND school_id = ? AND status = 'published'
          FOR UPDATE`,
        [id, schoolId],
      );
      if (!postRows.length) {
        throw new AppError(404, 'POST_NOT_FOUND', '帖子不存在');
      }

      const [likeRows] = await conn.execute(
        'SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ? LIMIT 1',
        [id, userId],
      );

      let liked;
      if (likeRows.length) {
        await conn.execute(
          'DELETE FROM post_likes WHERE post_id = ? AND user_id = ?',
          [id, userId],
        );
        await conn.execute(
          'UPDATE posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = ? AND school_id = ?',
          [id, schoolId],
        );
        liked = false;
      } else {
        await conn.execute(
          'INSERT INTO post_likes (post_id, user_id, school_id) VALUES (?, ?, ?)',
          [id, userId, schoolId],
        );
        await conn.execute(
          'UPDATE posts SET like_count = like_count + 1 WHERE id = ? AND school_id = ?',
          [id, schoolId],
        );
        liked = true;
      }

      const [countRows] = await conn.execute(
        'SELECT like_count FROM posts WHERE id = ? AND school_id = ?',
        [id, schoolId],
      );
      return { liked, likeCount: Number(countRows[0].like_count) };
    });

    res.json({ data: result });
  },
);
