import { db } from '@/lib/db';
import { Prisma, type User } from '@/lib/generated/prisma/client';
import type { Meal } from '@/lib/constants';
import type { MedicationInput } from '@/lib/services/prescriptions';

// Botdagi ko'p qadamli dialog holati. Vercel funksiyalari so'rovlar orasida xotirani saqlamaydi,
// shuning uchun holat `User.botState` (JSON) ustunida turadi.

export interface DraftPrescription {
  title: string;
  days: number;
  startDate: string;
  medications: MedicationInput[];
}

export interface DraftMedication {
  name?: string;
  dosage?: string | null;
  perDay?: number;
  times?: string[];
  days?: number | null;
  meal?: Meal;
}

export type BotState =
  | { step: 'rx_title' }
  | { step: 'rx_days'; draft: Partial<DraftPrescription> }
  | { step: 'rx_start'; draft: Partial<DraftPrescription> }
  | { step: 'med_name'; draft: DraftPrescription }
  | { step: 'med_dosage'; draft: DraftPrescription; med: DraftMedication }
  | { step: 'med_count'; draft: DraftPrescription; med: DraftMedication }
  | { step: 'med_times'; draft: DraftPrescription; med: DraftMedication }
  | { step: 'med_days'; draft: DraftPrescription; med: DraftMedication }
  | { step: 'med_meal'; draft: DraftPrescription; med: DraftMedication }
  | { step: 'rx_review'; draft: DraftPrescription }
  | { step: 'edit_times'; medicationId: string }
  | { step: 'edit_days'; prescriptionId: string }
  | { step: 'tz_custom' };

export type BotStep = BotState['step'];

// Juda eski (tashlab ketilgan) dialog e'tiborga olinmaydi.
const STATE_TTL_MS = 24 * 60 * 60_000;

export function getState(user: User): BotState | null {
  const raw = user.botState as (BotState & { at?: number }) | null;
  if (!raw || typeof raw !== 'object' || typeof raw.step !== 'string') return null;
  if (raw.at && Date.now() - raw.at > STATE_TTL_MS) return null;
  return raw;
}

export async function setState(user: User, state: BotState | null): Promise<void> {
  const value = state ? ({ ...state, at: Date.now() } as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
  await db.user.update({ where: { id: user.id }, data: { botState: value } });
  user.botState = state ? (value as Prisma.JsonValue) : null;
}
