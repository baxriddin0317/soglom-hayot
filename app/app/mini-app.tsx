'use client';

import Script from 'next/script';
import { useCallback, useEffect, useState } from 'react';
import type { Key } from '@/lib/i18n';
import type { MeView } from '@/lib/webapp/types';
import { api } from './api';
import { AdminScreen } from './screens/admin';
import { NewPrescriptionScreen } from './screens/new-prescription';
import { PrescriptionScreen } from './screens/prescription';
import { PrescriptionsScreen } from './screens/prescriptions';
import { SettingsScreen } from './screens/settings';
import { StatsScreen } from './screens/stats';
import { StockScreen } from './screens/stock';
import { TodayScreen } from './screens/today';
import { TABS, useApp, useT, type Tab } from './store';
import { applyTheme, getWebApp, haptic, safely } from './telegram';
import { Icon, Toast } from './ui';

const TAB_META: Record<Tab, { label: Key; icon: () => React.JSX.Element }> = {
  today: { label: 'app.tab.today', icon: Icon.tabToday },
  rx: { label: 'app.tab.rx', icon: Icon.tabRx },
  stock: { label: 'app.tab.stock', icon: Icon.tabStock },
  stats: { label: 'app.tab.stats', icon: Icon.tabStats },
  settings: { label: 'app.tab.settings', icon: Icon.tabSettings },
  admin: { label: 'app.tab.admin', icon: Icon.tabAdmin },
};

function initialTab(): Tab {
  const t = new URLSearchParams(window.location.search).get('tab');
  return TABS.includes(t as Tab) ? (t as Tab) : 'today';
}

export function MiniApp() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'outside'>('loading');
  const t = useT();
  const { tab, screen, toast, adminMode, goTab, open, clearToast, setMe } = useApp();

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
    useApp.setState({ tab: initialTab() });
    // Til va admin huquqi — birinchi chizishdan oldin (matnlar birdan to'g'ri tilda chiqishi uchun).
    api<MeView>('me')
      .then(setMe)
      .catch(() => {})
      .finally(() => setStatus('ready'));
  }, [setMe]);

  // Telegram'ning "orqaga" tugmasi ichki ekranlarda.
  useEffect(() => {
    const tg = getWebApp();
    if (!tg || status !== 'ready' || !tg.isVersionAtLeast('6.1')) return;
    const back = () => open(null);
    if (screen) {
      tg.BackButton.show();
      tg.onEvent('backButtonClicked', back);
    } else {
      tg.BackButton.hide();
    }
    return () => tg.offEvent('backButtonClicked', back);
  }, [screen, status, open]);

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
            <div>{t('app.outside')}</div>
          </div>
        )}
      </div>
    );
  }

  const tabs = TABS.filter((k) => k !== 'admin' || adminMode);
  const current = tab === 'admin' && !adminMode ? 'today' : tab;

  let body: React.ReactNode;
  let contentClass = 'content';
  if (screen?.name === 'rx') {
    body = <PrescriptionScreen id={screen.id} />;
    contentClass += ' no-tabs';
  } else if (screen?.name === 'new') {
    body = <NewPrescriptionScreen />;
    contentClass += ' with-bar';
  } else if (current === 'today') {
    body = <TodayScreen />;
  } else if (current === 'rx') {
    body = <PrescriptionsScreen />;
  } else if (current === 'stock') {
    body = <StockScreen />;
  } else if (current === 'stats') {
    body = <StatsScreen />;
  } else if (current === 'admin') {
    body = <AdminScreen />;
  } else {
    body = <SettingsScreen />;
  }

  return (
    <div className="app">
      {script}
      <main className={contentClass} key={screen ? `${screen.name}-${'id' in screen ? screen.id : ''}` : current}>
        {body}
      </main>

      {!screen && (
        <nav className="tabbar" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map((key) => {
            const { label, icon: TabIcon } = TAB_META[key];
            return (
              <button
                key={key}
                type="button"
                className={`tab ${current === key ? 'on' : ''}`}
                onClick={() => {
                  if (current !== key) haptic.select();
                  goTab(key);
                }}
              >
                <TabIcon />
                {t(label)}
              </button>
            );
          })}
        </nav>
      )}

      {toast && <Toast text={toast} onDone={clearToast} />}
    </div>
  );
}
