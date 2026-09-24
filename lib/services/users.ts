import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import type { User } from '@/lib/generated/prisma/client';
import { FOLLOW_UP_OPTIONS, LEAD_OPTIONS } from '@/lib/constants';
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
}

// Sozlamalarni tekshirib saqlaydi. Vaqt zonasi o'zgarsa kelajakdagi dozalar yangi zona
// bo'yicha qayta hisoblanadi (aks holda eslatmalar eski zona soatida kelardi).
export async function updateSettings(user: User, patch: SettingsPatch): Promise<User> {
  const data: Partial<Pick<User, 'timezone' | 'remindersEnabled' | 'leadMinutes' | 'followUpMinutes'>> = {};

  if (patch.timezone !== undefined) {
    if (typeof patch.timezone !== 'string' || !isValidTimeZone(patch.timezone)) {
      throw new AppError("Vaqt zonasi noto'g'ri. Masalan: Asia/Tashkent");
    }
    data.timezone = patch.timezone;
  }
  if (patch.remindersEnabled !== undefined) {
    if (typeof patch.remindersEnabled !== 'boolean') throw new AppError("Noto'g'ri qiymat");
    data.remindersEnabled = patch.remindersEnabled;
  }
  if (patch.leadMinutes !== undefined) {
    if (!(LEAD_OPTIONS as readonly unknown[]).includes(patch.leadMinutes)) throw new AppError("Noto'g'ri qiymat");
    data.leadMinutes = patch.leadMinutes as number;
  }
  if (patch.followUpMinutes !== undefined) {
    if (!(FOLLOW_UP_OPTIONS as readonly unknown[]).includes(patch.followUpMinutes)) {
      throw new AppError("Noto'g'ri qiymat");
    }
    data.followUpMinutes = patch.followUpMinutes as number;
  }

  const updated = await db.user.update({ where: { id: user.id }, data });
  if (data.timezone && data.timezone !== user.timezone) {
    await rescheduleUserDoses(updated);
  }
  return updated;
}

export function displayName(user: Pick<User, 'firstName' | 'username'>): string {
  return user.firstName || user.username || "do'stim";
}
