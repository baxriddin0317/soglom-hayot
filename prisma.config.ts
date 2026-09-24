import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma CLI (migrate, studio) uchun sozlama. Ilova o'zi bazaga lib/db.ts orqali ulanadi.
//
// Supabase'da ikki xil ulanish satri bor:
//   DATABASE_URL — pooler (6543-port, "Transaction" rejim) — Vercel funksiyalari uchun;
//   DIRECT_URL   — to'g'ridan-to'g'ri ulanish (5432-port) — migratsiyalar uchun.
// Migratsiya pooler orqali ishlamaydi, shuning uchun CLI DIRECT_URL ni ishlatadi.
//
// `env()` o'rniga process.env: `prisma generate` (Vercel build) URL'siz ham ishlashi kerak.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || '',
  },
});
