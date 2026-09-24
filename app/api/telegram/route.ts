import { NextResponse, type NextRequest } from 'next/server';
import type { Update } from 'telegraf/types';
import { getBot } from '@/lib/bot';
import { safeEqual } from '@/lib/secrets';

// Telegram webhook: har bir yangi xabar / tugma bosilishi (update) shu yerga POST qilinadi.
//
// Webhook'ni o'rnatish uchun deploydan keyin bir marta oching:
//   https://<DOMEN>/api/telegram/setup?key=<CRON_SECRET>

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    // Kalitsiz soxta update bilan boshqa foydalanuvchi nomidan dori belgilash mumkin bo'lardi.
    console.error('TELEGRAM_WEBHOOK_SECRET sozlanmagan — webhook bloklangan.');
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  if (!safeEqual(req.headers.get('x-telegram-bot-api-secret-token'), secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: Update;
  try {
    update = (await req.json()) as Update;
  } catch {
    return NextResponse.json({ ok: true });
  }

  try {
    await getBot().handleUpdate(update);
  } catch (err) {
    // Telegram 200 olmasa update'ni qayta-qayta yuboradi — xatoni faqat logga yozamiz.
    console.error('[telegram webhook] xato:', err);
  }

  return NextResponse.json({ ok: true });
}

// Brauzerdan tekshirish uchun ("tirik"ligini bildiradi).
export async function GET() {
  return NextResponse.json({ ok: true, message: 'Telegram webhook endpoint' });
}
