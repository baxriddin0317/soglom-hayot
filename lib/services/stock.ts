import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import type { Medication, Prisma, User } from '@/lib/generated/prisma/client';
import { isStockUnit, LIMITS, parseDosage, REFILL_DAYS_OPTIONS, type StockUnit } from '@/lib/constants';
import { getOwnedMedication, parseStockQty } from '@/lib/services/prescriptions';
import { dateIn, diffDays, safeTimeZone, timeIn } from '@/lib/time';

// Dori zaxirasi.
//
// Foydalanuvchi qo'lidagi miqdorni kiritadi (masalan 20 tabletka). Har "ichdim" da zaxira
// bir martalik sarfga (unitsPerDose) kamayadi, belgi bekor qilinsa — qaytadi. Prognoz oddiy
// "kuniga N marta" emas, haqiqiy jadval (kun ora, hafta kunlari, dori o'z muddati) bo'yicha:
// kelgusi dozalar ketma-ket "sarflanadi" va zaxira qaysi kuni yetmay qolishi aniqlanadi.

// Juda kichik qoldiq (suyuq dorida yaxlitlash xatosi) — 0 deb hisoblanadi.
const EPS = 1e-6;
// Bir kunda bir dori bo'yicha zaxira ogohlantirishi ko'pi bilan bir marta.
const ALERT_EVERY_MS = 20 * 60 * 60_000;
// Ogohlantirish faqat kunduzi (foydalanuvchi vaqti bilan) yuboriladi.
const ALERT_FROM_HOUR = 9;
const ALERT_TO_HOUR = 21;

type Tx = Prisma.TransactionClient;

/**
 * Zaxirani `doses` ta doza miqdoriga kamaytiradi (manfiy bo'lsa — qaytaradi). Atomar, 0 dan pastga
 * tushmaydi. Zaxira kuzatilmayotgan dori (stock = NULL) o'zgarmaydi.
 */
export async function consumeStock(tx: Tx, medicationId: string, doses: number): Promise<void> {
  if (doses === 0) return;
  await tx.$executeRaw`
    UPDATE "Medication"
    SET "stock" = GREATEST(0, ROUND(("stock" - ${doses} * "unitsPerDose")::numeric, 2))::double precision,
        "updatedAt" = NOW()
    WHERE "id" = ${medicationId} AND "stock" IS NOT NULL`;
}

// ---------------------------------------------------------------------------
// Prognoz
// ---------------------------------------------------------------------------

export interface StockForecast {
  stock: number;
  unit: StockUnit;
  unitsPerDose: number;
  // Rejadagi (hali ichilmagan) dozalar soni — kurs oxirigacha.
  dosesLeft: number;
  // Zaxira nechta dozaga yetadi.
  dosesCovered: number;
  // Kurs oxirigacha yetadimi.
  enough: boolean;
  // Zaxira yetmay qoladigan kun (shu kungi dozalardan kamida biri uchun yetmaydi).
  runOutDate: string | null;
  // Bugundan runOutDate gacha kunlar (0 — bugun tugaydi).
  daysLeft: number | null;
  // Kurs oxirigacha yana qancha kerak (birlikda).
  need: number;
}

type ForecastMed = Pick<Medication, 'id' | 'stock' | 'stockUnit' | 'unitsPerDose' | 'dosage' | 'asNeeded'>;

export function unitOf(med: Pick<Medication, 'stockUnit' | 'dosage'>): StockUnit {
  return isStockUnit(med.stockUnit) ? med.stockUnit : parseDosage(med.dosage).unit;
}

/** Toza funksiya: kelgusi dozalar (sana -> soni) bo'yicha prognoz. */
export function forecastFromDoses(
  med: ForecastMed & { stock: number },
  pendingByDate: [string, number][],
  today: string
): StockForecast {
  const perDose = med.unitsPerDose > 0 ? med.unitsPerDose : 1;
  const dosesCovered = Math.floor(med.stock / perDose + EPS);
  const sorted = [...pendingByDate].sort(([a], [b]) => (a < b ? -1 : 1));
  const dosesLeft = sorted.reduce((sum, [, n]) => sum + n, 0);

  let runOutDate: string | null = null;
  let cumulative = 0;
  for (const [date, n] of sorted) {
    cumulative += n;
    if (cumulative > dosesCovered) {
      runOutDate = date;
      break;
    }
  }
  const need = Math.max(0, Math.round((dosesLeft * perDose - med.stock) * 100) / 100);
  return {
    stock: med.stock,
    unit: unitOf(med),
    unitsPerDose: perDose,
    dosesLeft,
    dosesCovered,
    enough: runOutDate === null,
    runOutDate,
    daysLeft: runOutDate === null ? null : Math.max(0, diffDays(today, runOutDate)),
    need,
  };
}

