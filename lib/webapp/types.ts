// Mini App API javoblari. Server (lib/webapp/service.ts) va brauzer (app/app) ikkalasi ham
// shu turlardan foydalanadi. Sanalar "YYYY-MM-DD", vaqtlar "HH:MM", lahzalar ISO satr.

import type { Meal } from '@/lib/constants';

export type DoseStatus = 'PENDING' | 'TAKEN' | 'SKIPPED' | 'MISSED';
export type DoseActionName = 'take' | 'skip' | 'undo';

export interface DoseView {
  id: string;
  date: string;
  time: string;
  scheduledAt: string;
  status: DoseStatus;
  editable: boolean;
  name: string;
  dosage: string | null;
  meal: Meal;
  prescriptionId: string;
  prescriptionTitle: string;
}

export interface DoseCountsView {
  total: number;
  taken: number;
  skipped: number;
  missed: number;
  pending: number;
}

export interface TodayView {
  date: string;
  today: string;
  timezone: string;
  firstName: string;
  initials: string;
  doses: DoseView[];
  counts: DoseCountsView;
  next: { scheduledAt: string; date: string; time: string; names: string[] } | null;
  activePrescriptions: number;
  remindersEnabled: boolean;
}

export interface MedicationView {
  id: string;
  name: string;
  dosage: string | null;
  meal: Meal;
  times: string[];
  startDate: string;
  endDate: string;
  days: number;
  isActive: boolean;
  taken: number;
  resolved: number;
  percent: number | null;
}

export type PrescriptionStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface PrescriptionSummary {
  id: string;
  title: string;
  doctor: string | null;
  startDate: string;
  endDate: string;
  status: PrescriptionStatus;
  day: number;
  totalDays: number;
  percent: number | null;
  taken: number;
  medicationNames: string[];
}

export interface PrescriptionsView {
  today: string;
  active: PrescriptionSummary[];
  finished: PrescriptionSummary[];
  limit: number;
}

export interface PrescriptionDetailView extends PrescriptionSummary {
  notes: string | null;
  medications: MedicationView[];
  counts: { total: number; taken: number; skipped: number; missed: number };
}

export interface StatsView {
  period: 7 | 30;
  from: string;
  to: string;
  percent: number | null;
  streak: number;
  totals: DoseCountsView;
  days: (DoseCountsView & { date: string })[];
  medications: { id: string; name: string; taken: number; resolved: number; percent: number | null }[];
}

export interface SettingsView {
  name: string;
  username: string | null;
  initials: string;
  timezone: string;
  nowTime: string;
  remindersEnabled: boolean;
  leadMinutes: number;
  followUpMinutes: number;
  since: string;
}

// POST /api/app/prescriptions
export interface NewMedicationBody {
  name: string;
  dosage: string | null;
  meal: Meal;
  times: string[];
  days: number | null;
}

export interface NewPrescriptionBody {
  title: string;
  doctor: string | null;
  notes: string | null;
  startDate: string;
  days: number;
  medications: NewMedicationBody[];
}

export interface ApiError {
  error: string;
  code?: string;
}
