import { createHmac, timingSafeEqual } from 'node:crypto';
import type { TelegramProfile } from '@/lib/services/users';

// Mini App so'rovlari `Authorization: tma <initData>` sarlavhasi bilan keladi. initData'ni
// Telegram bot tokeni bilan imzolaydi — imzo to'g'ri bo'lsa, foydalanuvchi aynan o'zi ekaniga
// ishonsa bo'ladi (boshqa odamning retseptini ko'rib yoki o'zgartirib bo'lmaydi).
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

// Ilova ochilgandan keyin shuncha vaqt ichida so'rov kelishi kerak. Ochiq qolgan ilova uchun
// yetarlicha katta, lekin o'g'irlangan eski initData abadiy ishlamasligi uchun cheklangan.
const MAX_AGE_SEC = 24 * 60 * 60;

export function parseAuthHeader(header: string | null): string | null {
  if (!header?.startsWith('tma ')) return null;
  return header.slice(4);
}

export function signInitData(params: URLSearchParams, botToken: string): string {
  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secret).update(dataCheckString).digest('hex');
}

export function validateInitData(initData: string, botToken: string, now = Date.now()): TelegramProfile | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;

  const expected = Buffer.from(signInitData(params, botToken), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || now / 1000 - authDate > MAX_AGE_SEC) return null;

  try {
    const user = JSON.parse(params.get('user') ?? '') as Partial<TelegramProfile>;
    if (typeof user.id !== 'number') return null;
    return {
      id: user.id,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      language_code: user.language_code,
    };
  } catch {
    return null;
  }
}
