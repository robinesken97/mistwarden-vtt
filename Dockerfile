# Optionales Docker-Setup für andere Installationen (die eigene bleibt plain LXC, siehe deploy/).
# HTTPS übernimmt ein Reverse Proxy davor; ohne HTTPS laufen PWA und Service Worker nicht.

FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY packages/protocol/package.json packages/protocol/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 \
	DATABASE_PATH=/data/mistwarden.sqlite ASSET_STORAGE_PATH=/data/assets TRUST_PROXY=true
WORKDIR /app
COPY package.json package-lock.json LICENSE ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
COPY packages/protocol/package.json packages/protocol/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY apps/server/src apps/server/src
COPY packages/protocol/src packages/protocol/src
COPY --from=build /src/apps/client/dist apps/client/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/server/src/index.ts"]
