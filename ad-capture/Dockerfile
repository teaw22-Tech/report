FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev \
    && npx playwright install --with-deps chromium \
    && apt-get update && apt-get install -y --no-install-recommends xvfb \
    && rm -rf /var/lib/apt/lists/*

COPY . .

ENV PORT=3000
ENV NODE_OPTIONS="--max-old-space-size=192 --expose-gc"
EXPOSE 3000

# รันผ่านจอเสมือน Xvfb เพื่อให้เปิดเบราว์เซอร์แบบ headed ได้ —
# Google ไม่ serve โฆษณาให้เบราว์เซอร์ headless ที่ตรวจจับได้ว่าเป็น bot
CMD ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1280x800x24", "node", "server.js"]
