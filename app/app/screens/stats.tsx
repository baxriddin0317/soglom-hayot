'use client';

import { useState } from 'react';
import type { StatsView } from '@/lib/webapp/types';
import { formatDate, formatShort, weekday, weekdayShort } from '@/lib/time';
import { useApi } from '../api';
import { useLang, useT } from '../store';
import { ErrorState, Loading, ProgressBar, pctClass } from '../ui';

export function StatsScreen() {
  const t = useT();
  const lang = useLang();
  const [period, setPeriod] = useState<7 | 30>(7);
  const { data, error, reload } = useApi<StatsView>(`stats?period=${period}`);

  const tabs = (
    <div className="pad-x" style={{ paddingTop: 12 }}>
      <div className="segmented">
        {([7, 30] as const).map((p) => (
          <button key={p} type="button" className={`stab ${period === p ? 'on' : ''}`} onClick={() => setPeriod(p)}>
            {t('common.days', { n: p })}
          </button>
        ))}
      </div>
    </div>
  );

  const head = (
    <div className="page-head">
      <div className="page-title">{t('app.stats.title')}</div>
      <div className="page-sub">
        {data ? `${formatDate(data.from)} – ${formatDate(data.to)}` : t('app.stats.sub')}
      </div>
    </div>
  );

  if (!data) {
    return (
      <>
        {head}
        {tabs}
        {error ? <ErrorState message={error.message} onRetry={reload} /> : <Loading />}
      </>
    );
  }

  const tt = data.totals;
  const max = Math.max(1, ...data.days.map((d) => d.total));

  return (
    <>
      {head}
      {tabs}

      {tt.total === 0 ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="empty" style={{ paddingBottom: 22 }}>
            <div className="e-title">{t('app.stats.noData')}</div>
            <div className="e-text">{t('app.stats.noDataText')}</div>
          </div>
        </div>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className={`kpi-v ${pctClass(data.percent)}`}>{data.percent === null ? '—' : `${data.percent}%`}</div>
              <div className="kpi-k">{t('app.stats.adherence')}</div>
            </div>
            <div className="kpi">
              <div className="kpi-v">🔥 {data.streak}</div>
              <div className="kpi-k">{t('app.stats.streak')}</div>
            </div>
            <div className="kpi">
              <div className="kpi-v pct-ok">{tt.taken}</div>
              <div className="kpi-k">{t('app.stats.taken')}</div>
            </div>
            <div className="kpi">
              <div className={`kpi-v ${tt.missed + tt.skipped ? 'pct-bad' : ''}`}>{tt.missed + tt.skipped}</div>
              <div className="kpi-k">
                {t('app.stats.missed')}
                {tt.skipped && tt.missed ? ` (${tt.skipped} + ${tt.missed})` : ''}
              </div>
            </div>
          </div>

          <div className="sec-title">{t('app.stats.byDay')}</div>
          <div className="card chart">
            <div className="plot">
              {data.days.map((d) => (
                <div key={d.date} className={`col ${d.date === data.to ? 'today' : ''}`} title={`${formatShort(d.date)}: ${d.taken}/${d.total}`}>
                  <div className="col-stack" style={{ height: `${Math.max(3, (d.total / max) * 100)}%` }}>
                    {d.total > 0 && (
                      <>
                        <div className="c-ok" style={{ height: `${(d.taken / d.total) * 100}%` }} />
                        <div className="c-warn" style={{ height: `${(d.skipped / d.total) * 100}%` }} />
                        <div className="c-bad" style={{ height: `${(d.missed / d.total) * 100}%` }} />
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="xaxis">
              {data.days.map((d, i) => (
                <div key={d.date} className="xlab">
                  {period === 7
                    ? weekdayShort(weekday(d.date), lang)
                    : i % 5 === 0 || i === data.days.length - 1
                      ? formatShort(d.date)
                      : ''}
                </div>
              ))}
            </div>
            <div className="legend" style={{ marginTop: 10 }}>
              <span className="lg"><span className="sw ok" />{t('app.stats.lgTaken')}</span>
              <span className="lg"><span className="sw warn" />{t('app.stats.lgSkipped')}</span>
              <span className="lg"><span className="sw bad" />{t('app.stats.lgMissed')}</span>
            </div>
          </div>

          {data.medications.length > 0 && (
            <>
              <div className="sec-title">{t('app.stats.byMed')}</div>
              <div className="card">
                {data.medications.map((m) => (
                  <div className="mrow" key={m.id}>
                    <div className="mrow-head">
                      <b>{m.name}</b>
                      <span className={pctClass(m.percent)}>
                        {m.percent === null ? '—' : `${m.percent}%`}{' '}
                        <span style={{ color: 'var(--hint)' }}>
                          ({m.taken}/{m.resolved})
                        </span>
                      </span>
                    </div>
                    <ProgressBar value={m.percent ?? 0} ok />
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="sec-note">{t('app.stats.note')}</div>
        </>
      )}
    </>
  );
}
