# Anchor: production image for the Dell Pro Max with NVIDIA GB10 (arm64) or any x86_64 host.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN useradd --system --uid 1001 anchor
COPY --from=build --chown=anchor /app/.next/standalone ./
COPY --from=build --chown=anchor /app/.next/static ./.next/static
COPY --from=build --chown=anchor /app/public ./public
USER anchor
EXPOSE 3000
CMD ["node", "server.js"]
