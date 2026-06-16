FROM node:22-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    --no-install-recommends \
    && pip3 install -q yt-dlp --break-system-packages \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
ENV NODE_OPTIONS="--max-old-space-size=256"
EXPOSE 3000

CMD ["node", "server.js"]
