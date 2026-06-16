@echo off
chcp 65001 >nul
echo ====================================
echo  YouTube Capture - Docker Launcher
echo ====================================
echo.

docker info >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker Desktop is not running!
  echo.
  echo Please:
  echo  1. Open Docker Desktop from Start Menu
  echo  2. Wait until the whale icon stops spinning
  echo  3. Run this file again
  echo.
  pause
  exit /b 1
)

echo [1/2] Building Docker image (first time takes 5-10 minutes)...
docker build -t youtube-capture .
if errorlevel 1 (
  echo [ERROR] Build failed. Check your internet connection and try again.
  pause
  exit /b 1
)

echo.
echo [2/2] Starting server...
echo.
echo  ===========================================
echo   Open browser and go to: http://localhost:3000
echo   Press Ctrl+C to stop
echo  ===========================================
echo.
docker run --rm -p 3000:3000 youtube-capture
pause
