import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { langFor, menuFor, trFor, userMiddleware } from '@/lib/bot/context';
import {
  addCallback,
  adminCallback,
  asNeededCallback,
  dayDoseCallback,
  dayNavCallback,
  languageCallback,
  medicationCallback,
  prescriptionCallback,
  reminderCallback,
  reportCallback,
  settingsCallback,
  stockCallback,
} from '@/lib/bot/handlers/callbacks';
import {
  adminHandler,
  helpHandler,
  homeHandler,
  languageHandler,
  reportHandler,
  sendOpenAppButton,
  settingsHandler,
  startHandler,
  stockHandler,
  todayHandler,
} from '@/lib/bot/handlers/menu';
import { startAddPrescription } from '@/lib/bot/handlers/add-prescription';
import { textHandler } from '@/lib/bot/handlers/text';
import { safeAnswerCbQuery } from '@/lib/bot/telegram';
import { t } from '@/lib/i18n';

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
  instance.command('stock', stockHandler);
  instance.command('report', (ctx) => reportHandler(ctx, 7));
  instance.command('settings', settingsHandler);
  instance.command('lang', languageHandler);
  instance.command('help', helpHandler);
  instance.command('admin', adminHandler);
  instance.command('cancel', (ctx) => homeHandler(ctx, trFor(ctx)('menu.cancelled')));

  // Callback ma'lumotlari qisqa (Telegram 64 bayt cheklovi): <bo'lim>:<amal>:<id>.
  instance.action(/^r:([tsa]):([a-z0-9]+)$/, reminderCallback);
  instance.action(/^d:([ts]):([a-z0-9]+)$/, dayDoseCallback);
  instance.action(/^day:(\d{4}-\d{2}-\d{2})$/, dayNavCallback);
  instance.action(/^(n|nm):([a-z0-9]+)$/, asNeededCallback);
  instance.action(/^rx:(l|h)()$/, prescriptionCallback);
  instance.action(/^rx:([vdfFxX]):([a-z0-9]+)$/, prescriptionCallback);
  instance.action(/^m:([vtsS]):([a-z0-9]+)$/, medicationCallback);
  instance.action(/^st:(l)()()$/, stockCallback);
  instance.action(/^st:([vex]):([a-z0-9]+)()$/, stockCallback);
  instance.action(/^st:(a):([a-z0-9]+):(\d{1,4})$/, stockCallback);
  instance.action(/^rep:(7|30)$/, reportCallback);
  instance.action('add', addCallback);
  instance.action(/^lang:(uz|uz_cyrl|ru)(?::(1))?$/, languageCallback);
  instance.action(/^set:(rem|lead|fu|tz|lang|back)(?::(\w+))?$/, settingsCallback);
  instance.action(/^adm:([ru])$/, adminCallback);
  // Eski versiya eslatmalaridagi tugmalar (MongoDB id'lari) — endi amal qilmaydi.
  instance.action(/^(taken|missed)_/, async (ctx) => {
    const tr = trFor(ctx);
    await safeAnswerCbQuery(ctx, tr('rem.expired', { today: tr('menu.today') }), { show_alert: true });
  });
  instance.on('callback_query', (ctx) => safeAnswerCbQuery(ctx));

  instance.on(message('text'), textHandler);
  // Rasm (retsept surati) — AI orqali o'qish keyingi bosqichda; hozircha qo'lda kiritishga yo'naltiramiz.
  instance.on(message('photo'), async (ctx) => {
    const tr = trFor(ctx);
    await ctx.reply(tr('media.photo', { add: tr('menu.add') }), menuFor(ctx));
  });
  instance.on('message', async (ctx) => {
    await ctx.reply(trFor(ctx)('media.other'), menuFor(ctx));
  });

  instance.catch(async (err, ctx) => {
    console.error('Bot xatolik:', err);
    const text = ctx.state.user ? t(langFor(ctx), 'common.error') : t('uz', 'common.error');
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery(text, { show_alert: true }).catch(() => {});
      return;
    }
    await ctx.reply(text).catch(() => {});
  });

  bot = instance;
  return instance;
}
