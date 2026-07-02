#!/bin/sh
set -e

echo "=== 科技情报采集器 ==="

cd /app

if [ ! -f data/collector.db ]; then
  echo "[init] 初始化数据库..."
  node scripts/init-db.cjs
else
  echo "[init] 数据库已存在 ✓"
fi

echo "[start] Web 服务启动 :4040 ..."
exec npx next start -p 4040
