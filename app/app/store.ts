'use client';

import { useMemo } from 'react';
import { create } from 'zustand';
import { translator, type Lang, type T } from '@/lib/i18n';
import type { MeView } from '@/lib/webapp/types';
import { invalidateAll } from './api';

// Ilovaning umumiy (UI) holati: til, admin rejimi, ochiq tab / ichki ekran, toast.
// Server ma'lumotlari (retseptlar, dozalar) bu yerda emas — ular api.ts dagi useApi keshida.

export type Tab = 'today' | 'rx' | 'stock' | 'stats' | 'settings' | 'admin';
export type Screen = { name: 'rx'; id: string } | { name: 'new' };

export const TABS: Tab[] = ['today', 'rx', 'stock', 'stats', 'settings', 'admin'];

interface AppState {
  lang: Lang;
  isAdmin: boolean;
  adminMode: boolean;
  tab: Tab;
  screen: Screen | null;
  toast: string | null;

  setMe: (me: MeView) => void;
  setLang: (lang: Lang) => void;
  setAdminMode: (on: boolean) => void;
  goTab: (tab: Tab) => void;
  open: (screen: Screen | null) => void;
  showToast: (text: string) => void;
  clearToast: () => void;
}

export const useApp = create<AppState>((set, get) => ({
  lang: 'uz',
  isAdmin: false,
  adminMode: false,
  tab: 'today',
  screen: null,
  toast: null,

  setMe: (me) => set({ lang: me.lang, isAdmin: me.isAdmin, adminMode: me.adminMode }),
  setLang: (lang) => set({ lang }),
  setAdminMode: (on) => {
    // Admin rejimidan chiqilsa admin tabi yopiladi.
    set({ adminMode: on, ...(!on && get().tab === 'admin' ? { tab: 'settings' as Tab } : {}) });
  },
  goTab: (tab) => {
    set({ tab, screen: null });
    window.scrollTo(0, 0);
  },
  open: (screen) => {
    set({ screen });
    window.scrollTo(0, 0);
  },
  showToast: (text) => set({ toast: text }),
  clearToast: () => set({ toast: null }),
}));

/** Joriy tildagi tarjima funksiyasi. Til o'zgarsa komponent qayta chiziladi. */
export function useT(): T {
  const lang = useApp((s) => s.lang);
  return useMemo(() => translator(lang), [lang]);
}

export function useLang(): Lang {
  return useApp((s) => s.lang);
}

// Ekranlarga beriladigan umumiy amallar.
export interface Nav {
  openPrescription: (id: string) => void;
  openNew: () => void;
  goTab: (tab: Tab) => void;
  back: () => void;
  toast: (text: string) => void;
  // Ma'lumot o'zgargach (doza belgilandi, retsept qo'shildi) — barcha ekranlar keshini tozalash.
  changed: () => void;
}

export function useNav(): Nav {
  const open = useApp((s) => s.open);
  const goTab = useApp((s) => s.goTab);
  const showToast = useApp((s) => s.showToast);
  return useMemo(
    () => ({
      openPrescription: (id) => open({ name: 'rx', id }),
      openNew: () => open({ name: 'new' }),
      goTab,
      back: () => open(null),
      toast: showToast,
      changed: invalidateAll,
    }),
    [open, goTab, showToast]
  );
}
