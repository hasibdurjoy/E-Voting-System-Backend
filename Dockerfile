# syntax=docker/dockerfile:1
#
# Backend image.
#
# Debian (glibc) rather than Alpine on purpose: `argon2` is a native module and its
# prebuilt binaries are glibc. On musl it would fall back to compiling from source, which
# needs a toolchain in the image and fails in ways that are tedious to debug.

# ── dependencies ────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable

# Only the files that affect dependency resolution, so this layer is cached until they
# actually change.
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases ./.yarn/releases

# --immutable: the lockfile is the source of truth. A build must never quietly resolve a
# different tree from the one that was tested.
RUN yarn install --immutable

# ── build ───────────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /app
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN yarn build

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN corepack enable

ENV NODE_OPTIONS=--enable-source-maps
# NODE_ENV is deliberately NOT set here: it comes from the server's .env. The app refuses
# to start with NODE_ENV=production while the identity providers are mocks, and baking a
# value into the image would hide that decision.

COPY --from=deps  --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json yarn.lock .yarnrc.yml tsconfig.json ./
COPY --chown=node:node .yarn/releases ./.yarn/releases

# The TypeScript sources ship too, so the operational tooling runs inside the container:
#   docker compose exec backend yarn seed:demo
#   docker compose exec backend yarn trustee:share --election 1 --share ./share.json
# That is also why the dev dependencies (tsx) are kept rather than pruned.
COPY --chown=node:node src ./src

USER node
EXPOSE 5000

# Checked from inside the container, so Docker restarts a process that is up but not
# serving — not just one that has exited.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
