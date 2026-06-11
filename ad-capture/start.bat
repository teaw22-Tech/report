@echo off
REM วิธีใช้: ดับเบิลคลิกไฟล์นี้
cd /d "%~dp0"

if not exist node_modules (
  echo กำลังติดตั้งโปรแกรม (ครั้งแรกเท่านั้น รอสักครู่)...
  call npm install
)

if not exist "%USERPROFILE%\AppData\Local\ms-playwright" (
  echo กำลังติดตั้งเบราว์เซอร์สำหรับแคปภาพ (ครั้งแรกเท่านั้น)...
  call npx playwright install chromium
)

echo กำลังเปิดระบบ Ads Capture...
start "" http://localhost:3000
node server.js
