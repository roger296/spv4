# Smooth Parcel V4 web app: build the Vite bundle, then serve it with nginx.
# Build from the repo root so the shared-types workspace is available:
#   docker build -f apps/web/Dockerfile -t spv4-web --build-arg VITE_API_ORIGIN=https://api.example.com .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY packages/shared-types packages/shared-types
COPY apps/web apps/web
ARG VITE_API_ORIGIN=http://127.0.0.1:3100
ARG VITE_MCP_ORIGIN=http://127.0.0.1:3100/mcp
ENV VITE_API_ORIGIN=$VITE_API_ORIGIN VITE_MCP_ORIGIN=$VITE_MCP_ORIGIN
RUN npm run build -w @spv4/shared-types && npm run build -w @spv4/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK CMD wget -qO- http://127.0.0.1/healthz || exit 1
