import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/lib/generated/prisma/client';

// Bitta Prisma klienti butun server instance umri davomida qayta ishlatiladi (Vercel funksiyasi
// "iliq" bo'lsa keyingi so'rovlar yangi ulanish ochmaydi). Dev rejimida hot-reload har safar
// yangi klient yaratmasligi uchun globalThis'da saqlanadi.
//
// DATABASE_URL — Supabase Transaction pooler (6543). Pooler prepared statement'larni
// qo'llamaydi; `pg` drayveri nomsiz so'rovlardan foydalanadi, shuning uchun muammo yo'q.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL sozlanmagan');
  }
  // Serverless: har instance uchun kichik pul — Supabase ulanish limiti tugab qolmasligi uchun.
  const adapter = new PrismaPg({ connectionString, max: 5, idleTimeoutMillis: 10_000 });
  return new PrismaClient({ adapter });
}

let client: PrismaClient | undefined = globalForPrisma.prisma;

export function getDb(): PrismaClient {
  if (!client) {
    client = createClient();
    if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = client;
  }
  return client;
}

/** Testlar uchun: boshqa adapter (masalan PGlite) bilan yaratilgan klientni o'rnatish. */
export function setDb(next: PrismaClient): void {
  client = next;
}

// `db.user.findMany()` ko'rinishida qulay yozish uchun — klient faqat birinchi murojaatda yaratiladi
// (build paytida DATABASE_URL talab qilinmasligi uchun).
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = real[prop];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
});
