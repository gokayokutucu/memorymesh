FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY apps/server/package*.json ./apps/server/
COPY packages/core/package*.json ./packages/core/
COPY packages/cli/package*.json ./packages/cli/
RUN npm ci

COPY . .
RUN npm run build

RUN addgroup -S app && adduser -S app -G app
RUN chown -R app:app /app

WORKDIR /app/apps/server
USER app
CMD ["node", "dist/index.js"]
