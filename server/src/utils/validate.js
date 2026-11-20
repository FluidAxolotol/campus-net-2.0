// ============================================================
// 请求参数校验（zod）
// 只校验“形状与范围”；像“邮箱域是否属于学校”“学号是否重复”
// 这类需要查数据库的业务规则，放在 service 层。
// ============================================================

import { z } from 'zod';
import { AppError } from './errors.js';
import { config } from '../config/env.js';

export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length ? issue.path.join('.') : '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    throw new AppError(422, 'VALIDATION_FAILED', '请检查填写内容', fields);
  }
  return result.data;
}

export const numericId = z.coerce.number().int().positive();

export const passwordSchema = z
  .string()
  .min(config.passwordMinLength, `密码至少 ${config.passwordMinLength} 位`)
  .max(config.passwordMaxLength, `密码最多 ${config.passwordMaxLength} 位`)
  .regex(/[A-Za-z]/, '密码需包含字母')
  .regex(/\d/, '密码需包含数字');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('邮箱格式不正确')
  .max(160, '邮箱过长');

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, '请填写昵称')
  .max(40, '昵称最多 40 个字符');

export const studentNoSchema = z
  .string()
  .trim()
  .min(4, '学号至少 4 位')
  .max(32, '学号最多 32 位')
  .regex(/^[A-Za-z0-9-]+$/, '学号只能包含字母、数字和短横线');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export function paginationFrom(query) {
  const { page, pageSize } = parse(paginationSchema, {
    page: query.page ?? 1,
    pageSize: query.pageSize ?? 10,
  });
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function optionalTrimmed(max, message) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : value),
    z.string().max(max, message).optional().default(''),
  );
}
