import type { Context } from 'telegraf';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import {
  COURSE_DAY_PRESETS,
  DOSAGE_PRESET_KEYS,
  INTERVAL_HOURS,
  LIMITS,
  MAX_PER_DAY_OPTIONS,
  MEAL_KEY,
  MEALS,
  parseDosage,
  type Meal,
} from '@/lib/constants';
import { t, type Lang } from '@/lib/i18n';
import { currentUser, langFor, menuFor } from '@/lib/bot/context';
import { chunk, isButton, stepKeyboard } from '@/lib/bot/keyboards';
import { setState, type BotState, type DraftMedication, type DraftPrescription } from '@/lib/bot/session';
import { esc } from '@/lib/bot/telegram';
import { daysPatternText, medLine, qtyText, scheduleText } from '@/lib/bot/views';
import { getNextDose } from '@/lib/services/doses';
import { createPrescription, parseStockQty, validatePrescription, type MedicationInput } from '@/lib/services/prescriptions';
import {
  addDays,
  dateIn,
  formatDate,
  formatDayMonth,
  intervalTimes,
  isDateString,
  MAX_TIMES_PER_DAY,
  parseTimes,
  parseWeekdays,
  relativeDay,
  safeTimeZone,
  suggestedTimes,
} from '@/lib/time';

const html = (keyboard: ReturnType<typeof stepKeyboard>) => ({ parse_mode: 'HTML' as const, ...keyboard });
const daysText = (lang: Lang, n: number) => t(lang, 'common.days', { n });

function todayFor(ctx: Context) {
  return dateIn(safeTimeZone(currentUser(ctx).timezone));
}

export async function startAddPrescription(ctx: Context) {
  const user = currentUser(ctx);
  const lang = langFor(ctx);
  const active = await db.prescription.count({ where: { userId: user.id, status: 'ACTIVE' } });
  if (active >= LIMITS.activePrescriptions) {
    await ctx.reply(t(lang, 'add.limit', { n: active, list: t(lang, 'menu.list') }), menuFor(ctx));
    return;
  }
  const state: BotState = { step: 'rx_title' };
  await setState(user, state);
  await promptStep(ctx, state);
}

// "Har N soatda" uchun birinchi qabul: 6 va 8 soatda — erta tongdan (06:00), aks holda 08:00.
function intervalFirst(hours: number): string {
  return hours === 6 || hours === 8 ? '06:00' : '08:00';
}

function suggestionFor(med: DraftMedication): string[] {
  return med.intervalHours ? intervalTimes(med.intervalHours, intervalFirst(med.intervalHours)) : suggestedTimes(med.perDay ?? 1);
}

function medExtra(m: MedicationInput, lang: Lang): string {
  const extra = m.asNeeded ? [scheduleText({ ...m, maxPerDay: m.maxPerDay }, lang)] : [`⏰ ${m.times.join(', ')}`];
  const pattern = m.asNeeded ? null : daysPatternText(m, lang);
  if (pattern) extra.push(pattern);
  if (m.days) extra.push(daysText(lang, m.days));
  if (m.stock !== null && m.stockUnit) extra.push(`📦 ${qtyText(m.stock, m.stockUnit, lang)}`);
  return extra.join(' · ');
}

function medsSummary(draft: DraftPrescription, lang: Lang): string {
  return draft.medications.map((m, i) => `${i + 1}. ${medLine(m, lang)}\n    ${medExtra(m, lang)}`).join('\n');
}

