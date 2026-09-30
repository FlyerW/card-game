#!/usr/bin/env bash
# 開遊戲伺服器，當掉會自動重開：等 2 秒再開，連續當掉就越等越久（最多 60 秒）；正常跑超過 10 分鐘就重新計算。
# 環境變數照 README（PORT、DATA_DIR、HOST、ECPAY_TEST、GOOGLE_CLIENT_ID…）。紀錄接在 logs/server.log 後面。
# 用法：scripts/serve.sh；要停就在它的視窗按 Ctrl+C（整個迴圈一起停）。
cd "$(dirname "$0")/.." || exit 1
mkdir -p logs
delay=2
while true; do
  started=$(date +%s)
  echo "$(date '+%F %T') 開伺服器" >> logs/server.log
  npx tsx packages/server/src/main.ts 2>&1 | tee -a logs/server.log
  code=${PIPESTATUS[0]}
  if [ $(( $(date +%s) - started )) -gt 600 ]; then delay=2; fi
  echo "$(date '+%F %T') 伺服器結束（代碼 $code），${delay} 秒後重開" | tee -a logs/server.log
  sleep "$delay"
  delay=$(( delay * 2 > 60 ? 60 : delay * 2 ))
done
