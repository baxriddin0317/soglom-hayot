import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import type { Dose, DoseStatus, Medication, Prescription, User } from '@/lib/generated/prisma/client';
import { LIMITS } from '@/lib/constants';
import { consumeStock } from '@/lib/services/stock';
import { addDays, dateIn, safeTimeZone, timeIn } from '@/lib/time';

// Doza vaqtidan shuncha o'tib ham belgilanmasa — "belgilanmadi" (MISSED) deb hisoblanadi.
// Foydalanuvchi keyin ham (LIMITS.editableDaysBack kun ichida) "ichgan edim" deb tuzatishi mumkin.
export const MISS_AFTER_MS = 3 * 60 * 60_000;

export type DoseWithMedication = Dose & {
  medication: Pick<
    Medication,
    'id' | 'name' | 'dosage' | 'meal' | 'isActive' | 'asNeeded' | 'stock' | 'stockUnit' | 'unitsPerDose'
  > & {
    prescription: Pick<Prescription, 'id' | 'title'>;
  };
};

const doseInclude = {
  medication: {
    select: {
      id: true,
      name: true,
      dosage: true,
      meal: true,
      isActive: true,
      asNeeded: true,
      stock: true,
      stockUnit: true,
      unitsPerDose: true,
      prescription: { select: { id: true, title: true } },
    },
  },
} as const;

export async function getDayDoses(userId: string, date: string): Promise<DoseWithMedication[]> {
  const doses = await db.dose.findMany({
    where: { userId, date },
    include: doseInclude,
    orderBy: [{ time: 'asc' }, { createdAt: 'asc' }],
  });
  return doses;
}

/** Bitta eslatma xabaridagi dozalar: shu foydalanuvchining aynan shu vaqtdagi barcha dozalari. */
export async function getReminderGroup(userId: string, scheduledAt: Date): Promise<DoseWithMedication[]> {
  return db.dose.findMany({
    where: { userId, scheduledAt, medication: { asNeeded: false } },
    include: doseInclude,
    orderBy: [{ createdAt: 'asc' }],
  });
}

export type DoseAction = 'take' | 'skip' | 'undo';

function targetStatus(action: DoseAction, dose: Pick<Dose, 'scheduledAt'>, now: Date): DoseStatus {
  if (action === 'take') return 'TAKEN';
  if (action === 'skip') return 'SKIPPED';
  return dose.scheduledAt.getTime() <= now.getTime() - MISS_AFTER_MS ? 'MISSED' : 'PENDING';
}

function assertEditable(dose: Pick<Dose, 'date'>, user: Pick<User, 'timezone'>, now: Date) {
  const today = dateIn(safeTimeZone(user.timezone), now);
  if (dose.date > today) throw new AppError('err.futureDose', {}, 'conflict');
  if (dose.date < addDays(today, -LIMITS.editableDaysBack)) {
    throw new AppError('err.oldDose', {}, 'conflict');
  }
}

const takenDelta = (from: DoseStatus, to: DoseStatus) => (to === 'TAKEN' ? 1 : 0) - (from === 'TAKEN' ? 1 : 0);

/**
 * Bitta dozani belgilash. Egasi tekshiriladi — boshqa odamning dozasini belgilab bo'lmaydi.
 * "Ichildi" ga o'tsa zaxira kamayadi, "ichildi" dan chiqsa — qaytadi.
 */
export async function markDose(user: User, doseId: string, action: DoseAction, now = new Date()): Promise<Dose> {
  const dose = await db.dose.findFirst({
    where: { id: doseId, userId: user.id },
    include: { medication: { select: { asNeeded: true } } },
  });
  if (!dose) throw new AppError('err.doseNotFound', {}, 'not_found');
  assertEditable(dose, user, now);

  // "Kerak bo'lganda" qaydi: bekor qilinsa — qayd o'chadi (u rejada bo'lmagan).
  if (dose.medication.asNeeded) {
    if (action === 'take') return dose;
    if (action === 'skip') throw new AppError('err.value');
    return db.$transaction(async (tx) => {
      await tx.dose.delete({ where: { id: dose.id } });
      if (dose.status === 'TAKEN') await consumeStock(tx, dose.medicationId, -1);
      return { ...dose, status: 'PENDING' as const };
    });
  }

  const status = targetStatus(action, dose, now);
  if (dose.status === status) return dose;
  return db.$transaction(async (tx) => {
    const updated = await tx.dose.update({
      where: { id: dose.id },
      data: { status, actedAt: action === 'undo' ? null : now },
    });
    await consumeStock(tx, dose.medicationId, takenDelta(dose.status, status));
    return updated;
  });
}

