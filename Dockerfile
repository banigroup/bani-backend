FROM node:20-slim
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@9
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install
COPY . .

# BIRIM SINIRI VE GUARD KAPISI — build zamaninda, CMD'de DEGIL.
# CI'da da var (.github/workflows/ci.yml) ama Railway CI'i BEKLEMIYOR: push
# eder etmez build basliyor, dolayisiyla CI kirmizi olsa bile kod canliya
# gidebiliyordu. Burasi o boslugu kapatir - ihlal varsa IMAJ URETILMEZ,
# deploy hic gerceklesmez, eski surum ayakta kalir.
#
# NEDEN BUILD'DEN ONCE: iki script ~350 ms suruyor; ihlal varsa pnpm run
# build'in dakikalari hic harcanmaz.
# NEDEN RUN, CMD DEGIL: kontrol imaj basina BIR KEZ calisir ve tek imaj hem
# API hem worker'a gittigi icin BANI_PROCESS switch'ine dokunmaz. CMD'ye
# konsaydi her restart'a maliyet binerdi ve calisma zamaninda src/ klasorune
# bagimli hale gelirdik (imaj ileride dist-only'ye kucultulurse canlida coker).
RUN node scripts/check-boundaries.js && node scripts/check-guards.js

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
