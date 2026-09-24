// Bot xabarlari matni va inline tugmalari. Faqat ko'rinish — baza bilan ishlamaydi,
// shuning uchun bu funksiyalar scheduler'da ham, handler'larda ham ishlatiladi.

import { Markup } from 'telegraf';
import type { InlineKeyboardButton } from 'telegraf/types';
import type { Medication, Prescription, User } from '@/lib/generated/prisma/client';
import { FOLLOW_UP_OPTIONS, LEAD_OPTIONS, MEAL_SHORT, TIMEZONE_OPTIONS, type Meal } from '@/lib/constants';
import type { DoseWithMedication } from '@/lib/services/doses';
import type { DoseCounts } from '@/lib/services/prescriptions';
import { adherencePercent, courseProgress } from '@/lib/services/prescriptions';
import type { UserStats } from '@/lib/services/stats';
import {
  addDays,
  dateIn,
  daysInclusive,
  formatDate,
  formatShort,
  relativeDay,
  timeIn,
  weekday,
  weekdayName,
  WEEKDAYS_SHORT,
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
const STATUS_TEXT = { PENDING: '', TAKEN: 'ichildi', SKIPPED: "o'tkazildi", MISSED: 'belgilanmadi' } as const;

export function medLine(m: { name: string; dosage: string | null; meal: Meal | string }): string {
  const meal = MEAL_SHORT[m.meal as Meal];
  return `<b>${esc(m.name)}</b>${m.dosage ? ` — ${esc(m.dosage)}` : ''}${meal ? ` · <i>${meal}</i>` : ''}`;
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
// Eslatma
// ---------------------------------------------------------------------------

export function reminderView(
  doses: DoseWithMedication[],
  { now, timezone, followUp = false }: { now: Date; timezone: string; followUp?: boolean }
): View {
  const first = doses[0];
  const open = doses.filter((d) => isOpen(d.status));
  const today = dateIn(timezone, now);
  const when = first.date === today ? first.time : `${formatShort(first.date)} ${first.time}`;
  const minutesLeft = Math.round((first.scheduledAt.getTime() - now.getTime()) / 60_000);

  let header: string;
  if (open.length === 0) header = `✅ <b>${when}</b> dagi dorilar belgilandi`;
  else if (followUp) header = `🔔 <b>Eslatma:</b> ${when} dagi dori hali belgilanmagan`;
  else if (minutesLeft >= 1) header = `⏰ <b>${minutesLeft} daqiqadan so'ng</b> dori ichish vaqti — ${when}`;
  else header = `⏰ <b>Dori ichish vaqti — ${when}</b>`;

  const lines = doses.map((d) => {
    const status = d.status === 'PENDING' ? '' : ` — <i>${STATUS_TEXT[d.status]}</i>`;
    return `${d.status === 'PENDING' ? '💊' : STATUS_ICON[d.status]} ${medLine(d.medication)}${status}`;
  });

  const footer =
    open.length === 0 ? "Rahmat! Sog'ayib keting 🌿" : "Dorini ichganingizdan so'ng belgilang 👇";

  const rows: Button[][] = [];
  if (open.length === 1 && doses.length === 1) {
    const late = open[0].status === 'MISSED';
    rows.push([cb(late ? '✅ Ichgan edim' : '✅ Ichdim', `r:t:${open[0].id}`)]);
    rows.push([cb("⏭ O'tkazib yubordim", `r:s:${open[0].id}`)]);
  } else {
    for (const d of open) {
      rows.push([cb(`✅ ${short(d.medication.name, 26)}`, `r:t:${d.id}`), cb('⏭', `r:s:${d.id}`)]);
    }
    if (open.length > 1) rows.push([cb('✅ Hammasini ichdim', `r:a:${open[0].id}`)]);
  }

  return view(`${header}\n\n${lines.join('\n')}\n\n${footer}`, rows);
}

// ---------------------------------------------------------------------------
// Kun rejasi
// ---------------------------------------------------------------------------

// "Ichdim" tugmasi faqat vaqti yaqinlashgan / o'tgan dozalar uchun chiqadi.
const EARLY_TAKE_MS = 2 * 60 * 60_000;

export function dayView(doses: DoseWithMedication[], date: string, { now, timezone }: { now: Date; timezone: string }): View {
  const today = dateIn(timezone, now);
  const title = `📅 <b>${relativeDay(date, today)}</b>, ${formatDate(date)} (${weekdayName(date)})`;

  const nav = [
    cb(`◀️ ${formatShort(addDays(date, -1))}`, `day:${addDays(date, -1)}`),
    ...(date === today ? [] : [cb('Bugun', `day:${today}`)]),
    cb(`${formatShort(addDays(date, 1))} ▶️`, `day:${addDays(date, 1)}`),
  ];

  if (doses.length === 0) {
    const text =
      date >= today
        ? `${title}\n\nBu kunga dori rejalashtirilmagan.\n\nYangi retsept qo'shish uchun "➕ Yangi retsept" tugmasini bosing.`
        : `${title}\n\nBu kunda dori bo'lmagan.`;
    return view(text, [nav, appButtonRow()]);
  }

  const byTime = new Map<string, DoseWithMedication[]>();
  for (const d of doses) byTime.set(d.time, [...(byTime.get(d.time) ?? []), d]);

  const blocks: string[] = [];
  for (const [time, list] of byTime) {
    const items = list.map((d) => `   ${STATUS_ICON[d.status]} ${medLine(d.medication)}`);
    blocks.push(`🕐 <b>${time}</b>\n${items.join('\n')}`);
  }

  const taken = doses.filter((d) => d.status === 'TAKEN').length;
  const summary = `Ichildi: <b>${taken} / ${doses.length}</b> ${bar(taken, doses.length)}`;

  const actionable =
    date <= today
      ? doses.filter((d) => isOpen(d.status) && d.scheduledAt.getTime() <= now.getTime() + EARLY_TAKE_MS)
      : [];
  const rows: Button[][] = actionable
    .slice(0, 12)
    .map((d) => [cb(`✅ ${d.time} · ${short(d.medication.name, 22)}`, `d:t:${d.id}`), cb('⏭', `d:s:${d.id}`)]);

  const hint = actionable.length ? '\n\nIchgan dorilaringizni belgilang 👇' : '';
  return view(`${title}\n\n${blocks.join('\n\n')}\n\n${summary}${hint}`, [...rows, nav, appButtonRow()]);
}

// ---------------------------------------------------------------------------
// Retseptlar
// ---------------------------------------------------------------------------

type PrescriptionItem = Prescription & { medications: Medication[] };

export function prescriptionListView(
  active: PrescriptionItem[],
  finishedCount: number,
  { today, counts }: { today: string; counts: Map<string, DoseCounts> }
): View {
  if (active.length === 0) {
    const text =
      "📋 <b>Faol retseptlar yo'q</b>\n\nShifokor yozib bergan retseptni kiriting — men dori ichish vaqtini har safar eslatib turaman.";
    return view(text, [
      [cb('➕ Yangi retsept', 'add')],
      finishedCount ? [cb(`🧾 Tarix (${finishedCount})`, 'rx:h')] : null,
      appButtonRow('?tab=rx'),
    ]);
  }

  const lines = active.map((p, i) => {
    const { day, total } = courseProgress(p, today);
    const pct = adherencePercent(counts.get(p.id) ?? { taken: 0, skipped: 0, missed: 0 });
    const status = day === 0 ? `${formatShort(p.startDate)} dan boshlanadi` : `${day}/${total}-kun`;
    return `${i + 1}. <b>${esc(p.title)}</b> — ${status} · ${p.medications.length} ta dori${pct === null ? '' : ` · ${pct}%`}`;
  });

  const rows: (Button[] | null)[] = active.map((p) => [cb(`📋 ${short(p.title, 30)}`, `rx:v:${p.id}`)]);
  rows.push([cb('➕ Yangi retsept', 'add'), ...(finishedCount ? [cb(`🧾 Tarix (${finishedCount})`, 'rx:h')] : [])]);
  rows.push(appButtonRow('?tab=rx'));
  return view(`📋 <b>Faol retseptlar</b>\n\n${lines.join('\n')}\n\nBatafsil ko'rish uchun retseptni tanlang 👇`, rows);
}

export function historyView(finished: PrescriptionItem[], counts: Map<string, DoseCounts>): View {
  if (finished.length === 0) {
    return view("🧾 <b>Davolanish tarixi</b>\n\nHozircha yakunlangan retsept yo'q.", [[cb('◀️ Orqaga', 'rx:l')]]);
  }
  const lines = finished.map((p, i) => {
    const pct = adherencePercent(counts.get(p.id) ?? { taken: 0, skipped: 0, missed: 0 });
    const meds = p.medications.map((m) => esc(m.name)).join(', ');
    return (
      `${i + 1}. <b>${esc(p.title)}</b> — ${daysInclusive(p.startDate, p.endDate)} kun ` +
      `(${formatDate(p.startDate)} – ${formatDate(p.endDate)})` +
      `${pct === null ? '' : ` · rioya ${pct}%`}\n    💊 ${meds || '—'}`
    );
  });
  const rows: Button[][] = finished.slice(0, 10).map((p) => [cb(`🧾 ${short(p.title, 30)}`, `rx:v:${p.id}`)]);
  rows.push([cb('◀️ Orqaga', 'rx:l')]);
  return view(`🧾 <b>Davolanish tarixi</b>\n\n${lines.join('\n\n')}`, rows);
}

export function medDetails(m: Medication, courseEnd: string): string {
  const meal = MEAL_SHORT[m.meal as Meal];
  const parts = [`⏰ ${m.times.join(', ')}`];
  if (meal) parts.push(meal);
  if (m.endDate !== courseEnd) parts.push(`${daysInclusive(m.startDate, m.endDate)} kun (${formatShort(m.endDate)} gacha)`);
  if (!m.isActive) parts.push("<i>to'xtatilgan</i>");
  return parts.join(' · ');
}

export function prescriptionView(p: PrescriptionItem, counts: DoseCounts, { today }: { today: string }): View {
  const { day, total } = courseProgress(p, today);
  const active = p.status === 'ACTIVE';
  const lines = [`📋 <b>${esc(p.title)}</b>`];
  if (p.doctor) lines.push(`👨‍⚕️ ${esc(p.doctor)}`);
  const progress = !active ? 'yakunlangan' : day === 0 ? 'hali boshlanmagan' : `${day}/${total}-kun`;
  lines.push(`📅 ${formatDate(p.startDate)} – ${formatDate(p.endDate)} · ${progress}`);
  const pct = adherencePercent(counts);
  if (pct !== null) lines.push(`📈 Rioya: <b>${pct}%</b> (${counts.taken} ta doza ichildi)`);
  if (p.notes) lines.push(`📝 ${esc(p.notes)}`);

  lines.push('', '💊 <b>Dorilar:</b>');
  p.medications.forEach((m, i) => {
    lines.push(`${i + 1}. ${medLine(m)}`, `    ${medDetails(m, p.endDate)}`);
  });

  const rows: (Button[] | null)[] = [];
  if (active) {
    rows.push(
      ...chunk(
        p.medications.filter((m) => m.isActive).map((m) => cb(`💊 ${short(m.name, 20)}`, `m:v:${m.id}`)),
        2
      )
    );
    rows.push([cb("📅 Muddatni o'zgartirish", `rx:d:${p.id}`)]);
    rows.push([cb('⏹ Yakunlash', `rx:f:${p.id}`), cb("🗑 O'chirish", `rx:x:${p.id}`)]);
    rows.push([cb('◀️ Retseptlar', 'rx:l')]);
  } else {
    rows.push([cb("🗑 O'chirish", `rx:x:${p.id}`), cb('◀️ Tarix', 'rx:h')]);
  }
  return view(lines.join('\n'), rows);
}

export function confirmView(text: string, yes: { label: string; data: string }, noData: string): View {
  return view(text, [[cb(yes.label, yes.data), cb('Yo\'q', noData)]]);
}

export function medicationView(m: Medication, p: Prescription): View {
  const lines = [
    `💊 ${medLine(m)}`,
    `📋 Retsept: ${esc(p.title)}`,
    `⏰ Vaqtlar: <b>${m.times.join(', ')}</b> (kuniga ${m.times.length} marta)`,
    `📅 ${formatDate(m.startDate)} – ${formatDate(m.endDate)} (${daysInclusive(m.startDate, m.endDate)} kun)`,
  ];
  if (!m.isActive) lines.push("⏹ <i>To'xtatilgan</i>");
  const rows: Button[][] = [];
  if (m.isActive && p.status === 'ACTIVE') {
    rows.push([cb("⏰ Vaqtlarni o'zgartirish", `m:t:${m.id}`)]);
    rows.push([cb("⏹ Dorini to'xtatish", `m:s:${m.id}`)]);
  }
  rows.push([cb('◀️ Retseptga qaytish', `rx:v:${p.id}`)]);
  return view(lines.join('\n'), rows);
}

// ---------------------------------------------------------------------------
// Hisobot
// ---------------------------------------------------------------------------

export function reportView(stats: UserStats, period: 7 | 30): View {
  const tabs = [
    cb(period === 7 ? '• 7 kun •' : '7 kun', 'rep:7'),
    cb(period === 30 ? '• 30 kun •' : '30 kun', 'rep:30'),
  ];
  const t = stats.totals;
  if (t.total === 0) {
    return view(
      `📊 <b>Hisobot — oxirgi ${period} kun</b>\n\nBu davrda dori rejalashtirilmagan.`,
      [tabs, appButtonRow('?tab=stats')]
    );
  }

  const lines = [
    `📊 <b>Hisobot — oxirgi ${period} kun</b>`,
    `${formatDate(stats.from)} – ${formatDate(stats.to)}`,
    '',
    `📈 Rioya: <b>${percentText(stats.percent)}</b> ${bar(t.taken, t.taken + t.skipped + t.missed)}`,
    `✅ Ichildi: <b>${t.taken}</b>   ⏭ O'tkazildi: <b>${t.skipped}</b>   ❌ Belgilanmadi: <b>${t.missed}</b>`,
  ];
  if (t.pending) lines.push(`⏳ Kutilmoqda: <b>${t.pending}</b>`);
  lines.push(`🔥 Ketma-ket to'liq kunlar: <b>${stats.streak}</b>`);

  if (period === 7) {
    lines.push('', '<b>Kunlar bo\'yicha:</b>');
    for (const d of stats.days) {
      const label = `${WEEKDAYS_SHORT[weekday(d.date)]} ${formatShort(d.date)}`;
      lines.push(d.total ? `<code>${label}</code> ${bar(d.taken, d.total, 8)} ${d.taken}/${d.total}` : `<code>${label}</code> —`);
    }
  }

  if (stats.medications.length) {
    lines.push('', '<b>Dorilar bo\'yicha:</b>');
    for (const m of stats.medications.slice(0, 10)) {
      lines.push(`• ${esc(m.name)} — ${percentText(m.percent)} (${m.taken}/${m.resolved})`);
    }
  }

  if (stats.percent !== null && stats.percent < 80) {
    lines.push('', "💡 Dorini o'z vaqtida ichish davolanish samarasini oshiradi. Eslatmani oldinroq olishni ⚙️ Sozlamalardan yoqishingiz mumkin.");
  }

  return view(lines.join('\n'), [tabs, appButtonRow('?tab=stats')]);
}

// ---------------------------------------------------------------------------
// Sozlamalar
// ---------------------------------------------------------------------------

export function leadText(n: number): string {
  return n === 0 ? 'aynan vaqtida' : `${n} daqiqa oldin`;
}

export function followUpText(n: number): string {
  return n === 0 ? "o'chirilgan" : `${n} daqiqadan keyin`;
}

export function settingsView(user: User, now = new Date()): View {
  const lines = [
    '⚙️ <b>Sozlamalar</b>',
    '',
    `🔔 Eslatmalar: <b>${user.remindersEnabled ? 'yoqilgan' : "o'chirilgan"}</b>`,
    `⏱ Eslatish: <b>${leadText(user.leadMinutes)}</b>`,
    `🔁 Javob bo'lmasa qayta eslatish: <b>${followUpText(user.followUpMinutes)}</b>`,
    `🕐 Vaqt zonasi: <b>${esc(user.timezone)}</b> (hozir ${timeIn(user.timezone, now)})`,
  ];
  return view(lines.join('\n'), [
    [cb(user.remindersEnabled ? "🔕 Eslatmalarni o'chirish" : '🔔 Eslatmalarni yoqish', 'set:rem')],
    [cb('⏱ Oldindan eslatish', 'set:lead'), cb('🔁 Qayta eslatish', 'set:fu')],
    [cb('🕐 Vaqt zonasi', 'set:tz')],
  ]);
}

export function leadOptionsView(current: number): View {
  return view(
    "⏱ <b>Eslatmani qachon olasiz?</b>\n\nDori vaqtidan oldinroq eslatma kelsa, tayyorlanib olishga ulgurasiz.",
    [
      ...chunk(
        LEAD_OPTIONS.map((n) => cb(`${n === current ? '• ' : ''}${leadText(n)}`, `set:lead:${n}`)),
        2
      ),
      [cb('◀️ Orqaga', 'set:back')],
    ]
  );
}

export function followUpOptionsView(current: number): View {
  return view(
    "🔁 <b>Qayta eslatish</b>\n\nEslatmaga javob bermasangiz, shuncha vaqtdan keyin yana bir marta eslataman.",
    [
      ...chunk(
        FOLLOW_UP_OPTIONS.map((n) => cb(`${n === current ? '• ' : ''}${followUpText(n)}`, `set:fu:${n}`)),
        2
      ),
      [cb('◀️ Orqaga', 'set:back')],
    ]
  );
}

export function timezoneOptionsView(current: string): View {
  return view(
    "🕐 <b>Vaqt zonasi</b>\n\nEslatmalar shu zona soati bo'yicha keladi. Ro'yxatda bo'lmasa — «Boshqa» ni bosib yozing (masalan <code>Asia/Tashkent</code>).",
    [
      ...chunk(
        TIMEZONE_OPTIONS.map((o, i) => cb(`${o.tz === current ? '• ' : ''}${o.label}`, `set:tz:${i}`)),
        2
      ),
      [cb('✏️ Boshqa', 'set:tz:custom'), cb('◀️ Orqaga', 'set:back')],
    ]
  );
}
