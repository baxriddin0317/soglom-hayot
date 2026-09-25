// Bot xabarlari matni va inline tugmalari. Faqat ko'rinish — baza bilan ishlamaydi,
// shuning uchun bu funksiyalar scheduler'da ham, handler'larda ham ishlatiladi.

import { Markup } from 'telegraf';
import type { InlineKeyboardButton } from 'telegraf/types';
import type { Medication, Prescription, User } from '@/lib/generated/prisma/client';
import {
  FOLLOW_UP_OPTIONS,
  LEAD_OPTIONS,
  MEAL_SHORT_KEY,
  STOCK_ADD_OPTIONS,
  TIMEZONE_OPTIONS,
  type Meal,
} from '@/lib/constants';
import { daysPatternText, qtyText, scheduleText } from '@/lib/format';
import { LANG_LABELS, LANGS, langOf, t, type Key, type Lang } from '@/lib/i18n';

export { daysPatternText, qtyText, scheduleText };
import type { AsNeededToday, DoseWithMedication } from '@/lib/services/doses';
import type { DoseCounts } from '@/lib/services/prescriptions';
import { adherencePercent, courseProgress } from '@/lib/services/prescriptions';
import type { UserStats } from '@/lib/services/stats';
import type { StockForecast, StockItem } from '@/lib/services/stock';
import { unitOf } from '@/lib/services/stock';
import type { AdminOverview } from '@/lib/services/admin';
import { agoText } from '@/lib/services/system';
import {
  addDays,
  dateIn,
  daysInclusive,
  formatDate,
  formatDayMonth,
  formatShort,
  relativeDay,
  timeIn,
  weekday,
  weekdayName,
  weekdayShort,
} from '@/lib/time';
import { appButtonRow, chunk } from '@/lib/bot/keyboards';
import { esc, short } from '@/lib/bot/telegram';

type Button = InlineKeyboardButton;
export interface View {
  text: string;
  extra: { parse_mode: 'HTML'; reply_markup?: { inline_keyboard: Button[][] } };
}

function view(text: string, rows: (Button[] | null)[] = []): View {
  const inline = rows.filter((r): r is Button[] => !!r && r.length > 0);
  return {
    text,
    extra: { parse_mode: 'HTML', ...(inline.length ? { reply_markup: Markup.inlineKeyboard(inline).reply_markup } : {}) },
  };
}

const cb = Markup.button.callback;

export const STATUS_ICON = { PENDING: '⏳', TAKEN: '✅', SKIPPED: '⏭', MISSED: '❌' } as const;

const days = (lang: Lang, n: number) => t(lang, 'common.days', { n });

// ---------------------------------------------------------------------------
// Umumiy bo'laklar
// ---------------------------------------------------------------------------

export function mealShort(meal: Meal | string, lang: Lang): string | null {
  const key = MEAL_SHORT_KEY[meal as Meal];
  return key ? t(lang, key) : null;
}

export function medLine(m: { name: string; dosage: string | null; meal: Meal | string }, lang: Lang): string {
  const meal = mealShort(m.meal, lang);
  return `<b>${esc(m.name)}</b>${m.dosage ? ` — ${esc(m.dosage)}` : ''}${meal ? ` · <i>${meal}</i>` : ''}`;
}

/** Zaxira prognozi bitta satrda: "✅ kurs oxirigacha yetadi" / "⚠️ 28-sentyabr gacha yetadi (3 kun)". */
export function forecastText(f: StockForecast, lang: Lang): string {
  if (f.stock <= 1e-6) return t(lang, 'stock.out');
  if (f.enough) return t(lang, 'stock.enough');
  if (f.runOutDate === null || !f.daysLeft) return t(lang, 'stock.runsOutToday');
  return t(lang, 'stock.runsOut', { date: formatDayMonth(f.runOutDate, lang), days: days(lang, f.daysLeft) });
}

function percentText(p: number | null): string {
  return p === null ? '—' : `${p}%`;
}

function bar(value: number, total: number, width = 10): string {
  if (total <= 0) return '░'.repeat(width);
  const filled = Math.round((value / total) * width);
  return '▓'.repeat(filled) + '░'.repeat(width - filled);
}

const isOpen = (s: string) => s === 'PENDING' || s === 'MISSED';

