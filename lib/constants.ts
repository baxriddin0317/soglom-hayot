// Bot va Mini App (brauzer) uchun umumiy doimiylar. Bu fayl brauzerga ham tushadi —
// shuning uchun bu yerda server kodi (Prisma, Telegraf) import qilinmaydi.

export const LIMITS = {
  activePrescriptions: 10,
  medicationsPerPrescription: 15,
  maxCourseDays: 365,
  nameLength: 80,
  notesLength: 500,
  // Necha kun oldingi dozani hali belgilash mumkin (kechikib "ichdim" deyish).
  editableDaysBack: 2,
} as const;

export type Meal = 'ANY' | 'BEFORE' | 'WITH' | 'AFTER';
export const MEALS: Meal[] = ['ANY', 'BEFORE', 'WITH', 'AFTER'];

export const MEAL_LABELS: Record<Meal, string> = {
  ANY: 'Farqi yo\'q',
  BEFORE: 'Ovqatdan oldin',
  WITH: 'Ovqat bilan',
  AFTER: 'Ovqatdan keyin',
};

// Qisqa shakl — ro'yxatlarda dori nomi yonida.
export const MEAL_SHORT: Record<Meal, string | null> = {
  ANY: null,
  BEFORE: 'ovqatdan oldin',
  WITH: 'ovqat bilan',
  AFTER: 'ovqatdan keyin',
};

export const LEAD_OPTIONS = [0, 5, 10, 15, 30] as const;
export const FOLLOW_UP_OPTIONS = [0, 15, 30, 60] as const;

// Vaqt zonasi tanlovlari (IANA). O'zbekistonning hammasi bitta zonada (UTC+5).
export const TIMEZONE_OPTIONS: { tz: string; label: string }[] = [
  { tz: 'Asia/Tashkent', label: "O'zbekiston (UTC+5)" },
  { tz: 'Asia/Almaty', label: "Qozog'iston (UTC+5)" },
  { tz: 'Asia/Bishkek', label: "Qirg'iziston (UTC+6)" },
  { tz: 'Asia/Dushanbe', label: 'Tojikiston (UTC+5)' },
  { tz: 'Europe/Moscow', label: 'Moskva (UTC+3)' },
  { tz: 'Europe/Istanbul', label: 'Turkiya (UTC+3)' },
  { tz: 'Asia/Dubai', label: 'BAA (UTC+4)' },
  { tz: 'Asia/Seoul', label: 'Koreya (UTC+9)' },
  { tz: 'Europe/Berlin', label: 'Germaniya (CET)' },
  { tz: 'America/New_York', label: 'Nyu-York (ET)' },
];

export const DOSAGE_PRESETS = ['1 tabletka', '2 tabletka', '½ tabletka', '1 kapsula', '5 ml', '1 osh qoshiq'];
export const COURSE_DAY_PRESETS = [3, 5, 7, 10, 14, 30];
