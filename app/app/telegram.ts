// telegram-web-app.js beradigan `window.Telegram.WebApp` ning ilovada ishlatiladigan qismi.
// https://core.telegram.org/bots/webapps#initializing-mini-apps

export interface ThemeParams {
  bg_color?: string;
  secondary_bg_color?: string;
  section_bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  section_separator_color?: string;
  section_header_text_color?: string;
  destructive_text_color?: string;
}

type EventName = 'themeChanged' | 'backButtonClicked' | 'activated';

export interface TelegramWebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  themeParams: ThemeParams;
  platform: string;
  ready(): void;
  expand(): void;
  isVersionAtLeast(version: string): boolean;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  disableVerticalSwipes?(): void;
  onEvent(event: EventName, handler: () => void): void;
  offEvent(event: EventName, handler: () => void): void;
  showConfirm(message: string, callback: (ok: boolean) => void): void;
  showAlert(message: string, callback?: () => void): void;
  BackButton: { show(): void; hide(): void };
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp ?? null;
}

// Eski Telegram versiyalarida ba'zi metodlar yo'q yoki xato beradi — ilova buzilmasligi kerak.
export function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // e'tiborsiz
  }
}

export const haptic = {
  success: () => safely(() => getWebApp()?.HapticFeedback?.notificationOccurred('success')),
  error: () => safely(() => getWebApp()?.HapticFeedback?.notificationOccurred('error')),
  select: () => safely(() => getWebApp()?.HapticFeedback?.selectionChanged()),
};

export function confirmDialog(message: string): Promise<boolean> {
  const tg = getWebApp();
  return new Promise((resolve) => {
    try {
      if (!tg || !tg.isVersionAtLeast('6.2')) throw new Error('no popup');
      tg.showConfirm(message, resolve);
    } catch {
      resolve(window.confirm(message));
    }
  });
}

const THEME_VARS: [keyof ThemeParams, string][] = [
  ['secondary_bg_color', '--page'],
  ['text_color', '--text'],
  ['hint_color', '--hint'],
  ['link_color', '--link'],
  ['button_color', '--btn'],
  ['button_text_color', '--btn-text'],
  ['section_separator_color', '--sep'],
  ['section_header_text_color', '--sec-header'],
  ['destructive_text_color', '--dest'],
];

export function applyTheme(tg: TelegramWebApp): void {
  const root = document.documentElement;
  root.classList.toggle('dark', tg.colorScheme === 'dark');

  const params = tg.themeParams ?? {};
  for (const [key, cssVar] of THEME_VARS) {
    const value = params[key];
    if (value) root.style.setProperty(cssVar, value);
    else root.style.removeProperty(cssVar);
  }
  const card = params.section_bg_color || params.bg_color;
  if (card) root.style.setProperty('--card', card);
  else root.style.removeProperty('--card');

  const page = params.secondary_bg_color;
  safely(() => {
    if (!tg.isVersionAtLeast('6.1')) return;
    tg.setHeaderColor?.(page ? 'secondary_bg_color' : 'bg_color');
    if (page) tg.setBackgroundColor?.(page);
  });
  safely(() => {
    if (tg.isVersionAtLeast('7.10') && card) tg.setBottomBarColor?.(card);
  });
}
