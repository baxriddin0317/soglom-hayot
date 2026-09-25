import type { Context } from 'telegraf';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { TIMEZONE_OPTIONS } from '@/lib/constants';
import { isLang, LANG_LABELS, t, type Key } from '@/lib/i18n';
import { currentUser, langFor, menuFor, trFor } from '@/lib/bot/context';
import { setState } from '@/lib/bot/session';
import { editOrReply, esc, safeAnswerCbQuery } from '@/lib/bot/telegram';
import {
  adminView,
  confirmView,
  followUpOptionsView,
  leadOptionsView,
  medicationView,
  prescriptionView,
  qtyText,
  reminderView,
  settingsView,
  stockMedView,
  timezoneOptionsView,
} from '@/lib/bot/views';
import { promptStep, startAddPrescription } from '@/lib/bot/handlers/add-prescription';
import {
  historyHandler,
  languageHandler,
  listHandler,
  reportHandler,
  settingsHandler,
  stockHandler,
  todayHandler,
  welcome,
} from '@/lib/bot/handlers/menu';
import { getReminderGroup, logAsNeeded, markDose, markGroup, type DoseAction } from '@/lib/services/doses';
import {
  countDosesByPrescription,
  deletePrescription,
  emptyCounts,
  finishPrescription,
  getOwnedMedication,
  getPrescription,
  stopMedication,
} from '@/lib/services/prescriptions';
import { refreshReminderMessage } from '@/lib/services/scheduler';
import { addStock, listStock, unitOf, updateStock } from '@/lib/services/stock';
import { getAdminOverview } from '@/lib/services/admin';
import { isAdmin, setAdminMode, updateSettings } from '@/lib/services/users';
import { dateIn, formatDate, safeTimeZone } from '@/lib/time';

type Match = { match: RegExpExecArray };
type CallbackCtx = Context & Match;

// Biznes xatosi (masalan "Doza topilmadi") foydalanuvchiga alert sifatida ko'rsatiladi.
async function guard(ctx: Context, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof AppError) {
      await safeAnswerCbQuery(ctx, err.text(langFor(ctx)), { show_alert: true });
      return;
    }
    throw err;
  }
}

const TOAST: Record<DoseAction, Key> = {
  take: 'toast.taken',
  skip: 'toast.skipped',
  undo: 'toast.undone',
};

// --- Eslatma xabaridagi tugmalar: r:t|s|a:<doseId> ---
export async function reminderCallback(ctx: CallbackCtx) {
  await guard(ctx, async () => {
    const user = currentUser(ctx);
    const [, kind, doseId] = ctx.match;
    const dose =
      kind === 'a'
        ? await markGroup(user, doseId, 'take')
        : await markDose(user, doseId, kind === 't' ? 'take' : 'skip');
    await safeAnswerCbQuery(ctx, trFor(ctx)(kind === 's' ? TOAST.skip : TOAST.take));
    const doses = await getReminderGroup(user.id, dose.scheduledAt);
    const { text, extra } = reminderView(doses, {
      now: new Date(),
      timezone: safeTimeZone(user.timezone),
      lang: langFor(ctx),
    });
    await editOrReply(ctx, text, extra);
  });
}

// --- "Bugungi dorilar" ekranidagi tugmalar: d:t|s:<doseId> ---
export async function dayDoseCallback(ctx: CallbackCtx) {
  await guard(ctx, async () => {
    const user = currentUser(ctx);
    const [, kind, doseId] = ctx.match;
    const action: DoseAction = kind === 't' ? 'take' : 'skip';
    const dose = await markDose(user, doseId, action);
    await safeAnswerCbQuery(ctx, trFor(ctx)(TOAST[action]));
    await todayHandler(ctx, dose.date);
    await refreshReminderMessage(ctx.telegram, user, dose);
  });
}

export async function dayNavCallback(ctx: CallbackCtx) {
  await safeAnswerCbQuery(ctx);
  await todayHandler(ctx, ctx.match[1]);
}

