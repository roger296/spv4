# Smooth Parcel V4 API / worker image. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t spv4-api .
# The same image runs the API (default) and the worker (command: npm run worker -w @spv4/api).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @spv4/shared-types --workspace @spv4/api --include-workspace-root
COPY packages/shared-types packages/shared-types
COPY apps/api apps/api
RUN npm run build -w @spv4/shared-types && npm run build -w @spv4/api

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared-types/package.json packages/shared-types/package.json
COPY --from=build /app/packages/shared-types/dist packages/shared-types/dist
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/src/db/migrations apps/api/src/db/migrations
COPY --from=build /app/apps/api/scripts apps/api/scripts
COPY --from=build /app/apps/api/src apps/api/src
RUN mkdir -p /app/documents && chown -R node:node /app
USER node
WORKDIR /app/apps/api
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations run on every start (idempotent), then the API.
CMD ["sh", "-c", "npx tsx scripts/migrate.ts && node dist/server.js"]