/** Eslatmadagi "Hammasini ichdim": shu vaqtdagi hali belgilanmagan barcha dozalar. */
export async function markGroup(user: User, doseId: string, action: 'take' | 'skip', now = new Date()) {
  const dose = await db.dose.findFirst({ where: { id: doseId, userId: user.id } });
  if (!dose) throw new AppError('err.doseNotFound', {}, 'not_found');
  assertEditable(dose, user, now);

  const status = targetStatus(action, dose, now);
  await db.$transaction(async (tx) => {
    const changed = await tx.dose.updateManyAndReturn({
      where: { userId: user.id, scheduledAt: dose.scheduledAt, status: { in: ['PENDING', 'MISSED'] } },
      data: { status, actedAt: now },
      select: { medicationId: true },
    });
    if (status !== 'TAKEN') return;
    const perMed = new Map<string, number>();
    for (const c of changed) perMed.set(c.medicationId, (perMed.get(c.medicationId) ?? 0) + 1);
    for (const [medicationId, n] of perMed) await consumeStock(tx, medicationId, n);
  });
  return dose;
}

/** Keyingi (hali belgilanmagan, kelajakdagi) doza — "Bugun" ekranidagi taymer uchun. */
export async function getNextDose(userId: string, now = new Date()) {
  return db.dose.findFirst({
    where: { userId, status: 'PENDING', scheduledAt: { gt: now } },
    include: doseInclude,
    orderBy: { scheduledAt: 'asc' },
  });
}

// ---------------------------------------------------------------------------
// "Kerak bo'lganda" ichiladigan dorilar
// ---------------------------------------------------------------------------

export interface AsNeededLog {
  dose: Dose;
  medication: Pick<Medication, 'id' | 'name' | 'maxPerDay'>;
  // Bugun necha marta ichildi (shu qayd bilan).
  countToday: number;
  // Kunlik chegaradan oshdi.
  overLimit: boolean;
}

/** "Hozir ichdim": qayd yaratiladi (holati — ichildi), zaxira kamayadi. */
export async function logAsNeeded(user: User, medicationId: string, now = new Date()): Promise<AsNeededLog> {
  const med = await db.medication.findFirst({
    where: { id: medicationId, userId: user.id },
    include: { prescription: { select: { status: true } } },
  });
  if (!med) throw new AppError('err.medNotFound', {}, 'not_found');
  if (!med.asNeeded) throw new AppError('err.notAsNeeded', {}, 'conflict');
  if (!med.isActive || med.prescription.status !== 'ACTIVE') throw new AppError('err.medStopped', {}, 'conflict');

  const tz = safeTimeZone(user.timezone);
  const date = dateIn(tz, now);
  const time = timeIn(tz, now);
  const at = new Date(Math.floor(now.getTime() / 60_000) * 60_000);

  const dose = await db.$transaction(async (tx) => {
    const exists = await tx.dose.findUnique({ where: { medicationId_date_time: { medicationId, date, time } } });
    if (exists) throw new AppError('err.prnDuplicate', {}, 'conflict');
    const created = await tx.dose.create({
      data: {
        medicationId,
        userId: user.id,
        date,
        time,
        scheduledAt: at,
        status: 'TAKEN',
        actedAt: now,
        // Eslatma yuborilmaydi — qayd foydalanuvchining o'zidan.
        remindedAt: now,
      },
    });
    await consumeStock(tx, medicationId, 1);
    return created;
  });

  const countToday = await db.dose.count({ where: { medicationId, date, status: 'TAKEN' } });
  return {
    dose,
    medication: { id: med.id, name: med.name, maxPerDay: med.maxPerDay },
    countToday,
    overLimit: med.maxPerDay !== null && countToday > med.maxPerDay,
  };
}

export interface AsNeededToday {
  id: string;
  name: string;
  dosage: string | null;
  maxPerDay: number | null;
  countToday: number;
  lastTime: string | null;
  stock: number | null;
}

/** Faol "kerak bo'lganda" dorilari va bugun necha marta ichilgani. */
export async function getAsNeededToday(userId: string, date: string): Promise<AsNeededToday[]> {
  const meds = await db.medication.findMany({
    where: { userId, asNeeded: true, isActive: true, prescription: { status: 'ACTIVE' } },
    include: { doses: { where: { date, status: 'TAKEN' }, select: { time: true }, orderBy: { time: 'desc' } } },
    orderBy: { createdAt: 'asc' },
  });
  return meds.map((m) => ({
    id: m.id,
    name: m.name,
    dosage: m.dosage,
    maxPerDay: m.maxPerDay,
    countToday: m.doses.length,
    lastTime: m.doses[0]?.time ?? null,
    stock: m.stock,
  }));
}
