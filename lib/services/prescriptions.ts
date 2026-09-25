import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import type { Medication, Prescription, Prisma, User } from '@/lib/generated/prisma/client';
import { isStockUnit, LIMITS, MEALS, parseDosage, type Meal, type StockUnit } from '@/lib/constants';
import {
  addDays,
  dateIn,
  daysInclusive,
  formatDate,
  isDateString,
  isScheduledOn,
  isTimeString,
  MAX_TIMES_PER_DAY,
  safeTimeZone,
  zonedToUtc,
} from '@/lib/time';

// ---------------------------------------------------------------------------
// Kiritilgan ma'lumotni tekshirish (bot ham, Mini App ham shu funksiyadan o'tadi)
// ---------------------------------------------------------------------------

export interface MedicationInput {
  name: string;
  dosage: string | null;
  meal: Meal;
  // Kunlik qabul vaqtlari. "Kerak bo'lganda" dorida — bo'sh.
  times: string[];
  // null — butun kurs davomida.
  days: number | null;
  // 1 — har kuni, 2 — kun ora, 3 — har 3 kunda.
  everyDays: number;
  // Haftaning aniq kunlari (0 = yakshanba). Bo'sh — har kuni (everyDays bo'yicha).
  weekdays: number[];
  asNeeded: boolean;
  maxPerDay: number | null;
  // Zaxira (ixtiyoriy): qo'ldagi miqdor, o'lchov birligi va bir martalik sarf.
  stock: number | null;
  stockUnit: StockUnit | null;
  unitsPerDose: number;
}

export interface PrescriptionInput {
  title: string;
  doctor: string | null;
  notes: string | null;
  startDate: string;
  days: number;
  medications: MedicationInput[];
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function toInt(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
}

function toNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value.trim().replace(',', '.')) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Zaxira miqdori: bo'sh — kuzatilmaydi (null), aks holda 0..maxStock. */
export function parseStockQty(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  const n = toNumber(value);
  if (n === null || n < 0 || n > LIMITS.maxStock) return undefined;
  return Math.round(n * 100) / 100;
}

export function validateMedication(raw: unknown, courseDays: number, index = 0): MedicationInput {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const name = cleanText(m.name, LIMITS.nameLength);
  if (!name) throw new AppError('err.medName', { n: index + 1 });

  const dosage = cleanText(m.dosage, 40) || null;
  const meal = MEALS.includes(m.meal as Meal) ? (m.meal as Meal) : 'ANY';
  const asNeeded = m.asNeeded === true;

  let times: string[] = [];
  let everyDays = 1;
  let weekdays: number[] = [];
  let maxPerDay: number | null = null;

  if (asNeeded) {
    if (m.maxPerDay !== null && m.maxPerDay !== undefined && m.maxPerDay !== '') {
      maxPerDay = toInt(m.maxPerDay);
      if (maxPerDay === null || maxPerDay < 1 || maxPerDay > 24) throw new AppError('err.medMaxPerDay', { name });
    }
  } else {
    if (!Array.isArray(m.times) || m.times.length === 0) throw new AppError('err.medTimes', { name });
    if (!m.times.every(isTimeString)) throw new AppError('err.medTimeFormat', { name });
    times = [...new Set(m.times as string[])].sort();
    if (times.length > MAX_TIMES_PER_DAY) throw new AppError('err.medMaxTimes', { name, max: MAX_TIMES_PER_DAY });

    if (m.everyDays !== undefined && m.everyDays !== null) {
      const n = toInt(m.everyDays);
      if (n === null || n < 1 || n > 7) throw new AppError('err.medEveryDays', { name });
      everyDays = n;
    }
    if (Array.isArray(m.weekdays) && m.weekdays.length > 0) {
      if (!m.weekdays.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)) {
        throw new AppError('err.medWeekdays', { name });
      }
      weekdays = [...new Set(m.weekdays as number[])].sort();
      // Haftaning hamma kuni tanlangan bo'lsa — oddiy "har kuni".
      if (weekdays.length === 7) weekdays = [];
      everyDays = 1;
    }
  }

  let days: number | null = null;
  if (m.days !== null && m.days !== undefined && m.days !== '') {
    days = toInt(m.days);
    if (days === null || days < 1) throw new AppError('err.medDays', { name });
    if (days > courseDays) throw new AppError('err.medDaysLong', { name, days: courseDays });
    if (days === courseDays) days = null;
  }

  const parsed = parseDosage(dosage);
  const stock = parseStockQty(m.stock);
  if (stock === undefined) throw new AppError('err.medStock', { name });
  const stockUnit = isStockUnit(m.stockUnit) ? m.stockUnit : stock !== null ? parsed.unit : null;
  const perDose = toNumber(m.unitsPerDose);
  const unitsPerDose = perDose !== null && perDose > 0 && perDose <= 1000 ? perDose : parsed.amount;

  return { name, dosage, meal, times, days, everyDays, weekdays, asNeeded, maxPerDay, stock, stockUnit, unitsPerDose };
}

