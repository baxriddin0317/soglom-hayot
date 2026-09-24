'use client';

import Script from 'next/script';
import { useCallback, useEffect, useState } from 'react';
import { invalidateAll } from './api';
import { NewPrescriptionScreen } from './screens/new-prescription';
import { PrescriptionScreen } from './screens/prescription';
import { PrescriptionsScreen } from './screens/prescriptions';
import { SettingsScreen } from './screens/settings';
import { StatsScreen } from './screens/stats';
import { TodayScreen } from './screens/today';
import { applyTheme, getWebApp, haptic, safely } from './telegram';
import { Icon, Toast } from './ui';

export type Tab = 'today' | 'rx' | 'stats' | 'settings';
type Screen = { name: 'rx'; id: string } | { name: 'new' };

const TABS: { key: Tab; label: string; icon: () => React.JSX.Element }[] = [
  { key: 'today', label: 'Bugun', icon: Icon.tabToday },
  { key: 'rx', label: 'Retseptlar', icon: Icon.tabRx },
  { key: 'stats', label: 'Hisobot', icon: Icon.tabStats },
  { key: 'settings', label: 'Sozlamalar', icon: Icon.tabSettings },
];

function initialTab(): Tab {
  if (typeof window === 'undefined') return 'today';
  const t = new URLSearchParams(window.location.search).get('tab');
  return TABS.some((x) => x.key === t) ? (t as Tab) : 'today';
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

export function MiniApp() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'outside'>('loading');
  const [tab, setTab] = useState<Tab>('today');
  const [screen, setScreen] = useState<Screen | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const clearToast = useCallback(() => setToast(null), []);

  const init = useCallback(() => {
    const tg = getWebApp();
    if (!tg?.initData) {
      setStatus('outside');
      return;
    }
    safely(() => tg.ready());
    safely(() => tg.expand());
    safely(() => {
      if (tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes?.();
    });
    applyTheme(tg);
    tg.onEvent('themeChanged', () => applyTheme(tg));
    setTab(initialTab());
    setStatus('ready');
  }, []);

  // Telegram'ning "orqaga" tugmasi ichki ekranlarda.
  useEffect(() => {
    const tg = getWebApp();
    if (!tg || status !== 'ready' || !tg.isVersionAtLeast('6.1')) return;
    const back = () => setScreen(null);
    if (screen) {
      tg.BackButton.show();
      tg.onEvent('backButtonClicked', back);
    } else {
      tg.BackButton.hide();
    }
    return () => tg.offEvent('backButtonClicked', back);
  }, [screen, status]);

  const openScreen = (next: Screen | null) => {
    setScreen(next);
    window.scrollTo(0, 0);
  };

  const nav: Nav = {
    openPrescription: (id) => openScreen({ name: 'rx', id }),
    openNew: () => openScreen({ name: 'new' }),
    goTab: (t) => {
      openScreen(null);
      setTab(t);
    },
    back: () => openScreen(null),
    toast: setToast,
    changed: invalidateAll,
  };

  const script = (
    <Script
      src="https://telegram.org/js/telegram-web-app.js"
      strategy="afterInteractive"
      onReady={init}
      onError={() => setStatus('outside')}
    />
  );

  if (status !== 'ready') {
    return (
      <div className="app">
        {script}
        {status === 'loading' ? (
          <div className="center-state">
            <div className="spinner" />
          </div>
        ) : (
          <div className="center-state">
            <b>🌿 Sog'lom Hayot</b>
            <div>
              Bu ilova Telegram ichida ishlaydi. Botga <b style={{ fontSize: 'inherit' }}>/start</b> yozing va
              "📱 Ilovani ochish" tugmasini bosing.
            </div>
          </div>
        )}
      </div>
    );
  }

  let body: React.ReactNode;
  let contentClass = 'content';
  if (screen?.name === 'rx') {
    body = <PrescriptionScreen id={screen.id} nav={nav} />;
    contentClass += ' no-tabs';
  } else if (screen?.name === 'new') {
    body = <NewPrescriptionScreen nav={nav} />;
    contentClass += ' with-bar';
  } else if (tab === 'today') {
    body = <TodayScreen nav={nav} />;
  } else if (tab === 'rx') {
    body = <PrescriptionsScreen nav={nav} />;
  } else if (tab === 'stats') {
    body = <StatsScreen />;
  } else {
    body = <SettingsScreen nav={nav} />;
  }

  return (
    <div className="app">
      {script}
      <main className={contentClass} key={screen ? `${screen.name}-${'id' in screen ? screen.id : ''}` : tab}>
        {body}
      </main>

      {!screen && (
        <nav className="tabbar">
          {TABS.map(({ key, label, icon: TabIcon }) => (
            <button
              key={key}
              type="button"
              className={`tab ${tab === key ? 'on' : ''}`}
              onClick={() => {
                if (tab !== key) haptic.select();
                setTab(key);
                window.scrollTo(0, 0);
              }}
            >
              <TabIcon />
              {label}
            </button>
          ))}
        </nav>
      )}

      {toast && <Toast text={toast} onDone={clearToast} />}
    </div>
  );
}
