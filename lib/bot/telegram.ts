import { TelegramError, type Context } from 'telegraf';
import { sleep } from '@/lib/concurrency';

type ExtraEditMessageText = Parameters<Context['editMessageText']>[1];

// Telegram 429 ("Too Many Requests") da kutish kerak bo'lgan vaqt shu chegaradan kichik bo'lsa
// qayta uriniladi; kattaroq bo'lsa xato qaytariladi (funksiya vaqt limitini yeb qo'ymasligi uchun).
const MAX_RETRY_AFTER_SEC = 5;

export function isMessageNotModified(err: unknown): boolean {
  return err instanceof TelegramError && err.description.includes('message is not modified');
}

// Foydalanuvchi botni bloklagan / chat topilmadi — qayta urinish befoyda.
export function isUserUnreachable(err: unknown): boolean {
  if (!(err instanceof TelegramError)) return false;
  if (err.code === 403) return true;
  return err.code === 400 && /chat not found|user is deactivated|PEER_ID_INVALID/i.test(err.description);
}

export async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const retryAfter = err instanceof TelegramError ? err.parameters?.retry_after : undefined;
    if (err instanceof TelegramError && err.code === 429 && retryAfter && retryAfter <= MAX_RETRY_AFTER_SEC) {
      await sleep(retryAfter * 1000 + 100);
      return fn();
    }
    throw err;
  }
}

// Callback so'rovi juda eski bo'lsa answerCbQuery xato beradi — bu asosiy amalni buzmasligi kerak.
export async function safeAnswerCbQuery(ctx: Context, text?: string, extra?: { show_alert?: boolean }): Promise<void> {
  if (!ctx.callbackQuery) return;
  await ctx.answerCbQuery(text, extra).catch(() => {});
}

// Tugma bosilgan xabarni tahrirlaydi; xabar juda eski yoki o'chirilgan bo'lsa yangi xabar yuboradi.
// Oddiy xabarga (tugmasiz) javoban chaqirilsa — shunchaki yangi xabar yuboradi.
export async function editOrReply(ctx: Context, text: string, extra?: ExtraEditMessageText): Promise<void> {
  if (ctx.callbackQuery?.message) {
    try {
      await withRateLimitRetry(() => ctx.editMessageText(text, extra));
      return;
    } catch (err) {
      if (isMessageNotModified(err)) return;
      if (!(err instanceof TelegramError)) throw err;
    }
  }
  await ctx.reply(text, extra);
}

/** HTML parse_mode uchun foydalanuvchi matnini xavfsiz qilish. */
export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Tugma matni uchun qisqartirish (Telegram tugmalari tor). */
export function short(text: string, max = 24): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