export async function promptStep(ctx: Context, state: BotState, prefix = '') {
  const lang = langFor(ctx);
  const tr = (key: Parameters<typeof t>[1], params?: Parameters<typeof t>[2]) => t(lang, key, params);
  const p = prefix ? `${prefix}\n\n` : '';
  const kb = (rows: string[][], opts?: { back?: boolean }) => html(stepKeyboard(lang, rows, opts));

  switch (state.step) {
    case 'rx_title':
      return ctx.reply(`${p}${tr('add.title')}`, kb([[tr('common.skip')]], { back: false }));
    case 'rx_days':
      return ctx.reply(
        `${p}${tr('add.days', { max: LIMITS.maxCourseDays })}`,
        kb(chunk(COURSE_DAY_PRESETS.map((d) => daysText(lang, d)), 3))
      );
    case 'rx_start':
      return ctx.reply(`${p}${tr('add.start')}`, kb([[tr('add.fromToday'), tr('add.fromTomorrow')]]));
    case 'med_name':
      return ctx.reply(`${p}${tr('add.medName', { n: state.draft.medications.length + 1 })}`, kb([]));
    case 'med_dosage':
      return ctx.reply(
        `${p}${tr('add.dosage', { name: esc(state.med.name ?? '') })}`,
        kb([...chunk(DOSAGE_PRESET_KEYS.map((k) => tr(k)), 2), [tr('common.skip')]])
      );
    case 'med_count':
      return ctx.reply(
        `${p}${tr('add.count')}`,
        kb([
          [1, 2, 3].map((n) => tr('common.times', { n })),
          [4, 5, 6].map((n) => tr('common.times', { n })),
          INTERVAL_HOURS.slice(1).map((n) => tr('add.everyHours', { n })),
          [tr('add.asNeeded')],
        ])
      );
    case 'med_times': {
      const suggested = suggestionFor(state.med);
      return ctx.reply(
        `${p}${tr('add.times', { list: suggested.join(', '), plain: suggested.join(' ') })}`,
        kb([[`✅ ${suggested.join(' · ')}`]])
      );
    }
    case 'med_freq':
      return ctx.reply(
        `${p}${tr('add.freq')}`,
        kb([[tr('add.freqDaily')], [tr('add.freqOther'), tr('add.freq3')], [tr('add.freqWeek')]])
      );
    case 'med_weekdays':
      return ctx.reply(
        `${p}${tr('add.weekdays', { example: tr('add.weekdaysExample') })}`,
        kb([[tr('add.weekdaysExample')], [tr('add.weekdaysWork')]])
      );
    case 'med_max':
      return ctx.reply(
        `${p}${tr('add.maxPerDay')}`,
        kb([MAX_PER_DAY_OPTIONS.map((n) => tr('common.times', { n })), [tr('add.noLimit')]])
      );
    case 'med_days': {
      const total = state.draft.days;
      const presets = [3, 5, 7, 10, 14].filter((d) => d < total).map((d) => daysText(lang, d));
      return ctx.reply(
        `${p}${tr('add.medDays', { total: daysText(lang, total) })}`,
        kb([[tr('add.wholeCourse', { days: daysText(lang, total) })], ...chunk(presets, 3)])
      );
    }
    case 'med_meal':
      return ctx.reply(
        `${p}${tr('add.meal')}`,
        kb([
          [tr(MEAL_KEY.BEFORE), tr(MEAL_KEY.WITH)],
          [tr(MEAL_KEY.AFTER), tr(MEAL_KEY.ANY)],
        ])
      );
    case 'med_stock': {
      const unit = parseDosage(state.med.dosage).unit;
      return ctx.reply(
        `${p}${tr('add.stock', { unit: tr(`unitName.${unit}`) })}`,
        kb([['10', '20', '30'], [tr('common.skip')]])
      );
    }
    case 'rx_review': {
      const d = state.draft;
      const rows: string[][] = [];
      if (d.medications.length < LIMITS.medicationsPerPrescription) rows.push([tr('add.addMore')]);
      rows.push([tr('add.save')]);
      if (d.medications.length > 1) rows.push([tr('add.removeLast')]);
      const today = todayFor(ctx);
      return ctx.reply(
        `${p}${tr('add.review', {
          title: esc(d.title),
          days: daysText(lang, d.days),
          rel: relativeDay(d.startDate, today, lang).toLowerCase(),
          date: formatDate(d.startDate),
          meds: medsSummary(d, lang),
          addMore: tr('add.addMore'),
          save: tr('add.save'),
        })}`,
        kb(rows, { back: false })
      );
    }
    case 'edit_times':
      return ctx.reply(`${p}${tr('add.editTimes')}`, kb([], { back: false }));
    case 'edit_days':
      return ctx.reply(`${p}${tr('add.editDays')}`, kb([['5', '7', '10'], ['14', '30', '60']], { back: false }));
    case 'stock_qty': {
      const med = await db.medication.findUnique({ where: { id: state.medicationId } });
      const unit = med?.stockUnit ?? parseDosage(med?.dosage).unit;
      return ctx.reply(
        `${p}${tr('stock.askQty', { unit: tr(`unitName.${unit}` as Parameters<typeof t>[1]) })}`,
        kb([['10', '20', '30'], ['50', '100']], { back: false })
      );
    }
    case 'tz_custom':
      return ctx.reply(`${p}${tr('add.tzCustom')}`, kb([], { back: false }));
  }
}

async function go(ctx: Context, state: BotState, prefix = '') {
  await setState(currentUser(ctx), state);
  await promptStep(ctx, state, prefix);
}