export function validatePrescription(raw: unknown, today: string): PrescriptionInput {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const title = cleanText(p.title, LIMITS.nameLength) || 'Retsept';
  const doctor = cleanText(p.doctor, LIMITS.nameLength) || null;
  const notes = cleanText(p.notes, LIMITS.notesLength) || null;

  const days = toInt(p.days);
  if (days === null || days < 1 || days > LIMITS.maxCourseDays) {
    throw new AppError('err.courseDays', { max: LIMITS.maxCourseDays });
  }

  const startDate = p.startDate === undefined ? today : p.startDate;
  if (!isDateString(startDate)) throw new AppError('err.startDate');
  if (startDate < addDays(today, -LIMITS.editableDaysBack) || startDate > addDays(today, 60)) {
    throw new AppError('err.startRange');
  }

  if (!Array.isArray(p.medications) || p.medications.length === 0) {
    throw new AppError('err.noMeds');
  }
  if (p.medications.length > LIMITS.medicationsPerPrescription) {
    throw new AppError('err.maxMeds', { n: LIMITS.medicationsPerPrescription });
  }
  const medications = p.medications.map((m, i) => validateMedication(m, days, i));

  return { title, doctor, notes, startDate, days, medications };
}

// ---------------------------------------------------------------------------
// Dozalarni rejalash
// ---------------------------------------------------------------------------

// Hozirdan shuncha oldin o'tgan vaqt ham reja qilinadi — masalan 08:00 dagi dori 08:20 da
// kiritilsa, u ham ro'yxatga tushadi va darhol eslatiladi.
export const PAST_GRACE_MS = 60 * 60_000;
const CREATE_CHUNK = 2000;

type PlannableMedication = Pick<
  Medication,
  'id' | 'userId' | 'times' | 'startDate' | 'endDate' | 'everyDays' | 'weekdays' | 'asNeeded'
>;

/**
 * Dori uchun `fromDate` (default: bugun) dan kurs oxirigacha bo'lgan dozalar ro'yxati. Toza funksiya.
 * "Kerak bo'lganda" dorisi uchun reja yo'q; kun ora / hafta kunlari hisobga olinadi.
 */
export function planDoses(
  med: PlannableMedication,
  timezone: string,
  now: Date,
  { fromDate, includePast = false }: { fromDate?: string; includePast?: boolean } = {}
): Prisma.DoseCreateManyInput[] {
  const tz = safeTimeZone(timezone);
  const today = dateIn(tz, now);
  const first = fromDate ?? today;
  const start = med.startDate > first ? med.startDate : first;
  const cutoff = now.getTime() - PAST_GRACE_MS;
  const out: Prisma.DoseCreateManyInput[] = [];
  if (med.asNeeded) return out;

  for (let date = start; date <= med.endDate; date = addDays(date, 1)) {
    if (!isScheduledOn(med, date)) continue;
    for (const time of med.times) {
      const scheduledAt = zonedToUtc(date, time, tz);
      if (!includePast && scheduledAt.getTime() < cutoff) continue;
      out.push({ medicationId: med.id, userId: med.userId, date, time, scheduledAt });
    }
  }
  return out;
}

type Tx = Prisma.TransactionClient;

async function insertDoses(client: Tx, rows: Prisma.DoseCreateManyInput[]): Promise<number> {
  let created = 0;
  for (let i = 0; i < rows.length; i += CREATE_CHUNK) {
    const res = await client.dose.createMany({ data: rows.slice(i, i + CREATE_CHUNK), skipDuplicates: true });
    created += res.count;
  }
  return created;
}

