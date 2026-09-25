import { t, type Key, type Lang, type Params } from '@/lib/i18n';

// Foydalanuvchiga ko'rsatsa bo'ladigan (biznes) xato: "Retsept topilmadi" va h.k. Matn o'rniga
// lug'at kaliti saqlanadi — foydalanuvchi tilida chegarada (bot / Mini App API) tarjima qilinadi.
// Boshqa xatolar (baza, tarmoq) matni foydalanuvchiga chiqmaydi — faqat logga yoziladi.
export type AppErrorCode = 'not_found' | 'invalid' | 'forbidden' | 'conflict';

export class AppError extends Error {
  constructor(
    readonly key: Key,
    readonly params: Params = {},
    readonly code: AppErrorCode = 'invalid'
  ) {
    super(key);
  }

  text(lang: Lang): string {
    return t(lang, this.key, this.params);
  }
}
