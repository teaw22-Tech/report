FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev \
    && npx playwright install --with-deps chromium

COPY . .

ENV PORT=3000
ENV NODE_OPTIONS="--max-old-space-size=512"
EXPOSE 3000

CMD ["node", "server.js"]
