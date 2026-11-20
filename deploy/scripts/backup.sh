#!/usr/bin/env bash
# ============================================================
# 备份 MySQL + uploads
# 用法（开发环境）：
#   CAMPUS_ROOT="$PWD" ENV_FILE="$PWD/server/.env" BACKUP_DIR="$PWD/backups" \
#     ./deploy/scripts/backup.sh
# 生产环境：
#   CAMPUS_ROOT=/srv/campus2.0 /srv/campus2.0/current/deploy/scripts/backup.sh
# 注意：备份后必须演练恢复，确认文件真的可用。
# ============================================================
set -euo pipefail

CAMPUS_ROOT="${CAMPUS_ROOT:-/srv/campus2.0}"
ENV_FILE="${ENV_FILE:-$CAMPUS_ROOT/.env}"
BACKUP_DIR="${BACKUP_DIR:-$CAMPUS_ROOT/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "找不到环境变量文件：$ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_NAME="${DB_NAME:-campus2}"
DB_USER="${DB_USER:-campus2}"
DB_PASSWORD="${DB_PASSWORD:-}"
UPLOAD_DIR="${UPLOAD_DIR:-./uploads}"

# 相对路径按 server/ 解析
if [[ "$UPLOAD_DIR" != /* ]]; then
  UPLOAD_DIR="$CAMPUS_ROOT/current/server/${UPLOAD_DIR#./}"
fi

mkdir -p "$BACKUP_DIR"

echo "==> 备份数据库到 $BACKUP_DIR/mysql-$STAMP.sql.gz"
MYSQL_PWD="$DB_PASSWORD" mysqldump \
  -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
  --single-transaction --routines --triggers --no-tablespaces \
  "$DB_NAME" | gzip > "$BACKUP_DIR/mysql-$STAMP.sql.gz"

echo "==> 备份 uploads 到 $BACKUP_DIR/uploads-$STAMP.tar.gz"
tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"

echo "==> 校验 gzip"
gzip -t "$BACKUP_DIR/mysql-$STAMP.sql.gz"
tar -tzf "$BACKUP_DIR/uploads-$STAMP.tar.gz" >/dev/null

echo "备份完成：$STAMP"
