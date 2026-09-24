import { db } from '@/lib/db';
import type { DoseStatus, User } from '@/lib/generated/prisma/client';
import { addDays, dateIn, safeTimeZone } from '@/lib/time';
import { adherencePercent } from '@/lib/services/prescriptions';

export interface DayStat {
  date: string;
  total: number;
  taken: number;
  skipped: number;
  missed: number;
  pending: number;
}

export interface MedicationStat {
  id: string;
  name: string;
  taken: number;
  resolved: number;
  percent: number | null;
}

export interface UserStats {
  from: string;
  to: string;
  days: DayStat[];
  totals: Omit<DayStat, 'date'>;
  percent: number | null;
  streak: number;
  medications: MedicationStat[];
}

const STREAK_LOOKBACK_DAYS = 120;

function emptyDay(date: string): DayStat {
  return { date, total: 0, taken: 0, skipped: 0, missed: 0, pending: 0 };
}

function addStatus(day: Omit<DayStat, 'date'>, status: DoseStatus, n = 1) {
  day.total += n;
  if (status === 'TAKEN') day.taken += n;
  else if (status === 'SKIPPED') day.skipped += n;
  else if (status === 'MISSED') day.missed += n;
  else day.pending += n;
}

/**
 * Ketma-ket "to'liq" kunlar: shu kundagi barcha dozalar ichilgan. Dozasiz kunlar seriyani
 * uzmaydi. Bugun hali kutilayotgan dozalar bo'lsa — bugun hisobga qo'shilmaydi, lekin seriya uzilmaydi.
 */
export function computeStreak(days: Map<string, Omit<DayStat, 'date'>>, today: string, lookback = STREAK_LOOKBACK_DAYS) {
  let streak = 0;
  for (let i = 0; i < lookback; i++) {
    const date = addDays(today, -i);
    const d = days.get(date);
    if (!d || d.total === 0) continue;
    if (d.skipped > 0 || d.missed > 0) break;
    if (d.pending > 0) continue;
    streak += 1;
  }
  return streak;
}

export async function getUserStats(user: User, periodDays: number, now = new Date()): Promise<UserStats> {
  const tz = safeTimeZone(user.timezone);
  const today = dateIn(tz, now);
  const from = addDays(today, -(periodDays - 1));
  const lookbackFrom = addDays(today, -(Math.max(periodDays, STREAK_LOOKBACK_DAYS) - 1));

  const [byDay, byMed] = await Promise.all([
    db.dose.groupBy({
      by: ['date', 'status'],
      where: { userId: user.id, date: { gte: lookbackFrom, lte: today } },
      _count: { _all: true },
    }),
    db.dose.groupBy({
      by: ['medicationId', 'status'],
      where: { userId: user.id, date: { gte: from, lte: today }, status: { not: 'PENDING' } },
      _count: { _all: true },
    }),
  ]);

  const dayMap = new Map<string, Omit<DayStat, 'date'>>();
  for (const row of byDay) {
    const d = dayMap.get(row.date) ?? emptyDay(row.date);
    addStatus(d, row.status, row._count._all);
    dayMap.set(row.date, d);
  }

  const days: DayStat[] = [];
  const totals = emptyDay('');
  for (let date = from; date <= today; date = addDays(date, 1)) {
    const d = dayMap.get(date);
    const stat = { ...emptyDay(date), ...(d ?? {}), date };
    days.push(stat);
    totals.total += stat.total;
    totals.taken += stat.taken;
    totals.skipped += stat.skipped;
    totals.missed += stat.missed;
    totals.pending += stat.pending;
  }

  const medIds = [...new Set(byMed.map((r) => r.medicationId))];
  const meds = medIds.length
    ? await db.medication.findMany({ where: { id: { in: medIds } }, select: { id: true, name: true } })
    : [];
  const medStats = new Map<string, MedicationStat>();
  for (const m of meds) medStats.set(m.id, { id: m.id, name: m.name, taken: 0, resolved: 0, percent: null });
  for (const row of byMed) {
    const s = medStats.get(row.medicationId);
    if (!s) continue;
    s.resolved += row._count._all;
    if (row.status === 'TAKEN') s.taken += row._count._all;
  }
  const medications = [...medStats.values()]
    .map((s) => ({ ...s, percent: s.resolved ? Math.round((s.taken / s.resolved) * 100) : null }))
    .sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101) || a.name.localeCompare(b.name));

  const { date: _omit, ...totalsOnly } = totals;
  void _omit;
  return {
    from,
    to: today,
    days,
    totals: totalsOnly,
    percent: adherencePercent(totals),
    streak: computeStreak(dayMap, today),
    medications,
  };
}
