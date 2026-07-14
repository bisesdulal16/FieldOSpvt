# FieldOS Manager Dashboard — Next.js 16 (standalone output).
FROM node:20-alpine AS builder
WORKDIR /app

# Install deps against the lockfile for reproducible builds.
COPY package.json package-lock.json ./
RUN npm ci

# Build → produces .next/standalone with static/public copied in
# (see scripts/copy-standalone-assets.mjs, run by `npm run build`).
COPY . .
RUN npm run build

# ── Runtime image ──────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# The standalone bundle contains server.js, node_modules, .next and public.
COPY --from=builder /app/.next/standalone ./

EXPOSE 3000
CMD ["node", "server.js"]
