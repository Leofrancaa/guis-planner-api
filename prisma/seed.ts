import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Seed institutions
  const institutionNames = ['Senai Cimatec', 'Unifacs', 'Bahiana', 'UFBA'];
  for (const name of institutionNames) {
    await prisma.institution.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
  console.log(`✅ ${institutionNames.length} instituições criadas`);

  // Seed admin accounts
  const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD;
  if (!adminPassword) {
    throw new Error('ADMIN_DEFAULT_PASSWORD não definido no .env');
  }

  const admins = [
    { username: 'motti.admin', name: 'Motti Admin' },
    { username: 'leo.admin',   name: 'Leo Admin' },
    { username: 'guis.admin',  name: 'Guis Admin' },
    { username: 'dainiz.admin',name: 'Dainiz Admin' },
  ];

  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  for (const admin of admins) {
    await prisma.user.upsert({
      where: { username: admin.username },
      update: {
        role: 'ADMIN',
        plan: 'PREMIUM',
        premiumUntil: null,
      },
      create: {
        username: admin.username,
        name: admin.name,
        password: hashedPassword,
        role: 'ADMIN',
        plan: 'PREMIUM',
        premiumUntil: null,
      },
    });
  }
  console.log(`✅ ${admins.length} admins criados (motti.admin, leo.admin, guis.admin, dainiz.admin)`);
}

main()
  .catch((e) => {
    console.error('Seed falhou:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
