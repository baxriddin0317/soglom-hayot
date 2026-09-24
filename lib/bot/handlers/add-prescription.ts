import type { Context } from 'telegraf';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { COURSE_DAY_PRESETS, DOSAGE_PRESETS, LIMITS, MEAL_LABELS, MEALS, type Meal } from '@/lib/constants';
import { currentUser } from '@/lib/bot/context';
import { BUTTONS, chunk, mainKeyboard, stepKeyboard } from '@/lib/bot/keyboards';
import { setState, type BotState, type DraftMedication, type DraftPrescription } from '@/lib/bot/session';
import { esc } from '@/lib/bot/telegram';
import { medLine } from '@/lib/bot/views';
import { getNextDose } from '@/lib/services/doses';
import { createPrescription, validatePrescription } from '@/lib/services/prescriptions';
import {
  addDays,
  dateIn,
  formatDate,
  formatDayMonth,
  isDateString,
  MAX_TIMES_PER_DAY,
  parseTimes,
  relativeDay,
  safeTimeZone,
  suggestedTimes,
} from '@/lib/time';

const T = {
  today: 'Bugundan',
  tomorrow: 'Ertadan',
  wholeCourse: '♾ Butun kurs',
  addMore: "➕ Yana dori qo'shish",
  save: '✅ Saqlash',
  removeLast: "🗑 Oxirgi dorini o'chirish",
} as const;

const html = (keyboard: ReturnType<typeof stepKeyboard>) => ({ parse_mode: 'HTML' as const, ...keyboard });

function todayFor(ctx: Context) {
  return dateIn(safeTimeZone(currentUser(ctx).timezone));
}

export async function startAddPrescription(ctx: Context) {
  const user = currentUser(ctx);
  const active = await db.prescription.count({ where: { userId: user.id, status: 'ACTIVE' } });
  if (active >= LIMITS.activePrescriptions) {
    await ctx.reply(
      `Sizda ${active} ta faol retsept bor — bu eng ko'p miqdor. Keraksizini «📋 Retseptlarim» bo'limida yakunlang.`,
      mainKeyboard()
    );
    return;
  }
  const state: BotState = { step: 'rx_title' };
  await setState(user, state);
  await promptStep(ctx, state);
}

function medsSummary(draft: DraftPrescription): string {
  return draft.medications
    .map((m, i) => {
      const extra = [`⏰ ${m.times.join(', ')}`];
      if (m.days) extra.push(`${m.days} kun`);
      return `${i + 1}. ${medLine(m)}\n    ${extra.join(' · ')}`;
    })
    .join('\n');
}