// --- "Kerak bo'lganda" dori: n:<medId> (kun rejasidan) | nm:<medId> (dori sahifasidan) ---
export async function asNeededCallback(ctx: CallbackCtx) {
  await guard(ctx, async () => {
    const user = currentUser(ctx);
    const tr = trFor(ctx);
    const [, source, medId] = ctx.match;
    const log = await logAsNeeded(user, medId);
    const name = log.medication.name;
    if (log.overLimit) {
      await safeAnswerCbQuery(ctx, tr('prn.overLimit', { name, n: log.countToday, max: log.medication.maxPerDay ?? 0 }), {
        show_alert: true,
      });
    } else {
      await safeAnswerCbQuery(ctx, tr('prn.logged', { name, time: log.dose.time }));
    }
    if (source === 'nm') {
      const med = await getOwnedMedication(user.id, medId);
      const { text, extra } = medicationView(med, med.prescription, langFor(ctx));
      await editOrReply(ctx, text, extra);
    } else {
      await todayHandler(ctx, log.dose.date);
    }
  });
}

// --- Retseptlar: rx:l | rx:h | rx:v|d|f|F|x|X:<id> ---
export async function prescriptionCallback(ctx: CallbackCtx) {
  await guard(ctx, async () => {
    const user = currentUser(ctx);
    const lang = langFor(ctx);
    const tr = trFor(ctx);
    const [, action, id] = ctx.match;
    const tz = safeTimeZone(user.timezone);

    if (action === 'l') {
      await safeAnswerCbQuery(ctx);
      return listHandler(ctx);
    }
    if (action === 'h') {
      await safeAnswerCbQuery(ctx);
      return historyHandler(ctx);
    }

    const p = await getPrescription(user.id, id);
    const title = `«${esc(p.title)}»`;

    switch (action) {
      case 'v': {
        await safeAnswerCbQuery(ctx);
        const counts = (await countDosesByPrescription([p.id])).get(p.id) ?? emptyCounts();
        const { text, extra } = prescriptionView(p, counts, { today: dateIn(tz), lang });
        return editOrReply(ctx, text, extra);
      }
      case 'd': {
        await safeAnswerCbQuery(ctx);
        await setState(user, { step: 'edit_days', prescriptionId: p.id });
        await promptStep(
          ctx,
          { step: 'edit_days', prescriptionId: p.id },
          tr('rx.currentRange', { title, from: formatDate(p.startDate), to: formatDate(p.endDate) })
        );
        return;
      }
      case 'f': {
        await safeAnswerCbQuery(ctx);
        const { text, extra } = confirmView(
          tr('rx.confirmFinish', { title }),
          { label: tr('rx.confirmFinishYes'), data: `rx:F:${p.id}` },
          `rx:v:${p.id}`,
          lang
        );
        return editOrReply(ctx, text, extra);
      }
      case 'F': {
        await finishPrescription(user, p.id);
        await safeAnswerCbQuery(ctx, tr('rx.finishedToast'));
        await editOrReply(ctx, tr('rx.finishedMsg', { title }), { parse_mode: 'HTML' });
        return;
      }
      case 'x': {
        await safeAnswerCbQuery(ctx);
        const { text, extra } = confirmView(
          tr('rx.confirmDelete', { title }),
          { label: tr('rx.confirmDeleteYes'), data: `rx:X:${p.id}` },
          `rx:v:${p.id}`,
          lang
        );
        return editOrReply(ctx, text, extra);
      }
      case 'X': {
        await deletePrescription(user.id, p.id);
        await safeAnswerCbQuery(ctx, tr('rx.deletedToast'));
        await editOrReply(ctx, tr('rx.deletedMsg', { title }), { parse_mode: 'HTML' });
        return;
      }
    }
  });
}

