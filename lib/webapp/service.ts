import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import type { Medication, Prescription, User } from '@/lib/generated/prisma/client';
import { LIMITS, type Meal } from '@/lib/constants';
import { LANG_LABELS, langOf, t } from '@/lib/i18n';
import { runAfterResponse } from '@/lib/concurrency';
import { getBot } from '@/lib/bot';
import { mainKeyboard } from '@/lib/bot/keyboards';
import { esc } from '@/lib/bot/telegram';
import { refreshReminderMessage } from '@/lib/services/scheduler';
import {
  getAsNeededToday,
  getDayDoses,
  getNextDose,
  logAsNeeded,
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
import { addStock, computeForecasts, listStock, unitOf, updateStock, type StockForecast } from '@/lib/services/stock';
import { getAdminOverview, listAdminUsers } from '@/lib/services/admin';
import { displayName, inAdminMode, isAdmin, setAdminMode, updateSettings } from '@/lib/services/users';
import { addDays, dateIn, daysInclusive, formatDayMonth, isDateString, safeTimeZone, timeIn } from '@/lib/time';
import type {
  DoseView,
  MeView,
  PrescriptionDetailView,
  PrescriptionSummary,
  PrescriptionsView,
  SettingsView,
  StatsView,
  StockForecastView,
  StockView,
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

function forecastView(f: StockForecast | null | undefined): StockForecastView | null {
  return f ? { enough: f.enough, runOutDate: f.runOutDate, daysLeft: f.daysLeft, need: f.need, dosesLeft: f.dosesLeft } : null;
}

/** Botdagi pastki klaviaturani yangilash (til yoki admin rejimi o'zgarganda) — tasdiq xabari bilan. */
function refreshBotKeyboard(user: User, text: string) {
  runAfterResponse(async () => {
    const keyboard = mainKeyboard(langOf(user), { admin: inAdminMode(user) });
    await getBot().telegram.sendMessage(Number(user.telegramId), text, keyboard);
  });
}

// ---------------------------------------------------------------------------
// Profil
// ---------------------------------------------------------------------------

export function getMe(user: User): MeView {
  return { lang: langOf(user), isAdmin: isAdmin(user), adminMode: inAdminMode(user) };
}

// ---------------------------------------------------------------------------
// Bugun
// ---------------------------------------------------------------------------

export async function getToday(user: User, requestedDate: string | null): Promise<TodayView> {
  const now = new Date();
  const tz = safeTimeZone(user.timezone);
  const today = dateIn(tz, now);
  const date = requestedDate && isDateString(requestedDate) ? requestedDate : today;

  const [allDoses, next, activePrescriptions, asNeeded, stock] = await Promise.all([
    getDayDoses(user.id, date),
    getNextDose(user.id, now),
    db.prescription.count({ where: { userId: user.id, status: 'ACTIVE' } }),
    date === today ? getAsNeededToday(user.id, today) : Promise.resolve([]),
    date === today ? listStock(user, now) : Promise.resolve([]),
  ]);
  // "Kerak bo'lganda" qaydlari alohida bo'limda — kunlik reja va halqaga kirmaydi.
  const doses = allDoses.filter((d) => !d.medication.asNeeded);

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
    firstName: displayName(user, langOf(user)),
    initials: initials(user),
    doses: doses.map((d) => toDoseView(d, today)),
    counts,
    next: nextView,
    activePrescriptions,
    remindersEnabled: user.remindersEnabled,
    asNeeded: asNeeded.map(({ id, name, dosage, maxPerDay, countToday, lastTime }) => ({
      id,
      name,
      dosage,
      maxPerDay,
      countToday,
      lastTime,
    })),
    lowStock: stock.filter((i) => i.low).map((i) => i.medication.name),
  };
}

export async function actOnDose(user: User, doseId: unknown, action: unknown) {
  if (typeof doseId !== 'string' || !doseId) throw new AppError('err.noDose');
  if (action !== 'take' && action !== 'skip' && action !== 'undo') throw new AppError('err.unknownAction');
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
  if (!id) throw new AppError('err.noRx');
  const today = todayOf(user);
  const p = await getPrescription(user.id, id);
  const byMed = await countDosesByMedication(p.medications.map((m) => m.id));
  // "Kerak bo'lganda" dorilari rioya foiziga kirmaydi.
  const total = sumCounts(p.medications.filter((m) => !m.asNeeded).map((m) => byMed.get(m.id) ?? emptyCounts()));

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
        everyDays: m.everyDays,
        weekdays: m.weekdays,
        asNeeded: m.asNeeded,
        maxPerDay: m.maxPerDay,
        startDate: m.startDate,
        endDate: m.endDate,
        days: daysInclusive(m.startDate, m.endDate),
        isActive: m.isActive,
        taken: c.taken,
        resolved: c.taken + c.skipped + c.missed,
        percent: m.asNeeded ? null : adherencePercent(c),
        stock: m.stock,
        unit: unitOf(m),
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
    const lang = langOf(user);
    const text = t(lang, 'app.rxSaved', {
      title: esc(created.title),
      days: t(lang, 'common.days', { n: input.days }),
      from: formatDayMonth(created.startDate, lang),
      to: formatDayMonth(created.endDate, lang),
      n: input.medications.length,
    });
    await getBot().telegram.sendMessage(Number(user.telegramId), text, { parse_mode: 'HTML' });
  });

  return { id: created.id };
}

