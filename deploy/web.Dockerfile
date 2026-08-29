# Image for the Donald web app (Next.js 16 / React 19).
#
# It lives HERE rather than in frontend/ on purpose: the frontend is being worked
# on by other people, and a Dockerfile dropped into their tree is a merge
# conflict waiting to happen. Build context is still the frontend directory —
# see 04-build-web.sh, which passes `-f` at it.
#
# Why `next start` over the smaller `output: standalone` runtime: standalone
# requires a line in next.config.mjs, and editing a file someone else has open
# is exactly what we are avoiding. The cost is node_modules in the runtime layer
# (a few hundred MB); the box has 79 GB free and this is a demo. Switch to
# standalone once the frontend settles.

FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable

# Dependencies keyed only on the manifests, so a source-only change reuses this
# layer instead of re-resolving the whole tree.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# NEXT_PUBLIC_* is inlined into the client bundle AT BUILD TIME, not read at
# runtime — so this has to be a build arg. Point it at the API host; the app
# falls back to its recorded fixture when it is empty, which is a legitimate
# offline demo mode rather than a broken state.
ARG NEXT_PUBLIC_DONALD_API=""
ENV NEXT_PUBLIC_DONALD_API=$NEXT_PUBLIC_DONALD_API
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# The whole built tree: .next plus node_modules, and lib/donald/events.recorded.jsonl,
# which app/api/donald-recording reads from disk at request time.
#
# --chown matters: the runtime runs as the unprivileged `node` user, and a
# root-owned tree makes Next fail the moment it wants to write to .next/cache.
COPY --from=build --chown=node:node /app ./

# Next binds 3000 by default; the chart's service.port must match.
EXPOSE 3000
USER node

# Invoke next directly rather than through `pnpm start`. Going through pnpm makes
# corepack fetch the package manager from the network on EVERY container start —
# needless latency, and a startup that fails when the registry is unreachable.
# The binary is already in the image; use it.
CMD ["./node_modules/.bin/next", "start"]