// ---------------------------------------------------------------------------
// Til tanlash
// ---------------------------------------------------------------------------

export function languageView(current: string | null, lang: Lang, { first = false } = {}): View {
  const title = first ? t(lang, 'start.pickLang') : t(lang, 'set.langTitle');
  return view(
    title,
    LANGS.map((l) => [cb(`${l === current ? '• ' : ''}${LANG_LABELS[l]}`, `lang:${l}${first ? ':1' : ''}`)])
  );
}

// ---------------------------------------------------------------------------
// Eslatma
// ---------------------------------------------------------------------------

function stockSuffix(m: DoseWithMedication['medication'], lang: Lang): string {
  if (m.stock === null) return '';
  if (m.stock <= 1e-6) return ` · <i>${t(lang, 'rem.stockOut')}</i>`;
  return ` · <i>${t(lang, 'rem.stockLeft', { qty: qtyText(m.stock, unitOf(m), lang) })}</i>`;
}

export function reminderView(
  doses: DoseWithMedication[],
  { now, timezone, lang, followUp = false }: { now: Date; timezone: string; lang: Lang; followUp?: boolean }
): View {
  const first = doses[0];
  const open = doses.filter((d) => isOpen(d.status));
  const today = dateIn(timezone, now);
  const when = first.date === today ? first.time : `${formatShort(first.date)} ${first.time}`;
  const minutesLeft = Math.round((first.scheduledAt.getTime() - now.getTime()) / 60_000);

  let header: string;
  if (open.length === 0) header = t(lang, 'rem.allDone', { when });
  else if (followUp) header = t(lang, 'rem.followUp', { when });
  else if (minutesLeft >= 1) header = t(lang, 'rem.soon', { n: minutesLeft, when });
  else header = t(lang, 'rem.now', { when });

  const lines = doses.map((d) => {
    const status = d.status === 'PENDING' ? '' : ` — <i>${t(lang, `status.${d.status}` as Key)}</i>`;
    const icon = d.status === 'PENDING' ? '💊' : STATUS_ICON[d.status];
    return `${icon} ${medLine(d.medication, lang)}${status}${stockSuffix(d.medication, lang)}`;
  });

  const footer = open.length === 0 ? t(lang, 'rem.thanks') : t(lang, 'rem.hint');

  const rows: Button[][] = [];
  if (open.length === 1 && doses.length === 1) {
    const late = open[0].status === 'MISSED';
    rows.push([cb(t(lang, late ? 'rem.takeLate' : 'rem.take'), `r:t:${open[0].id}`)]);
    rows.push([cb(t(lang, 'rem.skip'), `r:s:${open[0].id}`)]);
  } else {
    for (const d of open) {
      rows.push([cb(`✅ ${short(d.medication.name, 26)}`, `r:t:${d.id}`), cb('⏭', `r:s:${d.id}`)]);
    }
    if (open.length > 1) rows.push([cb(t(lang, 'rem.all'), `r:a:${open[0].id}`)]);
  }

  return view(`${header}\n\n${lines.join('\n')}\n\n${footer}`, rows);
}

// ---------------------------------------------------------------------------
// Kun rejasi
// ---------------------------------------------------------------------------

// "Ichdim" tugmasi faqat vaqti yaqinlashgan / o'tgan dozalar uchun chiqadi.
const EARLY_TAKE_MS = 2 * 60 * 60_000;

