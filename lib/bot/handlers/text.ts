import type { Context } from 'telegraf';
import { AppError } from '@/lib/errors';
import { currentUser, langFor, menuFor, trFor } from '@/lib/bot/context';
import { isButton, menuActionFor, type MenuAction } from '@/lib/bot/keyboards';
import { getState, setState, type BotState } from '@/lib/bot/session';
import { esc } from '@/lib/bot/telegram';
import { medicationView, prescriptionView, settingsView, stockMedView } from '@/lib/bot/views';
import { handlePrescriptionStep, promptStep, startAddPrescription, stepBack } from '@/lib/bot/handlers/add-prescription';
import {
  adminHandler,
  helpHandler,
  historyHandler,
  homeHandler,
  listHandler,
  reportHandler,
  settingsHandler,
  stockHandler,
  todayHandler,
} from '@/lib/bot/handlers/menu';
import {
  countDosesByPrescription,
  emptyCounts,
  parseStockQty,
  setPrescriptionDays,
  updateMedicationTimes,
} from '@/lib/services/prescriptions';
import { listStock, updateStock } from '@/lib/services/stock';
import { updateSettings } from '@/lib/services/users';
import { dateIn, parseTimes, safeTimeZone } from '@/lib/time';
import { db } from '@/lib/db';

const MENU: Record<MenuAction, (ctx: Context) => Promise<unknown>> = {
  today: (ctx) => todayHandler(ctx),
  add: startAddPrescription,
  list: listHandler,
  history: historyHandler,
  stock: stockHandler,
  report: (ctx) => reportHandler(ctx, 7),
  settings: settingsHandler,
  help: helpHandler,
  home: (ctx) => homeHandler(ctx),
  admin: adminHandler,
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
  const tr = trFor(ctx);

  const menu = menuActionFor(text);
  if (menu) {
    if (state) await setState(user, null);
    await MENU[menu](ctx);
    return;
  }

  if (isButton(text, 'common.cancel')) {
    await homeHandler(ctx, state ? tr('menu.cancelled') : tr('menu.home'));
    return;
  }

  if (!state) {
    await ctx.reply(tr('menu.pick'), menuFor(ctx));
    return;
  }

  if (isButton(text, 'common.back')) {
    if (!(await stepBack(ctx, state))) await homeHandler(ctx);
    return;
  }

  if (await handlePrescriptionStep(ctx, state, text)) return;
  await handleEditStep(ctx, state, text);
}

async function handleEditStep(ctx: Context, state: BotState, text: string) {
  const user = currentUser(ctx);
  const lang = langFor(ctx);
  const tr = trFor(ctx);
  try {
    switch (state.step) {
      case 'edit_times': {
        const times = parseTimes(text);
        if (!times) {
          await promptStep(ctx, state, tr('add.errTimesShort'));
          return;
        }
        const med = await updateMedicationTimes(user, state.medicationId, times);
        await setState(user, null);
        await ctx.reply(tr('med.timesSaved', { times: med.times.join(', ') }), { parse_mode: 'HTML', ...menuFor(ctx) });
        const p = await db.prescription.findUniqueOrThrow({ where: { id: med.prescriptionId } });
        const { text: body, extra } = medicationView(med, p, lang);
        await ctx.reply(body, extra);
        return;
      }
      case 'edit_days': {
        const days = Number(text.replace(/\D+/g, ''));
        const p = await setPrescriptionDays(user, state.prescriptionId, days);
        await setState(user, null);
        await ctx.reply(tr('rx.daysUpdated'), menuFor(ctx));
        const counts = (await countDosesByPrescription([p.id])).get(p.id) ?? emptyCounts();
        const { text: body, extra } = prescriptionView(p, counts, { today: dateIn(safeTimeZone(user.timezone)), lang });
        await ctx.reply(body, extra);
        return;
      }
      case 'stock_qty': {
        const qty = parseStockQty(text.replace(/[^\d.,]/g, ''));
        if (qty === undefined || qty === null) {
          await promptStep(ctx, state, tr('add.errStock', { skip: tr('common.cancel') }));
          return;
        }
        await updateStock(user, state.medicationId, { stock: qty });
        await setState(user, null);
        await ctx.reply(tr('set.saved'), menuFor(ctx));
        const item = (await listStock(user)).find((i) => i.medication.id === state.medicationId);
        if (item) {
          const { text: body, extra } = stockMedView(item, lang);
          await ctx.reply(body, extra);
        }
        return;
      }
      case 'tz_custom': {
        const updated = await updateSettings(user, { timezone: text });
        ctx.state.user = updated;
        await setState(updated, null);
        await ctx.reply(tr('set.tzSaved', { tz: esc(updated.timezone) }), { parse_mode: 'HTML', ...menuFor(ctx) });
        const { text: body, extra } = settingsView(updated);
        await ctx.reply(body, extra);
        return;
      }
      default:
        await homeHandler(ctx);
    }
  } catch (err) {
    if (err instanceof AppError) {
      await promptStep(ctx, state, `❌ ${esc(err.text(lang))}`);
      return;
    }
    throw err;
  }
}
