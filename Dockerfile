# Next.js, for Sliplane (Phase E).
#
# ─────────────────────────────────────────────────────────────────────────────
# THREE STAGES, AND THE THIRD ONE IS THE POINT.
#
# The build needs the full dependency tree and the toolchain; the thing that runs
# in production needs neither. Shipping one stage would put the compiler, the
# test runner and every devDependency on a public host — a larger attack surface
# and a slower cold start, in exchange for a shorter Dockerfile.
#
# `output: 'standalone'` in next.config.ts is what makes the last stage small:
# Next traces the modules actually reached and copies those, rather than the
# 400MB of node_modules that produced them.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-alpine AS deps
WORKDIR /app
# Only the manifests, so this layer is cached until a dependency actually changes.
# Copying the source here instead would rebuild the dependency tree on every edit.
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The build must not reach a database or a model. Anything that needs either is a
# runtime concern, and a build that quietly depends on one fails in CI at the
# worst possible moment.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Not root. A container that runs as root turns any remote code execution into
# host-adjacent code execution, and there is nothing here that needs the
# privilege.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# Sliplane restarts an unhealthy container. The check hits the app's own route
# rather than a TCP probe: a Node process that is listening but has lost its
# database pool passes a TCP check and serves errors to every customer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