export function dayView(
  allDoses: DoseWithMedication[],
  date: string,
  { now, timezone, lang, asNeeded = [] }: { now: Date; timezone: string; lang: Lang; asNeeded?: AsNeededToday[] }
): View {
  const today = dateIn(timezone, now);
  const doses = allDoses.filter((d) => !d.medication.asNeeded);
  const title = t(lang, 'day.title', {
    rel: relativeDay(date, today, lang),
    date: formatDate(date),
    weekday: weekdayName(date, lang),
  });

  const nav = [
    cb(`◀️ ${formatShort(addDays(date, -1))}`, `day:${addDays(date, -1)}`),
    ...(date === today ? [] : [cb(t(lang, 'day.today'), `day:${today}`)]),
    cb(`${formatShort(addDays(date, 1))} ▶️`, `day:${addDays(date, 1)}`),
  ];

  // "Kerak bo'lganda" dorilari — faqat bugun uchun, belgilash tugmasi bilan.
  const prn = date === today ? asNeeded : [];
  const prnBlock = prn.length
    ? `\n\n${t(lang, 'day.prnTitle')}\n${prn.map((m) => `   💊 ${t(lang, 'day.prnLine', { name: esc(m.name), n: m.countToday })}`).join('\n')}`
    : '';
  const prnRows: Button[][] = prn.map((m) => [cb(t(lang, 'day.prnButton', { name: short(m.name, 22) }), `n:${m.id}`)]);

  if (doses.length === 0) {
    const empty =
      date >= today ? t(lang, 'day.emptyFuture', { add: t(lang, 'menu.add') }) : t(lang, 'day.emptyPast');
    return view(`${title}\n\n${empty}${prnBlock}`, [...prnRows, nav, appButtonRow(lang)]);
  }

  const byTime = new Map<string, DoseWithMedication[]>();
  for (const d of doses) byTime.set(d.time, [...(byTime.get(d.time) ?? []), d]);

  const blocks: string[] = [];
  for (const [time, list] of byTime) {
    const items = list.map((d) => `   ${STATUS_ICON[d.status]} ${medLine(d.medication, lang)}`);
    blocks.push(`🕐 <b>${time}</b>\n${items.join('\n')}`);
  }

  const taken = doses.filter((d) => d.status === 'TAKEN').length;
  const summary = `${t(lang, 'day.summary', { taken, total: doses.length })} ${bar(taken, doses.length)}`;

  const actionable =
    date <= today
      ? doses.filter((d) => isOpen(d.status) && d.scheduledAt.getTime() <= now.getTime() + EARLY_TAKE_MS)
      : [];
  const rows: Button[][] = actionable
    .slice(0, 12)
    .map((d) => [cb(`✅ ${d.time} · ${short(d.medication.name, 22)}`, `d:t:${d.id}`), cb('⏭', `d:s:${d.id}`)]);

  const hint = actionable.length ? `\n\n${t(lang, 'day.hint')}` : '';
  return view(`${title}\n\n${blocks.join('\n\n')}\n\n${summary}${prnBlock}${hint}`, [
    ...rows,
    ...prnRows,
    nav,
    appButtonRow(lang),
  ]);
}

// ---------------------------------------------------------------------------
// Retseptlar
// ---------------------------------------------------------------------------

type PrescriptionItem = Prescription & { medications: Medication[] };

export function prescriptionListView(
  active: PrescriptionItem[],
  finishedCount: number,
  { today, counts, lang }: { today: string; counts: Map<string, DoseCounts>; lang: Lang }
): View {
  const historyBtn = finishedCount ? cb(t(lang, 'rx.historyBtn', { n: finishedCount }), 'rx:h') : null;
  if (active.length === 0) {
    return view(t(lang, 'rx.noneTitle'), [
      [cb(t(lang, 'menu.add'), 'add')],
      historyBtn ? [historyBtn] : null,
      appButtonRow(lang, '?tab=rx'),
    ]);
  }

  const lines = active.map((p, i) => {
    const { day, total } = courseProgress(p, today);
    const pct = adherencePercent(counts.get(p.id) ?? { taken: 0, skipped: 0, missed: 0 });
    const status =
      day === 0 ? t(lang, 'rx.startsOn', { date: formatShort(p.startDate) }) : t(lang, 'rx.dayOf', { day, total });
    const meds = t(lang, 'rx.medsCount', { n: p.medications.length });
    return `${i + 1}. <b>${esc(p.title)}</b> — ${status} · ${meds}${pct === null ? '' : ` · ${pct}%`}`;
  });

  const rows: (Button[] | null)[] = active.map((p) => [cb(`📋 ${short(p.title, 30)}`, `rx:v:${p.id}`)]);
  rows.push([cb(t(lang, 'menu.add'), 'add'), ...(historyBtn ? [historyBtn] : [])]);
  rows.push(appButtonRow(lang, '?tab=rx'));
  return view(`${t(lang, 'rx.listTitle')}\n\n${lines.join('\n')}\n\n${t(lang, 'rx.listHint')}`, rows);
}

