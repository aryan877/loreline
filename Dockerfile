FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json turbo.json ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/eslint-config/package.json ./packages/eslint-config/package.json
COPY packages/next-config/package.json ./packages/next-config/package.json
COPY packages/next-config/prepare-standalone.mjs ./packages/next-config/prepare-standalone.mjs
COPY packages/typescript-config/package.json ./packages/typescript-config/package.json
RUN npm ci

FROM deps AS development
COPY . .
CMD ["npm", "run", "dev"]

FROM deps AS builder
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
USER nextjs

FROM runner AS web-runner
ENV PORT=3000
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM runner AS server-runner
ENV PORT=3001
COPY --from=builder --chown=nextjs:nodejs /app/apps/server/.next/standalone ./
EXPOSE 3001
CMD ["node", "apps/server/server.js"]
