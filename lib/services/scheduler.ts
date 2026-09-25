import type { Telegram } from 'telegraf';
import { db } from '@/lib/db';
import { mapLimit } from '@/lib/concurrency';
import { isMessageNotModified, isUserUnreachable, withRateLimitRetry, esc } from '@/lib/bot/telegram';
import { lowStockView, reminderView } from '@/lib/bot/views';
import { mainKeyboard } from '@/lib/bot/keyboards';
import { getReminderGroup, MISS_AFTER_MS } from '@/lib/services/doses';
import { adherencePercent, countDosesByMedication, sumCounts } from '@/lib/services/prescriptions';
import { claimLowStockAlerts, releaseLowStockAlert } from '@/lib/services/stock';
import { inAdminMode } from '@/lib/services/users';
import { dateIn, daysInclusive, formatDate, safeTimeZone } from '@/lib/time';
import { LEAD_OPTIONS } from '@/lib/constants';
import { langOf, t, type Lang } from '@/lib/i18n';

// Tashqi cron (cron-job.org) /api/cron/tick ni har daqiqada chaqiradi. Har chaqiruvda:
//   1) vaqti kelgan dozalar uchun eslatma;
//   2) javob berilmagan eslatmalar uchun bitta qayta eslatma;
//   3) 3 soat o'tib ham belgilanmagan dozalar — "belgilanmadi";
//   4) muddati tugagan retseptlar — yakunlanadi va foydalanuvchiga natija yuboriladi;
//   5) zaxirasi tugayotgan dorilar — ogohlantirish (kunduzi, kuniga ko'pi bilan bir marta).
//
// Cron ikki marta (yoki bir vaqtda) ishlasa ham har xabar bir marta ketadi: har bir doza avval
// bazada atomar "band qilinadi" (remindedAt / followUpAt), keyin xabar yuboriladi.

// Cron to'xtab qolgan bo'lsa juda eski eslatmalarni yubormaymiz — ular "belgilanmadi" bo'ladi.
const STALE_REMINDER_MS = 2 * 60 * 60_000;
const MAX_LEAD_MS = Math.max(...LEAD_OPTIONS) * 60_000;
const BATCH = 400;
const CONCURRENCY = 8;
// Route'ning maxDuration'i 60 soniya (app/api/cron/tick) — ishni shu vaqtdan oldin yakunlaymiz.
const TIME_BUDGET_MS = 45_000;

interface GroupKey {
  userId: string;
  scheduledAt: Date;
  telegramId: bigint;
  timezone: string;
  lang: Lang;
}

function groupBy<T extends { userId: string; scheduledAt: Date }>(rows: T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.userId}|${row.scheduledAt.toISOString()}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()];
}

async function markUnreachable(userId: string) {
  await db.user.update({ where: { id: userId }, data: { blockedAt: new Date() } }).catch(() => {});
}

// ---------------------------------------------------------------------------
// 1) Eslatmalar
// ---------------------------------------------------------------------------

export async function sendDueReminders(telegram: Telegram, now: Date, deadline: number) {
  const candidates = await db.dose.findMany({
    where: {
      status: 'PENDING',
      remindedAt: null,
      scheduledAt: { lte: new Date(now.getTime() + MAX_LEAD_MS), gte: new Date(now.getTime() - STALE_REMINDER_MS) },
      user: { remindersEnabled: true, blockedAt: null },
    },
    select: {
      id: true,
      userId: true,
      scheduledAt: true,
      user: { select: { telegramId: true, timezone: true, leadMinutes: true, language: true, languageCode: true } },
    },
    orderBy: { scheduledAt: 'asc' },
    take: BATCH,
  });

  const due = candidates.filter((d) => d.scheduledAt.getTime() - d.user.leadMinutes * 60_000 <= now.getTime());
  let sent = 0;

  await mapLimit(groupBy(due), CONCURRENCY, async (group) => {
    if (Date.now() > deadline) return;
    const { userId, scheduledAt, user } = group[0];
    const claimed = await db.dose.updateManyAndReturn({
      where: { id: { in: group.map((d) => d.id) }, remindedAt: null, status: 'PENDING' },
      data: { remindedAt: now },
      select: { id: true },
    });
    if (claimed.length === 0) return;
    const claimedIds = claimed.map((c) => c.id);

    const key = { userId, scheduledAt, telegramId: user.telegramId, timezone: user.timezone, lang: langOf(user) };
    const ok = await deliverGroup(telegram, key, now, false);
    if (ok === 'sent') sent += 1;
    else if (ok === 'retry') {
      // Vaqtinchalik xato — keyingi cron chaqiruvida qayta urinamiz.
      await db.dose.updateMany({ where: { id: { in: claimedIds } }, data: { remindedAt: null } });
    }
  });
  return sent;
}