export function historyView(finished: PrescriptionItem[], counts: Map<string, DoseCounts>, lang: Lang): View {
  const back = [[cb(t(lang, 'common.back'), 'rx:l')]];
  if (finished.length === 0) {
    return view(`${t(lang, 'rx.historyTitle')}\n\n${t(lang, 'rx.historyEmpty')}`, back);
  }
  const lines = finished.map((p, i) => {
    const pct = adherencePercent(counts.get(p.id) ?? { taken: 0, skipped: 0, missed: 0 });
    const meds = p.medications.map((m) => esc(m.name)).join(', ');
    return (
      `${i + 1}. <b>${esc(p.title)}</b> — ${days(lang, daysInclusive(p.startDate, p.endDate))} ` +
      `(${formatDate(p.startDate)} – ${formatDate(p.endDate)})` +
      `${pct === null ? '' : ` · ${t(lang, 'rx.adherenceShort', { pct })}`}\n    💊 ${meds || '—'}`
    );
  });
  const rows: Button[][] = finished.slice(0, 10).map((p) => [cb(`🧾 ${short(p.title, 30)}`, `rx:v:${p.id}`)]);
  rows.push(...back);
  return view(`${t(lang, 'rx.historyTitle')}\n\n${lines.join('\n\n')}`, rows);
}

export function medDetails(m: Medication, courseEnd: string, lang: Lang): string {
  const meal = mealShort(m.meal, lang);
  const parts = m.asNeeded ? [scheduleText(m, lang)] : [`⏰ ${m.times.join(', ')}`];
  const pattern = m.asNeeded ? null : daysPatternText(m, lang);
  if (pattern) parts.push(pattern);
  if (meal) parts.push(meal);
  if (m.endDate !== courseEnd) {
    parts.push(
      t(lang, 'med.untilDate', { days: days(lang, daysInclusive(m.startDate, m.endDate)), date: formatShort(m.endDate) })
    );
  }
  if (m.stock !== null) parts.push(`📦 ${qtyText(m.stock, unitOf(m), lang)}`);
  if (!m.isActive) parts.push(`<i>${t(lang, 'med.stopped')}</i>`);
  return parts.join(' · ');
}

export function prescriptionView(p: PrescriptionItem, counts: DoseCounts, { today, lang }: { today: string; lang: Lang }): View {
  const { day, total } = courseProgress(p, today);
  const active = p.status === 'ACTIVE';
  const lines = [`📋 <b>${esc(p.title)}</b>`];
  if (p.doctor) lines.push(`👨‍⚕️ ${esc(p.doctor)}`);
  const progress = !active
    ? t(lang, 'rx.finished')
    : day === 0
      ? t(lang, 'rx.notStarted')
      : t(lang, 'rx.dayOf', { day, total });
  lines.push(`📅 ${formatDate(p.startDate)} – ${formatDate(p.endDate)} · ${progress}`);
  const pct = adherencePercent(counts);
  if (pct !== null) lines.push(t(lang, 'rx.adherence', { pct, n: counts.taken }));
  if (p.notes) lines.push(`📝 ${esc(p.notes)}`);

  lines.push('', t(lang, 'rx.meds'));
  p.medications.forEach((m, i) => {
    lines.push(`${i + 1}. ${medLine(m, lang)}`, `    ${medDetails(m, p.endDate, lang)}`);
  });

  const rows: (Button[] | null)[] = [];
  if (active) {
    rows.push(
      ...chunk(
        p.medications.filter((m) => m.isActive).map((m) => cb(`💊 ${short(m.name, 20)}`, `m:v:${m.id}`)),
        2
      )
    );
    rows.push([cb(t(lang, 'rx.changeDays'), `rx:d:${p.id}`)]);
    rows.push([cb(t(lang, 'rx.finish'), `rx:f:${p.id}`), cb(t(lang, 'rx.delete'), `rx:x:${p.id}`)]);
    rows.push([cb(t(lang, 'rx.toList'), 'rx:l')]);
  } else {
    rows.push([cb(t(lang, 'rx.delete'), `rx:x:${p.id}`), cb(t(lang, 'rx.toHistory'), 'rx:h')]);
  }
  return view(lines.join('\n'), rows);
}

export function confirmView(text: string, yes: { label: string; data: string }, noData: string, lang: Lang): View {
  return view(text, [[cb(yes.label, yes.data), cb(t(lang, 'common.no'), noData)]]);
}

