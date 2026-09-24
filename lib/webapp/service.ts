import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import type { Medication, Prescription, User } from '@/lib/generated/prisma/client';
import { LIMITS, type Meal } from '@/lib/constants';
import { runAfterResponse } from '@/lib/concurrency';
import { getBot } from '@/lib/bot';
import { esc } from '@/lib/bot/telegram';
import { refreshReminderMessage } from '@/lib/services/scheduler';
import {
  getDayDoses,
  getNextDose,
  markDose,
  type DoseAction,
  type DoseWithMedication,
} from '@/lib/services/doses';
import {
  adherencePercent,
  countDosesByMedication,
  countDosesByPrescription,
  courseProgress,
  createPrescription,
  deletePrescription,
  emptyCounts,
  finishPrescription,
  getPrescription,
  listPrescriptions,
  setPrescriptionDays,
  stopMedication,
  sumCounts,
  updateMedicationTimes,
  validatePrescription,
  type DoseCounts,
} from '@/lib/services/prescriptions';
import { getUserStats } from '@/lib/services/stats';
import { displayName, updateSettings } from '@/lib/services/users';
import { addDays, dateIn, daysInclusive, formatDayMonth, isDateString, safeTimeZone, timeIn } from '@/lib/time';
import type {
  DoseView,
  PrescriptionDetailView,
  PrescriptionSummary,
  PrescriptionsView,
  SettingsView,
  StatsView,
  TodayView,
} from '@/lib/webapp/types';

function initials(user: Pick<User, 'firstName' | 'lastName' | 'username'>): string {
  const parts = [user.firstName, user.lastName].filter(Boolean) as string[];
  const letters = parts.map((p) => p.trim()[0]).filter(Boolean).join('');
  return (letters || user.username?.[0] || '?').slice(0, 2).toUpperCase();
}

function todayOf(user: User, now = new Date()) {
  return dateIn(safeTimeZone(user.timezone), now);
}

function toDoseView(d: DoseWithMedication, today: string): DoseView {
  return {
    id: d.id,
    date: d.date,
    time: d.time,
    scheduledAt: d.scheduledAt.toISOString(),
    status: d.status,
    editable: d.date <= today && d.date >= addDays(today, -LIMITS.editableDaysBack),
    name: d.medication.name,
    dosage: d.medication.dosage,
    meal: d.medication.meal as Meal,
    prescriptionId: d.medication.prescription.id,
    prescriptionTitle: d.medication.prescription.title,
  };
}

// ---------------------------------------------------------------------------
// Bugun
// ---------------------------------------------------------------------------

export async function getToday(user: User, requestedDate: string | null): Promise<TodayView> {
  const now = new Date();
  const tz = safeTimeZone(user.timezone);
  const today = dateIn(tz, now);
  const date = requestedDate && isDateString(requestedDate) ? requestedDate : today;

  const [doses, next, activePrescriptions] = await Promise.all([
    getDayDoses(user.id, date),
    getNextDose(user.id, now),
    db.prescription.count({ where: { userId: user.id, status: 'ACTIVE' } }),
  ]);

  let nextView: TodayView['next'] = null;
  if (next) {
    const group = await db.dose.findMany({
      where: { userId: user.id, scheduledAt: next.scheduledAt, status: 'PENDING' },
      include: { medication: { select: { name: true } } },
    });
    nextView = {
      scheduledAt: next.scheduledAt.toISOString(),
      date: next.date,
      time: next.time,
      names: group.map((g) => g.medication.name),
    };
  }

  const counts = { total: doses.length, taken: 0, skipped: 0, missed: 0, pending: 0 };
  for (const d of doses) {
    if (d.status === 'TAKEN') counts.taken++;
    else if (d.status === 'SKIPPED') counts.skipped++;
    else if (d.status === 'MISSED') counts.missed++;
    else counts.pending++;
  }

  return {
    date,
    today,
    timezone: tz,
    firstName: displayName(user),
    initials: initials(user),
    doses: doses.map((d) => toDoseView(d, today)),
    counts,
    next: nextView,
    activePrescriptions,
    remindersEnabled: user.remindersEnabled,
  };
}

export async function actOnDose(user: User, doseId: unknown, action: unknown) {
  if (typeof doseId !== 'string' || !doseId) throw new AppError('Doza tanlanmagan');
  if (action !== 'take' && action !== 'skip' && action !== 'undo') throw new AppError("Noma'lum amal");
  const dose = await markDose(user, doseId, action as DoseAction);
  // Botdagi eslatma xabari ham yangilanadi — tugmalar eskirib qolmasligi uchun.
  if (dose.messageId !== null) {
    runAfterResponse(() => refreshReminderMessage(getBot().telegram, user, dose));
  }
  return { id: dose.id, status: dose.status };
}

// ---------------------------------------------------------------------------
// Retseptlar
// ---------------------------------------------------------------------------

function summary(
  p: Prescription & { medications: Pick<Medication, 'name' | 'isActive'>[] },
  counts: DoseCounts | undefined,
  today: string
): PrescriptionSummary {
  const { day, total } = courseProgress(p, today);
  const c = counts ?? emptyCounts();
  return {
    id: p.id,
    title: p.title,
    doctor: p.doctor,
    startDate: p.startDate,
    endDate: p.endDate,
    status: p.status,
    day,
    totalDays: total,
    percent: adherencePercent(c),
    taken: c.taken,
    medicationNames: p.medications.map((m) => m.name),
  };
}

