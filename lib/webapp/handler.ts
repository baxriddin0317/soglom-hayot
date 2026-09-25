import { NextResponse, type NextRequest } from 'next/server';
import { AppError } from '@/lib/errors';
import type { User } from '@/lib/generated/prisma/client';
import { detectLang, langOf, t, type Lang } from '@/lib/i18n';
import { upsertUser } from '@/lib/services/users';
import { parseAuthHeader, validateInitData } from '@/lib/webapp/auth';

const STATUS: Record<AppError['code'], number> = { not_found: 404, invalid: 400, forbidden: 403, conflict: 409 };

// Mini App API route'lari uchun umumiy o'rama: initData imzosini tekshiradi, foydalanuvchini
// bazadan oladi (bo'lmasa yaratadi) va xatolarni bir xil JSON ko'rinishiga keltiradi.
export async function withWebAppUser(
  req: NextRequest,
  handler: (user: User) => Promise<unknown>
): Promise<NextResponse> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN sozlanmagan — Mini App API bloklangan.');
    return NextResponse.json({ error: t('uz', 'err.notConfigured') }, { status: 500 });
  }

  const initData = parseAuthHeader(req.headers.get('authorization'));
  const profile = initData ? validateInitData(initData, token) : null;
  if (!profile) {
    return NextResponse.json(
      { error: t('uz', 'err.unauthorized'), code: 'unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  let lang: Lang = detectLang(profile.language_code);
  try {
    const user = await upsertUser(profile);
    lang = langOf(user);
    const data = await handler(user);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json({ error: err.text(lang), code: err.code }, { status: STATUS[err.code] });
    }
    console.error('[mini app api] xato:', err);
    return NextResponse.json({ error: t(lang, 'err.server') }, { status: 500 });
  }
}

export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