export function medicationView(m: Medication, p: Prescription, lang: Lang): View {
  const lines = [`💊 ${medLine(m, lang)}`, t(lang, 'med.prescription', { title: esc(p.title) })];
  if (m.asNeeded) lines.push(t(lang, 'med.schedule', { freq: scheduleText(m, lang) }));
  else lines.push(t(lang, 'med.times', { times: m.times.join(', '), freq: scheduleText(m, lang) }));
  lines.push(
    t(lang, 'med.range', {
      from: formatDate(m.startDate),
      to: formatDate(m.endDate),
      days: days(lang, daysInclusive(m.startDate, m.endDate)),
    })
  );
  if (m.stock !== null) lines.push(`📦 ${t(lang, 'stock.left', { qty: qtyText(m.stock, unitOf(m), lang) })}`);
  if (!m.isActive) lines.push(t(lang, 'med.stoppedLine'));

  const rows: Button[][] = [];
  if (m.isActive && p.status === 'ACTIVE') {
    if (m.asNeeded) rows.push([cb(t(lang, 'med.prnTake'), `nm:${m.id}`)]);
    else rows.push([cb(t(lang, 'med.changeTimes'), `m:t:${m.id}`)]);
    rows.push([cb(t(lang, 'med.stockBtn'), `st:v:${m.id}`), cb(t(lang, 'med.stop'), `m:s:${m.id}`)]);
  }
  rows.push([cb(t(lang, 'med.toRx'), `rx:v:${p.id}`)]);
  return view(lines.join('\n'), rows);
}

// ---------------------------------------------------------------------------
// Zaxira
// ---------------------------------------------------------------------------

function stockItemLine(item: StockItem, lang: Lang): string {
  const m = item.medication;
  const icon = !item.forecast ? '▫️' : item.low || item.forecast.stock <= 1e-6 ? '🔴' : item.forecast.enough ? '🟢' : '🟡';
  if (!item.forecast) return `${icon} <b>${esc(m.name)}</b> — <i>${t(lang, 'stock.untracked')}</i>`;
  const f = item.forecast;
  const qty = t(lang, 'stock.left', { qty: qtyText(f.stock, f.unit, lang) });
  const status = m.asNeeded ? t(lang, 'freq.asNeeded') : forecastText(f, lang);
  return `${icon} <b>${esc(m.name)}</b> — ${qty}\n      ${status}`;
}

export function stockListView(items: StockItem[], lang: Lang): View {
  if (items.length === 0) {
    return view(`${t(lang, 'stock.title')}\n\n${t(lang, 'stock.empty')}`, [[cb(t(lang, 'menu.add'), 'add')]]);
  }
  const lines = items.map((i) => stockItemLine(i, lang));
  const rows: (Button[] | null)[] = chunk(
    items.map((i) => cb(`📦 ${short(i.medication.name, 20)}`, `st:v:${i.medication.id}`)),
    2
  );
  rows.push(appButtonRow(lang, '?tab=stock'));
  return view(`${t(lang, 'stock.title')}\n\n${lines.join('\n')}\n\n${t(lang, 'stock.hint')}`, rows);
}

export function stockMedView(item: StockItem, lang: Lang): View {
  const m = item.medication;
  const unit = unitOf(m);
  const lines = [t(lang, 'stock.medTitle', { name: esc(m.name) }), `📋 ${esc(m.prescription.title)}`, ''];
  if (item.forecast) {
    const f = item.forecast;
    lines.push(`📦 ${t(lang, 'stock.left', { qty: qtyText(f.stock, unit, lang) })}`);
    if (!m.asNeeded) {
      lines.push(forecastText(f, lang));
      if (!f.enough && f.need > 0) lines.push(t(lang, 'stock.need', { qty: qtyText(f.need, unit, lang) }));
    }
    lines.push(`💊 ${t(lang, 'stock.perDose', { qty: qtyText(m.unitsPerDose, unit, lang) })}`);
  } else {
    lines.push(t(lang, 'stock.notTracked'));
  }

  const rows: Button[][] = [
    STOCK_ADD_OPTIONS.map((n) => cb(`+${n}`, `st:a:${m.id}:${n}`)),
    [cb(t(lang, 'stock.setExact'), `st:e:${m.id}`)],
  ];
  if (item.forecast) rows.push([cb(t(lang, 'stock.disable'), `st:x:${m.id}`)]);
  rows.push([cb(t(lang, 'stock.toList'), 'st:l')]);
  return view(lines.join('\n'), rows);
}