// Kelajakdagi, hali eslatilmagan dozalarni o'chiradi (vaqtlar / muddat / zona o'zgarganda).
async function dropFutureDoses(client: Tx, where: Prisma.DoseWhereInput, now: Date): Promise<void> {
  await client.dose.deleteMany({
    where: { ...where, status: 'PENDING', remindedAt: null, scheduledAt: { gt: now } },
  });
}

// ---------------------------------------------------------------------------
// Retseptlar
// ---------------------------------------------------------------------------

export async function createPrescription(user: User, input: PrescriptionInput, now = new Date()) {
  const activeCount = await db.prescription.count({ where: { userId: user.id, status: 'ACTIVE' } });
  if (activeCount >= LIMITS.activePrescriptions) {
    throw new AppError('err.maxActive', { n: LIMITS.activePrescriptions }, 'conflict');
  }

  const endDate = addDays(input.startDate, input.days - 1);
  return db.$transaction(
    async (tx) => {
      const prescription = await tx.prescription.create({
        data: {
          userId: user.id,
          title: input.title,
          doctor: input.doctor,
          notes: input.notes,
          startDate: input.startDate,
          endDate,
          medications: {
            create: input.medications.map((m) => ({
              userId: user.id,
              name: m.name,
              dosage: m.dosage,
              meal: m.meal,
              times: m.times,
              everyDays: m.everyDays,
              weekdays: m.weekdays,
              asNeeded: m.asNeeded,
              maxPerDay: m.maxPerDay,
              stock: m.stock,
              stockUnit: m.stockUnit,
              unitsPerDose: m.unitsPerDose,
              startDate: input.startDate,
              endDate: m.days ? addDays(input.startDate, m.days - 1) : endDate,
            })),
          },
        },
        include: { medications: { orderBy: { createdAt: 'asc' } } },
      });
      const rows = prescription.medications.flatMap((m) => planDoses(m, user.timezone, now));
      await insertDoses(tx, rows);
      return prescription;
    },
    { timeout: 20_000 }
  );
}

async function getOwnedPrescription(userId: string, id: string) {
  const prescription = await db.prescription.findFirst({
    where: { id, userId },
    include: { medications: { orderBy: { createdAt: 'asc' } } },
  });
  if (!prescription) throw new AppError('err.rxNotFound', {}, 'not_found');
  return prescription;
}

export async function getOwnedMedication(userId: string, id: string) {
  const med = await db.medication.findFirst({ where: { id, userId }, include: { prescription: true } });
  if (!med) throw new AppError('err.medNotFound', {}, 'not_found');
  return med;
}

export type PrescriptionWithMeds = Prescription & { medications: Medication[] };

export async function listPrescriptions(userId: string) {
  const [active, finished] = await Promise.all([
    db.prescription.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { medications: { where: { isActive: true }, orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    }),
    db.prescription.findMany({
      where: { userId, status: { not: 'ACTIVE' } },
      include: { medications: { orderBy: { createdAt: 'asc' } } },
      orderBy: [{ endDate: 'desc' }, { createdAt: 'desc' }],
      take: 30,
    }),
  ]);
  return { active, finished };
}

export async function getPrescription(userId: string, id: string) {
  return getOwnedPrescription(userId, id);
}

/** Retseptni muddatidan oldin yakunlash: kelajakdagi eslatmalar o'chadi, tarix saqlanadi. */
export async function finishPrescription(user: User, id: string, now = new Date()) {
  const p = await getOwnedPrescription(user.id, id);
  if (p.status !== 'ACTIVE') return p;
  const today = dateIn(safeTimeZone(user.timezone), now);
  const endDate = p.endDate < today ? p.endDate : today < p.startDate ? p.startDate : today;

  await db.$transaction(async (tx) => {
    await dropFutureDoses(tx, { medication: { prescriptionId: id } }, now);
    await tx.medication.updateMany({ where: { prescriptionId: id, isActive: true }, data: { isActive: false } });
    await tx.prescription.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: now, endDate },
    });
  });
  return getOwnedPrescription(user.id, id);
}

