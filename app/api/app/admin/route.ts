import type { NextRequest } from 'next/server';
import { readJson, withWebAppUser } from '@/lib/webapp/handler';
import { getAdmin, setAdminModeFromApp } from '@/lib/webapp/service';

export const dynamic = 'force-dynamic';

// Faqat ADMIN_TELEGRAM_IDS dagi foydalanuvchilar uchun (aks holda 403).
//   GET ?view=overview            — statistika va tizim holati
//   GET ?view=users&q=&page=      — foydalanuvchilar ro'yxati
//   POST { adminMode: boolean }   — admin / foydalanuvchi rejimi
export function GET(req: NextRequest) {
  return withWebAppUser(req, (user) => getAdmin(user, req.nextUrl.searchParams));
}

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  return withWebAppUser(req, (user) => setAdminModeFromApp(user, body));
}
