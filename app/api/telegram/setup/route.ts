import { NextResponse, type NextRequest } from 'next/server';
import { TelegramError } from 'telegraf';
import { getBot } from '@/lib/bot';
import { t, type Key, type Lang } from '@/lib/i18n';
import { hasCronSecret } from '@/lib/secrets';
import { adminIds } from '@/lib/services/users';

const COMMANDS: [string, Key][] = [
  ['start', 'cmd.start'],
  ['today', 'cmd.today'],
  ['add', 'cmd.add'],
  ['stock', 'cmd.stock'],
  ['report', 'cmd.report'],
  ['settings', 'cmd.settings'],
  ['lang', 'cmd.lang'],
  ['app', 'cmd.app'],
  ['help', 'cmd.help'],
];

// Webhook, Mini App menyu tugmasi va buyruqlarni bir bosishda o'rnatish.
// Deploydan keyin PRODUCTION domenda bir marta oching:
//   https://<DOMEN>/api/telegram/setup?key=<CRON_SECRET>
//
// Webhook shu so'rov kelgan domenga o'rnatiladi — preview URL'da ochmang.

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET sozlanmagan — setup bloklangan.' }, { status: 500 });
  }
  if (!hasCronSecret(req)) {
    return NextResponse.json({ ok: false, error: "Kalit noto'g'ri." }, { status: 401 });
  }

  // Telegram secret_token'da faqat shu belgilarga ruxsat beradi.
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!webhookSecret || !/^[A-Za-z0-9_-]{1,256}$/.test(webhookSecret)) {
    return NextResponse.json(
      { ok: false, error: "TELEGRAM_WEBHOOK_SECRET sozlanmagan yoki noto'g'ri (faqat A-Z, a-z, 0-9, _ va -)." },
      { status: 500 }
    );
  }

  const webhookUrl = `${req.nextUrl.origin}/api/telegram`;
  const webAppUrl = process.env.WEBAPP_URL || `${req.nextUrl.origin}/app`;

  try {
    const { telegram } = getBot();
    await telegram.setWebhook(webhookUrl, {
      secret_token: webhookSecret,
      // my_chat_member — foydalanuvchi botni bloklaganini bilish uchun (unga eslatma yubormaymiz).
      allowed_updates: ['message', 'callback_query', 'my_chat_member'],
      // Eski (Render'dagi) botdan qolib ketgan navbatni tashlab yuboramiz.
      drop_pending_updates: req.nextUrl.searchParams.get('drop') === '1',
    });
    // Chat pastidagi menyu tugmasi Mini App'ni ochadi (barcha foydalanuvchilar uchun).
    await telegram.setChatMenuButton({
      menuButton: { type: 'web_app', text: t('uz', 'bot.menuButton'), web_app: { url: webAppUrl } },
    });

    // Buyruqlar va tavsif: standart — o'zbekcha, Telegram'i rus tilida bo'lganlarga — ruscha.
    const commands = (lang: Lang) =>
      COMMANDS.map(([command, key]) => ({ command, description: t(lang, key) }));
    await telegram.setMyCommands(commands('uz'));
    await telegram.setMyCommands(commands('ru'), { language_code: 'ru' });
    for (const [lang, code] of [['uz', undefined], ['ru', 'ru']] as const) {
      await telegram.setMyDescription(t(lang, 'bot.description'), code);
      await telegram.setMyShortDescription(t(lang, 'bot.shortDescription'), code);
    }
    // Adminlarga (ularning chatida) qo'shimcha /admin buyrug'i ko'rinadi.
    for (const id of adminIds()) {
      await telegram
        .setMyCommands([...commands('uz'), { command: 'admin', description: t('uz', 'menu.admin') }], {
          scope: { type: 'chat', chat_id: Number(id) },
        })
        .catch(() => {}); // admin hali botga yozmagan bo'lsa — chat topilmaydi
    }
    const info = await telegram.getWebhookInfo();

    return NextResponse.json({
      ok: true,
      webhookUrl: info.url,
      webAppUrl,
      pendingUpdates: info.pending_update_count,
      lastError: info.last_error_message ?? null,
    });
  } catch (err) {
    console.error('[telegram setup] xato:', err);
    // Tarmoq xatosi matnida bot tokeni (URL) bo'lishi mumkin — javobga faqat Telegram izohini chiqaramiz.
    const error =
      err instanceof TelegramError ? err.description : "Telegram API bilan bog'lanib bo'lmadi (loglarni ko'ring).";
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
