'use client';

import { useState } from 'react';
import { REFILL_DAYS_OPTIONS, STOCK_ADD_OPTIONS, STOCK_UNITS, type StockUnit } from '@/lib/constants';
import type { Key } from '@/lib/i18n';
import type { StockItemView, StockView } from '@/lib/webapp/types';
import { formatQty } from '@/lib/time';
import { ApiRequestError, api, useApi } from '../api';
import { useNav, useT } from '../store';
import { haptic } from '../telegram';
import { Loading, Sheet, Switch, qtyText } from '../ui';

const round = (n: number) => Math.round(n * 100) / 100;

/** Zaxira oynasi: dori id bo'yicha /api/app/stock dan oladi (retsept sahifasidan ham ochiladi). */
export function StockSheet({ medId, onClose, onSaved }: { medId: string; onClose: () => void; onSaved?: () => void }) {
  const { data } = useApi<StockView>('stock');
  const item = data?.items.find((i) => i.id === medId);
  return (
    <Sheet onClose={onClose}>
      {item ? <StockForm key={item.id} item={item} onClose={onClose} onSaved={onSaved} /> : <Loading />}
    </Sheet>
  );
}

function StockForm({ item, onClose, onSaved }: { item: StockItemView; onClose: () => void; onSaved?: () => void }) {
  const t = useT();
  const nav = useNav();
  const [tracked, setTracked] = useState(item.stock !== null);
  const [qty, setQty] = useState(item.stock ?? 0);
  const [qtyInput, setQtyInput] = useState(formatQty(item.stock ?? 0));
  const [unit, setUnit] = useState<StockUnit>(item.unit);
  const [perDose, setPerDose] = useState(item.unitsPerDose);
  const [refillDays, setRefillDays] = useState(item.refillDays);
  const [busy, setBusy] = useState(false);

  const setAmount = (n: number) => {
    const v = Math.max(0, round(n));
    setQty(v);
    setQtyInput(formatQty(v));
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api(
        'stock',
        tracked
          ? { id: item.id, action: 'set', stock: qty, unit, unitsPerDose: perDose, refillDays }
          : { id: item.id, action: 'disable' }
      );
      haptic.success();
      nav.changed();
      nav.toast(t('app.stock.saved'));
      onSaved?.();
      onClose();
    } catch (err) {
      haptic.error();
      nav.toast(err instanceof ApiRequestError ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="s-title">{t('app.stock.sheetTitle', { name: item.name })}</div>
      <div className="toggle-row">
        <div>
          <div className="row-k">{t('app.stock.track')}</div>
          <div className="row-sub">{t('app.stock.trackSub')}</div>
        </div>
        <Switch on={tracked} onChange={setTracked} />
      </div>

      {tracked && (
        <>
          <div className="field-flat">
            <span className="label">{t('app.stock.qty')}</span>
            <div className="stepper">
              <button type="button" onClick={() => setAmount(qty - 1)} aria-label="−">
                −
              </button>
              <input
                className="input qty"
                inputMode="decimal"
                value={qtyInput}
                onChange={(e) => {
                  setQtyInput(e.target.value);
                  const n = Number(e.target.value.replace(',', '.'));
                  if (Number.isFinite(n) && n >= 0) setQty(round(n));
                }}
                onBlur={() => setQtyInput(formatQty(qty))}
                aria-label={t('app.stock.qty')}
              />
              <button type="button" onClick={() => setAmount(qty + 1)} aria-label="+">
                +
              </button>
              <span className="label">{t(`unitName.${unit}` as Key)}</span>
            </div>
            <span className="label">{t('app.stock.quickAdd')}</span>
            <div className="chips">
              {STOCK_ADD_OPTIONS.map((n) => (
                <button key={n} type="button" className="chip add" onClick={() => setAmount(qty + n)}>
                  +{n}
                </button>
              ))}
            </div>
          </div>

          <div className="field-flat">
            <span className="label">{t('app.stock.unit')}</span>
            <div className="chips">
              {STOCK_UNITS.map((u) => (
                <button key={u} type="button" className={`chip ${unit === u ? 'on' : ''}`} onClick={() => setUnit(u)}>
                  {t(`unitName.${u}` as Key)}
                </button>
              ))}
            </div>
          </div>

          <div className="field-flat">
            <span className="label">{t('app.stock.perDose')}</span>
            <div className="stepper">
              <button type="button" onClick={() => setPerDose((v) => Math.max(0.25, round(v - (v > 1 ? 1 : 0.25))))}>
                −
              </button>
              <div className="stepper-v">{qtyText(perDose, unit, t)}</div>
              <button type="button" onClick={() => setPerDose((v) => round(v + (v >= 1 ? 1 : 0.25)))}>
                +
              </button>
            </div>
          </div>

          {!item.asNeeded && (
            <div className="field-flat">
              <span className="label">{t('app.stock.alert')}</span>
              <div className="chips">
                {REFILL_DAYS_OPTIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`chip ${refillDays === d ? 'on' : ''}`}
                    onClick={() => setRefillDays(d)}
                  >
                    {t('app.stock.alertDays', { days: t('common.days', { n: d }) })}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="s-actions">
        <button className="btn" type="button" disabled={busy} onClick={save}>
          {t('common.save')}
        </button>
      </div>
    </>
  );
}
