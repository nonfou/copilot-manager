#!/usr/bin/env bash

APP_NAME="copilot-manager"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR"

# ─── 停止（PM2 或 PID 文件）─────────────────────────────────────────────────
if command -v pm2 &>/dev/null && pm2 list | grep -q "$APP_NAME"; then
  pm2 stop "$APP_NAME"
  echo "[ok] 已通过 PM2 停止 $APP_NAME"
elif [ -f "app.pid" ]; then
  PID=$(cat app.pid)
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    echo "[ok] 已停止进程 PID=$PID"
  else
    echo "[warn] PID=$PID 进程不存在（可能已经停止）"
  fi
  rm -f app.pid
else
  echo "[warn] 未找到运行中的 $APP_NAME 进程"
fi
