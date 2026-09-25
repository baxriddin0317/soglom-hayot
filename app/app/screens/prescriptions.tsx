'use client';

import type { PrescriptionSummary, PrescriptionsView } from '@/lib/webapp/types';
import { formatDate, formatShort } from '@/lib/time';
import { useApi } from '../api';
import { useNav, useT } from '../store';
import { ErrorState, Icon, Loading, ProgressBar, pctClass } from '../ui';

export function PrescriptionsScreen() {
  const t = useT();
  const nav = useNav();
  const { data, error, reload } = useApi<PrescriptionsView>('prescriptions');
  if (!data) return error ? <ErrorState message={error.message} onRetry={reload} /> : <Loading />;

  const canAdd = data.active.length < data.limit;

  return (
    <>
      <div className="page-head">
        <div className="page-title">{t('app.rx.title')}</div>
        <div className="page-sub">{t('app.rx.sub')}</div>
      </div>

      <div className="sec-title">
        {t('app.rx.active')}
        {canAdd && data.active.length > 0 && (
          <button type="button" className="sec-link" onClick={nav.openNew}>
            {t('app.rx.new')}
          </button>
        )}
      </div>
      {data.active.length === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="empty-ic">
              <Icon.tabRx />
            </div>
            <div className="e-title">{t('app.rx.none')}</div>
            <div className="e-text">{t('app.rx.noneText')}</div>
          </div>
          <div className="e-actions">
            <button className="btn" type="button" onClick={nav.openNew}>
              <Icon.plus /> {t('app.today.addRx')}
            </button>
          </div>
        </div>
      ) : (
        <div className="card">
          {data.active.map((p) => (
            <PrescriptionRow key={p.id} p={p} onOpen={() => nav.openPrescription(p.id)} />
          ))}
        </div>
      )}
      {!canAdd && <div className="sec-note">{t('app.rx.limit', { n: data.limit })}</div>}

      {data.finished.length > 0 && (
        <>
          <div className="sec-title">{t('app.rx.history')}</div>
          <div className="card">
            {data.finished.map((p) => (
              <PrescriptionRow key={p.id} p={p} onOpen={() => nav.openPrescription(p.id)} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function PrescriptionRow({ p, onOpen }: { p: PrescriptionSummary; onOpen: () => void }) {
  const t = useT();
  const active = p.status === 'ACTIVE';
  const days = t('common.days', { n: p.totalDays });
  const status = !active
    ? t('app.rx.range', { from: formatDate(p.startDate), to: formatDate(p.endDate), days })
    : p.day === 0
      ? t('app.rx.startsOn', { date: formatShort(p.startDate), days })
      : t('app.rx.dayOf', { day: p.day, total: p.totalDays, date: formatShort(p.endDate) });
  return (
    <div className="rx" onClick={onOpen} role="button">
      <div className="rx-head">
        <div className="rx-title">{p.title}</div>
        {p.percent !== null && <div className={`rx-pct ${pctClass(p.percent)}`}>{p.percent}%</div>}
      </div>
      <div className="rx-meta">
        {status}
        <br />
        💊 {p.medicationNames.join(', ') || '—'}
      </div>
      {active && <ProgressBar value={(p.day / p.totalDays) * 100} />}
    </div>
  );
}
