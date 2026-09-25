import type { Telegram } from 'telegraf';
import { db } from '@/lib/db';
import { Prisma } from '@/lib/generated/prisma/client';
import { langOf, t, type Lang } from '@/lib/i18n';
import { withRateLimitRetry } from '@/lib/bot/telegram';
import { adminIds } from '@/lib/services/users';

// Tizim monitoringi. Eslatmalar tashqi cron (cron-job.org) ga bog'liq — u to'xtasa, bot "jim"
// qoladi va buni hech kim sezmaydi. Shuning uchun:
//   1) har cron chaqiruvi oxirgi ishlagan vaqtini (heartbeat) bazaga yozadi;
//   2) heartbeat eskirsa — adminlarga Telegram'da ogohlantirish (soatiga ko'pi bilan bir marta),
//      cron qayta ishlasa — "tiklandi" xabari;
//   3) /api/health — tashqi monitoring (UptimeRobot va h.k.) uchun: cron eskirsa 503.
// Tekshiruvni foydalanuvchi xabarlari (webhook) ham ishga tushiradi — cron o'zi to'xtaganda ham.

export const CRON_STALE_MS = 5 * 60_000;
const ALERT_REPEAT_MS = 60 * 60_000;
const ERROR_ALERT_REPEAT_MS = 60 * 60_000;

export interface CronState {
  at: string; // oxirgi muvaffaqiyatli yoki xatoli ishga tushish (ISO)
  durationMs: number;
  result: Record<string, number> | null;
  error: string | null;
  errorAt: string | null;
}

interface AlertState {
  active: boolean;
  sentAt: string | null;
  errorSentAt: string | null;
}

async function readState<T>(key: string): Promise<T | null> {
  const row = await db.systemState.findUnique({ where: { key } });
  return (row?.value as T | undefined) ?? null;
}

async function writeState(key: string, value: object): Promise<void> {
  const json = value as Prisma.InputJsonValue;
  await db.systemState.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
}

export async function getCronState(): Promise<CronState | null> {
  return readState<CronState>('cron');
}

/** Cron qancha vaqtdan beri ishlamayapti (ms). Hech ishlamagan bo'lsa — null. */
export function cronLagMs(state: CronState | null, now = new Date()): number | null {
  return state ? now.getTime() - new Date(state.at).getTime() : null;
}

export function isCronStale(state: CronState | null, now = new Date()): boolean {
  const lag = cronLagMs(state, now);
  return lag === null || lag > CRON_STALE_MS;
}

/** "12 daqiqa" / "3 soat" / "2 kun" — foydalanuvchi tilida. */
export function agoText(ms: number, lang: Lang): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return t(lang, 'common.minutes', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t(lang, 'common.hours', { n: hours });
  return t(lang, 'common.days', { n: Math.round(hours / 24) });
}

// ---------------------------------------------------------------------------
// Adminlarga xabar
// ---------------------------------------------------------------------------

/** Barcha adminlarga, har biriga o'z tilida. Admin hali botga yozmagan bo'lsa — o'zbekcha. */
export async function notifyAdmins(telegram: Telegram, text: (lang: Lang) => string): Promise<number> {
  const ids = adminIds();
  if (ids.length === 0) return 0;
  const users = await db.user.findMany({ where: { telegramId: { in: ids } } });
  let sent = 0;
  for (const id of ids) {
    const user = users.find((u) => u.telegramId === id);
    const lang = user ? langOf(user) : 'uz';
    try {
      await withRateLimitRetry(() => telegram.sendMessage(Number(id), text(lang), { parse_mode: 'HTML' }));
      sent += 1;
    } catch (err) {
      console.error('[system] adminga xabar yuborilmadi:', err);
    }
  }
  return sent;
}

// ---------------------------------------------------------------------------
// Cron heartbeat
// ---------------------------------------------------------------------------

/** Cron chaqiruvi natijasini yozadi. Oldin "to'xtadi" ogohlantirishi ketgan bo'lsa — "tiklandi". */
export async function recordCronRun(
  telegram: Telegram,
  run: { startedAt: Date; result?: Record<string, number>; error?: unknown }
): Promise<void> {
  const now = new Date();
  const previous = await getCronState();
  const errorText = run.error ? String(run.error instanceof Error ? run.error.message : run.error).slice(0, 300) : null;
  await writeState('cron', {
    at: now.toISOString(),
    durationMs: now.getTime() - run.startedAt.getTime(),
    result: run.result ?? previous?.result ?? null,
    // Oxirgi xato (vaqti bilan) keyingi muvaffaqiyatli ishlashlarda ham admin panelda ko'rinib turadi.
    error: errorText ?? previous?.error ?? null,
    errorAt: errorText ? now.toISOString() : (previous?.errorAt ?? null),
  } satisfies CronState);

  const alert = (await readState<AlertState>('cron_alert')) ?? { active: false, sentAt: null, errorSentAt: null };
  let changed = false;

  if (alert.active) {
    await notifyAdmins(telegram, (lang) => t(lang, 'admin.cronRecovered'));
    alert.active = false;
    changed = true;
  }
  if (errorText) {
    const last = alert.errorSentAt ? new Date(alert.errorSentAt).getTime() : 0;
    if (now.getTime() - last > ERROR_ALERT_REPEAT_MS) {
      const safe = errorText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      await notifyAdmins(telegram, (lang) => t(lang, 'admin.cronFailed', { error: safe }));
      alert.errorSentAt = now.toISOString();
      changed = true;
    }
  }
  if (changed) await writeState('cron_alert', alert);
}

// Bir server instance'i bazani har so'rovda tekshirmasligi uchun.
let lastWatchdogCheck = 0;
const WATCHDOG_EVERY_MS = 5 * 60_000;

/**
 * Cron to'xtaganini tekshiradi (webhook va /api/health chaqiradi). Eskirgan bo'lsa — adminlarga
 * ogohlantirish (soatiga ko'pi bilan bir marta). `force` — instance throttlingsiz.
 */
export async function cronWatchdog(telegram: Telegram, { force = false } = {}): Promise<void> {
  const nowMs = Date.now();
  if (!force && nowMs - lastWatchdogCheck < WATCHDOG_EVERY_MS) return;
  lastWatchdogCheck = nowMs;
  if (adminIds().length === 0) return;

  const state = await getCronState();
  // Hali birinchi marta ham ishlamagan (yangi o'rnatish) — ogohlantirmaymiz, admin panelda ko'rinadi.
  if (!state || !isCronStale(state)) return;

  const alert = (await readState<AlertState>('cron_alert')) ?? { active: false, sentAt: null, errorSentAt: null };
  const last = alert.sentAt ? new Date(alert.sentAt).getTime() : 0;
  if (alert.active && nowMs - last < ALERT_REPEAT_MS) return;

  const lag = cronLagMs(state) ?? 0;
  await notifyAdmins(telegram, (lang) => t(lang, 'admin.cronAlert', { ago: agoText(lag, lang) }));
  await writeState('cron_alert', { ...alert, active: true, sentAt: new Date().toISOString() });
}
