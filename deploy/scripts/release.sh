#!/usr/bin/env bash
# ============================================================
# 打包发布物：web server deploy docs README
# 排除 node_modules / .env / uploads / 测试产物
# 输出 dist/campus2.0-<version>.tar.gz + .sha256
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="${1:-$(date +%Y%m%d-%H%M%S)}"
OUT_DIR="$ROOT/dist"
NAME="campus2.0-$VERSION"
ARCHIVE="$OUT_DIR/$NAME.tar.gz"

mkdir -p "$OUT_DIR"

tar -czf "$ARCHIVE" \
  -C "$ROOT" \
  --exclude='server/node_modules' \
  --exclude='server/.env' \
  --exclude='server/.env.test' \
  --exclude='server/uploads/*' \
  --exclude='server/test/uploads/*' \
  --exclude='server/screenshots' \
  --exclude='.git' \
  --exclude='dist' \
  --exclude='backups' \
  web server deploy docs README.md

sha256sum "$ARCHIVE" > "$ARCHIVE.sha256"

echo "发布包：$ARCHIVE"
echo "校验和：$ARCHIVE.sha256"
echo "提示：发布包里没有 .env，服务器上的密钥放在 /srv/campus2.0/.env"
