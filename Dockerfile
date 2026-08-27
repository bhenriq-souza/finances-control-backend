FROM node:22.18-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build


FROM node:22.18-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
# Só dependências de runtime: o build já aconteceu no estágio anterior.
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
# O spec OpenAPI é lido de process.cwd()/docs em runtime.
COPY docs/openapi.yaml ./docs/openapi.yaml

USER node

EXPOSE 3000

CMD ["node", "dist/src/server.js"]
