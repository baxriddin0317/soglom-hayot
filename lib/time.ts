// Sana/vaqt yordamchilari. Server (Vercel) har doim UTC'da ishlaydi, foydalanuvchi esa o'z
// vaqt zonasida yashaydi — shuning uchun "bugun" va "08:00" doim foydalanuvchi zonasida
// hisoblanadi, bazaga esa aniq UTC nuqta (scheduledAt) yoziladi.
//
// Sanalar "YYYY-MM-DD", vaqtlar "HH:MM" satrlari ko'rinishida uzatiladi.

export const DEFAULT_TZ = 'Asia/Tashkent';
const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export function safeTimeZone(tz: string | null | undefined): string {
  return tz && isValidTimeZone(tz) ? tz : DEFAULT_TZ;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(instant: Date, tz: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(instant)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Berilgan lahzada zonadagi sana: "YYYY-MM-DD". */
export function dateIn(tz: string, instant: Date = new Date()): string {
  const p = zonedParts(instant, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Berilgan lahzada zonadagi vaqt: "HH:MM". */
export function timeIn(tz: string, instant: Date = new Date()): string {
  const p = zonedParts(instant, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

// Zonaning UTC'dan farqi (ms) — berilgan lahzada.
function offsetMs(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Zonadagi "sana + vaqt" -> aniq UTC lahza. Yozgi vaqtga o'tish kunlari ham to'g'ri hisoblanadi. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetMs(new Date(guess), tz);
  const second = guess - offsetMs(new Date(first), tz);
  return new Date(second);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** b - a (kunlarda). */
export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

/** Ikkala chegarani ham qo'shib hisoblangan kunlar soni. */
export function daysInclusive(start: string, end: string): number {
  return diffDays(start, end) + 1;
}

export function isDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Hafta kuni (0 = yakshanba) — sana satri bo'yicha. */
export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// ---------------------------------------------------------------------------
// Vaqtlarni kiritish
// ---------------------------------------------------------------------------

/** "8" / "8:5" / "08.30" / "0830" / "20-00" -> "HH:MM". Noto'g'ri bo'lsa null. */
export function normalizeTime(raw: string): string | null {
  const s = raw.trim();
  let h: number;
  let m: number;
  let match = /^(\d{1,2})(?:[:.\-,h ](\d{1,2}))?$/.exec(s);
  if (match) {
    h = Number(match[1]);
    m = match[2] === undefined ? 0 : Number(match[2]);
    if (match[2] !== undefined && match[2].length === 1) m *= 10; // "8:3" -> 08:30
  } else if ((match = /^(\d{2})(\d{2})$/.exec(s))) {
    h = Number(match[1]);
    m = Number(match[2]);
  } else {
    return null;
  }
  if (!Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

export const MAX_TIMES_PER_DAY = 8;

/**
 * Foydalanuvchi yozgan vaqtlar ro'yxati: "8:00 14:00 20:00", "8, 14, 20", "08.00;20.00".
 * Takrorlar olib tashlanadi, tartiblanadi. Birortasi noto'g'ri bo'lsa — null.
 */
export function parseTimes(text: string): string[] | null {
  const tokens = text
    .split(/[\s,;/|]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const out = new Set<string>();
  for (const token of tokens) {
    const t = normalizeTime(token);
    if (!t) return null;
    out.add(t);
  }
  const list = [...out].sort();
  return list.length > MAX_TIMES_PER_DAY ? null : list;
}

export function isTimeString(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Kuniga N marta uchun odatiy (tavsiya) vaqtlar — uyg'oq soatlar (08:00–22:00) bo'ylab teng taqsimlangan. */
export function suggestedTimes(perDay: number): string[] {
  const presets: Record<number, string[]> = {
    1: ['09:00'],
    2: ['08:00', '20:00'],
    3: ['08:00', '14:00', '20:00'],
    4: ['08:00', '12:00', '16:00', '20:00'],
  };
  if (presets[perDay]) return presets[perDay];
  const n = Math.max(1, Math.min(MAX_TIMES_PER_DAY, perDay));
  const start = 7 * 60;
  const end = 22 * 60;
  const step = (end - start) / (n - 1);
  return Array.from({ length: n }, (_, i) => {
    const total = Math.round((start + step * i) / 30) * 30;
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  });
}

// ---------------------------------------------------------------------------
// Ko'rsatish
// ---------------------------------------------------------------------------

const MONTHS = [
  'yanvar',
  'fevral',
  'mart',
  'aprel',
  'may',
  'iyun',
  'iyul',
  'avgust',
  'sentyabr',
  'oktyabr',
  'noyabr',
  'dekabr',
];
export const WEEKDAYS_SHORT = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];
const WEEKDAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];

/** "2026-09-24" -> "24-sentyabr" */
export function formatDayMonth(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d}-${MONTHS[m - 1]}`;
}

/** "2026-09-24" -> "24.09.2026" */
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}

/** "2026-09-24" -> "24.09" */
export function formatShort(date: string): string {
  const [, m, d] = date.split('-');
  return `${d}.${m}`;
}

export function weekdayName(date: string): string {
  return WEEKDAYS[weekday(date)];
}

/** Bugun / Ertaga / Kecha yoki "24-sentyabr". */
export function relativeDay(date: string, today: string): string {
  const diff = diffDays(today, date);
  if (diff === 0) return 'Bugun';
  if (diff === 1) return 'Ertaga';
  if (diff === -1) return 'Kecha';
  return formatDayMonth(date);
}

/** Kun so'zini to'g'ri shaklda: "7 kun". O'zbek tilida ko'plik qo'shimchasi kerak emas. */
export function daysLabel(n: number): string {
  return `${n} kun`;
}
