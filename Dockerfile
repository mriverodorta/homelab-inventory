FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/catalog-protocol/package.json ./packages/catalog-protocol/
COPY packages/share-contract/package.json ./packages/share-contract/
COPY packages/viewer-model/package.json ./packages/viewer-model/
COPY packages/viewer-react/package.json ./packages/viewer-react/
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.14-slim@sha256:d56a2534ffd262e92c12fd3249d3924d296d97086da773f821d7d0477435ea04 AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/catalog-protocol/package.json ./packages/catalog-protocol/
COPY packages/share-contract/package.json ./packages/share-contract/
COPY packages/viewer-model/package.json ./packages/viewer-model/
COPY packages/viewer-react/package.json ./packages/viewer-react/
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS bun-toolchain

FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY .release-artifacts/wasm/homelab_engine.wasm ./src/engine/generated/homelab_engine.wasm
COPY .release-artifacts/wasm/homelab_engine.wasm ./server/engine/generated/homelab_engine.wasm
ENV HOMELAB_WASM_PREBUILT=1
ENV VITE_DOMAIN_ENGINE=required
RUN mkdir -p /tmp/runtime-data && bun run build

FROM gcr.io/distroless/static-debian13:nonroot@sha256:f7f8f729987ad0fdf6b05eeeae94b26e6a0f613bdf46feea7fc40f7bd72953e6 AS runtime
COPY --from=bun-toolchain /usr/local/bin/bun /usr/local/bin/bun
COPY --from=bun-toolchain /lib/ld-musl-*.so.1 /lib/
COPY --from=bun-toolchain /usr/lib/libstdc++.so.6 /usr/lib/libgcc_s.so.1 /usr/lib/
WORKDIR /app
ARG APP_VERSION=development
ARG APP_REVISION=unknown
ARG APP_CHANNEL=release
ENV NODE_ENV=production
ENV PORT=8798
ENV DATA_DIR=/data
ENV SAVE_DEBOUNCE_MS=500
ENV HOMELAB_ENGINE_WASM=required
ENV APPLICATION_OEM_CONTRACT_VERSION=6
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
COPY --chown=10001:10001 src/types ./src/types
COPY --chown=10001:10001 shared/compatibility ./shared/compatibility
COPY --chown=10001:10001 shared/backup/contract.mjs ./shared/backup/
COPY --chown=10001:10001 shared/power-ports.mjs ./shared/
COPY --chown=10001:10001 shared/network-adapter-ports.ts ./shared/
COPY --chown=10001:10001 shared/engine ./shared/engine
COPY --chown=10001:10001 server/index.mjs server/agent-routes.mjs server/api-error-handler.mjs server/app-health.mjs server/backup-routes.mjs server/bootstrap-routes.mjs server/engine-routes.mjs server/external-access-policy.mjs server/http-delivery.mjs server/inventory-routes.mjs server/onboarding-routes.mjs server/project-routes.mjs server/workspace-routes.mjs server/registry-routes.mjs server/rate-limit.mjs server/request-security.mjs server/routing-cache-model.mjs server/routing-cache-routes.mjs server/runtime-config.mjs server/server-lifecycle.mjs server/staging-policy.mjs server/store-request-error.mjs server/update-checker.mjs server/update-routes.mjs server/update-scheduler.mjs ./server/
COPY --chown=10001:10001 server/backup/archive-envelope.mjs server/backup/archive-security.mjs server/backup/backup-model.mjs server/backup/backup-scheduler.mjs server/backup/backup-sections.mjs server/backup/backup-service.mjs server/backup/restore-journal.mjs server/backup/restore-preflight.mjs server/backup/sqlite-restore-staging.ts server/backup/sqlite-section-exporter.ts ./server/backup/
COPY --chown=10001:10001 server/auth/access-routes.mjs server/auth/access-service.mjs server/auth/api-permissions.mjs server/auth/auth-service.mjs server/auth/authorization-model.mjs server/auth/authorization-service.mjs server/auth/common-passwords.mjs server/auth/config.mjs server/auth/engine-permissions.mjs server/auth/invitation-service.mjs server/auth/middleware.mjs server/auth/model.mjs server/auth/oidc-service.mjs server/auth/passwords.mjs server/auth/permission-catalog.mjs server/auth/reset-owner-cli.mjs server/auth/routes.mjs server/auth/session-service.mjs server/auth/tokens.mjs ./server/auth/
COPY --chown=10001:10001 server/engine/command-service.mjs server/engine/runtime.mjs server/engine/snapshot.mjs server/engine/sse-hub.mjs ./server/engine/
COPY --chown=10001:10001 server/live-events ./server/live-events
COPY --from=build --chown=10001:10001 /app/server/engine/generated/homelab_engine.wasm ./server/engine/generated/homelab_engine.wasm
COPY --chown=10001:10001 server/db/agent-auth.mjs server/db/inventory-capabilities.mjs server/db/inventory-input.mjs server/db/inventory-lifecycle.mjs server/db/legacy-network-normalization.ts server/db/nas-power-configuration.mjs server/db/relational-ids.mjs server/db/store.mjs server/db/validation.mjs ./server/db/
COPY --chown=10001:10001 server/db/migrate-schema-*.mjs ./server/db/
COPY --chown=10001:10001 server/persistence ./server/persistence
COPY --chown=10001:10001 server/registry ./server/registry
COPY --chown=10001:10001 server/agents ./server/agents
COPY --chown=10001:10001 server/telemetry ./server/telemetry
COPY --chown=10001:10001 server/notifications ./server/notifications
COPY --chown=10001:10001 server/sharing/account-unlink-service.mjs server/sharing/capabilities.mjs server/sharing/enrollment-coordinator.mjs server/sharing/installation-auth.mjs server/sharing/installation-event-coordinator.mjs server/sharing/installation-identity.mjs server/sharing/installation-instance.mjs server/sharing/labgd-client.mjs server/sharing/privacy-policy.mjs server/sharing/public-id-service.mjs server/sharing/publication-coordinator.mjs server/sharing/publication-service.mjs server/sharing/remote-capabilities.mjs server/sharing/routes.mjs server/sharing/share-projector.mjs server/sharing/source-provider.mjs ./server/sharing/
COPY --chown=10001:10001 server/compatibility/audit-service.mjs server/compatibility/routes.mjs ./server/compatibility/
COPY --chown=10001:10001 server/inventory-metadata ./server/inventory-metadata
COPY --chown=10001:10001 server/systems/attention-projector.mjs server/systems/memory-pressure.mjs server/systems/read-service.mjs server/systems/routes.mjs server/systems/saved-view-service.mjs ./server/systems/
COPY --chown=10001:10001 server/startup ./server/startup
COPY --chown=10001:10001 server/agent-release-pin.json ./server/
COPY --chown=10001:10001 .release-artifacts/agent ./server/agent-release
RUN ["bun", "-e", "const fs = await import('node:fs/promises'); const { AgentReleaseService } = await import('./server/agents/release-service.mjs'); const pin = JSON.parse(await fs.readFile('./server/agent-release-pin.json', 'utf8')); await new AgentReleaseService({ expectedVersion: pin.version, expectedSourceRevision: pin.sourceRevision }).initialize();"]
COPY --chown=10001:10001 packages/catalog-protocol/package.json ./packages/catalog-protocol/
COPY --chown=10001:10001 packages/catalog-protocol/src ./packages/catalog-protocol/src
COPY --chown=10001:10001 packages/share-contract/package.json ./packages/share-contract/
COPY --chown=10001:10001 packages/share-contract/src ./packages/share-contract/src
COPY --chown=10001:10001 packages/viewer-model/package.json ./packages/viewer-model/
COPY --chown=10001:10001 packages/viewer-model/src ./packages/viewer-model/src
COPY --chown=10001:10001 packages/viewer-react/package.json ./packages/viewer-react/
COPY --chown=10001:10001 packages/viewer-react/src ./packages/viewer-react/src
COPY --chown=10001:10001 server/demo/session-manager.mjs server/demo/sanitizer.mjs ./server/demo/
COPY --chown=10001:10001 server/onboarding/example-workspace.mjs server/onboarding/lifecycle.mjs server/onboarding/model.mjs ./server/onboarding/
COPY --chown=10001:10001 scripts/verify-wasm-runtime.mjs ./scripts/
COPY --chown=10001:10001 scripts/verify-sqlite-runtime.mjs ./scripts/
COPY --from=build --chown=10001:10001 /tmp/runtime-data /data
RUN ["bun", "scripts/verify-wasm-runtime.mjs"]
RUN ["bun", "scripts/verify-sqlite-runtime.mjs"]
RUN ["bun", "-e", "await import('./server/auth/auth-service.mjs'); await import('./server/auth/routes.mjs')"]

VOLUME ["/data"]
EXPOSE 8798
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const r = await fetch('http://127.0.0.1:8798/api/health'); if (!r.ok) process.exit(1)"]

USER 10001:10001

ENTRYPOINT ["bun"]
CMD ["server/index.mjs"]
