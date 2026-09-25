'use client';

import { useState } from 'react';
import type { T } from '@/lib/i18n';
import type { StockItemView, StockView } from '@/lib/webapp/types';
import { formatDayMonth } from '@/lib/time';
import { ApiRequestError, api, useApi } from '../api';
import { useLang, useNav, useT } from '../store';
import { haptic } from '../telegram';
import { ErrorState, Icon, Loading, qtyText } from '../ui';
import { StockSheet } from './stock-sheet';

type Tone = 'ok' | 'warn' | 'bad' | 'none';

function statusOf(item: StockItemView, t: T, lang: ReturnType<typeof useLang>): { text: string; tone: Tone } {
  const f = item.forecast;
  if (!f || item.stock === null) return { text: t('app.stock.untracked'), tone: 'none' };
  if (item.stock <= 1e-6) return { text: t('app.stock.out'), tone: 'bad' };
  if (item.asNeeded) return { text: t('app.stock.prn'), tone: item.low ? 'bad' : 'ok' };
  if (f.enough) return { text: t('app.stock.enough'), tone: 'ok' };
  if (!f.daysLeft || !f.runOutDate) return { text: t('app.stock.runsOutToday'), tone: 'bad' };
  return {
    text: `${t('app.stock.runsOut', { date: formatDayMonth(f.runOutDate, lang) })} · ${t('app.stock.daysLeft', {
      days: t('common.days', { n: f.daysLeft }),
    })}`,
    tone: item.low ? 'bad' : 'warn',
  };
}

export function StockScreen() {
  const t = useT();
  const lang = useLang();
  const nav = useNav();
  const { data, error, reload } = useApi<StockView>('stock');
  const [sheet, setSheet] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const head = (
    <div className="page-head">
      <div className="page-title">{t('app.stock.title')}</div>
      <div className="page-sub">{t('app.stock.sub')}</div>
    </div>
  );
  if (!data) return error ? <ErrorState message={error.message} onRetry={reload} /> : <>{head}<Loading /></>;

  const quickAdd = async (item: StockItemView, amount: number) => {
    if (busyId) return;
    setBusyId(item.id);
    try {
      await api('stock', { id: item.id, action: 'add', amount });
      haptic.success();
      nav.changed();
      nav.toast(t('stock.added', { qty: qtyText(amount, item.unit, t) }));
      await reload();
    } catch (err) {
      haptic.error();
      nav.toast(err instanceof ApiRequestError ? err.message : t('common.error'));
    } finally {
      setBusyId(null);
    }
  };

  const tracked = data.items.filter((i) => i.stock !== null);
  const untracked = data.items.filter((i) => i.stock === null);

  return (
    <>
      {head}
      {data.items.length === 0 ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="empty">
            <div className="empty-ic">
              <Icon.tabStock />
            </div>
            <div className="e-title">{t('app.stock.empty')}</div>
            <div className="e-text">{t('app.stock.emptyText')}</div>
          </div>
          <div className="e-actions">
            <button className="btn" type="button" onClick={nav.openNew}>
              <Icon.plus /> {t('app.today.addRx')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {tracked.length > 0 && (
            <>
              <div className="sec-title">{t('app.stock.tracked')}</div>
              <div className="card">
                {tracked.map((item) => {
                  const status = statusOf(item, t, lang);
                  const f = item.forecast;
                  return (
                    <div key={item.id} className="stock-row">
                      <div className="stock-top" onClick={() => setSheet(item.id)} role="button">
                        <div className="stock-main">
                          <div className="med-name">{item.name}</div>
                          <div className="med-meta">{item.prescriptionTitle}</div>
                        </div>
                        <div className={`stock-qty tone-${status.tone}`}>{qtyText(item.stock ?? 0, item.unit, t)}</div>
                      </div>
                      <div className={`stock-status tone-${status.tone}`}>{status.text}</div>
                      {f && !f.enough && f.need > 0 && !item.asNeeded && (
                        <div className="med-meta">🛒 {t('app.stock.need', { qty: qtyText(f.need, item.unit, t) })}</div>
                      )}
                      <div className="chips">
                        {[10, 20, 30].map((n) => (
                          <button
                            key={n}
                            type="button"
                            className="chip add"
                            disabled={busyId === item.id}
                            onClick={() => quickAdd(item, n)}
                          >
                            +{n}
                          </button>
                        ))}
                        <button type="button" className="chip" onClick={() => setSheet(item.id)}>
                          ✏️
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {untracked.length > 0 && (
            <>
              <div className="sec-title">{t('app.stock.untracked')}</div>
              <div className="card">
                {untracked.map((item) => (
                  <div key={item.id} className="row">
                    <div style={{ minWidth: 0 }}>
                      <div className="row-k">{item.name}</div>
                      <div className="row-sub">{item.prescriptionTitle}</div>
                    </div>
                    <button type="button" className="btn quiet small" onClick={() => setSheet(item.id)}>
                      {t('app.stock.setUp')}
                    </button>
                  </div>
                ))}
              </div>
              <div className="sec-note">{t('app.stock.untrackedNote')}</div>
            </>
          )}
        </>
      )}

      {sheet && <StockSheet medId={sheet} onClose={() => setSheet(null)} onSaved={reload} />}
    </>
  );
}
