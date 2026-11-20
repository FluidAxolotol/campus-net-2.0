// ============================================================
// 学校上下文
// 已登录用户：学校来自会话（req.user），前端传什么都不算；
// 游客：允许通过 ?schoolId= 浏览公开数据，但必须是有效学校。
// 这是学校隔离的第一道口径。
// ============================================================

import { queryOne } from '../db/pool.js';
import { AppError } from './errors.js';

export async function resolveSchool(req) {
  if (req.user) {
    return {
      id: req.user.schoolId,
      name: req.user.school.name,
      code: req.user.school.code,
      email_domain: req.user.school.emailDomain,
      status: 'active',
    };
  }

  const raw = req.query.schoolId;
  const schoolId = Number.parseInt(raw, 10);
  if (!Number.isFinite(schoolId) || schoolId <= 0) {
    throw new AppError(422, 'SCHOOL_REQUIRED', '请先选择学校');
  }

  const school = await queryOne(
    'SELECT id, name, code, email_domain, status FROM schools WHERE id = ? LIMIT 1',
    [schoolId],
  );
  if (!school || school.status !== 'active') {
    throw new AppError(404, 'SCHOOL_NOT_FOUND', '学校不存在');
  }
  return school;
}

export function publicSchool(school) {
  return {
    id: school.id,
    name: school.name,
    code: school.code,
    emailDomain: school.email_domain,
  };
}