// --- Dorilar: m:v|t|s|S:<id> ---
export async function medicationCallback(ctx: CallbackCtx) {
  await guard(ctx, async () => {
    const user = currentUser(ctx);
    const lang = langFor(ctx);
    const tr = trFor(ctx);
    const [, action, id] = ctx.match;
    const med = await db.medication.findFirst({ where: { id, userId: user.id }, include: { prescription: true } });
    if (!med) throw new AppError('err.medNotFound', {}, 'not_found');

    switch (action) {
      case 'v': {
        await safeAnswerCbQuery(ctx);
        const { text, extra } = medicationView(med, med.prescription, lang);
        return editOrReply(ctx, text, extra);
      }
      case 't': {
        await safeAnswerCbQuery(ctx);
        await setState(user, { step: 'edit_times', medicationId: med.id });
        await promptStep(
          ctx,
          { step: 'edit_times', medicationId: med.id },
          tr('med.currentTimes', { name: esc(med.name), times: med.times.join(', ') })
        );
        return;
      }
      case 's': {
        await safeAnswerCbQuery(ctx);
        const { text, extra } = confirmView(
          tr('med.confirmStop', { name: esc(med.name) }),
          { label: tr('med.confirmStopYes'), data: `m:S:${med.id}` },
          `m:v:${med.id}`,
          lang
        );
        return editOrReply(ctx, text, extra);
      }
      case 'S': {
        const { prescriptionFinished } = await stopMedication(user, med.id);
        await safeAnswerCbQuery(ctx, tr('med.stoppedToast'));
        const suffix = prescriptionFinished ? tr('med.rxFinished') : '';
        await editOrReply(ctx, `${tr('med.stoppedMsg', { name: esc(med.name) })}${suffix}`, { parse_mode: 'HTML' });
        return;
      }
    }
  });
}

// --- Zaxira: st:l | st:v|e|x:<medId> | st:a:<medId>:<n> ---
export async function stockCallback(ctx: CallbackCtx) {
  await guard(ctx, async () => {
    const user = currentUser(ctx);
    const lang = langFor(ctx);
    const tr = trFor(ctx);
    const [, action, medId, amount] = ctx.match;

    if (action === 'l') {
      await safeAnswerCbQuery(ctx);
      return stockHandler(ctx);
    }

    const showMed = async () => {
      const item = (await listStock(user)).find((i) => i.medication.id === medId);
      if (!item) return stockHandler(ctx);
      const { text, extra } = stockMedView(item, lang);
      await editOrReply(ctx, text, extra);
    };

    switch (action) {
      case 'v':
        await safeAnswerCbQuery(ctx);
        return showMed();
      case 'a': {
        const med = await addStock(user, medId, Number(amount));
        await safeAnswerCbQuery(ctx, tr('stock.added', { qty: qtyText(Number(amount), unitOf(med), lang) }));
        return showMed();
      }
      case 'e': {
        await safeAnswerCbQuery(ctx);
        const med = await getOwnedMedication(user.id, medId);
        await setState(user, { step: 'stock_qty', medicationId: med.id });
        await promptStep(ctx, { step: 'stock_qty', medicationId: med.id }, `💊 <b>${esc(med.name)}</b>`);
        return;
      }
      case 'x': {
        const med = await updateStock(user, medId, { stock: null });
        await safeAnswerCbQuery(ctx, tr('stock.disabled', { name: med.name }));
        return showMed();
      }
    }
  });
}

export async function reportCallback(ctx: CallbackCtx) {
  await safeAnswerCbQuery(ctx);
  await reportHandler(ctx, ctx.match[1] === '30' ? 30 : 7);
}

export async function addCallback(ctx: Context) {
  await safeAnswerCbQuery(ctx);
  await startAddPrescription(ctx);
}

// --- Til: lang:<uz|uz_cyrl|ru>[:1] (":1" — /start dagi birinchi tanlov) ---
export async function languageCallback(ctx: CallbackCtx) {
  await guard(ctx, async () => {
    const [, code, first] = ctx.match;
    if (!isLang(code)) throw new AppError('err.lang');
    const updated = await updateSettings(currentUser(ctx), { language: code });
    ctx.state.user = updated;
    await safeAnswerCbQuery(ctx, t(code, 'start.langSaved', { lang: LANG_LABELS[code] }));
    if (first) {
      await editOrReply(ctx, t(code, 'start.langSaved', { lang: LANG_LABELS[code] }));
      await welcome(ctx);
      return;
    }
    // Pastki klaviatura ham yangi tilda bo'lishi uchun yangi xabar bilan yuboramiz.
    await ctx.reply(t(code, 'start.langSaved', { lang: LANG_LABELS[code] }), menuFor(ctx));
    const { text, extra } = settingsView(updated);
    await editOrReply(ctx, text, extra);
  });
}

