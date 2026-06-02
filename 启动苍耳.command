#!/bin/zsh
# 苍耳 pi-Xanthil 一键启动 — 双击运行
# 启动 gateway(:8787) + web(:5173)，就绪后自动打开浏览器；关闭本窗口即停止服务。

cd "$(dirname "$0")" || exit 1

WEB_URL="http://localhost:5173"
GATEWAY_HEALTH_URL="http://localhost:8787/api/health"

is_ready() {
  curl -fsS -o /dev/null "$WEB_URL" 2>/dev/null &&
    curl -fsS -o /dev/null "$GATEWAY_HEALTH_URL" 2>/dev/null
}

kill_port_listeners() {
  lsof -ti "tcp:$1" 2>/dev/null | xargs kill 2>/dev/null || true
}

# Finder 启动时通常已加载 ~/.zshrc 的 PATH；若仍找不到 npm，补常见路径。
if ! command -v npm >/dev/null 2>&1; then
  export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.nvm/versions/node/*/bin:$PATH"
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "❌ 找不到 npm，请确认 Node.js 已安装并在 PATH 中。"
  echo "按回车关闭…"; read; exit 1
fi

# 前后端都健康时直接复用现有实例。
if is_ready; then
  echo "✅ 检测到 苍耳 已在运行，直接打开浏览器…"
  open "$WEB_URL"
  exit 0
fi

# 首次启动安装依赖
if [ ! -d node_modules ]; then
  echo "📦 首次启动，安装依赖（约 20s）…"
  npm install || { echo "❌ npm install 失败"; echo "按回车关闭…"; read; exit 1; }
fi

# 半启动或旧版本实例会让 Vite 代理指向错误 gateway，启动前清理固定端口。
kill_port_listeners 5173
kill_port_listeners 8787

echo "🚀 启动 苍耳 pi-Xanthil…"
npm run dev &
DEV_PID=$!

# 关闭时清理：杀掉 npm 进程 + 占用端口的残留进程
cleanup() {
  echo "\n🛑 正在停止 苍耳…"
  kill "$DEV_PID" 2>/dev/null
  kill_port_listeners 5173
  kill_port_listeners 8787
}
trap cleanup INT TERM EXIT

# 等待前后端就绪（最多 60s）后打开浏览器
echo -n "⏳ 等待服务就绪"
for i in {1..60}; do
  if is_ready; then
    echo " 就绪！"
    open "$WEB_URL"
    break
  fi
  echo -n "."
  sleep 1
done

echo "\n———————————————————————————————"
echo "  苍耳运行中：$WEB_URL"
echo "  关闭此窗口或按 Ctrl+C 即停止服务"
echo "———————————————————————————————"

# 保持前台，直到服务退出或用户中断
wait "$DEV_PID"
