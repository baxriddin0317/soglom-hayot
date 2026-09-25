'use client';

import { useState } from 'react';
import { LIMITS } from '@/lib/constants';
import { daysPatternText, scheduleText } from '@/lib/format';
import type { MedicationView, PrescriptionDetailView } from '@/lib/webapp/types';
import { formatDate, formatShort } from '@/lib/time';
import { ApiRequestError, api, useApi } from '../api';
import { useLang, useNav, useT } from '../store';
import { confirmDialog, haptic } from '../telegram';
import { ErrorState, Loading, ProgressBar, Sheet, medMeta, pctClass, qtyText } from '../ui';
import { StockSheet } from './stock-sheet';
import { TimesEditor } from './times-editor';

type SheetState = { kind: 'times'; med: MedicationView } | { kind: 'days' } | { kind: 'stock'; medId: string } | null;

export function PrescriptionScreen({ id }: { id: string }) {
  const t = useT();
  const lang = useLang();
  const nav = useNav();
  const { data, error, reload } = useApi<PrescriptionDetailView>(`prescription?id=${encodeURIComponent(id)}`);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [times, setTimes] = useState<string[]>([]);
  const [days, setDays] = useState(7);

  if (!data) {
    if (error?.status === 404) {
      return <ErrorState message={t('app.rxd.notFound')} onRetry={nav.back} />;
    }
    return error ? <ErrorState message={error.message} onRetry={reload} /> : <Loading />;
  }

  const active = data.status === 'ACTIVE';

  const run = async (fn: () => Promise<unknown>, success: string, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      haptic.success();
      nav.changed();
      nav.toast(success);
      setSheet(null);
      if (after) after();
      else await reload();
    } catch (err) {
      haptic.error();
      nav.toast(err instanceof ApiRequestError ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    const ok = await confirmDialog(t('app.rxd.confirmFinish', { title: data.title }));
    if (ok) await run(() => api('prescription', { id, action: 'finish' }), t('rx.finishedToast'));
  };

  const remove = async () => {
    const ok = await confirmDialog(t('app.rxd.confirmDelete', { title: data.title }));
    if (ok) await run(() => api('prescription', { id, action: 'delete' }), t('app.rxd.deleted'), nav.back);
  };

  const stopMed = async (m: MedicationView) => {
    const ok = await confirmDialog(t('app.rxd.confirmStop', { name: m.name }));
    if (ok) await run(() => api('medication', { id: m.id, action: 'stop' }), t('app.rxd.stoppedToast', { name: m.name }));
  };

  const takeAsNeeded = (m: MedicationView) =>
    run(async () => {
      const res = await api<{ time: string; overLimit: boolean; countToday: number }>('medication', {
        id: m.id,
        action: 'prn',
      });
      if (res.overLimit) nav.toast(t('prn.overLimit', { name: m.name, n: res.countToday, max: m.maxPerDay ?? 0 }));
    }, t('app.today.marked', { name: m.name }));

  const medMetaLine = (m: MedicationView) =>
    [
      medMeta(m, t),
      m.asNeeded ? scheduleText(m, lang) : daysPatternText(m, lang),
      m.endDate !== data.endDate ? t('med.untilDate', { days: t('common.days', { n: m.days }), date: formatShort(m.endDate) }) : null,
      active && !m.isActive ? t('app.rxd.stopped') : null,
    ]
      .filter(Boolean)
      .join(' · ') || scheduleText(m, lang);

  return (
    <>
      <div className="detail-head">
        <span className={`badge ${active ? 'active' : ''}`}>
          {active
            ? data.day === 0
              ? t('app.rxd.notStarted')
              : t('app.rxd.dayOf', { day: data.day, total: data.totalDays })
            : t('app.rxd.finished')}
        </span>
        <div className="page-title">{data.title}</div>
        <div className="page-sub">
          {formatDate(data.startDate)} – {formatDate(data.endDate)} · {t('common.days', { n: data.totalDays })}
          {data.doctor ? ` · ${data.doctor}` : ''}
        </div>
        {active && data.day > 0 && (
          <div style={{ marginTop: 8 }}>
            <ProgressBar value={(data.day / data.totalDays) * 100} />
          </div>
        )}
      </div>

      <div className="kv">
        <div className="tile">
          <div className={`tile-v ${pctClass(data.percent)}`}>{data.percent === null ? '—' : `${data.percent}%`}</div>
          <div className="tile-k">{t('app.rxd.adherence')}</div>
        </div>
        <div className="tile">
          <div className="tile-v">{data.counts.taken}</div>
          <div className="tile-k">{t('app.rxd.taken')}</div>
        </div>
        <div className="tile">
          <div className="tile-v">{data.counts.skipped + data.counts.missed}</div>
          <div className="tile-k">{t('app.rxd.missed')}</div>
        </div>
      </div>

      {data.notes && (
        <>
          <div className="sec-title">{t('app.rxd.notes')}</div>
          <div className="card pad" style={{ fontSize: 15, lineHeight: 1.4 }}>
            {data.notes}
          </div>
        </>
      )}

      <div className="sec-title">{t('app.rxd.meds')}</div>
      <div className="card">
        {data.medications.map((m) => (
          <div key={m.id} className={`med ${m.isActive || !active ? '' : 'off'}`}>
            <div className="med-top">
              <div>
                <div className="med-name">{m.name}</div>
                <div className="med-meta">{medMetaLine(m)}</div>
              </div>
              {m.percent !== null && <div className={`rx-pct ${pctClass(m.percent)}`}>{m.percent}%</div>}
            </div>
            {!m.asNeeded && (
              <div className="time-chips">
                {m.times.map((tm) => (
                  <span className="tchip" key={tm}>
                    {tm}
                  </span>
                ))}
              </div>
            )}
            {m.stock !== null && <div className="med-meta">{t('rem.stockLeft', { qty: qtyText(m.stock, m.unit, t) })}</div>}
            {active && m.isActive && (
              <div className="med-actions">
                {m.asNeeded ? (
                  <button type="button" className="btn ok small" disabled={busy} onClick={() => takeAsNeeded(m)}>
                    {t('app.today.take')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn quiet small"
                    onClick={() => {
                      setTimes(m.times);
                      setSheet({ kind: 'times', med: m });
                    }}
                  >
                    {t('app.rxd.changeTimes')}
                  </button>
                )}
                <button type="button" className="btn quiet small" onClick={() => setSheet({ kind: 'stock', medId: m.id })}>
                  📦 {t('app.rxd.stock')}
                </button>
                <button type="button" className="btn danger small" onClick={() => stopMed(m)}>
                  {t('app.rxd.stop')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="page-actions" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '16px 16px 0' }}>
        {active && (
          <>
            <button
              className="btn quiet"
              type="button"
              onClick={() => {
                setDays(data.totalDays);
                setSheet({ kind: 'days' });
              }}
            >
              {t('app.rxd.changeDays')}
            </button>
            <button className="btn quiet" type="button" disabled={busy} onClick={finish}>
              {t('app.rxd.finish')}
            </button>
          </>
        )}
        <button className="btn ghost" type="button" disabled={busy} onClick={remove}>
          {t('app.rxd.delete')}
        </button>
      </div>

      {sheet?.kind === 'times' && (
        <Sheet onClose={() => setSheet(null)}>
          <div className="s-title">{sheet.med.name}</div>
          <div className="s-text">{t('app.rxd.timesText')}</div>
          <TimesEditor times={times} onChange={setTimes} />
          <div className="s-actions">
            <button
              className="btn"
              type="button"
              disabled={busy || times.length === 0}
              onClick={() => run(() => api('medication', { id: sheet.med.id, action: 'times', times }), t('app.rxd.timesSaved'))}
            >
              {t('common.save')}
            </button>
          </div>
        </Sheet>
      )}

      {sheet?.kind === 'days' && (
        <Sheet onClose={() => setSheet(null)}>
          <div className="s-title">{t('app.rxd.daysTitle')}</div>
          <div className="s-text">{t('app.rxd.daysText', { date: formatDate(data.startDate) })}</div>
          <div className="stepper" style={{ justifyContent: 'center' }}>
            <button type="button" onClick={() => setDays((d) => Math.max(Math.max(1, data.day), d - 1))}>
              −
            </button>
            <div className="stepper-v">{t('common.days', { n: days })}</div>
            <button type="button" onClick={() => setDays((d) => Math.min(LIMITS.maxCourseDays, d + 1))}>
              +
            </button>
          </div>
          <div className="s-actions">
            <button
              className="btn"
              type="button"
              disabled={busy || days === data.totalDays}
              onClick={() => run(() => api('prescription', { id, action: 'days', days }), t('app.rxd.daysSaved'))}
            >
              {t('common.save')}
            </button>
          </div>
        </Sheet>
      )}

      {sheet?.kind === 'stock' && <StockSheet medId={sheet.medId} onClose={() => setSheet(null)} onSaved={reload} />}
    </>
  );
}
