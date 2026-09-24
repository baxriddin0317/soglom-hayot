// Foydalanuvchiga ko'rsatsa bo'ladigan (biznes) xato: "Retsept topilmadi" va h.k.
// Boshqa xatolar (baza, tarmoq) matni foydalanuvchiga chiqmaydi — faqat logga yoziladi.
export type AppErrorCode = 'not_found' | 'invalid' | 'forbidden' | 'conflict';

export class AppError extends Error {
  constructor(
    message: string,
    readonly code: AppErrorCode = 'invalid'
  ) {
    super(message);
  }
}

export function userMessage(err: unknown): string {
  if (err instanceof AppError) return err.message;
  console.error('Kutilmagan xato:', err);
  return "Xatolik yuz berdi. Qayta urinib ko'ring.";
}