export async function promptStep(ctx: Context, state: BotState, prefix = '') {
  const p = prefix ? `${prefix}\n\n` : '';
  switch (state.step) {
    case 'rx_title':
      return ctx.reply(
        `${p}📝 <b>Yangi retsept</b>\n\nRetsept yoki kasallik nomini yozing.\n<i>Masalan: Gripp, Angina, Qon bosimi</i>`,
        html(stepKeyboard([[BUTTONS.skip]], { back: false }))
      );
    case 'rx_days':
      return ctx.reply(
        `${p}🗓 <b>Davolanish necha kun davom etadi?</b>\n\nRetseptdagi muddatni tanlang yoki raqam bilan yozing (1–${LIMITS.maxCourseDays}).`,
        html(stepKeyboard(chunk(COURSE_DAY_PRESETS.map((d) => `${d} kun`), 3)))
      );
    case 'rx_start':
      return ctx.reply(
        `${p}📅 <b>Dori ichishni qachondan boshlaysiz?</b>\n\nYoki sanani yozing: <code>25.09</code>`,
        html(stepKeyboard([[T.today, T.tomorrow]]))
      );
    case 'med_name': {
      const n = state.draft.medications.length + 1;
      return ctx.reply(
        `${p}💊 <b>${n}-dori</b>\n\nDori nomini yozing.\n<i>Masalan: Paracetamol 500 mg</i>`,
        html(stepKeyboard([]))
      );
    }
    case 'med_dosage':
      return ctx.reply(
        `${p}💊 <b>${esc(state.med.name ?? '')}</b>\n\nBir martada qancha ichiladi? Tanlang yoki yozing.`,
        html(stepKeyboard([...chunk(DOSAGE_PRESETS, 2), [BUTTONS.skip]]))
      );
    case 'med_count':
      return ctx.reply(
        `${p}🔢 <b>Kuniga necha marta ichiladi?</b>`,
        html(stepKeyboard([['1 marta', '2 marta', '3 marta'], ['4 marta', '5 marta', '6 marta']]))
      );
    case 'med_times': {
      const suggested = suggestedTimes(state.med.perDay ?? 1);
      return ctx.reply(
        `${p}⏰ <b>Qaysi soatlarda ichiladi?</b>\n\nTavsiya: <b>${suggested.join(', ')}</b>\n\n` +
          `Ma'qul bo'lsa tugmani bosing yoki o'z vaqtlaringizni probel bilan yozing:\n<code>${suggested.join(' ')}</code>`,
        html(stepKeyboard([[`✅ ${suggested.join(' · ')}`]]))
      );
    }
    case 'med_days': {
      const total = state.draft.days;
      const presets = [3, 5, 7, 10, 14].filter((d) => d < total).map((d) => `${d} kun`);
      return ctx.reply(
        `${p}📆 <b>Bu dori necha kun ichiladi?</b>\n\nKurs ${total} kun. Ba'zi dorilar (masalan antibiotik) qisqaroq muddat ichiladi.`,
        html(stepKeyboard([[`${T.wholeCourse} (${total} kun)`], ...chunk(presets, 3)]))
      );
    }
    case 'med_meal':
      return ctx.reply(
        `${p}🍽 <b>Ovqatga nisbatan qachon ichiladi?</b>`,
        html(stepKeyboard([
          [MEAL_LABELS.BEFORE, MEAL_LABELS.WITH],
          [MEAL_LABELS.AFTER, MEAL_LABELS.ANY],
        ]))
      );
    case 'rx_review': {
      const d = state.draft;
      const rows: string[][] = [];
      if (d.medications.length < LIMITS.medicationsPerPrescription) rows.push([T.addMore]);
      rows.push([T.save]);
      if (d.medications.length > 1) rows.push([T.removeLast]);
      const today = todayFor(ctx);
      return ctx.reply(
        `${p}📋 <b>${esc(d.title)}</b>\n📅 ${d.days} kun · ${relativeDay(d.startDate, today).toLowerCase()} ` +
          `(${formatDate(d.startDate)}) dan boshlab\n\n${medsSummary(d)}\n\n` +
          `Retseptda yana dori bo'lsa — «${T.addMore}», hammasi kiritilgan bo'lsa — «${T.save}».`,
        html(stepKeyboard(rows, { back: false }))
      );
    }
    case 'edit_times':
      return ctx.reply(
        `${p}⏰ Yangi vaqtlarni probel bilan yozing.\n<i>Masalan:</i> <code>08:00 14:00 20:00</code>`,
        html(stepKeyboard([], { back: false }))
      );
    case 'edit_days':
      return ctx.reply(
        `${p}📅 Kurs jami necha kun davom etsin? Raqam yozing (boshlangan kundan hisoblanadi).`,
        html(stepKeyboard([['5', '7', '10'], ['14', '30', '60']], { back: false }))
      );
    case 'tz_custom':
      return ctx.reply(
        `${p}🕐 Vaqt zonasini IANA formatida yozing.\n<i>Masalan:</i> <code>Asia/Tashkent</code>, <code>Europe/Moscow</code>, <code>America/Chicago</code>`,
        html(stepKeyboard([], { back: false }))
      );
  }
}

async function go(ctx: Context, state: BotState, prefix = '') {
  await setState(currentUser(ctx), state);
  await promptStep(ctx, state, prefix);
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
      await go(ctx, { step: 'med_count', draft: state.draft, med: state.med });
      return true;
    case 'med_days':
      await go(ctx, { step: 'med_times', draft: state.draft, med: state.med });
      return true;
    case 'med_meal':
      await go(ctx, {
        step: state.draft.days > 1 ? 'med_days' : 'med_times',
        draft: state.draft,
        med: state.med,
      });
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
  return MEALS.find((m) => MEAL_LABELS[m] === text) ?? null;
}

async function savePrescription(ctx: Context, draft: DraftPrescription) {
  const user = currentUser(ctx);
  const tz = safeTimeZone(user.timezone);
  const today = dateIn(tz);
  try {
    const input = validatePrescription(draft, today);
    const created = await createPrescription(user, input);
    await setState(user, null);

    const perDay = input.medications.reduce((sum, m) => sum + m.times.length, 0);
    const next = await getNextDose(user.id);
    const lines = [
      '✅ <b>Retsept saqlandi!</b>',
      '',
      `📋 ${esc(created.title)} — ${input.days} kun (${formatDayMonth(created.startDate)} – ${formatDayMonth(created.endDate)})`,
      `💊 ${input.medications.length} ta dori, kuniga jami ${perDay} marta`,
    ];
    if (next) {
      lines.push(`⏰ Birinchi eslatma: <b>${relativeDay(next.date, today).toLowerCase()} ${next.time}</b> — ${esc(next.medication.name)}`);
    }
    lines.push('', "Har bir dori vaqtida eslatma yuboraman. Dorini ichgach «✅ Ichdim» tugmasini bosing. Sog'ayib keting! 🌿");
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', ...mainKeyboard() });
  } catch (err) {
    if (err instanceof AppError) {
      await ctx.reply(`❌ ${err.message}`, mainKeyboard());
      await setState(user, null);
      return;
    }
    throw err;
  }
}

