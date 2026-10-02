# syntax = docker/dockerfile:1

# node:24-slim (glibc, not alpine) so better-sqlite3's prebuilt binary
# installs without a compiler toolchain in the image.
FROM node:24-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY src ./src
COPY public ./public
COPY README.md ./
ENV NODE_ENV=production
# fly.toml mounts the persistent volume at /data; without this the app would
# default to ./data (./app/data here) and lose everything on every redeploy.
ENV DATA_DIR=/data
CMD ["node", "src/server.ts"]