// --- Sozlamalar: set:rem | set:lead[:n] | set:fu[:n] | set:tz[:i|custom] | set:lang | set:back ---
export async function settingsCallback(ctx: CallbackCtx) {
  await guard(ctx, async () => {
    const user = currentUser(ctx);
    const lang = langFor(ctx);
    const tr = trFor(ctx);
    const [, key, value] = ctx.match;

    if (key === 'back') {
      await safeAnswerCbQuery(ctx);
      return settingsHandler(ctx);
    }
    if (key === 'lang') {
      await safeAnswerCbQuery(ctx);
      return languageHandler(ctx);
    }
    if (key === 'rem') {
      const updated = await updateSettings(user, { remindersEnabled: !user.remindersEnabled });
      ctx.state.user = updated;
      await safeAnswerCbQuery(ctx, tr(updated.remindersEnabled ? 'set.remOn' : 'set.remOff'));
      return settingsHandler(ctx);
    }
    if (key === 'lead') {
      if (value === undefined) {
        await safeAnswerCbQuery(ctx);
        const { text, extra } = leadOptionsView(user.leadMinutes, lang);
        return editOrReply(ctx, text, extra);
      }
      ctx.state.user = await updateSettings(user, { leadMinutes: Number(value) });
      await safeAnswerCbQuery(ctx, tr('set.saved'));
      return settingsHandler(ctx);
    }
    if (key === 'fu') {
      if (value === undefined) {
        await safeAnswerCbQuery(ctx);
        const { text, extra } = followUpOptionsView(user.followUpMinutes, lang);
        return editOrReply(ctx, text, extra);
      }
      ctx.state.user = await updateSettings(user, { followUpMinutes: Number(value) });
      await safeAnswerCbQuery(ctx, tr('set.saved'));
      return settingsHandler(ctx);
    }
    if (key === 'tz') {
      if (value === undefined) {
        await safeAnswerCbQuery(ctx);
        const { text, extra } = timezoneOptionsView(user.timezone, lang);
        return editOrReply(ctx, text, extra);
      }
      if (value === 'custom') {
        await safeAnswerCbQuery(ctx);
        await setState(user, { step: 'tz_custom' });
        await promptStep(ctx, { step: 'tz_custom' });
        return;
      }
      const option = TIMEZONE_OPTIONS[Number(value)];
      if (!option) throw new AppError('err.unknownTz');
      ctx.state.user = await updateSettings(user, { timezone: option.tz });
      await safeAnswerCbQuery(ctx, `✅ ${tr(option.key)}`);
      const { text, extra } = settingsView(ctx.state.user);
      return editOrReply(ctx, text, extra);
    }
    await safeAnswerCbQuery(ctx);
  });
}

// --- Admin: adm:r (yangilash) | adm:u (foydalanuvchi rejimiga o'tish) ---
export async function adminCallback(ctx: CallbackCtx) {
  await guard(ctx, async () => {
    const user = currentUser(ctx);
    if (!isAdmin(user)) throw new AppError('err.notAdmin', {}, 'forbidden');
    const tr = trFor(ctx);
    if (ctx.match[1] === 'u') {
      ctx.state.user = await setAdminMode(user, false);
      await safeAnswerCbQuery(ctx);
      await ctx.reply(tr('admin.userMode'), menuFor(ctx));
      return;
    }
    await safeAnswerCbQuery(ctx, '🔄');
    const overview = await getAdminOverview(user.timezone, ctx.telegram);
    const { text, extra } = adminView(overview, langFor(ctx));
    await editOrReply(ctx, text, extra);
  });
}