/** Dialog ichidagi matnli javobni qayta ishlaydi. */
export async function handlePrescriptionStep(ctx: Context, state: BotState, text: string): Promise<boolean> {
  const today = todayFor(ctx);

  switch (state.step) {
    case 'rx_title': {
      const title = text === BUTTONS.skip ? `Retsept (${formatDayMonth(today)})` : text.slice(0, LIMITS.nameLength);
      await go(ctx, { step: 'rx_days', draft: { title } });
      return true;
    }

    case 'rx_days': {
      const days = parseInteger(text);
      if (!days || days < 1 || days > LIMITS.maxCourseDays) {
        await promptStep(ctx, state, `❌ 1 dan ${LIMITS.maxCourseDays} gacha son kiriting.`);
        return true;
      }
      await go(ctx, { step: 'rx_start', draft: { ...state.draft, days } });
      return true;
    }

    case 'rx_start': {
      const startDate =
        text === T.today ? today : text === T.tomorrow ? addDays(today, 1) : parseStartDate(text, today);
      if (!startDate || startDate < addDays(today, -LIMITS.editableDaysBack) || startDate > addDays(today, 60)) {
        await promptStep(ctx, state, "❌ Sanani tushunmadim. «Bugundan» / «Ertadan» ni bosing yoki 25.09 ko'rinishida yozing.");
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
      const dosage = text === BUTTONS.skip ? null : text.slice(0, 40);
      await go(ctx, { step: 'med_count', draft: state.draft, med: { ...state.med, dosage } });
      return true;
    }

    case 'med_count': {
      const perDay = parseInteger(text);
      if (!perDay || perDay < 1 || perDay > MAX_TIMES_PER_DAY) {
        await promptStep(ctx, state, `❌ 1 dan ${MAX_TIMES_PER_DAY} gacha son kiriting.`);
        return true;
      }
      await go(ctx, { step: 'med_times', draft: state.draft, med: { ...state.med, perDay } });
      return true;
    }

    case 'med_times': {
      const perDay = state.med.perDay ?? 1;
      const times = text.startsWith('✅') ? suggestedTimes(perDay) : parseTimes(text);
      if (!times) {
        await promptStep(
          ctx,
          state,
          `❌ Vaqtlarni tushunmadim. Soat:daqiqa ko'rinishida, probel bilan yozing (ko'pi bilan ${MAX_TIMES_PER_DAY} ta).`
        );
        return true;
      }
      const med: DraftMedication = { ...state.med, times, perDay: times.length };
      const note =
        times.length !== perDay ? `ℹ️ ${times.length} ta vaqt kiritildi — kuniga ${times.length} marta deb saqlayman.` : '';
      if (state.draft.days > 1) await go(ctx, { step: 'med_days', draft: state.draft, med }, note);
      else await go(ctx, { step: 'med_meal', draft: state.draft, med: { ...med, days: null } }, note);
      return true;
    }

    case 'med_days': {
      let days: number | null = null;
      if (!text.startsWith(T.wholeCourse)) {
        days = parseInteger(text);
        if (!days || days < 1 || days > state.draft.days) {
          await promptStep(ctx, state, `❌ 1 dan ${state.draft.days} gacha son kiriting yoki «${T.wholeCourse}» ni tanlang.`);
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
        await promptStep(ctx, state, '❌ Tugmalardan birini tanlang.');
        return true;
      }
      const m = state.med;
      const draft: DraftPrescription = {
        ...state.draft,
        medications: [
          ...state.draft.medications,
          { name: m.name ?? 'Dori', dosage: m.dosage ?? null, meal, times: m.times ?? ['09:00'], days: m.days ?? null },
        ],
      };
      await go(ctx, { step: 'rx_review', draft }, `✅ <b>${esc(m.name ?? '')}</b> qo'shildi.`);
      return true;
    }

    case 'rx_review': {
      if (text === T.addMore) {
        if (state.draft.medications.length >= LIMITS.medicationsPerPrescription) {
          await promptStep(ctx, state, `❌ Bitta retseptda ko'pi bilan ${LIMITS.medicationsPerPrescription} ta dori.`);
          return true;
        }
        await go(ctx, { step: 'med_name', draft: state.draft });
        return true;
      }
      if (text === T.save) {
        await savePrescription(ctx, state.draft);
        return true;
      }
      if (text === T.removeLast && state.draft.medications.length > 1) {
        const removed = state.draft.medications.at(-1);
        const draft = { ...state.draft, medications: state.draft.medications.slice(0, -1) };
        await go(ctx, { step: 'rx_review', draft }, `🗑 ${esc(removed?.name ?? '')} olib tashlandi.`);
        return true;
      }
      await promptStep(ctx, state, '👇 Tugmalardan birini tanlang.');
      return true;
    }

    default:
      return false;
  }
}
