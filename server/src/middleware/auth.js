// ============================================================
// 认证与授权中间件
//   认证：你是谁（attachUser / attachAdmin）
//   授权：你现在能不能做（requireUser / requireAdminActive）
// 每次请求都重新查库，保证“禁用立即生效”。
// ============================================================

import { queryOne } from '../db/pool.js';
import { AppError } from '../utils/errors.js';

// 可选登录：有会话就挂 req.user；没有会话也放行，供游客浏览
export async function attachUser(req, res, next) {
  try {
    req.user = null;
    req.userIssue = null;

    if (!req.session?.userId) return next();

    const row = await queryOne(
      `SELECT u.id, u.school_id, u.student_no, u.email, u.display_name,
              u.degree, u.enroll_year, u.college, u.bio, u.status,
              u.reject_reason, s.name AS school_name, s.code AS school_code,
              s.status AS school_status, s.email_domain
         FROM users u
         JOIN schools s ON s.id = u.school_id
        WHERE u.id = ?
        LIMIT 1`,
      [req.session.userId],
    );

    if (!row) {
      req.userIssue = new AppError(401, 'UNAUTHENTICATED', '登录已失效，请重新登录');
      return next();
    }
    if (row.status === 'pending') {
      req.userIssue = new AppError(403, 'USER_PENDING', '账号正在等待管理员审核');
      return next();
    }
    if (row.status === 'rejected') {
      req.userIssue = new AppError(403, 'USER_REJECTED', '注册申请已被驳回', {
        reason: row.reject_reason || '',
      });
      return next();
    }
    if (row.status === 'disabled') {
      req.userIssue = new AppError(403, 'USER_DISABLED', '账号已被停用');
      return next();
    }
    if (row.school_status !== 'active') {
      req.userIssue = new AppError(403, 'SCHOOL_DISABLED', '所属学校已停用');
      return next();
    }

    // 统一输出 camelCase，和登录接口 / 前端契约保持一致
    req.user = {
      id: row.id,
      schoolId: row.school_id,
      studentNo: row.student_no,
      email: row.email,
      displayName: row.display_name,
      degree: row.degree,
      enrollYear: row.enroll_year,
      college: row.college,
      bio: row.bio,
      status: row.status,
      school: {
        id: row.school_id,
        name: row.school_name,
        code: row.school_code,
        emailDomain: row.email_domain,
      },
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

// 必须登录；未审核/被驳回/停用会给出明确错误码
export function requireUser(req, res, next) {
  if (!req.session?.userId) {
    return next(new AppError(401, 'UNAUTHENTICATED', '请先登录'));
  }
  if (req.userIssue) return next(req.userIssue);
  if (!req.user) {
    return next(new AppError(401, 'UNAUTHENTICATED', '请先登录'));
  }
  return next();
}

// 管理员会话：stage 可能是 setup_required / totp_required / active
export async function attachAdmin(req, res, next) {
  try {
    req.admin = null;
    req.adminIssue = null;
    req.adminStage = req.session?.stage || null;

    if (!req.session?.adminId) return next();

    const row = await queryOne(
      `SELECT id, username, display_name, status, totp_confirmed,
              must_change_password, last_totp_step
         FROM admins
        WHERE id = ?
        LIMIT 1`,
      [req.session.adminId],
    );

    if (!row) {
      req.adminIssue = new AppError(401, 'ADMIN_UNAUTHENTICATED', '管理员会话已失效');
      return next();
    }
    if (row.status !== 'active') {
      req.adminIssue = new AppError(403, 'ADMIN_DISABLED', '管理员账号已停用');
      return next();
    }

    req.admin = row;
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireAdminStage(expectedStage) {
  return (req, res, next) => {
    if (!req.session?.adminId) {
      return next(new AppError(401, 'ADMIN_UNAUTHENTICATED', '请先登录管理后台'));
    }
    if (req.adminIssue) return next(req.adminIssue);
    if (!req.admin) {
      return next(new AppError(401, 'ADMIN_UNAUTHENTICATED', '请先登录管理后台'));
    }
    if (req.session.stage !== expectedStage) {
      return next(new AppError(403, 'ADMIN_STAGE_REQUIRED', '当前登录阶段不允许该操作'));
    }
    return next();
  };
}

// 管理员完成动态码验证后，还必须选定一所有效学校
export async function requireAdminActive(req, res, next) {
  if (!req.session?.adminId) {
    return next(new AppError(401, 'ADMIN_UNAUTHENTICATED', '请先登录管理后台'));
  }
  if (req.adminIssue) return next(req.adminIssue);
  if (!req.admin) {
    return next(new AppError(401, 'ADMIN_UNAUTHENTICATED', '请先登录管理后台'));
  }
  if (req.session.stage !== 'active') {
    return next(new AppError(403, 'ADMIN_STAGE_REQUIRED', '请先完成动态码验证'));
  }
  const schoolId = req.session.currentSchoolId;
  if (!schoolId) {
    return next(new AppError(403, 'ADMIN_NO_SCHOOL', '请先选择要管理的学校'));
  }

  try {
    const school = await queryOne(
      'SELECT id, name, code, email_domain, status FROM schools WHERE id = ? LIMIT 1',
      [schoolId],
    );
    if (!school || school.status !== 'active') {
      return next(new AppError(403, 'SCHOOL_DISABLED', '当前管理的学校已停用，请切换学校'));
    }
    req.currentSchool = school;
    return next();
  } catch (error) {
    return next(error);
  }
}
