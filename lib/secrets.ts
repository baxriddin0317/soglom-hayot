import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

// Maxfiy kalitlarni vaqt bo'yicha "sizib chiqmaydigan" usulda solishtirish.
export function safeEqual(received: string | null | undefined, expected: string): boolean {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// CRON_SECRET: `?key=<CRON_SECRET>` yoki `Authorization: Bearer <CRON_SECRET>`.
// Kalit sozlanmagan bo'lsa hech kim o'tolmaydi.
export function hasCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (
    safeEqual(req.nextUrl.searchParams.get('key'), secret) ||
    safeEqual(req.headers.get('authorization'), `Bearer ${secret}`)
  );
}
