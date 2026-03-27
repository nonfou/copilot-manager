#!/usr/bin/env bash
set -e

APP_NAME="copilot-manager"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR"

# ─── 检查 .env ───────────────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo "[warn] .env 文件不存在，正在从 .env.example 复制..."
  cp .env.example .env
  echo "[warn] 请先编辑 .env 设置 ADMIN_USERNAME / ADMIN_PASSWORD / ENCRYPTION_KEY，然后重新运行此脚本"
  exit 1
fi

# ─── 安装依赖 & 构建 ─────────────────────────────────────────────────────────
echo "[info] 安装依赖..."
bun install --frozen-lockfile

echo "[info] 构建..."
bun run build

# ─── 启动（优先 PM2，否则 nohup）─────────────────────────────────────────────
if command -v pm2 &>/dev/null; then
  if pm2 list | grep -q "$APP_NAME"; then
    echo "[info] 检测到已有进程，执行 restart..."
    pm2 restart "$APP_NAME"
  else
    pm2 start dist/main.js --name "$APP_NAME" -- start
    pm2 save
  fi
  echo ""
  pm2 status "$APP_NAME"
  echo ""
  echo "[ok] 已通过 PM2 启动：pm2 logs $APP_NAME"
else
  # 无 PM2 则用 nohup 后台运行，日志写入 app.log
  nohup bun run dist/main.js start > app.log 2>&1 &
  echo $! > app.pid
  echo "[ok] 已在后台启动，PID=$(cat app.pid)，日志：tail -f app.log"
fi
