#!/usr/bin/env bash
set -e

APP_NAME="copilot-manager"
BINARY="./$APP_NAME"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR"

# ─── 解析端口参数 ─────────────────────────────────────────────────────────────
# 优先级：命令行 --port / -p > 环境变量 PORT > 默认值 4242
_PORT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port|-p)
      _PORT="$2"; shift 2 ;;
    --port=*)
      _PORT="${1#*=}"; shift ;;
    *) shift ;;
  esac
done

# ─── 检查 .env ───────────────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo "[warn] .env 文件不存在，正在从 .env.example 复制..."
  cp .env.example .env
  echo "[warn] 请先编辑 .env 设置 ADMIN_USERNAME / ADMIN_PASSWORD / ENCRYPTION_KEY，然后重新运行此脚本"
  exit 1
fi

# 从 .env 中读取 PORT（仅当命令行和 shell 环境均未指定时生效）
if [ -z "$_PORT" ] && [ -z "${PORT+x}" ]; then
  _ENV_PORT="$(grep -E '^PORT=' .env | head -1 | cut -d= -f2- | tr -d '[:space:]')"
  [ -n "$_ENV_PORT" ] && PORT="$_ENV_PORT"
fi
PORT="${_PORT:-${PORT:-4242}}"

# ─── 构建 ─────────────────────────────────────────────────────────────────────
echo "[info] 构建 Go 后端..."
go build -ldflags="-s -w" -o "$BINARY" ./backend/cmd/server/
echo "[info] 构建完成"

# ─── 启动（优先 PM2，否则 nohup）─────────────────────────────────────────────
if command -v pm2 &>/dev/null; then
  if pm2 list | grep -q "$APP_NAME"; then
    echo "[info] 检测到已有进程，执行 restart（端口 $PORT）..."
    PORT="$PORT" pm2 restart "$APP_NAME" --update-env
  else
    PORT="$PORT" pm2 start "$BINARY" --name "$APP_NAME"
    pm2 save
  fi
  echo ""
  pm2 status "$APP_NAME"
  echo ""
  echo "[ok] 已通过 PM2 启动（端口 $PORT）：pm2 logs $APP_NAME"
else
  # 无 PM2 则用 nohup 后台运行，日志写入 app.log
  PORT="$PORT" nohup "$BINARY" > app.log 2>&1 &
  echo $! > app.pid
  echo "[ok] 已在后台启动（端口 $PORT），PID=$(cat app.pid)，日志：tail -f app.log"
fi
