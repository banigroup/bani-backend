const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const phone = '+905444444444';
  const user = await prisma.user.upsert({
    where: { phone },
    update: { roles: ['ADMIN'], status: 'ACTIVE', phoneVerified: true, name: 'Operasyon Admin' },
    create: { phone, name: 'Operasyon Admin', roles: ['ADMIN'], status: 'ACTIVE', phoneVerified: true },
  });
  console.log('ADMIN OK:', user.phone, user.roles, user.status);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
