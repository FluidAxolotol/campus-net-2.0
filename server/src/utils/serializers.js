// ============================================================
// 数据库行 → API JSON
// 数据库列名是 snake_case，前端要 camelCase；日期要 ISO 字符串；
// 布尔字段统一 true/false；JSON 列统一数组/对象。
// 序列化器把数据库细节挡在 API 之内。
// ============================================================

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) return new Date(text).toISOString();
  return new Date(`${text.replace(' ', 'T')}Z`).toISOString();
}

function parseJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

export function formatSchool(row) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    emailDomain: row.email_domain,
    status: row.status,
  };
}

export function formatUser(row) {
  return {
    id: row.id,
    schoolId: row.school_id,
    studentNo: row.student_no,
    email: row.email,
    displayName: row.display_name,
    degree: row.degree,
    enrollYear: row.enroll_year,
    college: row.college || '',
    bio: row.bio || '',
    status: row.status,
    school: row.school_name
      ? {
        id: row.school_id,
        name: row.school_name,
        code: row.school_code,
        emailDomain: row.email_domain,
      }
      : undefined,
  };
}

export function formatRegistration(row) {
  return {
    ...formatUser(row),
    rejectReason: row.reject_reason || '',
    createdAt: toIso(row.created_at),
    reviewedAt: toIso(row.reviewed_at),
  };
}

export function formatApp(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    summary: row.summary,
    icon: row.icon,
    steps: parseJson(row.steps, []),
    views: Number(row.views) || 0,
    status: row.status,
    createdAt: toIso(row.created_at),
  };
}

export function formatExam(row) {
  const fileType = row.mime_type === 'application/pdf' ? 'PDF' : 'IMG';
  return {
    id: row.id,
    title: row.title,
    subject: row.subject,
    college: row.college,
    semester: row.semester,
    examType: row.exam_type,
    hasAnswer: Boolean(row.has_answer),
    status: row.status,
    downloadCount: Number(row.download_count) || 0,
    reviewNote: row.review_note || '',
    createdAt: toIso(row.created_at),
    uploader: {
      id: row.uploader_id,
      displayName: row.uploader_name || '匿名',
    },
    file: row.file_id
      ? {
        id: row.file_id,
        originalName: row.file_name || '',
        mimeType: row.mime_type || '',
        sizeBytes: Number(row.size_bytes) || 0,
        fileType,
      }
      : null,
    downloadUrl: `/api/exams/${row.id}/download`,
  };
}

export function formatPost(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    status: row.status,
    likeCount: Number(row.like_count) || 0,
    commentCount: Number(row.comment_count) || 0,
    likedByMe: Boolean(row.liked_by_me),
    createdAt: toIso(row.created_at),
    board: {
      id: row.board_id,
      code: row.board_code,
      name: row.board_name,
    },
    author: {
      id: row.author_id,
      displayName: row.author_name || '匿名',
    },
  };
}

export function formatQa(row) {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    createdAt: toIso(row.created_at),
    user: {
      id: row.user_id,
      displayName: row.user_name || '同学',
    },
  };
}

export function formatCorrection(row) {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    targetTitle: row.target_title || '',
    content: row.content,
    status: row.status,
    adminNote: row.admin_note || '',
    createdAt: toIso(row.created_at),
    resolvedAt: toIso(row.resolved_at),
    user: {
      id: row.user_id,
      displayName: row.user_name || '同学',
    },
  };
}

export function formatResetRequest(row) {
  return {
    id: row.id,
    note: row.note || '',
    status: row.status,
    createdAt: toIso(row.created_at),
    handledAt: toIso(row.handled_at),
    user: {
      id: row.user_id,
      displayName: row.display_name || '',
      studentNo: row.student_no || '',
      email: row.email || '',
    },
  };
}

export function formatAudit(row) {
  return {
    id: row.id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    detail: parseJson(row.detail, null),
    ip: row.ip || '',
    createdAt: toIso(row.created_at),
  };
}

export { toIso };
