// Bot va Mini App uchun umumiy matn bo'laklari (brauzerga ham tushadi — server kodi yo'q).

import type { StockUnit } from '@/lib/constants';
import { t, type Key, type Lang } from '@/lib/i18n';
import { formatQty, weekdaysText } from '@/lib/time';

/** "20 tabletka" / "2,5 мл" */
export function qtyText(qty: number, unit: StockUnit, lang: Lang): string {
  return t(lang, `unit.${unit}` as Key, { n: formatQty(qty) });
}

/** Qaysi kunlari: "Du, Ch, Ju" / "kun ora" / "har 3 kunda". Har kuni bo'lsa — null. */
export function daysPatternText(m: { everyDays: number; weekdays: number[] }, lang: Lang): string | null {
  if (m.weekdays.length > 0) return weekdaysText(m.weekdays, lang);
  if (m.everyDays === 2) return t(lang, 'freq.everyOther');
  if (m.everyDays > 2) return t(lang, 'freq.everyN', { n: m.everyDays });
  return null;
}

export interface ScheduleLike {
  times: string[];
  everyDays: number;
  weekdays: number[];
  asNeeded: boolean;
  maxPerDay: number | null;
}

/** "kuniga 2 marta · kun ora" / "kerak bo'lganda, kuniga ko'pi bilan 3 marta" */
export function scheduleText(m: ScheduleLike, lang: Lang): string {
  if (m.asNeeded) {
    return m.maxPerDay ? t(lang, 'freq.asNeededMax', { n: m.maxPerDay }) : t(lang, 'freq.asNeeded');
  }
  return [t(lang, 'freq.perDay', { n: m.times.length }), daysPatternText(m, lang)].filter(Boolean).join(' · ');
}
