import { Markup } from 'telegraf';
import { getWebAppUrl } from '@/lib/webapp/url';

// Pastki (reply) klaviatura matnlari. Bot aynan shu matnlarni tutadi — klaviatura va handler
// bir-biridan ajrab qolmasligi uchun faqat shu yerda yoziladi.
export const BUTTONS = {
  today: '📅 Bugungi dorilar',
  add: '➕ Yangi retsept',
  list: '📋 Retseptlarim',
  report: '📊 Hisobot',
  settings: '⚙️ Sozlamalar',
  help: 'ℹ️ Yordam',
  back: '◀️ Orqaga',
  cancel: '❌ Bekor qilish',
  skip: "⏭ O'tkazib yuborish",
} as const;

export type MenuAction = 'today' | 'add' | 'list' | 'history' | 'report' | 'settings' | 'help' | 'home';

// Eski versiyadagi klaviatura tugmalari. Ba'zi foydalanuvchilarda eski klaviatura hali ochiq
// turibdi — ular ham ishlashda davom etadi.
const LEGACY_BUTTONS: Record<string, MenuAction> = {
  "💊 Yangi retsept qo'shish": 'add',
  '📋 Mening dorilarim': 'list',
  '⏰ Eslatmalar': 'today',
  '📊 Kunlik hisobot': 'report',
  '🧾 Kasallik tarixi': 'history',
  'ℹ️ Biz haqida': 'help',
  '🕐 Vaqt zonasi': 'settings',
  '🔔 Eslatma sozlamalari': 'settings',
  'Asosiy menyu': 'home',
  '🔙 Asosiy menyu': 'home',
  'Asosiy menyuga qaytish': 'home',
  '🔙 Orqaga': 'home',
};

const MENU_BUTTONS: Record<string, MenuAction> = {
  [BUTTONS.today]: 'today',
  [BUTTONS.add]: 'add',
  [BUTTONS.list]: 'list',
  [BUTTONS.report]: 'report',
  [BUTTONS.settings]: 'settings',
  [BUTTONS.help]: 'help',
  ...LEGACY_BUTTONS,
};

export function menuActionFor(text: string): MenuAction | null {
  return MENU_BUTTONS[text] ?? null;
}

export function mainKeyboard() {
  return Markup.keyboard([
    [BUTTONS.today],
    [BUTTONS.add, BUTTONS.list],
    [BUTTONS.report, BUTTONS.settings],
    [BUTTONS.help],
  ]).resize();
}

/** Dialog qadamlari uchun: variantlar + [Orqaga] [Bekor qilish]. */
export function stepKeyboard(rows: string[][], { back = true }: { back?: boolean } = {}) {
  const nav = back ? [BUTTONS.back, BUTTONS.cancel] : [BUTTONS.cancel];
  return Markup.keyboard([...rows, nav]).resize();
}

export const OPEN_APP_TEXT = '📱 Ilovani ochish';

export function openAppKeyboard(url: string) {
  return Markup.inlineKeyboard([[Markup.button.webApp(OPEN_APP_TEXT, url)]]);
}

/** Inline klaviaturaga qo'shiladigan "Ilovada ochish" tugmasi (URL sozlangan bo'lsa). */
export function appButtonRow(path = '') {
  const url = getWebAppUrl();
  return url ? [Markup.button.webApp('📱 Ilovada ochish', `${url}${path}`)] : null;
}

/** Ro'yxatni n tadan qatorlarga bo'lish. */
export function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}
