#!/bin/sh
set -e

echo "=== 科技情报采集器 ==="

cd /app

echo "[init] 检查数据库..."
node scripts/init-db.cjs

echo "[start] Web 服务启动 :4040 ..."
exec npx next start -p 4040
