// 集成测试：注册 → 待审核不能登录 → 管理员审核 → 登录 → /me
// 走真实 Express 中间件、真实 MySQL、真实 CSRF。

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  agent, resetDatabase, seedBase, getCsrf, loginAdmin, closePool,
} from './helpers.js';

let ctx;

before(async () => {
  await resetDatabase();
  ctx = await seedBase();
});

after(async () => {
  await closePool();
});

test('注册后是 pending，审核通过后才能登录', async () => {
  const userAgent = agent();
  let token = await getCsrf(userAgent);

  const registered = await userAgent
    .post('/api/auth/register')
    .set('X-CSRF-Token', token)
    .send({
      schoolId: 1,
      studentNo: '23332001',
      email: 'newbie@mail.sysu.edu.cn',
      displayName: '新同学',
      password: 'Newbie@2026',
      degree: '本科',
      enrollYear: 2025,
      college: '计算机学院',
    })
    .expect(201);

  assert.equal(registered.body.data.status, 'pending');
  const userId = registered.body.data.id;

  // 未审核不能登录
  const pendingLogin = await userAgent
    .post('/api/auth/login')
    .set('X-CSRF-Token', token)
    .send({ account: 'newbie@mail.sysu.edu.cn', password: 'Newbie@2026' })
    .expect(403);
  assert.equal(pendingLogin.body.error.code, 'USER_PENDING');

  // 管理员登录（密码 + TOTP）
  const adminAgent = agent();
  const adminLogin = await loginAdmin(adminAgent, { secret: ctx.totpSecret });
  assert.equal(adminLogin.start.status, 200);
  assert.equal(adminLogin.start.body.data.stage, 'totp_required');
  assert.equal(adminLogin.verify.status, 200);
  assert.equal(adminLogin.verify.body.data.stage, 'active');

  const adminToken = await getCsrf(adminAgent);
  const pendingList = await adminAgent
    .get('/api/admin/registrations?status=pending')
    .expect(200);
  assert.ok(pendingList.body.data.some((user) => user.id === userId));

  await adminAgent
    .post(`/api/admin/registrations/${userId}/approve`)
    .set('X-CSRF-Token', adminToken)
    .send({})
    .expect(200);

  // 审核后可以登录
  token = await getCsrf(userAgent);
  const login = await userAgent
    .post('/api/auth/login')
    .set('X-CSRF-Token', token)
    .send({ account: 'newbie@mail.sysu.edu.cn', password: 'Newbie@2026' })
    .expect(200);
  assert.equal(login.body.data.user.displayName, '新同学');
  assert.equal(login.body.data.user.schoolId, 1);

  const me = await userAgent.get('/api/auth/me').expect(200);
  assert.equal(me.body.data.user.email, 'newbie@mail.sysu.edu.cn');
  assert.equal(me.body.data.user.school.name, '中山大学');
});

test('密码错误返回 401，且不暴露账号是否存在', async () => {
  const userAgent = agent();
  const token = await getCsrf(userAgent);
  const wrong = await userAgent
    .post('/api/auth/login')
    .set('X-CSRF-Token', token)
    .send({ account: 'alice@mail.sysu.edu.cn', password: 'WrongPass123' })
    .expect(401);
  assert.equal(wrong.body.error.code, 'AUTH_INVALID');

  const token2 = await getCsrf(userAgent);
  const missing = await userAgent
    .post('/api/auth/login')
    .set('X-CSRF-Token', token2)
    .send({ account: 'nobody@mail.sysu.edu.cn', password: 'WrongPass123' })
    .expect(401);
  assert.equal(missing.body.error.code, 'AUTH_INVALID');
  assert.equal(missing.body.error.message, wrong.body.error.message);
});
