import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { userMiddleware } from '@/lib/bot/context';
import { mainKeyboard } from '@/lib/bot/keyboards';
import {
  addCallback,
  dayDoseCallback,
  dayNavCallback,
  medicationCallback,
  prescriptionCallback,
  reminderCallback,
  reportCallback,
  settingsCallback,
} from '@/lib/bot/handlers/callbacks';
import { helpHandler, homeHandler, reportHandler, sendOpenAppButton, settingsHandler, startHandler, todayHandler } from '@/lib/bot/handlers/menu';
import { startAddPrescription } from '@/lib/bot/handlers/add-prescription';
import { textHandler } from '@/lib/bot/handlers/text';
import { safeAnswerCbQuery } from '@/lib/bot/telegram';

let bot: Telegraf | undefined;

// Bot faqat birinchi so'rovda yaratiladi (build paytida token talab qilinmasligi uchun)
// va server instance umri davomida qayta ishlatiladi.
//
// MUHIM: bu yerda `bot.launch()` YO'Q va bo'lmasligi kerak — launch (long polling)
// webhook'ni o'chirib yuboradi. Update'lar /api/telegram orqali keladi.
export function getBot(): Telegraf {
  if (bot) return bot;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN sozlanmagan');
  }

  // handlerTimeout Vercel funksiyasining maxDuration (60s) dan kichik bo'lishi kerak.
  const instance = new Telegraf(token, { handlerTimeout: 55_000 });

  instance.use(userMiddleware);

  instance.start(startHandler);
  instance.command('app', sendOpenAppButton);
  instance.command('today', (ctx) => todayHandler(ctx));
  instance.command('add', startAddPrescription);
  instance.command('report', (ctx) => reportHandler(ctx, 7));
  instance.command('settings', settingsHandler);
  instance.command('help', helpHandler);
  instance.command('cancel', (ctx) => homeHandler(ctx, '❌ Bekor qilindi.'));

  // Callback ma'lumotlari qisqa (Telegram 64 bayt cheklovi): <bo'lim>:<amal>:<id>.
  instance.action(/^r:([tsa]):([a-z0-9]+)$/, reminderCallback);
  instance.action(/^d:([ts]):([a-z0-9]+)$/, dayDoseCallback);
  instance.action(/^day:(\d{4}-\d{2}-\d{2})$/, dayNavCallback);
  instance.action(/^rx:(l|h)()$/, prescriptionCallback);
  instance.action(/^rx:([vdfFxX]):([a-z0-9]+)$/, prescriptionCallback);
  instance.action(/^m:([vtsS]):([a-z0-9]+)$/, medicationCallback);
  instance.action(/^rep:(7|30)$/, reportCallback);
  instance.action('add', addCallback);
  instance.action(/^set:(rem|lead|fu|tz|back)(?::(\w+))?$/, settingsCallback);
  // Eski versiya eslatmalaridagi tugmalar (MongoDB id'lari) — endi amal qilmaydi.
  instance.action(/^(taken|missed)_/, async (ctx) => {
    await safeAnswerCbQuery(ctx, "Bu eslatma eskirgan. «📅 Bugungi dorilar» bo'limidan belgilang.", { show_alert: true });
  });
  instance.on('callback_query', (ctx) => safeAnswerCbQuery(ctx));

  instance.on(message('text'), textHandler);
  instance.on('message', async (ctx) => {
    await ctx.reply('Men faqat matn va tugmalarni tushunaman. Quyidagi menyudan tanlang 👇', mainKeyboard());
  });

  instance.catch(async (err, ctx) => {
    console.error('Bot xatolik:', err);
    const text = "Xatolik yuz berdi. Qayta urinib ko'ring.";
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery(text, { show_alert: true }).catch(() => {});
      return;
    }
    await ctx.reply(text).catch(() => {});
  });

  bot = instance;
  return instance;
}
