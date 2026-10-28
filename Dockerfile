FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev && chown -R node:node /app
USER node
ENV HOST=0.0.0.0 PORT=3000 CHROMIUM_PATH=/usr/bin/chromium
EXPOSE 3000
CMD ["node", "server/index.cjs"]
