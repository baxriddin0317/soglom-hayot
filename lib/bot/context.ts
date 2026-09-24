import type { Context, MiddlewareFn } from 'telegraf';
import type { User } from '@/lib/generated/prisma/client';
import { setBlocked, upsertUser } from '@/lib/services/users';

// Har bir update uchun foydalanuvchi bazadan olinadi (bo'lmasa yaratiladi) va ctx.state.user ga
// qo'yiladi. Handler'lar `currentUser(ctx)` orqali oladi.

export function currentUser(ctx: Context): User {
  const user = ctx.state.user as User | undefined;
  if (!user) throw new Error('ctx.state.user yo\'q — userMiddleware ulanmagan');
  return user;
}

export const userMiddleware: MiddlewareFn<Context> = async (ctx, next) => {
  // Foydalanuvchi botni bloklasa / qayta ishga tushirsa — eslatma yuborishni to'xtatamiz / tiklaymiz.
  const member = ctx.myChatMember;
  if (member) {
    if (member.chat.type === 'private') {
      const status = member.new_chat_member.status;
      await setBlocked(member.from.id, status === 'kicked' || status === 'left');
    }
    return;
  }

  // Bot faqat shaxsiy chatda ishlaydi.
  if (!ctx.from || ctx.from.is_bot) return;
  if (ctx.chat && ctx.chat.type !== 'private') return;

  ctx.state.user = await upsertUser(ctx.from);
  return next();
};
