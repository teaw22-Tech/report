@echo off
echo ====================================
echo  YouTube Capture - Docker Launcher
echo ====================================
echo.

docker info >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker Desktop ยังไม่ได้เปิด กรุณาเปิด Docker Desktop แล้วลองใหม่
  pause
  exit /b 1
)

echo [1/2] Building Docker image...
docker build -t youtube-capture .
if errorlevel 1 (
  echo [ERROR] Build ไม่สำเร็จ
  pause
  exit /b 1
)

echo.
echo [2/2] Starting server...
echo.
echo  ✅ เปิด browser แล้วไปที่: http://localhost:3000
echo  (กด Ctrl+C เพื่อหยุด)
echo.
docker run --rm -p 3000:3000 youtube-capture
pause