/** Retseptni butunlay o'chirish (tarix bilan birga). */
export async function deletePrescription(userId: string, id: string) {
  const p = await getOwnedPrescription(userId, id);
  await db.prescription.delete({ where: { id: p.id } });
  return p;
}

/**
 * Kurs muddatini o'zgartirish (uzaytirish yoki qisqartirish). "Butun kurs" davomida ichiladigan
 * dorilar ham birga uzayadi; qisqartirilsa dorilarning muddati yangi chegaraga qirqiladi.
 */
export async function setPrescriptionDays(user: User, id: string, days: number, now = new Date()) {
  if (!Number.isInteger(days) || days < 1 || days > LIMITS.maxCourseDays) {
    throw new AppError('err.days', { max: LIMITS.maxCourseDays });
  }
  const p = await getOwnedPrescription(user.id, id);
  if (p.status !== 'ACTIVE') throw new AppError('err.rxFinished', {}, 'conflict');

  const tz = safeTimeZone(user.timezone);
  const today = dateIn(tz, now);
  const newEnd = addDays(p.startDate, days - 1);
  if (newEnd < today) {
    throw new AppError('err.minDays', { date: formatDate(p.startDate), n: daysInclusive(p.startDate, today) });
  }

  await db.$transaction(
    async (tx) => {
      await tx.prescription.update({ where: { id }, data: { endDate: newEnd } });
      for (const med of p.medications) {
        if (!med.isActive) continue;
        const wholeCourse = med.endDate === p.endDate;
        const medEnd = wholeCourse || med.endDate > newEnd ? newEnd : med.endDate;
        if (medEnd !== med.endDate) {
          await tx.medication.update({ where: { id: med.id }, data: { endDate: medEnd } });
        }
        await tx.dose.deleteMany({
          where: { medicationId: med.id, status: 'PENDING', remindedAt: null, date: { gt: medEnd } },
        });
        await insertDoses(tx, planDoses({ ...med, endDate: medEnd }, tz, now));
      }
    },
    { timeout: 20_000 }
  );
  return getOwnedPrescription(user.id, id);
}

/** Dorini to'xtatish: kelajakdagi eslatmalar o'chadi. Retseptda faol dori qolmasa u yakunlanadi. */
export async function stopMedication(user: User, medicationId: string, now = new Date()) {
  const med = await getOwnedMedication(user.id, medicationId);
  await db.$transaction(async (tx) => {
    await dropFutureDoses(tx, { medicationId }, now);
    await tx.medication.update({ where: { id: medicationId }, data: { isActive: false } });
  });
  const remaining = await db.medication.count({ where: { prescriptionId: med.prescriptionId, isActive: true } });
  if (remaining === 0 && med.prescription.status === 'ACTIVE') {
    await finishPrescription(user, med.prescriptionId, now);
  }
  return { medication: med, prescriptionFinished: remaining === 0 };
}

/** Qabul vaqtlarini o'zgartirish. Bugungi o'tgan dozalar tarixi saqlanadi. */
export async function updateMedicationTimes(user: User, medicationId: string, rawTimes: unknown, now = new Date()) {
  const med = await getOwnedMedication(user.id, medicationId);
  if (!med.isActive || med.prescription.status !== 'ACTIVE') {
    throw new AppError('err.medStopped', {}, 'conflict');
  }
  if (med.asNeeded) throw new AppError('err.value');
  if (!Array.isArray(rawTimes) || rawTimes.length === 0 || !rawTimes.every(isTimeString)) {
    throw new AppError('err.times');
  }
  const times = [...new Set(rawTimes as string[])].sort();
  if (times.length > MAX_TIMES_PER_DAY) throw new AppError('err.maxTimes', { max: MAX_TIMES_PER_DAY });

  await db.$transaction(
    async (tx) => {
      await dropFutureDoses(tx, { medicationId }, now);
      const updated = await tx.medication.update({ where: { id: medicationId }, data: { times } });
      await insertDoses(tx, planDoses(updated, user.timezone, now));
    },
    { timeout: 20_000 }
  );
  return db.medication.findUniqueOrThrow({ where: { id: medicationId } });
}

