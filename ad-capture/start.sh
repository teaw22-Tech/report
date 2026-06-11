#!/bin/bash
# วิธีใช้: ดับเบิลคลิกไฟล์นี้ (หรือรันใน terminal ด้วย ./start.sh)
cd "$(dirname "$0")"

if [ ! -d "node_modules" ]; then
  echo "กำลังติดตั้งโปรแกรม (ครั้งแรกเท่านั้น รอสักครู่)..."
  npm install
fi

if [ ! -d "$(npm root)/playwright/.local-browsers" ] && [ ! -d "$HOME/.cache/ms-playwright" ]; then
  echo "กำลังติดตั้งเบราว์เซอร์สำหรับแคปภาพ (ครั้งแรกเท่านั้น)..."
  npx playwright install chromium
fi

echo "กำลังเปิดระบบ Ads Capture..."
( sleep 2 && (open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null) ) &
node server.js
