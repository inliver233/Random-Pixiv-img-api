FROM node:24-alpine AS builder

WORKDIR /app

# Prisma v6 loads prisma.config.ts during postinstall/generate and requires DATABASE_URL.
# The value is only used for schema parsing during build (no DB connection is required here).
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pixivcat?schema=public

COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json app.ts ./
COPY src ./src
COPY views ./views

RUN npm run build
RUN npm prune --omit=dev


FROM node:24-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist

USER node

EXPOSE 3000

CMD ["node", "dist/app.js"]