/** Cron: zaxira tugayotgani haqida ogohlantirish. */
export function lowStockView(
  m: Pick<Medication, 'id' | 'name' | 'asNeeded' | 'stockUnit' | 'dosage'>,
  f: StockForecast,
  lang: Lang
): View {
  const unit = unitOf(m);
  const qty = qtyText(f.stock, unit, lang);
  const text = m.asNeeded
    ? t(lang, 'stock.lowPrn', { name: esc(m.name), qty })
    : t(lang, 'stock.low', {
        name: esc(m.name),
        qty,
        forecast: forecastText(f, lang),
        need: f.need > 0 ? `\n${t(lang, 'stock.need', { qty: qtyText(f.need, unit, lang) })}` : '',
      });
  return view(text, [
    STOCK_ADD_OPTIONS.slice(0, 3).map((n) => cb(`+${n}`, `st:a:${m.id}:${n}`)),
    [cb(t(lang, 'stock.setExact'), `st:e:${m.id}`)],
  ]);
}

// ---------------------------------------------------------------------------
// Hisobot
// ---------------------------------------------------------------------------

export function reportView(stats: UserStats, period: 7 | 30, lang: Lang): View {
  const label = days(lang, period);
  const tabs = [
    cb(period === 7 ? `• ${days(lang, 7)} •` : days(lang, 7), 'rep:7'),
    cb(period === 30 ? `• ${days(lang, 30)} •` : days(lang, 30), 'rep:30'),
  ];
  const title = t(lang, 'rep.title', { period: label });
  const tt = stats.totals;
  if (tt.total === 0) {
    return view(`${title}\n\n${t(lang, 'rep.empty')}`, [tabs, appButtonRow(lang, '?tab=stats')]);
  }

  const lines = [
    title,
    `${formatDate(stats.from)} – ${formatDate(stats.to)}`,
    '',
    `${t(lang, 'rep.adherence', { pct: percentText(stats.percent) })} ${bar(tt.taken, tt.taken + tt.skipped + tt.missed)}`,
    t(lang, 'rep.counts', { taken: tt.taken, skipped: tt.skipped, missed: tt.missed }),
  ];
  if (tt.pending) lines.push(t(lang, 'rep.pending', { n: tt.pending }));
  lines.push(t(lang, 'rep.streak', { n: stats.streak }));

  if (period === 7) {
    lines.push('', t(lang, 'rep.byDay'));
    for (const d of stats.days) {
      const dayLabel = `${weekdayShort(weekday(d.date), lang)} ${formatShort(d.date)}`;
      lines.push(d.total ? `<code>${dayLabel}</code> ${bar(d.taken, d.total, 8)} ${d.taken}/${d.total}` : `<code>${dayLabel}</code> —`);
    }
  }

  if (stats.medications.length) {
    lines.push('', t(lang, 'rep.byMed'));
    for (const m of stats.medications.slice(0, 10)) {
      lines.push(`• ${esc(m.name)} — ${percentText(m.percent)} (${m.taken}/${m.resolved})`);
    }
  }

  if (stats.percent !== null && stats.percent < 80) lines.push('', t(lang, 'rep.tip'));

  return view(lines.join('\n'), [tabs, appButtonRow(lang, '?tab=stats')]);
}

// ---------------------------------------------------------------------------
// Sozlamalar
// ---------------------------------------------------------------------------

export function leadText(n: number, lang: Lang): string {
  return n === 0 ? t(lang, 'set.leadOnTime') : t(lang, 'set.leadMin', { n });
}

export function followUpText(n: number, lang: Lang): string {
  return n === 0 ? t(lang, 'set.off') : t(lang, 'set.fuMin', { n });
}

export function settingsView(user: User, now = new Date()): View {
  const lang = langOf(user);
  const lines = [
    t(lang, 'set.title'),
    '',
    t(lang, 'set.reminders', { v: t(lang, user.remindersEnabled ? 'set.on' : 'set.off') }),
    t(lang, 'set.lead', { v: leadText(user.leadMinutes, lang) }),
    t(lang, 'set.followUp', { v: followUpText(user.followUpMinutes, lang) }),
    t(lang, 'set.tz', { tz: esc(user.timezone), time: timeIn(user.timezone, now) }),
    t(lang, 'set.lang', { lang: LANG_LABELS[lang] }),
  ];
  return view(lines.join('\n'), [
    [cb(t(lang, user.remindersEnabled ? 'set.turnOff' : 'set.turnOn'), 'set:rem')],
    [cb(t(lang, 'set.leadBtn'), 'set:lead'), cb(t(lang, 'set.followUpBtn'), 'set:fu')],
    [cb(t(lang, 'set.tzBtn'), 'set:tz'), cb(t(lang, 'set.langBtn'), 'set:lang')],
  ]);
}

