# CLAUDE.md — BANİ GROUP Çalışma Anayasası (backend)

Proje: bani-backend (NestJS + Prisma + PostgreSQL). Railway'de CANLIDIR ve main'e her push OTOMATİK CANLI DEPLOY demektir. 8 aydır geliştirilen çalışan sistem; "sıfırdan kurulum / yeni altyapı" çerçevesi YASAKTIR. Yerel DB = Docker (test verisi); canlı DB = Railway.

## Değişmez kurallar
1. TEŞHİS SAHİBİ KULLANICIDIR: teşhisi yeniden yorumlayıp daraltma; önce onun kelimeleriyle teyit et, kapsamı ondan al, sonra uygula. Güncel talimat eski karardan üstündür.
2. HER DEĞİŞİKLİKTEN ÖNCE dosyanın güncel hali diskten okunur. Geniş regex/toplu değiştirme YASAK — hedefli, tekil eşleşmeli düzenleme.
3. DOĞRULAMA: npx tsc --noEmit --skipLibCheck --experimentalDecorators --emitDecoratorMetadata + npm run build yeşil olmadan commit önerilmez.
4. PUSH = CANLI DEPLOY: push yalnız kullanıcı onayıyla; "bitti" ancak kullanıcı canlıda teyit edince söylenir.
5. KESİN YASAKLAR: .env dosyaları okunmaz, yazılmaz, içeriği hiçbir çıktıda gösterilmez · şifre/token/credential hiçbir dosyaya yazılmaz · prisma migrate / db push / seed komutları kullanıcı onayı olmadan ÇALIŞTIRILMAZ · veritabanına yazan script onaysız çalıştırılmaz.
6. HASSAS DOSYALAR (dokunmadan önce kullanıcıya söyle): src/main.ts, prisma/schema.prisma, src/instrument.ts, src/common/audit/*, src/auth/*.
7. AUDIT TEK KAYNAK: kritik olay kayıtları controller katmanındadır — servise ikinci kayıt EKLENMEZ (çift kayıt yasağı).
8. İLETİŞİM: Türkçe; tek seferde tek soru; kısa ve net; her işin sonunda kullanıcıya canlı kontrol listesi verilir.
