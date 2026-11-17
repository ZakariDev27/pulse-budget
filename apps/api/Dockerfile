# Build context is the repository root:  docker build -f apps/api/Dockerfile .

FROM node:26-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

FROM base AS build
RUN --mount=type=cache,target=/root/.npm npm ci
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN npm run build -w @pulse/api

FROM base AS runtime
ENV NODE_ENV=production
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --workspace @pulse/api
COPY apps/api/migrations apps/api/migrations
COPY --from=build /app/apps/api/dist apps/api/dist

# One image, two roles: the API (default) and the worker (command: node dist/worker.js).
USER node
WORKDIR /app/apps/api
EXPOSE 3000
CMD ["node", "dist/server.js"]