/** Dori ma'lumotlaridan keyingi qadam: kunlari -> muddati -> ovqat. */
function afterSchedule(draft: DraftPrescription, med: DraftMedication): BotState {
  if (draft.days > 1) return { step: 'med_days', draft, med };
  return { step: 'med_meal', draft, med: { ...med, days: null } };
}

/** "◀️ Orqaga" — bir qadam orqaga. */
export async function stepBack(ctx: Context, state: BotState): Promise<boolean> {
  switch (state.step) {
    case 'rx_days':
      await go(ctx, { step: 'rx_title' });
      return true;
    case 'rx_start':
      await go(ctx, { step: 'rx_days', draft: state.draft });
      return true;
    case 'med_name':
      if (state.draft.medications.length > 0) await go(ctx, { step: 'rx_review', draft: state.draft });
      else await go(ctx, { step: 'rx_start', draft: state.draft });
      return true;
    case 'med_dosage':
      await go(ctx, { step: 'med_name', draft: state.draft });
      return true;
    case 'med_count':
      await go(ctx, { step: 'med_dosage', draft: state.draft, med: state.med });
      return true;
    case 'med_times':
    case 'med_max':
      await go(ctx, { step: 'med_count', draft: state.draft, med: state.med });
      return true;
    case 'med_freq':
      await go(ctx, { step: 'med_times', draft: state.draft, med: state.med });
      return true;
    case 'med_weekdays':
      await go(ctx, { step: 'med_freq', draft: state.draft, med: state.med });
      return true;
    case 'med_days': {
      const { draft, med } = state;
      const step = med.asNeeded ? 'med_max' : draft.days > 2 ? 'med_freq' : 'med_times';
      await go(ctx, { step, draft, med });
      return true;
    }
    case 'med_meal': {
      const { draft, med } = state;
      const step = draft.days > 1 ? 'med_days' : med.asNeeded ? 'med_max' : 'med_times';
      await go(ctx, { step, draft, med });
      return true;
    }
    case 'med_stock':
      await go(ctx, { step: 'med_meal', draft: state.draft, med: state.med });
      return true;
    case 'rx_review':
      await promptStep(ctx, state);
      return true;
    default:
      return false;
  }
}

function parseInteger(text: string): number | null {
  const m = /^(\d{1,4})\b/.exec(text.trim());
  return m ? Number(m[1]) : null;
}

