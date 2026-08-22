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
# TEK IMAJ, IKI SUREC — hangisi calisacagi BANI_PROCESS ile secilir.
#
# NEDEN BOYLE: Railway'de Dockerfile'li bir serviste baslangic komutunu
# degistirmenin tek yolu servis ayarindaki "Custom Start Command" - ve o alan
# CLI'dan ayarlanamiyor (railway add/service/up komutlarinin hicbirinde
# start/command secenegi yok). Env degiskeni ise CLI'dan ayarlanabiliyor,
# dolayisiyla worker servisi tamamen komut satirindan kurulabilir hale geliyor.
#
# EK FAYDA — MIGRATION YARISI YOK: worker dalinda `prisma migrate deploy` ve
# bootstrap scriptleri BILEREK calismiyor. Iki servis ayni anda migrate etseydi
# yarisirlardi; migration tek sahipte (API) kaliyor.
CMD sh -c 'if [ "$BANI_PROCESS" = "worker" ]; then       node dist/src/main-worker.js;     else       pnpm exec prisma migrate deploy       && (node create-kervan.js || true)       && (node create-market-express.js || true)       && (node mutabakat-market-express.js || true)       && (node hiyerarsi-market-express.js || true)       && (node mutabakat-kervan.js || true)       && node dist/src/main.js;     fi'
