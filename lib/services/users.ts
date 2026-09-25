import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import type { User } from '@/lib/generated/prisma/client';
import { FOLLOW_UP_OPTIONS, LEAD_OPTIONS } from '@/lib/constants';
import { isLang, t, type Lang } from '@/lib/i18n';
import { isValidTimeZone } from '@/lib/time';
import { rescheduleUserDoses } from '@/lib/services/prescriptions';

export interface TelegramProfile {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

// Telegram foydalanuvchisini bazada topadi yoki yaratadi. Ism/username o'zgargan bo'lsa yangilanadi.
// Foydalanuvchi botga yozgan bo'lsa demak bloklamagan — blockedAt tozalanadi.
export async function upsertUser(profile: TelegramProfile): Promise<User> {
  const data = {
    firstName: (profile.first_name ?? '').slice(0, 64),
    lastName: profile.last_name?.slice(0, 64) ?? null,
    username: profile.username?.slice(0, 64) ?? null,
    languageCode: profile.language_code?.slice(0, 8) ?? null,
    lastActiveAt: new Date(),
    blockedAt: null,
  };
  return db.user.upsert({
    where: { telegramId: BigInt(profile.id) },
    create: { telegramId: BigInt(profile.id), ...data },
    update: data,
  });
}

export async function setBlocked(telegramId: number, blocked: boolean): Promise<void> {
  await db.user.updateMany({
    where: { telegramId: BigInt(telegramId) },
    data: { blockedAt: blocked ? new Date() : null },
  });
}

export interface SettingsPatch {
  timezone?: unknown;
  remindersEnabled?: unknown;
  leadMinutes?: unknown;
  followUpMinutes?: unknown;
  language?: unknown;
}

// Sozlamalarni tekshirib saqlaydi. Vaqt zonasi o'zgarsa kelajakdagi dozalar yangi zona
// bo'yicha qayta hisoblanadi (aks holda eslatmalar eski zona soatida kelardi).
export async function updateSettings(user: User, patch: SettingsPatch): Promise<User> {
  const data: Partial<Pick<User, 'timezone' | 'remindersEnabled' | 'leadMinutes' | 'followUpMinutes' | 'language'>> = {};

  if (patch.timezone !== undefined) {
    if (typeof patch.timezone !== 'string' || !isValidTimeZone(patch.timezone)) {
      throw new AppError('err.tz');
    }
    data.timezone = patch.timezone;
  }
  if (patch.remindersEnabled !== undefined) {
    if (typeof patch.remindersEnabled !== 'boolean') throw new AppError('err.value');
    data.remindersEnabled = patch.remindersEnabled;
  }
  if (patch.leadMinutes !== undefined) {
    if (!(LEAD_OPTIONS as readonly unknown[]).includes(patch.leadMinutes)) throw new AppError('err.value');
    data.leadMinutes = patch.leadMinutes as number;
  }
  if (patch.followUpMinutes !== undefined) {
    if (!(FOLLOW_UP_OPTIONS as readonly unknown[]).includes(patch.followUpMinutes)) {
      throw new AppError('err.value');
    }
    data.followUpMinutes = patch.followUpMinutes as number;
  }
  if (patch.language !== undefined) {
    if (!isLang(patch.language)) throw new AppError('err.lang');
    data.language = patch.language;
  }

  const updated = await db.user.update({ where: { id: user.id }, data });
  if (data.timezone && data.timezone !== user.timezone) {
    await rescheduleUserDoses(updated);
  }
  return updated;
}

export function displayName(user: Pick<User, 'firstName' | 'username'>, lang: Lang = 'uz'): string {
  return user.firstName || user.username || t(lang, 'name.friend');
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

// ADMIN_TELEGRAM_IDS="123456789,987654321" — adminlarning Telegram ID'lari (vergul bilan).
export function adminIds(): bigint[] {
  return (process.env.ADMIN_TELEGRAM_IDS ?? '')
    .split(/[\s,;]+/)
    .filter((s) => /^\d+$/.test(s))
    .map((s) => BigInt(s));
}

/** Adminlik huquqi (faqat ADMIN_TELEGRAM_IDS bo'yicha — bazadagi maydonga ishonilmaydi). */
export function isAdmin(user: Pick<User, 'telegramId'>): boolean {
  return adminIds().includes(user.telegramId);
}

/** Admin menyusi ko'rinadimi: admin va admin rejimi yoqilgan. */
export function inAdminMode(user: Pick<User, 'telegramId' | 'adminMode'>): boolean {
  return user.adminMode && isAdmin(user);
}

export async function setAdminMode(user: User, on: boolean): Promise<User> {
  if (!isAdmin(user)) throw new AppError('err.notAdmin', {}, 'forbidden');
  return db.user.update({ where: { id: user.id }, data: { adminMode: on } });
}
