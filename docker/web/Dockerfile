# Campus Forge PWA image: build the Vite app, serve it from nginx, and proxy
# /api + /ws to the backend container (mirroring web-client/serve.mjs — the
# browser Origin header is stripped so Spring CORS never rejects it).
#
# Build context = repo root (see docker-compose.yml).
FROM node:20-alpine AS build

WORKDIR /app

COPY web-client/package.json web-client/package-lock.json ./
RUN npm ci

COPY web-client/ ./
RUN npm run build

FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="Campus Forge Web Client"
LABEL org.opencontainers.image.description="Vite + React 18 PWA (offline-first)"

COPY docker/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK CMD wget -q -O /dev/null http://localhost/ || exit 1
