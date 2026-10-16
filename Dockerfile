# syntax=docker/dockerfile:1.7

# Alpine is the only supported base; both stages use the same musl ABI.

# ---------- Stage 1: build ----------
FROM node:22-alpine AS builder

# Build deps for native modules (sharp, argon2)
RUN apk add --no-cache python3 make g++ pkgconf ca-certificates

WORKDIR /app

# Install all deps (incl. dev) for `nuxt build`
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# Copy sources and build
COPY . .

# Build identity. `.git` is excluded by .dockerignore, so the version CANNOT be
# derived inside the image — it must be computed on the host and passed in.
# Use `npm run docker:build`, or compute it yourself:
#   docker build --build-arg APP_VERSION=$(node scripts/version.mjs) ... .
ARG APP_VERSION
ARG APP_COMMIT=""
ARG APP_COMMIT_DATE=""
RUN test -n "$APP_VERSION" || { \
      echo "ERROR: APP_VERSION build arg is required." >&2; \
      echo "Run 'npm run docker:build', or pass --build-arg APP_VERSION=\$(node scripts/version.mjs)" >&2; \
      exit 1; \
    }

# Build does NOT need real secrets — runtimeConfig is overridden at boot via
# NUXT_* env vars, and production builds embed only non-secret defaults.
# The full Nitro bundle peaks at ~5.5 GiB of V8 heap; Node's default (~4 GiB)
# runs out of memory during bundling. The build host/VM needs >= 8 GiB RAM.
ENV NODE_ENV=production \
    NUXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=7168 \
    APP_VERSION=${APP_VERSION} \
    APP_COMMIT=${APP_COMMIT} \
    APP_COMMIT_DATE=${APP_COMMIT_DATE}

RUN npm run build

# Offline recovery assistant behind `panda recover`. Bundled to a single
# dependency-free file so it runs inside the runtime image without tsx/sources.
# bin/panda.mjs runs it as a child process when bin/recover.cjs exists:
#   docker compose stop app && docker compose run --rm app panda recover [--help]
RUN npx --no-install esbuild scripts/recover.ts --bundle --platform=node \
      --format=cjs --target=node22 --log-level=warning \
      --outfile=/app/recover.cjs

# Interactive account recovery behind `panda password-reset`. Keep the native
# Argon2 binding external and resolve it from Nitro's traced runtime deps.
# This is a standalone tool, not an import of the compiled web server.
RUN npx --no-install esbuild scripts/password-reset.ts --bundle --platform=node \
      --format=cjs --target=node22 --log-level=warning --external:argon2 \
      --outfile=/app/.output/server/password-reset.cjs

# Prune workspace down to runtime artefacts
RUN mkdir -p /app/runtime \
 && cp -r .output                  /app/runtime/.output \
 && cp -r themes                   /app/runtime/themes \
 && mkdir -p /app/runtime/server/utils \
 && cp server/utils/schema.surql   /app/runtime/server/utils/schema.surql \
 && cp package.json                /app/runtime/package.json \
 && cp -r bin                      /app/runtime/bin \
 && cp /app/recover.cjs            /app/runtime/bin/recover.cjs \
 && mkdir -p /app/runtime/.output/server/node_modules \
 && cp -r node_modules/node-cron   /app/runtime/.output/server/node_modules/node-cron

# Freeze build identity for the `panda` CLI. git is not available at runtime,
# so this file is the only source of truth inside the image.
RUN node -e "const { writeFileSync } = require('node:fs'); \
const version = process.env.APP_VERSION; \
writeFileSync('/app/runtime/version.json', JSON.stringify({ \
  version, \
  sha: process.env.APP_COMMIT || null, \
  committedAt: process.env.APP_COMMIT_DATE || null, \
  dirty: /\.dirty\$/.test(version) \
}, null, 2) + '\n')"

# ---------- Stage 2: runtime ----------
FROM node:22-alpine AS runtime

# ARGs do not cross build stages; re-declare for the image labels below.
ARG APP_VERSION
ARG APP_COMMIT=""
ARG APP_COMMIT_DATE=""

# Standard OCI metadata so `docker inspect` reveals the build without exec'ing
# into the container. `created` is the COMMIT date, not wall-clock time, so the
# same commit always yields identical labels.
LABEL org.opencontainers.image.title="PandaBlog" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${APP_COMMIT}" \
      org.opencontainers.image.created="${APP_COMMIT_DATE}"

# Runtime libs needed by sharp / argon2 native bindings
RUN apk add --no-cache ca-certificates tini libstdc++ \
 && addgroup -S -g 1001 nodejs \
 && adduser -S -D -H -u 1001 -G nodejs nuxt

WORKDIR /app

COPY --from=builder --chown=nuxt:nodejs /app/runtime/ ./

# Storage + data dirs (volumes mount over these)
# NOTE: in production the whole ./app-storage host dir is bind-mounted over
# /app/storage, which SHADOWS these baked-in dirs.
RUN mkdir -p storage/uploads storage/variants storage/downloads storage/backups storage/logs storage/rate-limit \
 && chown -R nuxt:nodejs storage

# The single operator CLI (includes `panda password-reset <username>`).
# (`panda --help` for the full reference). Must be created while still root —
# the shim lives outside /app.
RUN printf '#!/bin/sh\nexec node /app/bin/panda.mjs "$@"\n' > /usr/local/bin/panda \
 && chmod 0755 /usr/local/bin/panda

USER nuxt

ENV NODE_ENV=production \
    NUXT_TELEMETRY_DISABLED=1 \
    PANDABLOG_VERSION=${APP_VERSION} \
    NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3000 \
    NODE_OPTIONS=--max-old-space-size=1024 \
    NITRO_SHUTDOWN_TIMEOUT=15000 \
    PORT=3000

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", ".output/server/index.mjs"]