/** Vaqt zonasi o'zgarganda: barcha faol dorilarning kelajakdagi dozalari yangi zona bo'yicha. */
export async function rescheduleUserDoses(user: User, now = new Date()) {
  const meds = await db.medication.findMany({
    where: { userId: user.id, isActive: true, prescription: { status: 'ACTIVE' } },
  });
  if (meds.length === 0) return;
  await db.$transaction(
    async (tx) => {
      for (const med of meds) {
        await dropFutureDoses(tx, { medicationId: med.id }, now);
        await insertDoses(tx, planDoses(med, user.timezone, now));
      }
    },
    { timeout: 30_000 }
  );
}

// ---------------------------------------------------------------------------
// Statistika (retsept bo'yicha)
// ---------------------------------------------------------------------------

export interface DoseCounts {
  total: number; // butun kurs bo'yicha rejadagi dozalar
  due: number; // vaqti kelganlari
  taken: number;
  skipped: number;
  missed: number;
}

export const emptyCounts = (): DoseCounts => ({ total: 0, due: 0, taken: 0, skipped: 0, missed: 0 });

/** Har bir dori bo'yicha dozalar hisobi. */
export async function countDosesByMedication(medicationIds: string[], now = new Date()) {
  const result = new Map<string, DoseCounts>();
  if (medicationIds.length === 0) return result;
  const [all, due] = await Promise.all([
    db.dose.groupBy({ by: ['medicationId', 'status'], where: { medicationId: { in: medicationIds } }, _count: { _all: true } }),
    db.dose.groupBy({
      by: ['medicationId'],
      where: { medicationId: { in: medicationIds }, scheduledAt: { lte: now } },
      _count: { _all: true },
    }),
  ]);
  for (const row of all) {
    const c = result.get(row.medicationId) ?? emptyCounts();
    const n = row._count._all;
    c.total += n;
    if (row.status === 'TAKEN') c.taken += n;
    else if (row.status === 'SKIPPED') c.skipped += n;
    else if (row.status === 'MISSED') c.missed += n;
    result.set(row.medicationId, c);
  }
  for (const row of due) {
    const c = result.get(row.medicationId) ?? emptyCounts();
    c.due += row._count._all;
    result.set(row.medicationId, c);
  }
  return result;
}

/** Har bir retsept bo'yicha (uning barcha dorilari) dozalar hisobi. */
export async function countDosesByPrescription(
  prescriptionIds: string[],
  now = new Date()
): Promise<Map<string, DoseCounts>> {
  const result = new Map<string, DoseCounts>();
  if (prescriptionIds.length === 0) return result;
  // "Kerak bo'lganda" dorilari rejaga ega emas — rioya foiziga kirmaydi.
  const meds = await db.medication.findMany({
    where: { prescriptionId: { in: prescriptionIds }, asNeeded: false },
    select: { id: true, prescriptionId: true },
  });
  const byMed = await countDosesByMedication(
    meds.map((m) => m.id),
    now
  );
  for (const m of meds) {
    const c = byMed.get(m.id);
    if (!c) continue;
    result.set(m.prescriptionId, sumCounts([result.get(m.prescriptionId) ?? emptyCounts(), c]));
  }
  return result;
}

export function sumCounts(list: Iterable<DoseCounts>): DoseCounts {
  const out = emptyCounts();
  for (const c of list) {
    out.total += c.total;
    out.due += c.due;
    out.taken += c.taken;
    out.skipped += c.skipped;
    out.missed += c.missed;
  }
  return out;
}

/**
 * Rioya foizi: natijasi ma'lum dozalardan (ichildi / o'tkazildi / belgilanmadi) nechtasi ichilgan.
 * Hali kutilayotgan doza foizni tushirmaydi. Hisoblash uchun doza bo'lmasa — null.
 */
export function adherencePercent(c: Pick<DoseCounts, 'taken' | 'skipped' | 'missed'>): number | null {
  const resolved = c.taken + c.skipped + c.missed;
  if (resolved <= 0) return null;
  return Math.round((c.taken / resolved) * 100);
}

/** Kursning nechanchi kuni ekanligi: { day, total } (kurs boshlanmagan bo'lsa day = 0). */
export function courseProgress(p: Pick<Prescription, 'startDate' | 'endDate'>, today: string) {
  const total = daysInclusive(p.startDate, p.endDate);
  if (today < p.startDate) return { day: 0, total };
  return { day: Math.min(total, daysInclusive(p.startDate, today)), total };
}