// Guruh (bir foydalanuvchining bir vaqtdagi dozalari) uchun xabar yuboradi va messageId'ni saqlaydi.
async function deliverGroup(
  telegram: Telegram,
  key: GroupKey,
  now: Date,
  followUp: boolean
): Promise<'sent' | 'retry' | 'unreachable' | 'empty'> {
  const doses = await getReminderGroup(key.userId, key.scheduledAt);
  if (!doses.some((d) => d.status === 'PENDING')) return 'empty';
  const { text, extra } = reminderView(doses, { now, timezone: safeTimeZone(key.timezone), lang: key.lang, followUp });

  try {
    const msg = await withRateLimitRetry(() => telegram.sendMessage(Number(key.telegramId), text, extra));
    const oldMessageIds = [...new Set(doses.map((d) => d.messageId).filter((id): id is number => id !== null))];
    await db.dose.updateMany({
      where: { userId: key.userId, scheduledAt: key.scheduledAt },
      data: { messageId: msg.message_id },
    });
    // Qayta eslatmada eski xabarni o'chiramiz — chatda bitta faol tugmali xabar qoladi.
    for (const id of oldMessageIds) {
      if (id !== msg.message_id) await telegram.deleteMessage(Number(key.telegramId), id).catch(() => {});
    }
    return 'sent';
  } catch (err) {
    if (isUserUnreachable(err)) {
      await markUnreachable(key.userId);
      return 'unreachable';
    }
    console.error('[scheduler] eslatma yuborilmadi:', err);
    return 'retry';
  }
}

// ---------------------------------------------------------------------------
// 2) Qayta eslatish
// ---------------------------------------------------------------------------

export async function sendFollowUps(telegram: Telegram, now: Date, deadline: number) {
  const candidates = await db.dose.findMany({
    where: {
      status: 'PENDING',
      remindedAt: { not: null },
      followUpAt: null,
      scheduledAt: { lte: new Date(now.getTime() - 10 * 60_000), gt: new Date(now.getTime() - MISS_AFTER_MS) },
      user: { remindersEnabled: true, blockedAt: null, followUpMinutes: { gt: 0 } },
    },
    select: {
      id: true,
      userId: true,
      scheduledAt: true,
      remindedAt: true,
      user: { select: { telegramId: true, timezone: true, followUpMinutes: true, language: true, languageCode: true } },
    },
    orderBy: { scheduledAt: 'asc' },
    take: BATCH,
  });

  const due = candidates.filter((d) => {
    const base = Math.max(d.scheduledAt.getTime(), d.remindedAt?.getTime() ?? 0);
    return base + d.user.followUpMinutes * 60_000 <= now.getTime();
  });
  let sent = 0;

  await mapLimit(groupBy(due), CONCURRENCY, async (group) => {
    if (Date.now() > deadline) return;
    const { userId, scheduledAt, user } = group[0];
    const claimed = await db.dose.updateManyAndReturn({
      where: { id: { in: group.map((d) => d.id) }, followUpAt: null, status: 'PENDING' },
      data: { followUpAt: now },
      select: { id: true },
    });
    if (claimed.length === 0) return;
    const key = { userId, scheduledAt, telegramId: user.telegramId, timezone: user.timezone, lang: langOf(user) };
    const result = await deliverGroup(telegram, key, now, true);
    if (result === 'sent') sent += 1;
    else if (result === 'retry') {
      await db.dose.updateMany({ where: { id: { in: claimed.map((c) => c.id) } }, data: { followUpAt: null } });
    }
  });
  return sent;
}

// ---------------------------------------------------------------------------
// 3) Belgilanmagan dozalar
// ---------------------------------------------------------------------------

export async function markMissedDoses(telegram: Telegram, now: Date, deadline: number) {
  const stale = await db.dose.findMany({
    where: { status: 'PENDING', scheduledAt: { lte: new Date(now.getTime() - MISS_AFTER_MS) } },
    select: {
      id: true,
      userId: true,
      scheduledAt: true,
      messageId: true,
      user: { select: { telegramId: true, timezone: true, blockedAt: true, language: true, languageCode: true } },
    },
    take: 1000,
  });
  if (stale.length === 0) return 0;

  const res = await db.dose.updateMany({
    where: { id: { in: stale.map((d) => d.id) }, status: 'PENDING' },
    data: { status: 'MISSED' },
  });

  // Eslatma xabarini yangilaymiz: "belgilanmadi" + "Ichgan edim" tugmasi (kechikib belgilash uchun).
  const withMessage = groupBy(stale.filter((d) => d.messageId !== null && !d.user.blockedAt)).slice(0, 60);
  await mapLimit(withMessage, CONCURRENCY, async (group) => {
    if (Date.now() > deadline) return;
    const { userId, scheduledAt, messageId, user } = group[0];
    const doses = await getReminderGroup(userId, scheduledAt);
    if (doses.length === 0 || messageId === null) return;
    const { text, extra } = reminderView(doses, { now, timezone: safeTimeZone(user.timezone), lang: langOf(user) });
    await telegram.editMessageText(Number(user.telegramId), messageId, undefined, text, extra).catch((err) => {
      if (!isMessageNotModified(err) && !isUserUnreachable(err)) console.error('[scheduler] xabar yangilanmadi:', err);
    });
  });
  return res.count;
}

// ---------------------------------------------------------------------------
// 4) Kurs yakuni
// ---------------------------------------------------------------------------

