import type { Context } from 'telegraf';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { TIMEZONE_OPTIONS } from '@/lib/constants';
import { currentUser } from '@/lib/bot/context';
import { setState } from '@/lib/bot/session';
import { editOrReply, esc, safeAnswerCbQuery } from '@/lib/bot/telegram';
import {
  confirmView,
  followUpOptionsView,
  leadOptionsView,
  medicationView,
  prescriptionView,
  reminderView,
  settingsView,
  timezoneOptionsView,
} from '@/lib/bot/views';
import { promptStep, startAddPrescription } from '@/lib/bot/handlers/add-prescription';
import { historyHandler, listHandler, reportHandler, settingsHandler, todayHandler } from '@/lib/bot/handlers/menu';
import { getReminderGroup, markDose, markGroup, type DoseAction } from '@/lib/services/doses';
import {
  countDosesByPrescription,
  deletePrescription,
  emptyCounts,
  finishPrescription,
  getPrescription,
  stopMedication,
} from '@/lib/services/prescriptions';
import { refreshReminderMessage } from '@/lib/services/scheduler';
import { updateSettings } from '@/lib/services/users';
import { dateIn, formatDate, safeTimeZone } from '@/lib/time';

type Match = { match: RegExpExecArray };
type CallbackCtx = Context & Match;

// Biznes xatosi (masalan "Doza topilmadi") foydalanuvchiga alert sifatida ko'rsatiladi.
async function guard(ctx: Context, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof AppError) {
      await safeAnswerCbQuery(ctx, err.message, { show_alert: true });
      return;
    }
    throw err;
  }
}

const TOAST: Record<DoseAction, string> = {
  take: "✅ Belgilandi. Sog'ayib keting!",
  skip: "⏭ O'tkazib yuborildi",
  undo: 'Bekor qilindi',
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
    await safeAnswerCbQuery(ctx, kind === 's' ? TOAST.skip : TOAST.take);
    const doses = await getReminderGroup(user.id, dose.scheduledAt);
    const { text, extra } = reminderView(doses, { now: new Date(), timezone: safeTimeZone(user.timezone) });
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
    await safeAnswerCbQuery(ctx, TOAST[action]);
    await todayHandler(ctx, dose.date);
    await refreshReminderMessage(ctx.telegram, user, dose);
  });
}

export async function dayNavCallback(ctx: CallbackCtx) {
  await safeAnswerCbQuery(ctx);
  await todayHandler(ctx, ctx.match[1]);
}

// --- Retseptlar: rx:l | rx:h | rx:v|d|f|F|x|X:<id> ---
export async function prescriptionCallback(ctx: CallbackCtx) {
  await guard(ctx, async () => {
    const user = currentUser(ctx);
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
        const { text, extra } = prescriptionView(p, counts, { today: dateIn(tz) });
        return editOrReply(ctx, text, extra);
      }
      case 'd': {
        await safeAnswerCbQuery(ctx);
        await setState(user, { step: 'edit_days', prescriptionId: p.id });
        await promptStep(
          ctx,
          { step: 'edit_days', prescriptionId: p.id },
          `📋 ${title}: hozir ${formatDate(p.startDate)} – ${formatDate(p.endDate)}`
        );
        return;
      }
      case 'f': {
        await safeAnswerCbQuery(ctx);
        const { text, extra } = confirmView(
          `⏹ ${title} kursini hozir yakunlaysizmi?\n\nKelgusi eslatmalar to'xtaydi, tarix saqlanib qoladi.`,
          { label: '⏹ Ha, yakunlash', data: `rx:F:${p.id}` },
          `rx:v:${p.id}`
        );
        return editOrReply(ctx, text, extra);
      }
      case 'F': {
        await finishPrescription(user, p.id);
        await safeAnswerCbQuery(ctx, '⏹ Kurs yakunlandi');
        await editOrReply(ctx, `⏹ ${title} kursi yakunlandi. U «🧾 Tarix» bo'limida saqlanadi.`, { parse_mode: 'HTML' });
        return;
      }
      case 'x': {
        await safeAnswerCbQuery(ctx);
        const { text, extra } = confirmView(
          `🗑 ${title} retseptini butunlay o'chirasizmi?\n\nBarcha dorilar va ichish tarixi ham o'chadi. Bu amalni qaytarib bo'lmaydi.`,
          { label: "🗑 Ha, o'chirish", data: `rx:X:${p.id}` },
          `rx:v:${p.id}`
        );
        return editOrReply(ctx, text, extra);
      }
      case 'X': {
        await deletePrescription(user.id, p.id);
        await safeAnswerCbQuery(ctx, "🗑 O'chirildi");
        await editOrReply(ctx, `🗑 ${title} retsepti o'chirildi.`, { parse_mode: 'HTML' });
        return;
      }
    }
  });
}

