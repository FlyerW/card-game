#!/usr/bin/env bash
# 在這台機器上架起遊戲：打包網頁，在 tmux 裡開伺服器（scripts/serve.sh，當掉自動重開）與 Cloudflare 通道，印出給朋友的網址。
# 伺服器只接受本機連線，外面的人都從通道進來（HOST=0.0.0.0 才讓同一個網路的人直接連）。
# 用法：scripts/deploy.sh            （要開 Google 登入就加 GOOGLE_CLIENT_ID=... ）
# 儲值（綠界）：ECPAY_TEST=1 scripts/deploy.sh 用綠界公開的測試帳號；正式的金鑰寫在 data/secrets.env（不會進 git）：
#   ECPAY_MERCHANT_ID=...  ECPAY_HASH_KEY=...  ECPAY_HASH_IV=...  （可以另外設 PUBLIC_URL=https://你的網址）
# 看狀態：tmux attach -t card-game   停掉：tmux kill-session -t card-game
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-8787}
SESSION=${SESSION:-card-game}

npm run build:web
mkdir -p data logs
# 金鑰放在 data/secrets.env，一行一個 KEY=value。
if [ -f data/secrets.env ]; then set -a; . data/secrets.env; set +a; fi
: > logs/tunnel.log

tmux kill-session -t "$SESSION" 2>/dev/null || true
tmux new-session -d -s "$SESSION" -n server \
  "PORT=$PORT DATA_DIR='$PWD/data' GOOGLE_CLIENT_ID='${GOOGLE_CLIENT_ID:-}' ECPAY_TEST='${ECPAY_TEST:-}' ECPAY_STAGE='${ECPAY_STAGE:-}' \
   ECPAY_MERCHANT_ID='${ECPAY_MERCHANT_ID:-}' ECPAY_HASH_KEY='${ECPAY_HASH_KEY:-}' ECPAY_HASH_IV='${ECPAY_HASH_IV:-}' PUBLIC_URL='${PUBLIC_URL:-}' \
   HOST='${HOST:-127.0.0.1}' scripts/serve.sh"
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
