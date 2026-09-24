import type { Context } from 'telegraf';
import { currentUser } from '@/lib/bot/context';
import { mainKeyboard, openAppKeyboard } from '@/lib/bot/keyboards';
import { setState } from '@/lib/bot/session';
import { editOrReply, esc } from '@/lib/bot/telegram';
import { dayView, historyView, prescriptionListView, reportView, settingsView } from '@/lib/bot/views';
import { getDayDoses, getNextDose } from '@/lib/services/doses';
import { countDosesByPrescription, listPrescriptions } from '@/lib/services/prescriptions';
import { getUserStats } from '@/lib/services/stats';
import { displayName } from '@/lib/services/users';
import { dateIn, isDateString, relativeDay, safeTimeZone } from '@/lib/time';
import { getWebAppUrl } from '@/lib/webapp/url';
import { startAddPrescription } from '@/lib/bot/handlers/add-prescription';

export async function startHandler(ctx: Context) {
  const user = currentUser(ctx);
  await setState(user, null);

  const payload = 'payload' in ctx && typeof ctx.payload === 'string' ? ctx.payload : '';
  if (payload === 'add') return startAddPrescription(ctx);

  const { active } = await listPrescriptions(user.id);
  const lines = [
    `Assalomu alaykum, ${esc(displayName(user))}! 👋`,
    '',
    "🌿 <b>Sog'lom Hayot</b> — shifokor yozib bergan retsept bo'yicha dori ichishni eslatib turuvchi yordamchingiz.",
    '',
  ];
  if (active.length === 0) {
    lines.push(
      "Boshlash uchun <b>«➕ Yangi retsept»</b> tugmasini bosing va retseptdagi dorilarni kiriting — " +
        'qolganini men eslatib turaman: har bir dori vaqtida xabar yuboraman.'
    );
  } else {
    lines.push(`📋 Faol retseptlar: <b>${active.length} ta</b>`);
    const next = await getNextDose(user.id);
    if (next) {
      const tz = safeTimeZone(user.timezone);
      const day = relativeDay(next.date, dateIn(tz)).toLowerCase();
      lines.push(`⏰ Keyingi dori: <b>${esc(next.medication.name)}</b> — ${day} ${next.time}`);
    }
  }

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', ...mainKeyboard() });
  await sendOpenAppButton(ctx);
}

// Mini App: retseptlar, bugungi reja, hisobot va sozlamalar — hammasi bitta ilovada.
export async function sendOpenAppButton(ctx: Context) {
  const url = getWebAppUrl();
  if (!url) return;
  await ctx.reply('📱 Retseptlar, bugungi reja va hisobotni qulay ilovada ko\'ring:', openAppKeyboard(url));
}

export async function homeHandler(ctx: Context, text = 'Asosiy menyu') {
  await setState(currentUser(ctx), null);
  await ctx.reply(text, mainKeyboard());
}

export async function helpHandler(ctx: Context) {
  const text = [
    "ℹ️ <b>Sog'lom Hayot qanday ishlaydi?</b>",
    '',
    "1️⃣ <b>«➕ Yangi retsept»</b> — shifokor yozib bergan retseptni kiriting: davolanish muddati, dorilar, " +
      'kuniga necha marta va qaysi soatlarda.',
    '2️⃣ Har bir dori vaqtida eslatma yuboraman. <b>«✅ Ichdim»</b> yoki <b>«⏭ O\'tkazib yubordim»</b> ni bosing.',
    "3️⃣ Javob bermasangiz — biroz vaqtdan keyin yana bir bor eslataman.",
    '4️⃣ <b>«📅 Bugungi dorilar»</b> — bugungi reja; <b>«📊 Hisobot»</b> — davolanishga rioya darajasi.',
    '5️⃣ Kurs tugaganda natijani yuboraman va retsept tarixga o\'tadi.',
    '',
    '⚙️ Sozlamalarda eslatmani oldinroq olish, qayta eslatish va vaqt zonasini o\'zgartirish mumkin.',
    '',
    "⚠️ Bot shifokor o'rnini bosmaydi. Dori, miqdor va muddatni faqat shifokor belgilaydi.",
  ].join('\n');
  await ctx.reply(text, { parse_mode: 'HTML', ...mainKeyboard() });
  await sendOpenAppButton(ctx);
}

export async function todayHandler(ctx: Context, date?: string) {
  const user = currentUser(ctx);
  const tz = safeTimeZone(user.timezone);
  const now = new Date();
  const day = date && isDateString(date) ? date : dateIn(tz, now);
  const doses = await getDayDoses(user.id, day);
  const { text, extra } = dayView(doses, day, { now, timezone: tz });
  await editOrReply(ctx, text, extra);
}

export async function listHandler(ctx: Context) {
  const user = currentUser(ctx);
  const tz = safeTimeZone(user.timezone);
  const { active, finished } = await listPrescriptions(user.id);
  const counts = await countDosesByPrescription(active.map((p) => p.id));
  const { text, extra } = prescriptionListView(active, finished.length, { today: dateIn(tz), counts });
  await editOrReply(ctx, text, extra);
}

export async function historyHandler(ctx: Context) {
  const user = currentUser(ctx);
  const { finished } = await listPrescriptions(user.id);
  const counts = await countDosesByPrescription(finished.map((p) => p.id));
  const { text, extra } = historyView(finished, counts);
  await editOrReply(ctx, text, extra);
}

export async function reportHandler(ctx: Context, period: 7 | 30 = 7) {
  const user = currentUser(ctx);
  const stats = await getUserStats(user, period);
  const { text, extra } = reportView(stats, period);
  await editOrReply(ctx, text, extra);
}

export async function settingsHandler(ctx: Context) {
  const { text, extra } = settingsView(currentUser(ctx));
  await editOrReply(ctx, text, extra);
}
