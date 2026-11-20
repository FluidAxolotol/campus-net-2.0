// ============================================================
// 首页聚合接口
// 一次返回：学校、统计、最新应用、最新真题、最新帖子
// 登录用户和游客都能访问；游客必须带 ?schoolId=。
// ============================================================

import { Router } from 'express';
import { query, queryOne } from '../../db/pool.js';
import { resolveSchool, publicSchool } from '../../utils/school.js';
import { formatApp, formatExam, formatPost } from '../../utils/serializers.js';

export const homeRouter = Router();

homeRouter.get('/', async (req, res) => {
  const school = await resolveSchool(req);
  const schoolId = school.id;
  const userId = req.user?.id ?? 0;

  const [apps, exams, posts, appCount, examCount, postCount] = await Promise.all([
    query(
      `SELECT id, school_id, title, category, summary, icon, steps, views, status, created_at
         FROM apps
        WHERE school_id = ? AND status = 'active'
        ORDER BY views DESC, id DESC
        LIMIT 4`,
      [schoolId],
    ),
    query(
      `SELECT e.id, e.title, e.subject, e.college, e.semester, e.exam_type,
              e.has_answer, e.status, e.download_count, e.created_at,
              e.file_id, f.original_name AS file_name, f.mime_type, f.size_bytes,
              e.uploader_id, u.display_name AS uploader_name
         FROM exams e
         JOIN files f ON f.id = e.file_id AND f.school_id = e.school_id
         JOIN users u ON u.id = e.uploader_id AND u.school_id = e.school_id
        WHERE e.school_id = ? AND e.status = 'approved'
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT 3`,
      [schoolId],
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
        WHERE p.school_id = ? AND p.status = 'published'
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT 3`,
      [userId, schoolId],
    ),
    queryOne("SELECT COUNT(*) AS n FROM apps WHERE school_id = ? AND status = 'active'", [schoolId]),
    queryOne("SELECT COUNT(*) AS n FROM exams WHERE school_id = ? AND status = 'approved'", [schoolId]),
    queryOne("SELECT COUNT(*) AS n FROM posts WHERE school_id = ? AND status = 'published'", [schoolId]),
  ]);

  res.json({
    data: {
      school: publicSchool(school),
      stats: {
        apps: Number(appCount?.n) || 0,
        exams: Number(examCount?.n) || 0,
        posts: Number(postCount?.n) || 0,
      },
      apps: apps.map(formatApp),
      exams: exams.map(formatExam),
      posts: posts.map(formatPost),
    },
  });
});
