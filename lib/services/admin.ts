import type { Telegram } from 'telegraf';
import { db } from '@/lib/db';
import type { Prisma } from '@/lib/generated/prisma/client';
import { adherencePercent } from '@/lib/services/prescriptions';
import { cronLagMs, getCronState, isCronStale } from '@/lib/services/system';
import { addDays, dateIn, safeTimeZone, zonedToUtc } from '@/lib/time';

// Admin panel uchun statistika. Tibbiy tafsilotlar (dori nomlari) ko'rsatilmaydi — faqat sonlar.

const DAY_MS = 86_400_000;

export interface AdminOverview {
  today: string;
  users: {
    total: number;
    blocked: number;
    newToday: number;
    new7: number;
    new30: number;
    activeToday: number;
    active7: number;
    active30: number;
    withActiveRx: number;
  };
  activePrescriptions: number;
  remindersToday: number;
  adherence7: number | null;
  // 7–14 kun oldin qo'shilganlardan oxirgi 7 kunda qaytganlar ulushi (%).
  retentionD7: number | null;
  languages: { language: string | null; count: number }[];
  newByDay: { date: string; count: number }[];
  cron: {
    lastRunAt: string | null;
    lagMs: number | null;
    stale: boolean;
    durationMs: number | null;
    result: Record<string, number> | null;
    lastError: string | null;
    lastErrorAt: string | null;
  };
  webhook: { pending: number; lastError: string | null } | null;
}

export async function getAdminOverview(timezone: string, telegram: Telegram | null, now = new Date()): Promise<AdminOverview> {
  const tz = safeTimeZone(timezone);
  const today = dateIn(tz, now);
  const startToday = zonedToUtc(today, '00:00', tz);
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const chartFrom = addDays(today, -13);

  const [
    total,
    blocked,
    newToday,
    new7,
    new30,
    activeToday,
    active7,
    active30,
    rxUsers,
    activePrescriptions,
    remindersToday,
    adherenceRows,
    cohort,
    cohortBack,
    languages,
    recentUsers,
    cronState,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { blockedAt: { not: null } } }),
    db.user.count({ where: { createdAt: { gte: startToday } } }),
    db.user.count({ where: { createdAt: { gte: ago(7) } } }),
    db.user.count({ where: { createdAt: { gte: ago(30) } } }),
    db.user.count({ where: { lastActiveAt: { gte: startToday } } }),
    db.user.count({ where: { lastActiveAt: { gte: ago(7) } } }),
    db.user.count({ where: { lastActiveAt: { gte: ago(30) } } }),
    db.prescription.groupBy({ by: ['userId'], where: { status: 'ACTIVE' } }),
    db.prescription.count({ where: { status: 'ACTIVE' } }),
    db.dose.count({ where: { remindedAt: { gte: startToday }, medication: { asNeeded: false } } }),
    db.dose.groupBy({
      by: ['status'],
      where: { date: { gte: addDays(today, -6), lte: today }, status: { not: 'PENDING' }, medication: { asNeeded: false } },
      _count: { _all: true },
    }),
    db.user.count({ where: { createdAt: { gte: ago(14), lt: ago(7) } } }),
    db.user.count({ where: { createdAt: { gte: ago(14), lt: ago(7) }, lastActiveAt: { gte: ago(7) } } }),
    db.user.groupBy({ by: ['language'], _count: { _all: true } }),
    db.user.findMany({ where: { createdAt: { gte: zonedToUtc(chartFrom, '00:00', tz) } }, select: { createdAt: true } }),
    getCronState(),
  ]);

  const counts = { taken: 0, skipped: 0, missed: 0 };
  for (const row of adherenceRows) {
    if (row.status === 'TAKEN') counts.taken += row._count._all;
    else if (row.status === 'SKIPPED') counts.skipped += row._count._all;
    else if (row.status === 'MISSED') counts.missed += row._count._all;
  }

  const perDay = new Map<string, number>();
  for (const u of recentUsers) {
    const d = dateIn(tz, u.createdAt);
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
  }
  const newByDay = Array.from({ length: 14 }, (_, i) => {
    const date = addDays(chartFrom, i);
    return { date, count: perDay.get(date) ?? 0 };
  });

  let webhook: AdminOverview['webhook'] = null;
  if (telegram) {
    try {
      const info = await telegram.getWebhookInfo();
      if (info && typeof info === 'object') {
        webhook = { pending: info.pending_update_count ?? 0, lastError: info.last_error_message ?? null };
      }
    } catch {
      // Telegram javob bermadi — panel baribir ochiladi.
    }
  }

  return {
    today,
    users: {
      total,
      blocked,
      newToday,
      new7,
      new30,
      activeToday,
      active7,
      active30,
      withActiveRx: rxUsers.length,
    },
    activePrescriptions,
    remindersToday,
    adherence7: adherencePercent(counts),
    retentionD7: cohort > 0 ? Math.round((cohortBack / cohort) * 100) : null,
    languages: languages
      .map((l) => ({ language: l.language, count: l._count._all }))
      .sort((a, b) => b.count - a.count),
    newByDay,
    cron: {
      lastRunAt: cronState?.at ?? null,
      lagMs: cronLagMs(cronState, now),
      stale: isCronStale(cronState, now),
      durationMs: cronState?.durationMs ?? null,
      result: cronState?.result ?? null,
      lastError: cronState?.error ?? null,
      lastErrorAt: cronState?.errorAt ?? null,
    },
    webhook,
  };
}

export interface AdminUserRow {
  id: string;
  telegramId: string;
  name: string;
  username: string | null;
  language: string | null;
  createdAt: string;
  lastActiveAt: string;
  blocked: boolean;
  activePrescriptions: number;
}

export const ADMIN_PAGE_SIZE = 30;

/** Foydalanuvchilar ro'yxati: qidiruv (ism, username, Telegram ID), oxirgi faollik bo'yicha. */
export async function listAdminUsers(query: string, page: number): Promise<{ users: AdminUserRow[]; hasMore: boolean }> {
  const q = query.trim().replace(/^@/, '').slice(0, 64);
  const where: Prisma.UserWhereInput = q
    ? {
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { username: { contains: q, mode: 'insensitive' } },
          ...(/^\d{3,20}$/.test(q) ? [{ telegramId: BigInt(q) }] : []),
        ],
      }
    : {};
  const safePage = Math.max(0, Math.min(1000, Math.floor(page) || 0));
  const rows = await db.user.findMany({
    where,
    orderBy: { lastActiveAt: 'desc' },
    skip: safePage * ADMIN_PAGE_SIZE,
    take: ADMIN_PAGE_SIZE + 1,
    include: { _count: { select: { prescriptions: { where: { status: 'ACTIVE' } } } } },
  });
  return {
    hasMore: rows.length > ADMIN_PAGE_SIZE,
    users: rows.slice(0, ADMIN_PAGE_SIZE).map((u) => ({
      id: u.id,
      telegramId: String(u.telegramId),
      name: [u.firstName, u.lastName].filter(Boolean).join(' ') || '—',
      username: u.username,
      language: u.language,
      createdAt: u.createdAt.toISOString(),
      lastActiveAt: u.lastActiveAt.toISOString(),
      blocked: u.blockedAt !== null,
      activePrescriptions: u._count.prescriptions,
    })),
  };
}
