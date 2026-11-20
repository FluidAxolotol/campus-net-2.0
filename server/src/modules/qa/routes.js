// ============================================================
// 真题问答（演示版）
// P0 不接真实大模型，用规则生成回答，跑通“提问 → 落库 → 展示”。
// 接口仍然要求登录，对应游客权限矩阵里的“AI 问答需登录”。
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../../db/pool.js';
import { requireUser } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { parse, numericId } from '../../utils/validate.js';
import { formatQa } from '../../utils/serializers.js';
import { AppError } from '../../utils/errors.js';
import { getVisibleExam } from '../exams/service.js';

export const qaRouter = Router();

function buildDemoAnswer(exam, question) {
  const intro = `这是课程演示版问答（规则生成，不是真实大模型）。我已定位到《${exam.title}》`;
  const facts = `科目：${exam.subject}；学期：${exam.semester}；类型：${exam.exam_type}；学院：${exam.college}；${exam.has_answer ? '含答案' : '未标注答案'}。`;

  let focus = '建议先从卷面题型分布入手：选择/填空通常覆盖基础概念，大题集中在前几章的综合应用。';
  if (/最后|压轴/.test(question)) {
    focus = '最后一题通常综合度最高。可以按“题目条件 → 对应章节 → 可复用模板”三步拆解，并优先复习该科目最后两章。';
  } else if (/难|容易|得分/.test(question)) {
    focus = '难度判断建议结合题型与分值：分值高、步骤多的题更容易失分。演示版无法读取卷面原文，真实 AI 版会引用原文页码。';
  } else if (/答案|解析/.test(question)) {
    focus = '这份真题的答案状态见上方元信息。含答案的卷子可以直接下载后对照；无答案的卷子建议先独立完成再在社区讨论。';
  } else if (/题型|重点|章节/.test(question)) {
    focus = '可以把近三年的同科目真题按题型做一张表，重复出现的章节就是重点。真题库列表支持按学期和学院筛选。';
  }

  return `${intro}。${facts}\n\n${focus}\n\n你的问题：${question}`;
}

qaRouter.get('/:id/questions', requireUser, async (req, res) => {
  const id = parse(numericId, req.params.id);
  const exam = await getVisibleExam({
    examId: id,
    schoolId: req.user.schoolId,
    userId: req.user.id,
  });

  const rows = await query(
    `SELECT q.id, q.question, q.answer, q.created_at, q.user_id,
            u.display_name AS user_name
       FROM qa_threads q
       JOIN users u ON u.id = q.user_id AND u.school_id = q.school_id
      WHERE q.school_id = ? AND q.exam_id = ?
      ORDER BY q.created_at ASC, q.id ASC
      LIMIT 50`,
    [req.user.schoolId, id],
  );

  res.json({
    data: {
      exam: {
        id: exam.id,
        title: exam.title,
        subject: exam.subject,
        semester: exam.semester,
        examType: exam.exam_type,
        hasAnswer: Boolean(exam.has_answer),
        uploader: { displayName: exam.uploader_name },
      },
      threads: rows.map(formatQa),
    },
  });
});

const questionSchema = z.object({
  question: z.string().trim().min(2, '请至少写 2 个字').max(500, '问题最多 500 字'),
});

qaRouter.post(
  '/:id/questions',
  requireUser,
  rateLimit('qa-question', 60 * 60 * 1000, 30),
  async (req, res) => {
    const id = parse(numericId, req.params.id);
    const input = parse(questionSchema, req.body);
    const exam = await getVisibleExam({
      examId: id,
      schoolId: req.user.schoolId,
      userId: req.user.id,
    });

    const answer = buildDemoAnswer(exam, input.question);
    const result = await query(
      `INSERT INTO qa_threads (school_id, exam_id, user_id, question, answer)
       VALUES (?, ?, ?, ?, ?)`,
      [req.user.schoolId, id, req.user.id, input.question, answer],
    );

    const row = await queryOne(
      `SELECT q.id, q.question, q.answer, q.created_at, q.user_id,
              u.display_name AS user_name
         FROM qa_threads q
         JOIN users u ON u.id = q.user_id AND u.school_id = q.school_id
        WHERE q.id = ? AND q.school_id = ?`,
      [result.insertId, req.user.schoolId],
    );
    res.status(201).json({ data: { thread: formatQa(row) } });
  },
);
