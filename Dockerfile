# Narco Futbol - single container: the game server also serves the client.
FROM node:22-slim AS build
WORKDIR /app

# Install with dev dependencies so we can build, then prune below.
COPY package.json package-lock.json* ./
RUN npm ci --include=dev --no-audit --no-fund

COPY tsconfig.json vite.config.ts ./
COPY shared ./shared
COPY server ./server
COPY client ./client
COPY scripts ./scripts
RUN npm run build

# --- runtime ----------------------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# The runtime only needs `ws`: three.js and the Discord SDK are bundled into
# the client at build time, which is why they are dev/optional dependencies.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --omit=optional --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist

ENV PORT=8080
ENV HOST=0.0.0.0
EXPOSE 8080

# Fly's health check hits /api/health.
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "dist/server.js"]
