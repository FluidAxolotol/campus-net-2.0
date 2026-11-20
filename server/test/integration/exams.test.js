// 集成测试：上传（魔数校验）→ 管理员审核 → 下载 → 跨校 404
// 以及真题问答的登录与学校隔离。

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  agent, resetDatabase, seedBase, getCsrf, loginUser, loginAdmin, closePool,
} from './helpers.js';

let ctx;
const pdfBuffer = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
  'ascii',
);

before(async () => {
  await resetDatabase();
  ctx = await seedBase();
});

after(async () => {
  await closePool();
});

test('上传 PDF → 审核 → 下载 → 跨校 404', async () => {
  const userAgent = agent();
  await loginUser(userAgent, 'alice@mail.sysu.edu.cn');
  let token = await getCsrf(userAgent);

  const uploaded = await userAgent
    .post('/api/exams')
    .set('X-CSRF-Token', token)
    .field('title', '集成测试数据结构期末')
    .field('subject', '数据结构')
    .field('college', '计算机学院')
    .field('semester', '2025 春')
    .field('examType', '期末')
    .field('hasAnswer', 'true')
    .attach('file', pdfBuffer, { filename: '测试卷.pdf', contentType: 'application/pdf' })
    .expect(201);

  assert.equal(uploaded.body.data.status, 'pending');
  const examId = uploaded.body.data.id;

  // 待审核状态下，非上传者不能下载
  const carolAgent = agent();
  await loginUser(carolAgent, 'carol@mail.scut.edu.cn');
  await carolAgent.get(`/api/exams/${examId}/download`).expect(404);

  // 管理员审核通过
  const adminAgent = agent();
  await loginAdmin(adminAgent, { secret: ctx.totpSecret });
  const adminToken = await getCsrf(adminAgent);
  await adminAgent
    .post(`/api/admin/exams/${examId}/review`)
    .set('X-CSRF-Token', adminToken)
    .send({ action: 'approve', note: '集成测试通过' })
    .expect(200);

  // 本校学生可以下载
  const download = await userAgent
    .get(`/api/exams/${examId}/download`)
    .expect(200);
  assert.match(download.headers['content-type'], /application\/pdf/);
  assert.ok(download.body.length > 0);

  // 跨校学生即使知道 id 也拿不到
  await carolAgent.get(`/api/exams/${examId}/download`).expect(404);
  // 已通过的详情也按学校隔离
  await carolAgent.get(`/api/exams/${examId}`).expect(404);
});

test('伪造成 .pdf 的文本文件会被魔数校验拒绝', async () => {
  const userAgent = agent();
  await loginUser(userAgent, 'alice@mail.sysu.edu.cn');
  const token = await getCsrf(userAgent);

  const response = await userAgent
    .post('/api/exams')
    .set('X-CSRF-Token', token)
    .field('title', '伪造文件测试')
    .field('subject', '测试')
    .field('college', '计算机学院')
    .field('semester', '2025 春')
    .field('examType', '期末')
    .field('hasAnswer', 'false')
    .attach('file', Buffer.from('this is not a pdf'), {
      filename: 'fake.pdf',
      contentType: 'application/pdf',
    })
    .expect(422);

  assert.equal(response.body.error.code, 'FILE_TYPE_INVALID');
});

test('问答需要登录，并且只能问本校真题', async () => {
  // 游客 401（先拿 CSRF 以证明拦截来自登录而非 CSRF）
  const guest = agent();
  const guestToken = await getCsrf(guest);
  await guest
    .post('/api/exams/1/questions')
    .set('X-CSRF-Token', guestToken)
    .send({ question: '最后一题考什么？' })
    .expect(401);

  const userAgent = agent();
  await loginUser(userAgent, 'alice@mail.sysu.edu.cn');
  const token = await getCsrf(userAgent);

  // 找到本校已通过的真题
  const list = await userAgent.get('/api/exams').expect(200);
  const exam = list.body.data[0];
  assert.ok(exam);

  const created = await userAgent
    .post(`/api/exams/${exam.id}/questions`)
    .set('X-CSRF-Token', token)
    .send({ question: '最后一题考什么？' })
    .expect(201);
  assert.match(created.body.data.thread.answer, /演示版问答/);

  // 跨校用户访问同一份真题的问答 → 404
  const carolAgent = agent();
  await loginUser(carolAgent, 'carol@mail.scut.edu.cn');
  await carolAgent.get(`/api/exams/${exam.id}/questions`).expect(404);
});
