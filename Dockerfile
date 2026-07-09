FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1-slim AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p /tmp/runtime-data && bun run build

FROM oven/bun:1-distroless AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8798
ENV DATA_DIR=/data
ENV SAVE_DEBOUNCE_MS=500

COPY --chown=10001:10001 package.json bun.lock ./
COPY --from=prod-deps --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/dist ./dist
COPY --chown=10001:10001 src/release-notes.ts ./src/
COPY --chown=10001:10001 server/index.mjs server/agent-routes.mjs ./server/
COPY --chown=10001:10001 server/db/agent-auth.mjs server/db/store.mjs server/db/validation.mjs ./server/db/
COPY --chown=10001:10001 server/demo/session-manager.mjs server/demo/sanitizer.mjs ./server/demo/
COPY --from=build --chown=10001:10001 /tmp/runtime-data /data

VOLUME ["/data"]
EXPOSE 8798
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const r = await fetch('http://127.0.0.1:8798/api/health'); if (!r.ok) process.exit(1)"]

USER 10001:10001

CMD ["server/index.mjs"]
