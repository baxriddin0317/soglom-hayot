import { Markup } from 'telegraf';
import { allVariants, t, type Key, type Lang } from '@/lib/i18n';
import { getWebAppUrl } from '@/lib/webapp/url';

// Pastki (reply) klaviatura. Tugma matni foydalanuvchi tilida, lekin bot har qanday tildagi
// variantni taniydi — foydalanuvchi tilni almashtirganda eski klaviatura ham ishlayveradi.

export type MenuAction = 'today' | 'add' | 'list' | 'history' | 'stock' | 'report' | 'settings' | 'help' | 'home' | 'admin';

const MENU_KEYS: [Key, MenuAction][] = [
  ['menu.today', 'today'],
  ['menu.add', 'add'],
  ['menu.list', 'list'],
  ['menu.stock', 'stock'],
  ['menu.report', 'report'],
  ['menu.settings', 'settings'],
  ['menu.help', 'help'],
  ['menu.admin', 'admin'],
];

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

const MENU_BUTTONS: Record<string, MenuAction> = { ...LEGACY_BUTTONS };
for (const [key, action] of MENU_KEYS) {
  for (const text of allVariants(key)) MENU_BUTTONS[text] = action;
}

export function menuActionFor(text: string): MenuAction | null {
  return MENU_BUTTONS[text] ?? null;
}

/** Foydalanuvchi bosgan tugma shu kalitning (istalgan tildagi) matnimi. */
export function isButton(text: string, key: Key, params?: Record<string, string | number>): boolean {
  return allVariants(key, params).includes(text);
}

export function mainKeyboard(lang: Lang, { admin = false }: { admin?: boolean } = {}) {
  const tr = (key: Key) => t(lang, key);
  return Markup.keyboard([
    [tr('menu.today')],
    [tr('menu.add'), tr('menu.list')],
    [tr('menu.stock'), tr('menu.report')],
    [tr('menu.settings'), tr('menu.help')],
    ...(admin ? [[tr('menu.admin')]] : []),
  ]).resize();
}

/** Dialog qadamlari uchun: variantlar + [Orqaga] [Bekor qilish]. */
export function stepKeyboard(lang: Lang, rows: string[][], { back = true }: { back?: boolean } = {}) {
  const nav = back ? [t(lang, 'common.back'), t(lang, 'common.cancel')] : [t(lang, 'common.cancel')];
  return Markup.keyboard([...rows, nav]).resize();
}

export function openAppKeyboard(url: string, lang: Lang) {
  return Markup.inlineKeyboard([[Markup.button.webApp(t(lang, 'start.openAppButton'), url)]]);
}

/** Inline klaviaturaga qo'shiladigan "Ilovada ochish" tugmasi (URL sozlangan bo'lsa). */
export function appButtonRow(lang: Lang, path = '') {
  const url = getWebAppUrl();
  return url ? [Markup.button.webApp(t(lang, 'start.inApp'), `${url}${path}`)] : null;
}

/** Ro'yxatni n tadan qatorlarga bo'lish. */
export function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}
