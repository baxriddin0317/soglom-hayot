import type { Context } from 'telegraf';
import { AppError } from '@/lib/errors';
import { currentUser } from '@/lib/bot/context';
import { BUTTONS, mainKeyboard, menuActionFor, type MenuAction } from '@/lib/bot/keyboards';
import { getState, setState, type BotState } from '@/lib/bot/session';
import { esc } from '@/lib/bot/telegram';
import { medicationView, prescriptionView, settingsView } from '@/lib/bot/views';
import { handlePrescriptionStep, promptStep, startAddPrescription, stepBack } from '@/lib/bot/handlers/add-prescription';
import {
  helpHandler,
  historyHandler,
  homeHandler,
  listHandler,
  reportHandler,
  settingsHandler,
  todayHandler,
} from '@/lib/bot/handlers/menu';
import { countDosesByPrescription, emptyCounts, setPrescriptionDays, updateMedicationTimes } from '@/lib/services/prescriptions';
import { updateSettings } from '@/lib/services/users';
import { dateIn, parseTimes, safeTimeZone } from '@/lib/time';
import { db } from '@/lib/db';

const MENU: Record<MenuAction, (ctx: Context) => Promise<unknown>> = {
  today: (ctx) => todayHandler(ctx),
  add: startAddPrescription,
  list: listHandler,
  history: historyHandler,
  report: (ctx) => reportHandler(ctx, 7),
  settings: settingsHandler,
  help: helpHandler,
  home: (ctx) => homeHandler(ctx),
};

// Barcha matnli xabarlar shu yerdan o'tadi:
//   1) asosiy menyu tugmasi — har qanday dialogni to'xtatib, bo'limni ochadi;
//   2) "Bekor qilish" / "Orqaga";
//   3) dialog davom etayotgan bo'lsa — joriy qadamga javob;
//   4) aks holda — menyuni qayta ko'rsatamiz.
export async function textHandler(ctx: Context) {
  const user = currentUser(ctx);
  const text = (ctx.text ?? '').trim();
  const state = getState(user);

  const menu = menuActionFor(text);
  if (menu) {
    if (state) await setState(user, null);
    await MENU[menu](ctx);
    return;
  }

  if (text === BUTTONS.cancel) {
    await homeHandler(ctx, state ? '❌ Bekor qilindi.' : 'Asosiy menyu');
    return;
  }

  if (!state) {
    await ctx.reply('Quyidagi tugmalardan birini tanlang 👇', mainKeyboard());
    return;
  }

  if (text === BUTTONS.back) {
    if (!(await stepBack(ctx, state))) await homeHandler(ctx);
    return;
  }

  if (await handlePrescriptionStep(ctx, state, text)) return;
  await handleEditStep(ctx, state, text);
}

async function handleEditStep(ctx: Context, state: BotState, text: string) {
  const user = currentUser(ctx);
  try {
    switch (state.step) {
      case 'edit_times': {
        const times = parseTimes(text);
        if (!times) {
          await promptStep(ctx, state, "❌ Vaqtlarni tushunmadim.");
          return;
        }
        const med = await updateMedicationTimes(user, state.medicationId, times);
        await setState(user, null);
        await ctx.reply(`✅ Yangi vaqtlar saqlandi: <b>${med.times.join(', ')}</b>`, {
          parse_mode: 'HTML',
          ...mainKeyboard(),
        });
        const p = await db.prescription.findUniqueOrThrow({ where: { id: med.prescriptionId } });
        const { text: body, extra } = medicationView(med, p);
        await ctx.reply(body, extra);
        return;
      }
      case 'edit_days': {
        const days = Number(text.replace(/\D+/g, ''));
        const p = await setPrescriptionDays(user, state.prescriptionId, days);
        await setState(user, null);
        await ctx.reply(`✅ Kurs muddati yangilandi.`, mainKeyboard());
        const counts = (await countDosesByPrescription([p.id])).get(p.id) ?? emptyCounts();
        const { text: body, extra } = prescriptionView(p, counts, { today: dateIn(safeTimeZone(user.timezone)) });
        await ctx.reply(body, extra);
        return;
      }
      case 'tz_custom': {
        const updated = await updateSettings(user, { timezone: text });
        await setState(updated, null);
        await ctx.reply(`✅ Vaqt zonasi: <b>${esc(updated.timezone)}</b>`, { parse_mode: 'HTML', ...mainKeyboard() });
        const { text: body, extra } = settingsView(updated);
        await ctx.reply(body, extra);
        return;
      }
      default:
        await homeHandler(ctx);
    }
  } catch (err) {
    if (err instanceof AppError) {
      await promptStep(ctx, state, `❌ ${esc(err.message)}`);
      return;
    }
    throw err;
  }
}