/** Bir nechta dori uchun prognoz (bitta so'rov bilan). Zaxira kuzatilmaydigan dorilar kirmaydi. */
export async function computeForecasts(meds: ForecastMed[], today: string): Promise<Map<string, StockForecast>> {
  const tracked = meds.filter((m): m is ForecastMed & { stock: number } => m.stock !== null);
  const result = new Map<string, StockForecast>();
  if (tracked.length === 0) return result;

  const rows = await db.dose.groupBy({
    by: ['medicationId', 'date'],
    where: { medicationId: { in: tracked.map((m) => m.id) }, status: 'PENDING', date: { gte: today } },
    _count: { _all: true },
  });
  const byMed = new Map<string, [string, number][]>();
  for (const row of rows) {
    byMed.set(row.medicationId, [...(byMed.get(row.medicationId) ?? []), [row.date, row._count._all]]);
  }
  for (const m of tracked) result.set(m.id, forecastFromDoses(m, byMed.get(m.id) ?? [], today));
  return result;
}

/** Zaxira kamligi: "kerak bo'lganda" dori — 2 dozadan kam; jadvalli — `refillDays` kun ichida tugaydi. */
export function isLow(med: Pick<Medication, 'asNeeded' | 'refillDays'>, f: StockForecast): boolean {
  if (med.asNeeded) return f.dosesCovered < 2;
  return !f.enough && f.daysLeft !== null && f.daysLeft <= med.refillDays;
}

// ---------------------------------------------------------------------------
// Foydalanuvchi amallari
// ---------------------------------------------------------------------------

export interface StockPatch {
  stock?: unknown; // null — kuzatishni o'chirish
  stockUnit?: unknown;
  unitsPerDose?: unknown;
  refillDays?: unknown;
}

/** Zaxira sozlamalarini saqlash (aniq miqdor, birlik, bir martalik sarf, ogohlantirish muddati). */
export async function updateStock(user: User, medicationId: string, patch: StockPatch) {
  const med = await getOwnedMedication(user.id, medicationId);
  const data: Prisma.MedicationUpdateInput = {};

  if (patch.stock !== undefined) {
    const qty = parseStockQty(patch.stock);
    if (qty === undefined) throw new AppError('err.stockQty');
    data.stock = qty;
    // To'ldirildi — keyingi safar yana ogohlantiramiz.
    if (qty === null || med.stock === null || qty > med.stock) data.lowStockNotifiedAt = null;
    if (qty !== null && !med.stockUnit) data.stockUnit = unitOf(med);
  }
  if (patch.stockUnit !== undefined) {
    if (!isStockUnit(patch.stockUnit)) throw new AppError('err.value');
    data.stockUnit = patch.stockUnit;
  }
  if (patch.unitsPerDose !== undefined) {
    const n = Number(patch.unitsPerDose);
    if (!Number.isFinite(n) || n <= 0 || n > 1000) throw new AppError('err.value');
    data.unitsPerDose = Math.round(n * 100) / 100;
  }
  if (patch.refillDays !== undefined) {
    if (!(REFILL_DAYS_OPTIONS as readonly unknown[]).includes(patch.refillDays)) throw new AppError('err.value');
    data.refillDays = patch.refillDays as number;
  }
  return db.medication.update({ where: { id: med.id }, data });
}

/** Sotib olindi: zaxiraga qo'shish. Kuzatilmayotgan bo'lsa — shu miqdordan boshlanadi. */
export async function addStock(user: User, medicationId: string, amount: unknown) {
  const med = await getOwnedMedication(user.id, medicationId);
  const qty = parseStockQty(amount);
  if (qty === undefined || qty === null || qty <= 0) throw new AppError('err.stockQty');
  const next = Math.min(LIMITS.maxStock, Math.round(((med.stock ?? 0) + qty) * 100) / 100);
  return db.medication.update({
    where: { id: med.id },
    data: { stock: next, stockUnit: med.stockUnit ?? unitOf(med), lowStockNotifiedAt: null },
  });
}

