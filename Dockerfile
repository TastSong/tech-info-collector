# ===== tech-info-collector Docker 部署 =====
FROM node:22-alpine AS deps

RUN npm install -g pnpm@9.15.0
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --prod --frozen-lockfile

FROM node:22-alpine AS builder

RUN npm install -g pnpm@9.15.0

WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .
COPY scripts/build-init-db.cjs ./scripts/build-init-db.cjs
RUN mkdir -p /app/data && node scripts/build-init-db.cjs

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-alpine AS runner

RUN npm install -g pnpm@9.15.0

# Playwright 从自己的 CDN 下载 Chromium 二进制（不依赖 apk/apt 源）
# --with-deps 在 Alpine 上不可用，手动装系统依赖
RUN apk add --no-cache \
    cups-libs libxcomposite libxdamage libxrandr \
    mesa-gbm pango alsa-lib at-spi2-core \
    nss nspr dbus-libs gtk+3.0

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npx playwright install chromium

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/ms-playwright/chromium-1228/chrome-linux/chrome

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/db ./db
COPY --from=builder /app/data/sites.seed.json ./data/sites.seed.json
COPY --from=builder /app/src/config/seed.ts ./src/config/seed.ts
COPY --from=builder /app/src/config/seed-remaining.ts ./src/config/seed-remaining.ts
COPY --from=builder /app/src/pipeline ./src/pipeline
COPY --from=builder /app/src/ai ./src/ai
COPY --from=builder /app/src/crawler ./src/crawler
COPY --from=builder /app/src/lib ./src/lib
COPY --from=builder /app/src/notify ./src/notify
COPY --from=builder /app/src/scheduler ./src/scheduler

RUN mkdir -p /app/data

COPY scripts/init-db.cjs ./scripts/init-db.cjs
COPY scripts/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4040
CMD ["docker-entrypoint.sh"]
