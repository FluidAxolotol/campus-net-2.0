#!/usr/bin/env bash
# ============================================================
# 健康检查：/api/health 会 SELECT 1，因此同时验证 Node 与 MySQL
# 用法：./healthcheck.sh [base_url]
# ============================================================
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:8088}"

echo "==> API + DB：$BASE_URL/api/health"
curl -fsS "$BASE_URL/api/health"
echo

echo "==> 静态页：$BASE_URL/login.html"
curl -fsS -o /dev/null -w "HTTP %{http_code}\n" "$BASE_URL/login.html"

echo "健康检查通过"
