FROM node:20-slim
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@9
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install
COPY . .
RUN pnpm run build
ENV NODE_ENV=production
EXPOSE 4000
CMD pnpm exec prisma migrate deploy && (node create-kervan.js || true) && (node create-market-express.js || true) && (node mutabakat-market-express.js || true) && (node hiyerarsi-market-express.js || true) && (node mutabakat-kervan.js || true) && node dist/src/main.js
