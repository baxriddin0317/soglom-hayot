// Bot va Mini App (brauzer) uchun umumiy doimiylar. Bu fayl brauzerga ham tushadi —
// shuning uchun bu yerda server kodi (Prisma, Telegraf) import qilinmaydi.

import type { Key } from '@/lib/i18n';

export const LIMITS = {
  activePrescriptions: 10,
  medicationsPerPrescription: 15,
  maxCourseDays: 365,
  nameLength: 80,
  notesLength: 500,
  // Necha kun oldingi dozani hali belgilash mumkin (kechikib "ichdim" deyish).
  editableDaysBack: 2,
  maxStock: 100_000,
} as const;

export type Meal = 'ANY' | 'BEFORE' | 'WITH' | 'AFTER';
export const MEALS: Meal[] = ['ANY', 'BEFORE', 'WITH', 'AFTER'];

export const MEAL_KEY: Record<Meal, Key> = {
  ANY: 'meal.ANY',
  BEFORE: 'meal.BEFORE',
  WITH: 'meal.WITH',
  AFTER: 'meal.AFTER',
};

// Qisqa shakl — ro'yxatlarda dori nomi yonida.
export const MEAL_SHORT_KEY: Record<Meal, Key | null> = {
  ANY: null,
  BEFORE: 'mealShort.BEFORE',
  WITH: 'mealShort.WITH',
  AFTER: 'mealShort.AFTER',
};

export const LEAD_OPTIONS = [0, 5, 10, 15, 30] as const;
export const FOLLOW_UP_OPTIONS = [0, 15, 30, 60] as const;

// Vaqt zonasi tanlovlari (IANA). O'zbekistonning hammasi bitta zonada (UTC+5).
export const TIMEZONE_OPTIONS: { tz: string; key: Key }[] = [
  { tz: 'Asia/Tashkent', key: 'tz.tashkent' },
  { tz: 'Asia/Almaty', key: 'tz.almaty' },
  { tz: 'Asia/Bishkek', key: 'tz.bishkek' },
  { tz: 'Asia/Dushanbe', key: 'tz.dushanbe' },
  { tz: 'Europe/Moscow', key: 'tz.moscow' },
  { tz: 'Europe/Istanbul', key: 'tz.istanbul' },
  { tz: 'Asia/Dubai', key: 'tz.dubai' },
  { tz: 'Asia/Seoul', key: 'tz.seoul' },
  { tz: 'Europe/Berlin', key: 'tz.berlin' },
  { tz: 'America/New_York', key: 'tz.newyork' },
];

export const DOSAGE_PRESET_KEYS: Key[] = [
  'preset.tablet1',
  'preset.tablet2',
  'preset.tabletHalf',
  'preset.capsule1',
  'preset.ml5',
  'preset.drops',
  'preset.ampoule',
];
export const COURSE_DAY_PRESETS = [3, 5, 7, 10, 14, 30];

// "Har N soatda" tanlovlari.
export const INTERVAL_HOURS = [4, 6, 8, 12] as const;
// "Kun ora" va h.k.: 1 — har kuni.
export const EVERY_DAYS_OPTIONS = [1, 2, 3] as const;
// "Kerak bo'lganda" — kuniga ko'pi bilan.
export const MAX_PER_DAY_OPTIONS = [2, 3, 4, 6] as const;

// ---------------------------------------------------------------------------
// Dori zaxirasi
// ---------------------------------------------------------------------------

export type StockUnit = 'tablet' | 'capsule' | 'ml' | 'drop' | 'ampoule' | 'sachet' | 'piece';
export const STOCK_UNITS: StockUnit[] = ['tablet', 'capsule', 'ml', 'drop', 'ampoule', 'sachet', 'piece'];
export const REFILL_DAYS_OPTIONS = [1, 2, 3, 5, 7] as const;
// Tez qo'shish tugmalari (sotib olganda).
export const STOCK_ADD_OPTIONS = [10, 20, 30, 50] as const;

export function isStockUnit(value: unknown): value is StockUnit {
  return typeof value === 'string' && (STOCK_UNITS as string[]).includes(value);
}

// Dozalash matnidagi so'z -> o'lchov birligi (o'zbek lotin/kirill, rus, lotin qisqartmalar).
const UNIT_WORDS: [RegExp, StockUnit][] = [
  [/^(tab|tabl|tabletka|таб|табл|таблетк|таблетка|таблетки|таблеток|tablet)/, 'tablet'],
  [/^(kaps|kapsula|капс|капсула|капсулы|капсул|caps|capsule)/, 'capsule'],
  [/^(ml|мл)$/, 'ml'],
  [/^(tomchi|томчи|кап|капля|капли|капель|drop)/, 'drop'],
  [/^(ampula|ampul|ампула|ампулы|ампул|ukol|укол|inyeksiya|инъекц)/, 'ampoule'],
  [/^(paket|пакет|sashe|саше|poroshok|порошок)/, 'sachet'],
  [/^(dona|дона|шт|ta|та)$/, 'piece'],
];

/**
 * "2 tabletka" -> { amount: 2, unit: 'tablet' }, "½ таблетки" -> 0.5, "5 ml" -> 5 ml.
 * Birlik aniqlanmasa — 'piece', miqdor aniqlanmasa — 1.
 */
export function parseDosage(dosage: string | null | undefined): { amount: number; unit: StockUnit } {
  const s = (dosage ?? '').trim().toLowerCase().replace('½', '0.5').replace('¼', '0.25');
  const m = /^(\d+(?:[.,]\d+)?)(?:\s*\/\s*(\d+))?\s*(.*)$/.exec(s);
  let amount = 1;
  let rest = s;
  if (m) {
    amount = Number(m[1].replace(',', '.'));
    if (m[2]) amount = amount / Number(m[2]);
    rest = m[3];
  }
  if (!Number.isFinite(amount) || amount <= 0) amount = 1;
  const word = rest.split(/\s+/)[0] ?? '';
  const unit = UNIT_WORDS.find(([re]) => re.test(word))?.[1] ?? 'piece';
  return { amount, unit };
}
