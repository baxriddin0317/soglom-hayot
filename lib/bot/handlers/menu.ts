import type { Context } from 'telegraf';
import { currentUser, langFor, menuFor, trFor } from '@/lib/bot/context';
import { openAppKeyboard } from '@/lib/bot/keyboards';
import { setState } from '@/lib/bot/session';
import { editOrReply, esc } from '@/lib/bot/telegram';
import {
  adminView,
  dayView,
  historyView,
  languageView,
  prescriptionListView,
  reportView,
  settingsView,
  stockListView,
} from '@/lib/bot/views';
import { getAsNeededToday, getDayDoses, getNextDose } from '@/lib/services/doses';
import { countDosesByPrescription, listPrescriptions } from '@/lib/services/prescriptions';
import { getUserStats } from '@/lib/services/stats';
import { listStock } from '@/lib/services/stock';
import { getAdminOverview } from '@/lib/services/admin';
import { displayName, isAdmin, setAdminMode } from '@/lib/services/users';
import { dateIn, isDateString, relativeDay, safeTimeZone } from '@/lib/time';
import { getWebAppUrl } from '@/lib/webapp/url';
import { startAddPrescription } from '@/lib/bot/handlers/add-prescription';

export async function startHandler(ctx: Context) {
  const user = currentUser(ctx);
  await setState(user, null);

  // Birinchi marta — avval til tanlanadi (keyin salomlashish shu tilda).
  if (!user.language) {
    const { text, extra } = languageView(null, langFor(ctx), { first: true });
    await ctx.reply(text, extra);
    return;
  }

  const payload = 'payload' in ctx && typeof ctx.payload === 'string' ? ctx.payload : '';
  if (payload === 'add') return startAddPrescription(ctx);
  await welcome(ctx);
}

/** Salomlashish: nima qila olishi va keyingi dori. */
export async function welcome(ctx: Context) {
  const user = currentUser(ctx);
  const lang = langFor(ctx);
  const tr = trFor(ctx);
  const { active } = await listPrescriptions(user.id);
  const lines = [tr('start.hello', { name: esc(displayName(user, lang)) }), '', tr('start.about'), ''];
  if (active.length === 0) {
    lines.push(tr('start.empty', { add: tr('menu.add') }));
  } else {
    lines.push(tr('start.active', { n: active.length }));
    const next = await getNextDose(user.id);
    if (next) {
      const tz = safeTimeZone(user.timezone);
      const when = `${relativeDay(next.date, dateIn(tz), lang).toLowerCase()} ${next.time}`;
      lines.push(tr('start.next', { name: esc(next.medication.name), when }));
    }
  }

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', ...menuFor(ctx) });
  await sendOpenAppButton(ctx);
}

// Mini App: retseptlar, bugungi reja, hisobot va sozlamalar — hammasi bitta ilovada.
export async function sendOpenAppButton(ctx: Context) {
  const url = getWebAppUrl();
  if (!url) return;
  await ctx.reply(trFor(ctx)('start.openApp'), openAppKeyboard(url, langFor(ctx)));
}

export async function homeHandler(ctx: Context, text?: string) {
  await setState(currentUser(ctx), null);
  await ctx.reply(text ?? trFor(ctx)('menu.home'), menuFor(ctx));
}

export async function helpHandler(ctx: Context) {
  const tr = trFor(ctx);
  const text = tr('help.text', {
    add: tr('menu.add'),
    stock: tr('menu.stock'),
    today: tr('menu.today'),
    report: tr('menu.report'),
  });
  await ctx.reply(text, { parse_mode: 'HTML', ...menuFor(ctx) });
  await sendOpenAppButton(ctx);
}

export async function todayHandler(ctx: Context, date?: string) {
  const user = currentUser(ctx);
  const tz = safeTimeZone(user.timezone);
  const now = new Date();
  const today = dateIn(tz, now);
  const day = date && isDateString(date) ? date : today;
  const [doses, asNeeded] = await Promise.all([
    getDayDoses(user.id, day),
    day === today ? getAsNeededToday(user.id, today) : Promise.resolve([]),
  ]);
  const { text, extra } = dayView(doses, day, { now, timezone: tz, lang: langFor(ctx), asNeeded });
  await editOrReply(ctx, text, extra);
}

export async function listHandler(ctx: Context) {
  const user = currentUser(ctx);
  const tz = safeTimeZone(user.timezone);
  const { active, finished } = await listPrescriptions(user.id);
  const counts = await countDosesByPrescription(active.map((p) => p.id));
  const { text, extra } = prescriptionListView(active, finished.length, { today: dateIn(tz), counts, lang: langFor(ctx) });
  await editOrReply(ctx, text, extra);
}

export async function historyHandler(ctx: Context) {
  const user = currentUser(ctx);
  const { finished } = await listPrescriptions(user.id);
  const counts = await countDosesByPrescription(finished.map((p) => p.id));
  const { text, extra } = historyView(finished, counts, langFor(ctx));
  await editOrReply(ctx, text, extra);
}

export async function reportHandler(ctx: Context, period: 7 | 30 = 7) {
  const user = currentUser(ctx);
  const stats = await getUserStats(user, period);
  const { text, extra } = reportView(stats, period, langFor(ctx));
  await editOrReply(ctx, text, extra);
}

export async function settingsHandler(ctx: Context) {
  const { text, extra } = settingsView(currentUser(ctx));
  await editOrReply(ctx, text, extra);
}

export async function stockHandler(ctx: Context) {
  const items = await listStock(currentUser(ctx));
  const { text, extra } = stockListView(items, langFor(ctx));
  await editOrReply(ctx, text, extra);
}

export async function languageHandler(ctx: Context) {
  const user = currentUser(ctx);
  const { text, extra } = languageView(user.language, langFor(ctx));
  await editOrReply(ctx, text, extra);
}

/**
 * /admin va «🛠 Admin panel». Admin foydalanuvchi rejimida bo'lsa — admin rejimiga qaytaradi.
 * Admin bo'lmaganlar uchun buyruq mavjud emasdek — oddiy menyu.
 */
export async function adminHandler(ctx: Context) {
  let user = currentUser(ctx);
  if (!isAdmin(user)) {
    await ctx.reply(trFor(ctx)('menu.pick'), menuFor(ctx));
    return;
  }
  if (!user.adminMode) {
    user = await setAdminMode(user, true);
    ctx.state.user = user;
    await ctx.reply(trFor(ctx)('admin.adminMode'), menuFor(ctx));
  }
  const overview = await getAdminOverview(user.timezone, ctx.telegram);
  const { text, extra } = adminView(overview, langFor(ctx));
  await editOrReply(ctx, text, extra);
}
