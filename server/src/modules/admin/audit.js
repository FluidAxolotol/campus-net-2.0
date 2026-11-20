// ============================================================
// 后台审计日志
// 关键操作写表，不写文件；不记录密码、动态码、恢复码。
// db 可以是连接池，也可以是事务里的 connection。
// ============================================================

export async function writeAudit(db, {
  schoolId,
  actorType = 'admin',
  actorId,
  action,
  targetType = null,
  targetId = null,
  detail = null,
  ip = '',
}) {
  await db.execute(
    `INSERT INTO audit_logs
       (school_id, actor_type, actor_id, action, target_type, target_id, detail, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      schoolId,
      actorType,
      actorId ?? null,
      action,
      targetType,
      targetId ?? null,
      detail ? JSON.stringify(detail) : null,
      ip ? String(ip).slice(0, 64) : null,
    ],
  );
}