export async function actOnPrescription(user: User, body: Record<string, unknown>) {
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) throw new AppError('err.noRx');
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
      throw new AppError('err.unknownAction');
  }
}

export async function actOnMedication(user: User, body: Record<string, unknown>) {
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) throw new AppError('err.noMed');
  switch (body.action) {
    case 'stop': {
      const res = await stopMedication(user, id);
      return { ok: true, prescriptionFinished: res.prescriptionFinished };
    }
    case 'times':
      await updateMedicationTimes(user, id, body.times);
      return { ok: true };
    // "Kerak bo'lganda" dori: hozir ichdim.
    case 'prn': {
      const log = await logAsNeeded(user, id);
      return { ok: true, countToday: log.countToday, overLimit: log.overLimit, time: log.dose.time, doseId: log.dose.id };
    }
    default:
      throw new AppError('err.unknownAction');
  }
}

// ---------------------------------------------------------------------------
// Zaxira
// ---------------------------------------------------------------------------

export async function getStock(user: User): Promise<StockView> {
  const items = await listStock(user);
  return {
    today: todayOf(user),
    items: items.map(({ medication: m, forecast, low }) => ({
      id: m.id,
      name: m.name,
      dosage: m.dosage,
      prescriptionTitle: m.prescription.title,
      asNeeded: m.asNeeded,
      stock: m.stock,
      unit: unitOf(m),
      unitsPerDose: m.unitsPerDose,
      refillDays: m.refillDays,
      forecast: forecastView(forecast),
      low,
    })),
  };
}

export async function actOnStock(user: User, body: Record<string, unknown>) {
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) throw new AppError('err.noMed');
  switch (body.action) {
    case 'add':
      await addStock(user, id, body.amount);
      break;
    case 'set':
      await updateStock(user, id, {
        stock: body.stock,
        stockUnit: body.unit,
        unitsPerDose: body.unitsPerDose,
        refillDays: body.refillDays,
      });
      break;
    case 'disable':
      await updateStock(user, id, { stock: null });
      break;
    default:
      throw new AppError('err.unknownAction');
  }
  const med = await db.medication.findUniqueOrThrow({ where: { id } });
  const forecast = (await computeForecasts([med], todayOf(user))).get(id);
  return { ok: true, stock: med.stock, forecast: forecastView(forecast) };
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
    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || displayName(user, langOf(user)),
    username: user.username,
    initials: initials(user),
    timezone: user.timezone,
    nowTime: timeIn(safeTimeZone(user.timezone)),
    remindersEnabled: user.remindersEnabled,
    leadMinutes: user.leadMinutes,
    followUpMinutes: user.followUpMinutes,
    since: dateIn(safeTimeZone(user.timezone), user.createdAt),
    language: langOf(user),
    isAdmin: isAdmin(user),
    adminMode: inAdminMode(user),
  };
}

export async function saveSettings(user: User, body: Record<string, unknown>) {
  const updated = await updateSettings(user, {
    timezone: body.timezone,
    remindersEnabled: body.remindersEnabled,
    leadMinutes: body.leadMinutes,
    followUpMinutes: body.followUpMinutes,
    language: body.language,
  });
  // Til o'zgarsa — botdagi pastki menyu ham yangi tilda bo'lishi kerak.
  if (updated.language !== user.language) {
    const lang = langOf(updated);
    refreshBotKeyboard(updated, t(lang, 'start.langSaved', { lang: LANG_LABELS[lang] }));
  }
  return settingsOf(updated);
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

function assertAdmin(user: User) {
  if (!isAdmin(user)) throw new AppError('err.notAdmin', {}, 'forbidden');
}

export async function getAdmin(user: User, params: URLSearchParams) {
  assertAdmin(user);
  if (params.get('view') === 'users') {
    return listAdminUsers(params.get('q') ?? '', Number(params.get('page') ?? 0));
  }
  return getAdminOverview(user.timezone, getBot().telegram);
}

/** Admin <-> foydalanuvchi rejimi (bitta tugma). Botdagi menyu ham shunga moslanadi. */
export async function setAdminModeFromApp(user: User, body: Record<string, unknown>) {
  if (typeof body.adminMode !== 'boolean') throw new AppError('err.value');
  const updated = await setAdminMode(user, body.adminMode);
  const lang = langOf(updated);
  refreshBotKeyboard(updated, t(lang, updated.adminMode ? 'admin.adminMode' : 'admin.userMode'));
  return getMe(updated);
}