export function leadOptionsView(current: number, lang: Lang): View {
  return view(t(lang, 'set.leadTitle'), [
    ...chunk(
      LEAD_OPTIONS.map((n) => cb(`${n === current ? '• ' : ''}${leadText(n, lang)}`, `set:lead:${n}`)),
      2
    ),
    [cb(t(lang, 'common.back'), 'set:back')],
  ]);
}

export function followUpOptionsView(current: number, lang: Lang): View {
  return view(t(lang, 'set.fuTitle'), [
    ...chunk(
      FOLLOW_UP_OPTIONS.map((n) => cb(`${n === current ? '• ' : ''}${followUpText(n, lang)}`, `set:fu:${n}`)),
      2
    ),
    [cb(t(lang, 'common.back'), 'set:back')],
  ]);
}

export function timezoneOptionsView(current: string, lang: Lang): View {
  return view(t(lang, 'set.tzTitle'), [
    ...chunk(
      TIMEZONE_OPTIONS.map((o, i) => cb(`${o.tz === current ? '• ' : ''}${t(lang, o.key)}`, `set:tz:${i}`)),
      2
    ),
    [cb(t(lang, 'set.tzOther'), 'set:tz:custom'), cb(t(lang, 'common.back'), 'set:back')],
  ]);
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export function adminView(o: AdminOverview, lang: Lang, now = new Date()): View {
  const u = o.users;
  const pct = (p: number | null) => (p === null ? '—' : `${p}%`);
  const langList = o.languages
    .map((l) => `${l.language && (LANGS as string[]).includes(l.language) ? LANG_LABELS[l.language as Lang] : '🌐 auto'} ${l.count}`)
    .join(' · ');

  let cron: string;
  if (!o.cron.lastRunAt) cron = t(lang, 'admin.cronNever');
  else if (o.cron.stale) cron = t(lang, 'admin.cronStale', { ago: agoText(o.cron.lagMs ?? 0, lang) });
  else cron = t(lang, 'admin.cronOk', { ago: agoText(o.cron.lagMs ?? 0, lang) });

  const lines = [
    t(lang, 'admin.title'),
    '',
    t(lang, 'admin.users', { total: u.total, blocked: u.blocked }),
    t(lang, 'admin.new', { today: u.newToday, d7: u.new7, d30: u.new30 }),
    t(lang, 'admin.active', { today: u.activeToday, d7: u.active7, d30: u.active30 }),
    t(lang, 'admin.withRx', { users: u.withActiveRx, rx: o.activePrescriptions }),
    t(lang, 'admin.reminders', { n: o.remindersToday }),
    t(lang, 'admin.adherence', { pct: pct(o.adherence7) }),
    t(lang, 'admin.retention', { pct: pct(o.retentionD7) }),
    t(lang, 'admin.langs', { list: langList || '—' }),
    '',
    t(lang, 'admin.cron', { status: cron }),
  ];
  if (o.cron.lastError && o.cron.lastErrorAt) {
    const ago = agoText(now.getTime() - new Date(o.cron.lastErrorAt).getTime(), lang);
    lines.push(`${t(lang, 'admin.cronError', { error: esc(o.cron.lastError.slice(0, 120)) })} (${ago})`);
  }
  if (o.webhook) {
    lines.push(t(lang, 'admin.webhook', { n: o.webhook.pending }));
    if (o.webhook.lastError) lines.push(t(lang, 'admin.webhookError', { error: esc(o.webhook.lastError.slice(0, 120)) }));
  }

  return view(lines.join('\n'), [
    [cb(t(lang, 'admin.refresh'), 'adm:r')],
    appButtonRow(lang, '?tab=admin'),
    [cb(t(lang, 'admin.toUser'), 'adm:u')],
  ]);
}