export async function getPrescriptions(user: User): Promise<PrescriptionsView> {
  const today = todayOf(user);
  const { active, finished } = await listPrescriptions(user.id);
  const counts = await countDosesByPrescription([...active, ...finished].map((p) => p.id));
  return {
    today,
    active: active.map((p) => summary(p, counts.get(p.id), today)),
    finished: finished.map((p) => summary(p, counts.get(p.id), today)),
    limit: LIMITS.activePrescriptions,
  };
}

export async function getPrescriptionDetail(user: User, id: string): Promise<PrescriptionDetailView> {
  if (!id) throw new AppError('Retsept tanlanmagan');
  const today = todayOf(user);
  const p = await getPrescription(user.id, id);
  const byMed = await countDosesByMedication(p.medications.map((m) => m.id));
  const total = sumCounts(byMed.values());

  return {
    ...summary(p, total, today),
    notes: p.notes,
    counts: { total: total.total, taken: total.taken, skipped: total.skipped, missed: total.missed },
    medications: p.medications.map((m) => {
      const c = byMed.get(m.id) ?? emptyCounts();
      return {
        id: m.id,
        name: m.name,
        dosage: m.dosage,
        meal: m.meal as Meal,
        times: m.times,
        startDate: m.startDate,
        endDate: m.endDate,
        days: daysInclusive(m.startDate, m.endDate),
        isActive: m.isActive,
        taken: c.taken,
        resolved: c.taken + c.skipped + c.missed,
        percent: adherencePercent(c),
      };
    }),
  };
}

export async function createFromApp(user: User, body: Record<string, unknown>) {
  const today = todayOf(user);
  // Ilova sanani "bugun/ertaga" deb yuboradi — kalendar sanasi foydalanuvchi zonasida hisoblanadi.
  const raw = { ...body };
  if (raw.startOffset === 0 || raw.startOffset === 1) raw.startDate = addDays(today, raw.startOffset);
  const input = validatePrescription(raw, today);
  const created = await createPrescription(user, input);

  // Botda ham tasdiq — foydalanuvchi eslatmalar shu chatga kelishini bilsin.
  runAfterResponse(async () => {
    const perDay = input.medications.reduce((sum, m) => sum + m.times.length, 0);
    const text =
      `✅ <b>Retsept saqlandi:</b> ${esc(created.title)}\n` +
      `📅 ${input.days} kun (${formatDayMonth(created.startDate)} – ${formatDayMonth(created.endDate)}) · ` +
      `${input.medications.length} ta dori, kuniga ${perDay} marta\n\n` +
      'Har bir dori vaqtida shu yerga eslatma yuboraman.';
    await getBot().telegram.sendMessage(Number(user.telegramId), text, { parse_mode: 'HTML' });
  });

  return { id: created.id };
}

export async function actOnPrescription(user: User, body: Record<string, unknown>) {
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) throw new AppError('Retsept tanlanmagan');
  switch (body.action) {
    case 'finish':
      await finishPrescription(user, id);
      return { ok: true };
    case 'delete':
      await deletePrescription(user.id, id);
      return { ok: true, deleted: true };
    case 'days':
      await setPrescriptionDays(user, id, Number(body.days));
      return { ok: true };
    default:
      throw new AppError("Noma'lum amal");
  }
}

export async function actOnMedication(user: User, body: Record<string, unknown>) {
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) throw new AppError('Dori tanlanmagan');
  switch (body.action) {
    case 'stop': {
      const res = await stopMedication(user, id);
      return { ok: true, prescriptionFinished: res.prescriptionFinished };
    }
    case 'times':
      await updateMedicationTimes(user, id, body.times);
      return { ok: true };
    default:
      throw new AppError("Noma'lum amal");
  }
}

// ---------------------------------------------------------------------------
// Hisobot va sozlamalar
// ---------------------------------------------------------------------------

export async function getStats(user: User, periodParam: string | null): Promise<StatsView> {
  const period = periodParam === '30' ? 30 : 7;
  const stats = await getUserStats(user, period);
  return {
    period,
    from: stats.from,
    to: stats.to,
    percent: stats.percent,
    streak: stats.streak,
    totals: stats.totals,
    days: stats.days,
    medications: stats.medications,
  };
}

export function settingsOf(user: User): SettingsView {
  return {
    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || displayName(user),
    username: user.username,
    initials: initials(user),
    timezone: user.timezone,
    nowTime: timeIn(safeTimeZone(user.timezone)),
    remindersEnabled: user.remindersEnabled,
    leadMinutes: user.leadMinutes,
    followUpMinutes: user.followUpMinutes,
    since: dateIn(safeTimeZone(user.timezone), user.createdAt),
  };
}

export async function saveSettings(user: User, body: Record<string, unknown>) {
  const updated = await updateSettings(user, {
    timezone: body.timezone,
    remindersEnabled: body.remindersEnabled,
    leadMinutes: body.leadMinutes,
    followUpMinutes: body.followUpMinutes,
  });
  return settingsOf(updated);
}