// "25.09" / "25.09.2026" / "2026-09-25" -> "YYYY-MM-DD"
function parseStartDate(text: string, today: string): string | null {
  const s = text.trim();
  if (isDateString(s)) return s;
  const m = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/.exec(s);
  if (!m) return null;
  const year = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : today.slice(0, 4);
  let date = `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (!isDateString(date)) return null;
  // Yil yozilmagan va sana o'tib ketgan bo'lsa — keyingi yil (masalan dekabrda "05.01").
  if (!m[3] && date < addDays(today, -LIMITS.editableDaysBack)) {
    date = `${Number(year) + 1}${date.slice(4)}`;
  }
  return date;
}

function mealFromLabel(text: string): Meal | null {
  return MEALS.find((m) => isButton(text, MEAL_KEY[m])) ?? null;
}

async function savePrescription(ctx: Context, draft: DraftPrescription) {
  const user = currentUser(ctx);
  const lang = langFor(ctx);
  const tz = safeTimeZone(user.timezone);
  const today = dateIn(tz);
  try {
    const input = validatePrescription(draft, today);
    const created = await createPrescription(user, input);
    await setState(user, null);

    const perDay = input.medications.reduce((sum, m) => sum + m.times.length, 0);
    const next = await getNextDose(user.id);
    const lines = [
      t(lang, 'add.saved'),
      '',
      t(lang, 'add.savedSummary', {
        title: esc(created.title),
        days: daysText(lang, input.days),
        from: formatDayMonth(created.startDate, lang),
        to: formatDayMonth(created.endDate, lang),
      }),
      t(lang, 'add.savedMeds', { n: input.medications.length, perDay }),
    ];
    if (next) {
      const when = `${relativeDay(next.date, today, lang).toLowerCase()} ${next.time}`;
      lines.push(t(lang, 'add.firstReminder', { when, name: esc(next.medication.name) }));
    }
    lines.push('', t(lang, 'add.savedFooter'));
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', ...menuFor(ctx) });
  } catch (err) {
    if (err instanceof AppError) {
      await ctx.reply(`❌ ${err.text(lang)}`, menuFor(ctx));
      await setState(user, null);
      return;
    }
    throw err;
  }
}

/** Dorini qoralamaga qo'shadi va retsept ko'rinishiga qaytadi. */
async function finishMedication(ctx: Context, draft: DraftPrescription, m: DraftMedication, stock: number | null) {
  const lang = langFor(ctx);
  const parsed = parseDosage(m.dosage);
  const med: MedicationInput = {
    name: m.name ?? t(lang, 'add.medDefault'),
    dosage: m.dosage ?? null,
    meal: m.meal ?? 'ANY',
    times: m.asNeeded ? [] : (m.times ?? ['09:00']),
    days: m.days ?? null,
    everyDays: m.everyDays ?? 1,
    weekdays: m.weekdays ?? [],
    asNeeded: m.asNeeded ?? false,
    maxPerDay: m.maxPerDay ?? null,
    stock,
    stockUnit: stock !== null ? parsed.unit : null,
    unitsPerDose: parsed.amount,
  };
  const next: DraftPrescription = { ...draft, medications: [...draft.medications, med] };
  await go(ctx, { step: 'rx_review', draft: next }, t(lang, 'add.medAdded', { name: esc(med.name) }));
}

/** Dialog ichidagi matnli javobni qayta ishlaydi. */
export async function handlePrescriptionStep(ctx: Context, state: BotState, text: string): Promise<boolean> {
  const today = todayFor(ctx);
  const lang = langFor(ctx);
  const tr = (key: Parameters<typeof t>[1], params?: Parameters<typeof t>[2]) => t(lang, key, params);
  const skip = isButton(text, 'common.skip');

  switch (state.step) {
    case 'rx_title': {
      const title = skip ? tr('add.defaultTitle', { date: formatDayMonth(today, lang) }) : text.slice(0, LIMITS.nameLength);
      await go(ctx, { step: 'rx_days', draft: { title } });
      return true;
    }

    case 'rx_days': {
      const days = parseInteger(text);
      if (!days || days < 1 || days > LIMITS.maxCourseDays) {
        await promptStep(ctx, state, tr('add.errRange', { max: LIMITS.maxCourseDays }));
        return true;
      }
      await go(ctx, { step: 'rx_start', draft: { ...state.draft, days } });
      return true;
    }

    case 'rx_start': {
      const startDate = isButton(text, 'add.fromToday')
        ? today
        : isButton(text, 'add.fromTomorrow')
          ? addDays(today, 1)
          : parseStartDate(text, today);
      if (!startDate || startDate < addDays(today, -LIMITS.editableDaysBack) || startDate > addDays(today, 60)) {
        await promptStep(ctx, state, tr('add.errDate', { today: tr('add.fromToday'), tomorrow: tr('add.fromTomorrow') }));
        return true;
      }
      const draft: DraftPrescription = {
        title: state.draft.title ?? 'Retsept',
        days: state.draft.days ?? 1,
        startDate,
        medications: [],
      };
      await go(ctx, { step: 'med_name', draft });
      return true;
    }

    case 'med_name': {
      const name = text.slice(0, LIMITS.nameLength);
      await go(ctx, { step: 'med_dosage', draft: state.draft, med: { name } });
      return true;
    }

    case 'med_dosage': {
      const dosage = skip ? null : text.slice(0, 40);
      await go(ctx, { step: 'med_count', draft: state.draft, med: { ...state.med, dosage } });
      return true;
    }

    case 'med_count': {
      const base = { ...state.med, intervalHours: undefined, asNeeded: false };
      if (isButton(text, 'add.asNeeded')) {
        await go(ctx, { step: 'med_max', draft: state.draft, med: { ...base, asNeeded: true, times: [] } });
        return true;
      }
      const hours = INTERVAL_HOURS.find((h) => isButton(text, 'add.everyHours', { n: h }));
      if (hours) {
        const times = intervalTimes(hours, intervalFirst(hours));
        await go(ctx, { step: 'med_times', draft: state.draft, med: { ...base, intervalHours: hours, perDay: times.length } });
        return true;
      }
      const perDay = parseInteger(text);
      if (!perDay || perDay < 1 || perDay > MAX_TIMES_PER_DAY) {
        await promptStep(ctx, state, tr('add.errRange', { max: MAX_TIMES_PER_DAY }));
        return true;
      }
      await go(ctx, { step: 'med_times', draft: state.draft, med: { ...base, perDay } });
      return true;
    }

    case 'med_times': {
      const perDay = state.med.perDay ?? 1;
      const times = text.startsWith('✅') ? suggestionFor(state.med) : parseTimes(text);
      if (!times) {
        await promptStep(ctx, state, tr('add.errTimes', { max: MAX_TIMES_PER_DAY }));
        return true;
      }
      const med: DraftMedication = { ...state.med, times, perDay: times.length, everyDays: 1, weekdays: [] };
      const note = times.length !== perDay ? tr('add.timesNote', { n: times.length }) : '';
      // Qisqa kursda (1–2 kun) "kun ora" ma'nosiz — so'ramaymiz.
      if (state.draft.days > 2) await go(ctx, { step: 'med_freq', draft: state.draft, med }, note);
      else await go(ctx, afterSchedule(state.draft, med), note);
      return true;
    }

    case 'med_freq': {
      const everyDays = isButton(text, 'add.freqDaily')
        ? 1
        : isButton(text, 'add.freqOther')
          ? 2
          : isButton(text, 'add.freq3')
            ? 3
            : null;
      if (everyDays !== null) {
        await go(ctx, afterSchedule(state.draft, { ...state.med, everyDays, weekdays: [] }));
        return true;
      }
      if (isButton(text, 'add.freqWeek')) {
        await go(ctx, { step: 'med_weekdays', draft: state.draft, med: state.med });
        return true;
      }
      await promptStep(ctx, state, tr('add.errButtons'));
      return true;
    }

    case 'med_weekdays': {
      const weekdays = parseWeekdays(text);
      if (!weekdays) {
        await promptStep(ctx, state, tr('add.errWeekdays', { example: tr('add.weekdaysExample') }));
        return true;
      }
      await go(ctx, afterSchedule(state.draft, { ...state.med, everyDays: 1, weekdays }));
      return true;
    }

    case 'med_max': {
      let maxPerDay: number | null = null;
      if (!text.startsWith('♾')) {
        maxPerDay = parseInteger(text);
        if (!maxPerDay || maxPerDay < 1 || maxPerDay > 24) {
          await promptStep(ctx, state, tr('add.errRange', { max: 24 }));
          return true;
        }
      }
      await go(ctx, afterSchedule(state.draft, { ...state.med, maxPerDay }));
      return true;
    }

    case 'med_days': {
      let days: number | null = null;
      if (!text.startsWith('♾')) {
        days = parseInteger(text);
        if (!days || days < 1 || days > state.draft.days) {
          await promptStep(
            ctx,
            state,
            tr('add.errMedDays', { max: state.draft.days, whole: tr('add.wholeCourse', { days: daysText(lang, state.draft.days) }) })
          );
          return true;
        }
        if (days === state.draft.days) days = null;
      }
      await go(ctx, { step: 'med_meal', draft: state.draft, med: { ...state.med, days } });
      return true;
    }

    case 'med_meal': {
      const meal = mealFromLabel(text);
      if (!meal) {
        await promptStep(ctx, state, tr('add.errButtons'));
        return true;
      }
      await go(ctx, { step: 'med_stock', draft: state.draft, med: { ...state.med, meal } });
      return true;
    }

    case 'med_stock': {
      if (skip) {
        await finishMedication(ctx, state.draft, state.med, null);
        return true;
      }
      const qty = parseStockQty(text.replace(/[^\d.,]/g, ''));
      if (qty === undefined || qty === null) {
        await promptStep(ctx, state, tr('add.errStock', { skip: tr('common.skip') }));
        return true;
      }
      await finishMedication(ctx, state.draft, state.med, qty);
      return true;
    }

    case 'rx_review': {
      if (isButton(text, 'add.addMore')) {
        if (state.draft.medications.length >= LIMITS.medicationsPerPrescription) {
          await promptStep(ctx, state, tr('add.errMaxMeds', { n: LIMITS.medicationsPerPrescription }));
          return true;
        }
        await go(ctx, { step: 'med_name', draft: state.draft });
        return true;
      }
      if (isButton(text, 'add.save')) {
        await savePrescription(ctx, state.draft);
        return true;
      }
      if (isButton(text, 'add.removeLast') && state.draft.medications.length > 1) {
        const removed = state.draft.medications.at(-1);
        const draft = { ...state.draft, medications: state.draft.medications.slice(0, -1) };
        await go(ctx, { step: 'rx_review', draft }, tr('add.removed', { name: esc(removed?.name ?? '') }));
        return true;
      }
      await promptStep(ctx, state, tr('add.pick'));
      return true;
    }

    default:
      return false;
  }
}
