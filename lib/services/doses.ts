import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import type { Dose, DoseStatus, Medication, Prescription, User } from '@/lib/generated/prisma/client';
import { LIMITS } from '@/lib/constants';
import { addDays, dateIn, safeTimeZone } from '@/lib/time';

// Doza vaqtidan shuncha o'tib ham belgilanmasa — "belgilanmadi" (MISSED) deb hisoblanadi.
// Foydalanuvchi keyin ham (LIMITS.editableDaysBack kun ichida) "ichgan edim" deb tuzatishi mumkin.
export const MISS_AFTER_MS = 3 * 60 * 60_000;

export type DoseWithMedication = Dose & {
  medication: Pick<Medication, 'id' | 'name' | 'dosage' | 'meal' | 'isActive'> & {
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
    where: { userId, scheduledAt },
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
  if (dose.date > today) throw new AppError("Kelgusi kunlardagi dozani hali belgilab bo'lmaydi", 'conflict');
  if (dose.date < addDays(today, -LIMITS.editableDaysBack)) {
    throw new AppError("Bu doza juda eski — uni o'zgartirib bo'lmaydi", 'conflict');
  }
}

/** Bitta dozani belgilash. Egasi tekshiriladi — boshqa odamning dozasini belgilab bo'lmaydi. */
export async function markDose(user: User, doseId: string, action: DoseAction, now = new Date()): Promise<Dose> {
  const dose = await db.dose.findFirst({ where: { id: doseId, userId: user.id } });
  if (!dose) throw new AppError('Doza topilmadi', 'not_found');
  assertEditable(dose, user, now);

  const status = targetStatus(action, dose, now);
  if (dose.status === status) return dose;
  return db.dose.update({
    where: { id: dose.id },
    data: { status, actedAt: action === 'undo' ? null : now },
  });
}

/** Eslatmadagi "Hammasini ichdim": shu vaqtdagi hali belgilanmagan barcha dozalar. */
export async function markGroup(user: User, doseId: string, action: 'take' | 'skip', now = new Date()) {
  const dose = await db.dose.findFirst({ where: { id: doseId, userId: user.id } });
  if (!dose) throw new AppError('Doza topilmadi', 'not_found');
  assertEditable(dose, user, now);

  await db.dose.updateMany({
    where: { userId: user.id, scheduledAt: dose.scheduledAt, status: { in: ['PENDING', 'MISSED'] } },
    data: { status: targetStatus(action, dose, now), actedAt: now },
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
