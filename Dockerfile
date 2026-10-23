# syntax=docker/dockerfile:1.7

ARG PNPM_VERSION=12.4.2
ARG TURBO_VERSION=2.11.9

FROM node:22.23.3-bookworm-slim@sha256:3ed98443660ff48413b5af19ecefce3b9d50845a901a43420d47cc63a9fddbe9 AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1
RUN npm install --global --no-fund --no-audit pnpm@${PNPM_VERSION}
WORKDIR /repo

# Only the workspaces the image needs reach the build stage, so a change in another package
# (the SDK, the e2e suite) or in docs and scripts does not invalidate the install or build layers.
FROM base AS prune
ARG TURBO_VERSION
RUN npm install --global --no-fund --no-audit turbo@${TURBO_VERSION}
COPY . .
RUN turbo prune @cohory/web @cohory/worker @cohory/db --docker

FROM base AS build
COPY --from=prune /repo/out/json/ ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store
COPY --from=prune /repo/out/full/ ./
# The Turbopack build cache lives in a cache mount, so the next build after a code change only
# recompiles what changed. Cap the build cache with
# `docker builder prune -f --max-used-space 3gb` instead of dropping it with the pnpm store.
RUN --mount=type=cache,id=cohory-next-cache,sharing=locked,target=/repo/apps/web/.next/cache \
    pnpm build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @cohory/worker deploy --prod --legacy --store-dir /pnpm/store /out/worker \
 && pnpm --filter @cohory/db deploy --prod --legacy --store-dir /pnpm/store /out/db

FROM node:22.23.3-bookworm-slim@sha256:3ed98443660ff48413b5af19ecefce3b9d50845a901a43420d47cc63a9fddbe9 AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
RUN groupadd --system --gid 1001 cohory \
 && useradd --system --uid 1001 --gid cohory --no-create-home cohory \
 && mkdir -p /data/uploads \
 && chown -R cohory:cohory /data
COPY --from=build --chown=cohory:cohory /repo/apps/web/.next/standalone ./
COPY --from=build --chown=cohory:cohory /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=cohory:cohory /out/worker/node_modules ./apps/worker/node_modules
COPY --from=build --chown=cohory:cohory /repo/apps/worker/dist ./apps/worker/dist
COPY --from=build --chown=cohory:cohory /repo/apps/worker/package.json ./apps/worker/package.json
COPY --from=build --chown=cohory:cohory /out/db/node_modules ./packages/db/node_modules
COPY --from=build --chown=cohory:cohory /repo/packages/db/dist ./packages/db/dist
COPY --from=build --chown=cohory:cohory /repo/packages/db/migrations ./packages/db/migrations
COPY --from=build --chown=cohory:cohory /repo/packages/db/package.json ./packages/db/package.json
USER cohory
EXPOSE 3000
VOLUME ["/data/uploads"]
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/web/server.js"]
