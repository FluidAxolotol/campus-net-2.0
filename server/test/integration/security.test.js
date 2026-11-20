// 集成测试：CSRF、学校隔离、跨校 404、管理员切换学校、TOTP 防重放

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';
import { app } from '../../src/app.js';
import { generateTotp } from '../../src/utils/crypto.js';
import {
  agent, resetDatabase, seedBase, getCsrf, loginUser, loginAdmin,
  createExamWithFile, closePool, query,
} from './helpers.js';

let ctx;
let exam1;
let exam2;

before(async () => {
  await resetDatabase();
  ctx = await seedBase();
  exam1 = await createExamWithFile({
    schoolId: 1, uploaderId: ctx.alice, title: '中山大学真题', status: 'approved',
  });
  exam2 = await createExamWithFile({
    schoolId: 2, uploaderId: ctx.carol, title: '华工真题', status: 'approved',
  });
});

after(async () => {
  await closePool();
});

test('缺少 CSRF 令牌的写请求被拒绝', async () => {
  const response = await supertest(app)
    .post('/api/auth/login')
    .send({ account: 'alice@mail.sysu.edu.cn', password: 'Student@2026' })
    .expect(403);
  assert.equal(response.body.error.code, 'CSRF_INVALID');
});

test('学生只能看到本校数据，URL 传 schoolId 也无法越权', async () => {
  const userAgent = agent();
  await loginUser(userAgent, 'alice@mail.sysu.edu.cn');

  // 本校真题可读
  await userAgent.get(`/api/exams/${exam1}`).expect(200);
  // 跨校真题 404，不暴露存在
  const crossExam = await userAgent.get(`/api/exams/${exam2}`).expect(404);
  assert.equal(crossExam.body.error.code, 'EXAM_NOT_FOUND');

  // 登录后 home 的学校来自会话，query 参数 schoolId=2 无效
  const home = await userAgent.get('/api/home?schoolId=2').expect(200);
  assert.equal(home.body.data.school.id, 1);

  const list = await userAgent.get('/api/exams?schoolId=2').expect(200);
  assert.ok(list.body.data.every((exam) => exam.id !== exam2));
});

test('学生发帖、点赞走真实事务', async () => {
  const userAgent = agent();
  await loginUser(userAgent, 'alice@mail.sysu.edu.cn');
  let token = await getCsrf(userAgent);

  const post = await userAgent
    .post('/api/posts')
    .set('X-CSRF-Token', token)
    .send({ boardId: 1, title: '集成测试帖子', content: '这条帖子会被测试点赞' })
    .expect(201);
  const postId = post.body.data.post.id;

  token = await getCsrf(userAgent);
  const liked = await userAgent
    .post(`/api/posts/${postId}/like`)
    .set('X-CSRF-Token', token)
    .expect(200);
  assert.equal(liked.body.data.liked, true);
  assert.equal(liked.body.data.likeCount, 1);

  token = await getCsrf(userAgent);
  const unliked = await userAgent
    .post(`/api/posts/${postId}/like`)
    .set('X-CSRF-Token', token)
    .expect(200);
  assert.equal(unliked.body.data.liked, false);
  assert.equal(unliked.body.data.likeCount, 0);
});

test('管理员切换学校后只能看到目标学校数据', async () => {
  const adminAgent = agent();
  await loginAdmin(adminAgent, { secret: ctx.totpSecret });

  const beforeSwitch = await adminAgent.get('/api/admin/overview').expect(200);
  assert.equal(beforeSwitch.body.data.school.id, 1);
  assert.ok(beforeSwitch.body.data.stats.pendingUsers >= 1);

  let token = await getCsrf(adminAgent);
  await adminAgent
    .post('/api/admin/auth/switch-school')
    .set('X-CSRF-Token', token)
    .send({ schoolId: 2 })
    .expect(200);

  const afterSwitch = await adminAgent.get('/api/admin/overview').expect(200);
  assert.equal(afterSwitch.body.data.school.id, 2);
  assert.equal(afterSwitch.body.data.stats.pendingUsers, 0);

  const pending = await adminAgent.get('/api/admin/registrations?status=pending').expect(200);
  assert.equal(pending.body.data.length, 0);

  // 华工管理员审核不了中山大学的真题
  token = await getCsrf(adminAgent);
  const crossReview = await adminAgent
    .post(`/api/admin/exams/${exam1}/review`)
    .set('X-CSRF-Token', token)
    .send({ action: 'approve' })
    .expect(404);
  assert.equal(crossReview.body.error.code, 'EXAM_NOT_FOUND');
});

test('同一个 TOTP 动态码不能重放', async () => {
  // 前面的测试可能已经消耗了当前时间步；清空 last_totp_step，保证本测试从干净状态开始
  await query('UPDATE admins SET last_totp_step = NULL WHERE id = 1');

  const firstAgent = agent();
  const passwordLogin = await (async () => {
    const token = await getCsrf(firstAgent);
    return firstAgent
      .post('/api/admin/auth/login')
      .set('X-CSRF-Token', token)
      .send({ schoolId: 1, username: 'testadmin', password: 'Admin@2026' })
      .expect(200);
  })();
  assert.equal(passwordLogin.body.data.stage, 'totp_required');

  const code = generateTotp(ctx.totpSecret);
  let token = await getCsrf(firstAgent);
  await firstAgent
    .post('/api/admin/auth/verify')
    .set('X-CSRF-Token', token)
    .send({ code })
    .expect(200);

  // 第二个浏览器用同一个动态码登录
  const secondAgent = agent();
  const secondToken = await getCsrf(secondAgent);
  await secondAgent
    .post('/api/admin/auth/login')
    .set('X-CSRF-Token', secondToken)
    .send({ schoolId: 1, username: 'testadmin', password: 'Admin@2026' })
    .expect(200);
  const verifyToken = await getCsrf(secondAgent);
  const replay = await secondAgent
    .post('/api/admin/auth/verify')
    .set('X-CSRF-Token', verifyToken)
    .send({ code })
    .expect(401);
  assert.equal(replay.body.error.code, 'TOTP_REPLAY');
});
