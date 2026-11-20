// 单元测试：序列化器把数据库行转成前端契约

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatExam, formatPost, toIso,
} from '../../src/utils/serializers.js';

test('日期统一转换为 ISO 字符串', () => {
  assert.equal(toIso('2026-01-02 03:04:05.000'), '2026-01-02T03:04:05.000Z');
  assert.equal(toIso(new Date('2026-01-02T03:04:05.000Z')), '2026-01-02T03:04:05.000Z');
  assert.equal(toIso(null), null);
});

test('真题行转换为 camelCase 契约', () => {
  const row = {
    id: 1,
    title: '数据结构',
    subject: '数据结构',
    college: '计算机学院',
    semester: '2025 春',
    exam_type: '期末',
    has_answer: 1,
    status: 'approved',
    download_count: 12,
    review_note: null,
    created_at: '2026-01-02 03:04:05.000',
    file_id: 9,
    uploader_id: 3,
    file_name: '卷子.pdf',
    mime_type: 'application/pdf',
    size_bytes: 1024,
    uploader_name: '小张',
  };
  const exam = formatExam(row);
  assert.equal(exam.examType, '期末');
  assert.equal(exam.hasAnswer, true);
  assert.equal(exam.downloadCount, 12);
  assert.equal(exam.file.fileType, 'PDF');
  assert.equal(exam.uploader.displayName, '小张');
  assert.equal(exam.downloadUrl, '/api/exams/1/download');
});

test('帖子行转换为前端需要的嵌套结构', () => {
  const post = formatPost({
    id: 2,
    title: '台灯出',
    content: '九成新',
    status: 'published',
    like_count: 3,
    comment_count: 0,
    liked_by_me: 1,
    created_at: '2026-01-02 03:04:05.000',
    board_id: 1,
    board_code: 'secondhand',
    board_name: '二手交易',
    author_id: 5,
    author_name: '阿华',
  });
  assert.equal(post.likedByMe, true);
  assert.equal(post.board.name, '二手交易');
  assert.equal(post.author.displayName, '阿华');
});
