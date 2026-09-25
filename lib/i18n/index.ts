// Ko'p tillilik: o'zbek (lotin), o'zbek (kirill), rus.
//
// Asosiy lug'at — lotin yozuvidagi `uz.ts`. Kirill matnlari undan avtomatik o'giriladi
// (`latinToCyrillic`), rus tili — `ru.ts` da qo'lda tarjima (TypeScript barcha kalitlar
// tarjima qilinganini tekshiradi). Bu fayl brauzerga ham tushadi — server kodi import qilinmaydi.
//
// Shablonlar:
//   {name}              — parametr qiymati (o'girilmaydi, foydalanuvchi matni shundayligicha qoladi);
//   {n:день|дня|дней}   — songa qarab so'z shakli (rus tili uchun; o'zbekchada kerak emas).

import { uz, type Key } from './uz';
import { ru } from './ru';

export type { Key };
export type Lang = 'uz' | 'uz_cyrl' | 'ru';
export const LANGS: Lang[] = ['uz', 'uz_cyrl', 'ru'];

export const LANG_LABELS: Record<Lang, string> = {
  uz: "🇺🇿 O'zbekcha",
  uz_cyrl: '🇺🇿 Ўзбекча',
  ru: '🇷🇺 Русский',
};

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as string[]).includes(value);
}

/** Telegram `language_code` dan taxminiy til. */
export function detectLang(languageCode: string | null | undefined): Lang {
  const code = (languageCode ?? '').toLowerCase().split('-')[0];
  if (['ru', 'uk', 'be', 'kk', 'ky'].includes(code)) return 'ru';
  return 'uz';
}

/** Foydalanuvchi tanlagan til, tanlanmagan bo'lsa — Telegram tilidan. */
export function langOf(user: { language?: string | null; languageCode?: string | null }): Lang {
  return isLang(user.language) ? user.language : detectLang(user.languageCode);
}

export type Params = Record<string, string | number>;

// ---------------------------------------------------------------------------
// Lotin -> kirill
// ---------------------------------------------------------------------------

const APOSTROPHES = "'ʻ’ʼ`";
const SINGLE: Record<string, string> = {
  a: 'а', b: 'б', c: 'с', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м',
  n: 'н', o: 'о', p: 'п', q: 'қ', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'х', y: 'й', z: 'з',
};
const DIGRAPHS: Record<string, string> = { sh: 'ш', ch: 'ч', yo: 'ё', yu: 'ю', ya: 'я', ye: 'е' };
// Rus tilidan kirgan so'zlar kirillda boshqacha yoziladi.
const WORDS: [RegExp, string][] = [
  [/retsept/g, 'рецепт'],
  [/Retsept/g, 'Рецепт'],
  [/RETSEPT/g, 'РЕЦЕПТ'],
];

const isLatin = (ch: string | undefined) => !!ch && /[a-zA-Z]/.test(ch);
const upper = (s: string) => s.toUpperCase();

function convertPlain(text: string): string {
  let s = text;
  for (const [re, to] of WORDS) s = s.replace(re, to);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const lower = ch.toLowerCase();
    const isUpper = ch !== lower;
    const next = s[i + 1];

    if ((lower === 'o' || lower === 'g') && next !== undefined && APOSTROPHES.includes(next)) {
      const c = lower === 'o' ? 'ў' : 'ғ';
      out += isUpper ? upper(c) : c;
      i += 1;
      continue;
    }
    const pair = next ? lower + next.toLowerCase() : '';
    if (DIGRAPHS[pair]) {
      const c = DIGRAPHS[pair];
      // "Sh" / "SH" -> "Ш"
      out += isUpper ? upper(c) : c;
      i += 1;
      continue;
    }
    if (APOSTROPHES.includes(ch)) {
      // Tutuq belgisi (ma'lumot -> маълумот); so'z chegarasidagi apostrof — qo'shtirnoq sifatida qoladi.
      out += isLatin(s[i - 1]) && isLatin(next) ? 'ъ' : ch;
      continue;
    }
    if (lower === 'e' && !isLatin(s[i - 1]) && !'ўғ'.includes(out.at(-1) ?? '')) {
      out += isUpper ? 'Э' : 'э';
      continue;
    }
    const mapped = SINGLE[lower];
    out += mapped ? (isUpper ? upper(mapped) : mapped) : ch;
  }
  return out;
}

/** O'zbek lotin matnini kirillga o'giradi. HTML teglar, {parametrlar} va &entity; tegilmaydi. */
export function latinToCyrillic(text: string): string {
  return text
    .split(/(<[^>]*>|\{[^}]*\}|&[a-z]+;)/g)
    .map((part, i) => (i % 2 === 1 ? part : convertPlain(part)))
    .join('');
}

// ---------------------------------------------------------------------------
// Tarjima
// ---------------------------------------------------------------------------

const cyrillicCache = new Map<Key, string>();

function template(lang: Lang, key: Key): string {
  if (lang === 'ru') return ru[key];
  if (lang === 'uz_cyrl') {
    let cached = cyrillicCache.get(key);
    if (cached === undefined) {
      cached = latinToCyrillic(uz[key]);
      cyrillicCache.set(key, cached);
    }
    return cached;
  }
  return uz[key];
}

/** Rus tilidagi so'z shakli: 1 день, 2 дня, 5 дней. */
export function pluralRu(n: number, forms: [string, string, string]): string {
  // Kasr son: "2,5 таблетки".
  if (!Number.isInteger(n)) return forms[1];
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

export function t(lang: Lang, key: Key, params?: Params): string {
  const tpl = template(lang, key);
  if (!params && !tpl.includes('{')) return tpl;
  return tpl.replace(/\{(\w+)(?::([^}]*))?\}/g, (whole, name: string, forms?: string) => {
    const value = params?.[name];
    if (value === undefined) return whole;
    if (forms !== undefined) {
      const list = forms.split('|');
      return list.length === 3 ? pluralRu(Number(value), list as [string, string, string]) : list[0] ?? '';
    }
    return String(value);
  });
}

export type T = (key: Key, params?: Params) => string;

/** Tilga bog'langan tarjima funksiyasi: `const tr = translator(lang); tr('menu.today')`. */
export function translator(lang: Lang): T {
  return (key, params) => t(lang, key, params);
}

/** Kalitning barcha tillardagi varianti — foydalanuvchi bosgan tugma matnini tanish uchun. */
export function allVariants(key: Key, params?: Params): string[] {
  return [...new Set(LANGS.map((lang) => t(lang, key, params)))];
}
