// ============================================================
// 个人中心
// 资料修改、修改密码、我的真题、我的帖子
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { query } from '../../db/pool.js';
import { requireUser } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { parse, displayNameSchema, optionalTrimmed } from '../../utils/validate.js';
import { formatExam, formatPost } from '../../utils/serializers.js';
import { getProfileStats, changeUserPassword } from '../auth/service.js';

export const profileRouter = Router();

profileRouter.get('/', requireUser, async (req, res) => {
  const schoolId = req.user.schoolId;
  const userId = req.user.id;

  const [stats, examRows, postRows] = await Promise.all([
    getProfileStats(userId, schoolId),
    query(
      `SELECT e.id, e.title, e.subject, e.college, e.semester, e.exam_type,
              e.has_answer, e.status, e.download_count, e.review_note, e.created_at,
              e.file_id, e.uploader_id,
              f.original_name AS file_name, f.mime_type, f.size_bytes,
              u.display_name AS uploader_name
         FROM exams e
         JOIN files f ON f.id = e.file_id AND f.school_id = e.school_id
         JOIN users u ON u.id = e.uploader_id AND u.school_id = e.school_id
        WHERE e.school_id = ? AND e.uploader_id = ?
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT 50`,
      [schoolId, userId],
    ),
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
        WHERE p.school_id = ? AND p.author_id = ? AND p.status <> 'deleted'
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT 50`,
      [userId, schoolId, userId],
    ),
  ]);

  res.json({
    data: {
      user: req.user,
      stats,
      exams: examRows.map(formatExam),
      posts: postRows.map(formatPost),
    },
  });
});

const updateSchema = z.object({
  displayName: displayNameSchema.optional(),
  college: optionalTrimmed(80, '学院名称最多 80 个字符').optional(),
  bio: optionalTrimmed(200, '个人简介最多 200 个字符').optional(),
});

profileRouter.patch('/', requireUser, rateLimit('profile-update', 60 * 60 * 1000, 30), async (req, res) => {
  const input = parse(updateSchema, req.body);
  const sets = [];
  const params = [];

  if (input.displayName !== undefined) {
    sets.push('display_name = ?');
    params.push(input.displayName);
  }
  if (input.college !== undefined) {
    sets.push('college = ?');
    params.push(input.college || null);
  }
  if (input.bio !== undefined) {
    sets.push('bio = ?');
    params.push(input.bio || null);
  }

  if (sets.length) {
    params.push(req.user.id);
    await query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  res.json({
    data: {
      user: {
        ...req.user,
        displayName: input.displayName ?? req.user.displayName,
        college: input.college ?? req.user.college,
        bio: input.bio ?? req.user.bio,
      },
      message: '资料已保存',
    },
  });
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1, '请输入当前密码').max(64),
  newPassword: z.string().min(8, '新密码至少 8 位').max(64, '新密码最多 64 位')
    .regex(/[A-Za-z]/, '新密码需包含字母')
    .regex(/\d/, '新密码需包含数字'),
});

profileRouter.post(
  '/password',
  requireUser,
  rateLimit('user-password', 60 * 60 * 1000, 10),
  async (req, res) => {
    const input = parse(passwordSchema, req.body);
    await changeUserPassword(
      req.user.id,
      req.sessionID,
      input.currentPassword,
      input.newPassword,
    );
    res.json({ data: { message: '密码已更新，其他设备已退出登录' } });
  },
);