export interface StockItem {
  medication: Medication & { prescription: { id: string; title: string } };
  forecast: StockForecast | null;
  low: boolean;
}

/** Foydalanuvchining faol dorilari va zaxira prognozi: avval tugayotganlari. */
export async function listStock(user: User, now = new Date()): Promise<StockItem[]> {
  const today = dateIn(safeTimeZone(user.timezone), now);
  const meds = await db.medication.findMany({
    where: { userId: user.id, isActive: true, prescription: { status: 'ACTIVE' } },
    include: { prescription: { select: { id: true, title: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const forecasts = await computeForecasts(meds, today);
  const items = meds.map((m) => {
    const forecast = forecasts.get(m.id) ?? null;
    return { medication: m, forecast, low: forecast ? isLow(m, forecast) : false };
  });
  const rank = (i: StockItem) => (!i.forecast ? 3 : i.low ? 0 : i.forecast.enough ? 2 : 1);
  return items.sort((a, b) => rank(a) - rank(b) || (a.forecast?.daysLeft ?? 999) - (b.forecast?.daysLeft ?? 999));
}

// ---------------------------------------------------------------------------
// Cron: zaxira tugayotganda ogohlantirish
// ---------------------------------------------------------------------------

export interface LowStockAlert {
  user: Pick<User, 'id' | 'telegramId' | 'timezone' | 'language' | 'languageCode'>;
  medication: Medication;
  forecast: StockForecast;
}

/**
 * Ogohlantirish kerak bo'lgan dorilarni topadi va atomar "band qiladi" (lowStockNotifiedAt) —
 * cron ikki marta ishlasa ham xabar bir marta ketadi. Xabarni yuborish chaqiruvchining ishi.
 */
export async function claimLowStockAlerts(now: Date, limit = 50): Promise<LowStockAlert[]> {
  const cutoff = new Date(now.getTime() - ALERT_EVERY_MS);
  const candidates = await db.medication.findMany({
    where: {
      stock: { not: null },
      isActive: true,
      prescription: { status: 'ACTIVE' },
      OR: [{ lowStockNotifiedAt: null }, { lowStockNotifiedAt: { lt: cutoff } }],
      user: { blockedAt: null, remindersEnabled: true },
    },
    include: { user: { select: { id: true, telegramId: true, timezone: true, language: true, languageCode: true } } },
    take: 300,
  });

  // Faqat kunduzi (foydalanuvchi vaqti bo'yicha).
  const awake = candidates.filter((m) => {
    const hour = Number(timeIn(safeTimeZone(m.user.timezone), now).slice(0, 2));
    return hour >= ALERT_FROM_HOUR && hour < ALERT_TO_HOUR;
  });

  const alerts: LowStockAlert[] = [];
  const byTz = new Map<string, typeof awake>();
  for (const m of awake) {
    const tz = safeTimeZone(m.user.timezone);
    byTz.set(tz, [...(byTz.get(tz) ?? []), m]);
  }
  for (const [tz, meds] of byTz) {
    const forecasts = await computeForecasts(meds, dateIn(tz, now));
    for (const m of meds) {
      const f = forecasts.get(m.id);
      if (!f || !isLow(m, f)) continue;
      const claim = await db.medication.updateMany({
        where: { id: m.id, OR: [{ lowStockNotifiedAt: null }, { lowStockNotifiedAt: { lt: cutoff } }] },
        data: { lowStockNotifiedAt: now },
      });
      if (claim.count === 0) continue;
      const { user, ...medication } = m;
      alerts.push({ user, medication, forecast: f });
      if (alerts.length >= limit) return alerts;
    }
  }
  return alerts;
}

/** Xabar yuborilmadi (vaqtinchalik xato) — keyingi cron'da qayta urinish uchun. */
export async function releaseLowStockAlert(medicationId: string): Promise<void> {
  await db.medication.update({ where: { id: medicationId }, data: { lowStockNotifiedAt: null } }).catch(() => {});
}

