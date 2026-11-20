// ============================================================
// 真题业务：查询、上传（文件 + 两条 INSERT 同事务）、下载鉴权
// ============================================================

import { query, queryOne, withTransaction } from '../../db/pool.js';
import { AppError } from '../../utils/errors.js';
import { saveUploadedFile, removeStoredFile } from '../../utils/files.js';

const EXAM_SELECT = `
  SELECT e.id, e.title, e.subject, e.college, e.semester, e.exam_type,
         e.has_answer, e.status, e.download_count, e.review_note, e.created_at,
         e.file_id, e.uploader_id,
         f.original_name AS file_name, f.mime_type, f.size_bytes,
         u.display_name AS uploader_name
    FROM exams e
    JOIN files f ON f.id = e.file_id AND f.school_id = e.school_id
    JOIN users u ON u.id = e.uploader_id AND u.school_id = e.school_id
`;

export async function listExams({ schoolId, college, semester, keyword, page, pageSize, offset }) {
  const where = ["e.school_id = ?", "e.status = 'approved'"];
  const params = [schoolId];

  if (college) {
    where.push('e.college = ?');
    params.push(college);
  }
  if (semester) {
    where.push('e.semester = ?');
    params.push(semester);
  }
  if (keyword) {
    where.push('(e.title LIKE ? OR e.subject LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = where.join(' AND ');

  const [rows, countRow] = await Promise.all([
    query(
      `${EXAM_SELECT}
        WHERE ${whereSql}
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    ),
    queryOne(
      `SELECT COUNT(*) AS n
         FROM exams e
        WHERE ${whereSql}`,
      params,
    ),
  ]);

  return { rows, total: Number(countRow?.n) || 0 };
}

export async function getVisibleExam({ examId, schoolId, userId }) {
  const exam = await queryOne(
    `${EXAM_SELECT}
      WHERE e.id = ? AND e.school_id = ?
        AND (e.status = 'approved' OR e.uploader_id = ?)
      LIMIT 1`,
    [examId, schoolId, userId ?? 0],
  );
  if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND', '真题不存在');
  return exam;
}

/**
 * 上传流程：
 *   1. 校验文件头并落盘；
 *   2. files + exams 在同一事务插入；
 *   3. 事务失败，删除已经写下的文件，避免“有文件没记录”。
 */
export async function createExam({ schoolId, userId, file, meta }) {
  const stored = await saveUploadedFile(file);
  try {
    const examId = await withTransaction(async (conn) => {
      const [fileResult] = await conn.execute(
        `INSERT INTO files
           (school_id, uploader_id, storage_key, original_name, mime_type, size_bytes, sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          schoolId,
          userId,
          stored.storageKey,
          stored.originalName,
          stored.mimeType,
          stored.sizeBytes,
          stored.sha256,
        ],
      );

      const [examResult] = await conn.execute(
        `INSERT INTO exams
           (school_id, file_id, uploader_id, title, subject, college, semester,
            exam_type, has_answer, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          schoolId,
          fileResult.insertId,
          userId,
          meta.title,
          meta.subject,
          meta.college,
          meta.semester,
          meta.examType,
          meta.hasAnswer ? 1 : 0,
        ],
      );
      return examResult.insertId;
    });
    return { examId, status: 'pending' };
  } catch (error) {
    // 数据库回滚了，但磁盘上的文件不会自动回滚
    await removeStoredFile(stored.storageKey);
    throw error;
  }
}

export async function getDownloadExam({ examId, schoolId, userId }) {
  const exam = await queryOne(
    `${EXAM_SELECT}
      WHERE e.id = ? AND e.school_id = ?
      LIMIT 1`,
    [examId, schoolId],
  );
  if (!exam) throw new AppError(404, 'EXAM_NOT_FOUND', '真题不存在');

  // 本人可以下载自己的待审核文件；其他人只能下载 approved
  if (exam.status !== 'approved' && Number(exam.uploader_id) !== Number(userId)) {
    throw new AppError(404, 'EXAM_NOT_FOUND', '真题不存在');
  }

  await query(
    'UPDATE exams SET download_count = download_count + 1 WHERE id = ? AND school_id = ?',
    [examId, schoolId],
  );

  const file = await queryOne(
    `SELECT id, storage_key, original_name, mime_type
       FROM files
      WHERE id = ? AND school_id = ?
      LIMIT 1`,
    [exam.file_id, schoolId],
  );
  if (!file) throw new AppError(404, 'FILE_NOT_FOUND', '文件不存在');
  return file;
}
