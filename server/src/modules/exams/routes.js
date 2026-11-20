// ============================================================
// 真题库接口
// GET  /api/exams            搜索/筛选/分页（游客可读）
// GET  /api/exams/:id        详情（游客可读）
// POST /api/exams            上传（登录，审核后公开）
// GET  /api/exams/:id/download 下载（登录 + 本校鉴权）
// ============================================================

import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../../config/env.js';
import { resolveSchool } from '../../utils/school.js';
import { formatExam } from '../../utils/serializers.js';
import { parse, numericId, paginationFrom } from '../../utils/validate.js';
import { requireUser } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { sendStoredFile } from '../../utils/files.js';
import {
  listExams, getVisibleExam, createExam, getDownloadExam,
} from './service.js';

export const examsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxMultipartSize,
    files: 1,
  },
});

examsRouter.get('/', async (req, res) => {
  const school = await resolveSchool(req);
  const { page, pageSize, offset } = paginationFrom(req.query);
  const college = String(req.query.college || '').trim().slice(0, 80);
  const semester = String(req.query.semester || '').trim().slice(0, 20);
  const keyword = String(req.query.q || '').trim().slice(0, 80);

  const { rows, total } = await listExams({
    schoolId: school.id, college, semester, keyword, page, pageSize, offset,
  });

  res.json({
    data: rows.map(formatExam),
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  });
});

examsRouter.get('/:id', async (req, res) => {
  const school = await resolveSchool(req);
  const id = parse(numericId, req.params.id);
  const exam = await getVisibleExam({
    examId: id,
    schoolId: school.id,
    userId: req.user?.id,
  });
  res.json({ data: { exam: formatExam(exam) } });
});

const metaSchema = z.object({
  title: z.string().trim().min(4, '标题至少 4 个字').max(160, '标题最多 160 字'),
  subject: z.string().trim().min(1, '请填写科目').max(80, '科目名过长'),
  college: z.string().trim().min(1, '请填写学院').max(80, '学院名过长'),
  semester: z.string().trim().min(2, '请填写学期').max(20, '学期最长 20 字'),
  examType: z.string().trim().min(1, '请填写考试类型').max(20, '考试类型过长').default('期末'),
  hasAnswer: z.preprocess(
    (value) => value === true || value === 'true' || value === '1' || value === 'on',
    z.boolean(),
  ),
});

examsRouter.post(
  '/',
  requireUser,
  rateLimit('exam-upload', 60 * 60 * 1000, 20),
  upload.single('file'),
  async (req, res) => {
    const meta = parse(metaSchema, req.body);
    const result = await createExam({
      schoolId: req.user.schoolId,
      userId: req.user.id,
      file: req.file,
      meta,
    });
    res.status(201).json({
      data: {
        id: result.examId,
        status: result.status,
        message: '已提交审核，管理员通过后全校可见',
      },
    });
  },
);

examsRouter.get(
  '/:id/download',
  requireUser,
  rateLimit('exam-download', 60 * 60 * 1000, 200),
  async (req, res) => {
    const id = parse(numericId, req.params.id);
    const fileRow = await getDownloadExam({
      examId: id,
      schoolId: req.user.schoolId,
      userId: req.user.id,
    });
    sendStoredFile(res, fileRow);
  },
);