export async function completeFinishedCourses(telegram: Telegram, now: Date, deadline: number) {
  // Eng "oldinda" yuradigan zona (UTC+14) bo'yicha bugun — undan oldin tugaganlarni tekshiramiz,
  // keyin har birini foydalanuvchining o'z zonasi bo'yicha aniqlaymiz.
  const latestToday = dateIn('Pacific/Kiritimati', now);
  const candidates = await db.prescription.findMany({
    where: { status: 'ACTIVE', endDate: { lt: latestToday } },
    include: { user: true, medications: { select: { id: true, name: true, asNeeded: true } } },
    take: 100,
  });

  let completed = 0;
  for (const p of candidates) {
    if (Date.now() > deadline) break;
    const tz = safeTimeZone(p.user.timezone);
    if (p.endDate >= dateIn(tz, now)) continue;

    const claim = await db.prescription.updateMany({
      where: { id: p.id, status: 'ACTIVE' },
      data: { status: 'COMPLETED', completedAt: now },
    });
    if (claim.count === 0) continue;
    await db.medication.updateMany({ where: { prescriptionId: p.id }, data: { isActive: false } });
    completed += 1;

    if (p.user.blockedAt) continue;
    const lang = langOf(p.user);
    const scheduled = p.medications.filter((m) => !m.asNeeded).map((m) => m.id);
    const counts = sumCounts((await countDosesByMedication(scheduled, now)).values());
    const pct = adherencePercent(counts);
    const lines = [
      t(lang, 'done.title', { title: esc(p.title) }),
      '',
      t(lang, 'done.range', {
        days: t(lang, 'common.days', { n: daysInclusive(p.startDate, p.endDate) }),
        from: formatDate(p.startDate),
        to: formatDate(p.endDate),
      }),
      t(lang, 'done.meds', { list: p.medications.map((m) => esc(m.name)).join(', ') }),
    ];
    if (pct !== null) lines.push(t(lang, 'done.taken', { n: counts.taken, pct }));
    lines.push(
      '',
      t(lang, pct !== null && pct >= 90 ? 'done.great' : 'done.seeDoctor'),
      t(lang, 'done.footer', { add: t(lang, 'menu.add') })
    );
    const keyboard = mainKeyboard(lang, { admin: inAdminMode(p.user) });
    await withRateLimitRetry(() =>
      telegram.sendMessage(Number(p.user.telegramId), lines.join('\n'), { parse_mode: 'HTML', ...keyboard })
    ).catch(async (err) => {
      if (isUserUnreachable(err)) await markUnreachable(p.userId);
      else console.error('[scheduler] kurs yakuni xabari yuborilmadi:', err);
    });
  }
  return completed;
}

/**
 * Doza botdan tashqarida (Mini App yoki "Bugungi dorilar") belgilanganda eslatma xabarini ham
 * yangilaymiz — aks holda unda eskirgan "Ichdim" tugmalari qolib ketadi.
 */
export async function refreshReminderMessage(
  telegram: Telegram,
  user: { id: string; telegramId: bigint; timezone: string; language: string | null; languageCode: string | null },
  dose: { scheduledAt: Date; messageId: number | null }
) {
  if (dose.messageId === null) return;
  const doses = await getReminderGroup(user.id, dose.scheduledAt);
  if (doses.length === 0) return;
  const { text, extra } = reminderView(doses, {
    now: new Date(),
    timezone: safeTimeZone(user.timezone),
    lang: langOf(user),
  });
  await telegram.editMessageText(Number(user.telegramId), dose.messageId, undefined, text, extra).catch(() => {});
}

// ---------------------------------------------------------------------------
// 5) Zaxira tugayotgani haqida ogohlantirish
// ---------------------------------------------------------------------------

export async function sendLowStockAlerts(telegram: Telegram, now: Date, deadline: number) {
  if (Date.now() > deadline) return 0;
  const alerts = await claimLowStockAlerts(now);
  let sent = 0;
  await mapLimit(alerts, CONCURRENCY, async ({ user, medication, forecast }) => {
    if (Date.now() > deadline) {
      await releaseLowStockAlert(medication.id);
      return;
    }
    const { text, extra } = lowStockView(medication, forecast, langOf(user));
    try {
      await withRateLimitRetry(() => telegram.sendMessage(Number(user.telegramId), text, extra));
      sent += 1;
    } catch (err) {
      if (isUserUnreachable(err)) {
        await markUnreachable(user.id);
      } else {
        console.error('[scheduler] zaxira ogohlantirishi yuborilmadi:', err);
        await releaseLowStockAlert(medication.id);
      }
    }
  });
  return sent;
}

export async function runScheduledJobs(telegram: Telegram, now = new Date()) {
  const deadline = Date.now() + TIME_BUDGET_MS;
  const reminders = await sendDueReminders(telegram, now, deadline);
  const followUps = await sendFollowUps(telegram, now, deadline);
  const missed = await markMissedDoses(telegram, now, deadline);
  const completed = await completeFinishedCourses(telegram, now, deadline);
  const lowStock = await sendLowStockAlerts(telegram, now, deadline);
  return { reminders, followUps, missed, completed, lowStock };
}
