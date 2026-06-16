#!/bin/bash
echo "===================================="
echo " YouTube Capture - Docker Launcher"
echo "===================================="
echo ""

if ! docker info > /dev/null 2>&1; then
  echo "[ERROR] Docker Desktop ยังไม่ได้เปิด กรุณาเปิด Docker Desktop แล้วลองใหม่"
  exit 1
fi

echo "[1/2] Building Docker image..."
docker build -t youtube-capture .
if [ $? -ne 0 ]; then
  echo "[ERROR] Build ไม่สำเร็จ"
  exit 1
fi

echo ""
echo "[2/2] Starting server..."
echo ""
echo " ✅ เปิด browser แล้วไปที่: http://localhost:3000"
echo " (กด Ctrl+C เพื่อหยุด)"
echo ""
docker run --rm -p 3000:3000 youtube-capture
