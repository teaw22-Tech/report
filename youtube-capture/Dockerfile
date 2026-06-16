FROM node:22-slim

WORKDIR /app

# Install yt-dlp, ffmpeg, python3
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    curl \
    --no-install-recommends \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3000
ENV NODE_OPTIONS="--max-old-space-size=256"
EXPOSE 3000

CMD ["node", "server.js"]
