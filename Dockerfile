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
ARG APP_VERSION=development
ARG APP_REVISION=unknown
ARG APP_CHANNEL=stable
ENV NODE_ENV=production
ENV PORT=8798
ENV DATA_DIR=/data
ENV SAVE_DEBOUNCE_MS=500
ENV APP_REVISION=${APP_REVISION}
ENV APP_CHANNEL=${APP_CHANNEL}

LABEL org.opencontainers.image.version=${APP_VERSION}
LABEL org.opencontainers.image.revision=${APP_REVISION}
LABEL org.opencontainers.image.source="https://github.com/mriverodorta/homelab-inventory"
LABEL io.homelab-inventory.channel=${APP_CHANNEL}

COPY --chown=10001:10001 package.json bun.lock ./
COPY --from=prod-deps --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/dist ./dist
COPY --chown=10001:10001 src/release-notes.ts ./src/
COPY --chown=10001:10001 src/lib/negotiated-speed.ts ./src/lib/
COPY --chown=10001:10001 server/index.mjs server/agent-routes.mjs server/update-checker.mjs server/update-routes.mjs server/update-scheduler.mjs ./server/
COPY --chown=10001:10001 server/db/agent-auth.mjs server/db/store.mjs server/db/validation.mjs ./server/db/
COPY --chown=10001:10001 server/demo/session-manager.mjs server/demo/sanitizer.mjs ./server/demo/
COPY --from=build --chown=10001:10001 /tmp/runtime-data /data

VOLUME ["/data"]
EXPOSE 8798
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const r = await fetch('http://127.0.0.1:8798/api/health'); if (!r.ok) process.exit(1)"]

USER 10001:10001

CMD ["server/index.mjs"]
