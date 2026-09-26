#!/usr/bin/env bash
# 在這台機器上架起遊戲：打包網頁，在 tmux 裡開伺服器與 Cloudflare 通道，印出給朋友的網址。
# 用法：scripts/deploy.sh            （要開 Google 登入就加 GOOGLE_CLIENT_ID=... ）
# 看狀態：tmux attach -t card-game   停掉：tmux kill-session -t card-game
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-8787}
SESSION=${SESSION:-card-game}

npm run build:web
mkdir -p data logs
: > logs/tunnel.log

tmux kill-session -t "$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" -n server \
  "PORT=$PORT DATA_DIR='$PWD/data' GOOGLE_CLIENT_ID='${GOOGLE_CLIENT_ID:-}' npx tsx packages/server/src/main.ts 2>&1 | tee logs/server.log"
# Cloudflare 的免費通道：不用帳號，給一個 https://xxxx.trycloudflare.com 網址。每次重開網址會變。
tmux new-window -t "$SESSION" -n tunnel "cloudflared tunnel --no-autoupdate --url http://localhost:$PORT 2>&1 | tee logs/tunnel.log"

url=''
for _ in $(seq 1 60); do
  url=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' logs/tunnel.log | head -1 || true)
  [ -n "$url" ] && break
  sleep 1
done
if [ -z "$url" ]; then
  echo '通道沒有給網址，看 logs/tunnel.log' >&2
  exit 1
fi
echo "$url" > logs/url.txt
echo "遊戲網址：$url"
