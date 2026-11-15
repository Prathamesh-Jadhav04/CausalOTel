FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard ./
RUN npm run build

FROM caddy:2.10-alpine
COPY --from=build /app/dist /usr/share/caddy