// --- Dorilar: m:v|t|s|S:<id> ---
export async function medicationCallback(ctx: CallbackCtx) {
  await guard(ctx, async () => {
    const user = currentUser(ctx);
    const [, action, id] = ctx.match;
    const med = await db.medication.findFirst({ where: { id, userId: user.id }, include: { prescription: true } });
    if (!med) throw new AppError('Dori topilmadi', 'not_found');

    switch (action) {
      case 'v': {
        await safeAnswerCbQuery(ctx);
        const { text, extra } = medicationView(med, med.prescription);
        return editOrReply(ctx, text, extra);
      }
      case 't': {
        await safeAnswerCbQuery(ctx);
        await setState(user, { step: 'edit_times', medicationId: med.id });
        await promptStep(
          ctx,
          { step: 'edit_times', medicationId: med.id },
          `💊 <b>${esc(med.name)}</b> — hozirgi vaqtlar: ${med.times.join(', ')}`
        );
        return;
      }
      case 's': {
        await safeAnswerCbQuery(ctx);
        const { text, extra } = confirmView(
          `⏹ <b>${esc(med.name)}</b> ni to'xtatasizmi?\n\nBu dori bo'yicha eslatmalar endi kelmaydi.`,
          { label: "⏹ Ha, to'xtatish", data: `m:S:${med.id}` },
          `m:v:${med.id}`
        );
        return editOrReply(ctx, text, extra);
      }
      case 'S': {
        const { prescriptionFinished } = await stopMedication(user, med.id);
        await safeAnswerCbQuery(ctx, "⏹ To'xtatildi");
        const suffix = prescriptionFinished ? '\n\nRetseptda boshqa faol dori qolmadi — kurs yakunlandi.' : '';
        await editOrReply(ctx, `⏹ <b>${esc(med.name)}</b> to'xtatildi.${suffix}`, { parse_mode: 'HTML' });
        return;
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

// --- Sozlamalar: set:rem | set:lead[:n] | set:fu[:n] | set:tz[:i|custom] | set:back ---
export async function settingsCallback(ctx: CallbackCtx) {
  await guard(ctx, async () => {
    const user = currentUser(ctx);
    const [, key, value] = ctx.match;

    if (key === 'back') {
      await safeAnswerCbQuery(ctx);
      return settingsHandler(ctx);
    }
    if (key === 'rem') {
      const updated = await updateSettings(user, { remindersEnabled: !user.remindersEnabled });
      ctx.state.user = updated;
      await safeAnswerCbQuery(ctx, updated.remindersEnabled ? '🔔 Eslatmalar yoqildi' : "🔕 Eslatmalar o'chirildi");
      return settingsHandler(ctx);
    }
    if (key === 'lead') {
      if (value === undefined) {
        await safeAnswerCbQuery(ctx);
        const { text, extra } = leadOptionsView(user.leadMinutes);
        return editOrReply(ctx, text, extra);
      }
      ctx.state.user = await updateSettings(user, { leadMinutes: Number(value) });
      await safeAnswerCbQuery(ctx, '✅ Saqlandi');
      return settingsHandler(ctx);
    }
    if (key === 'fu') {
      if (value === undefined) {
        await safeAnswerCbQuery(ctx);
        const { text, extra } = followUpOptionsView(user.followUpMinutes);
        return editOrReply(ctx, text, extra);
      }
      ctx.state.user = await updateSettings(user, { followUpMinutes: Number(value) });
      await safeAnswerCbQuery(ctx, '✅ Saqlandi');
      return settingsHandler(ctx);
    }
    if (key === 'tz') {
      if (value === undefined) {
        await safeAnswerCbQuery(ctx);
        const { text, extra } = timezoneOptionsView(user.timezone);
        return editOrReply(ctx, text, extra);
      }
      if (value === 'custom') {
        await safeAnswerCbQuery(ctx);
        await setState(user, { step: 'tz_custom' });
        await promptStep(ctx, { step: 'tz_custom' });
        return;
      }
      const option = TIMEZONE_OPTIONS[Number(value)];
      if (!option) throw new AppError('Noma\'lum vaqt zonasi');
      ctx.state.user = await updateSettings(user, { timezone: option.tz });
      await safeAnswerCbQuery(ctx, `✅ ${option.label}`);
      const { text, extra } = settingsView(ctx.state.user);
      return editOrReply(ctx, text, extra);
    }
    await safeAnswerCbQuery(ctx);
  });
}
