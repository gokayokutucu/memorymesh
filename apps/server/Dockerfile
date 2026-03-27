FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY apps/server/package*.json ./apps/server/
COPY packages/core/package*.json ./packages/core/
COPY packages/cli/package*.json ./packages/cli/
RUN npm install

COPY . .
RUN npm run build

WORKDIR /app/apps/server
CMD ["node", "dist/index.js"]
