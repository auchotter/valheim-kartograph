FROM node:24-alpine AS build

WORKDIR /app

# Only the build stage contains compilers, needed if SQLite's native module has no matching prebuild.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY client ./client
COPY server ./server
COPY shared ./shared
COPY tsconfig.server.json vite.config.ts ./
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine AS production

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/valheim-map.sqlite

WORKDIR /app

RUN addgroup --system --gid 10001 app && adduser --system --uid 10001 --ingroup app app \
    && mkdir /data \
    && chown app:app /data

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server/index.js"]
