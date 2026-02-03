FROM node:24-alpine AS deps

WORKDIR /app

# Prisma v6 loads prisma.config.ts during postinstall/generate and requires DATABASE_URL.
# The value is only used for schema parsing during build (no DB connection is required here).
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pixivcat?schema=public

COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build

COPY tsconfig.json app.ts ./
COPY src ./src
COPY views ./views

RUN npm run build

FROM build AS prod-deps

RUN npm prune --omit=dev


FROM node:24-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app

COPY --from=prod-deps --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/dist ./dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "dist/app.js"]


FROM build AS migrator

CMD ["npx", "prisma", "migrate", "deploy"]
