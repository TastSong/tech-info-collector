# ===== tech-info-collector Docker 部署 =====
# 使用 Debian-based 镜像 (glibc) 以支持 Playwright Chromium
FROM node:22-slim AS deps

RUN npm install -g pnpm@9.15.0
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --prod --frozen-lockfile

FROM node:22-slim AS builder

RUN npm install -g pnpm@9.15.0

WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .
COPY scripts/build-init-db.cjs ./scripts/build-init-db.cjs
RUN mkdir -p /app/data && node scripts/build-init-db.cjs

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-slim AS runner

RUN npm install -g pnpm@9.15.0

# Playwright 系统依赖 (Debian Bookworm/glibc)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
    libasound2 libatspi2.0-0 \
    && rm -rf /var/lib/apt/lists/*

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
COPY --from=builder /app/sites.json ./sites.json
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
