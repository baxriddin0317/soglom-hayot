'use client';

import { useState } from 'react';
import type { StatsView } from '@/lib/webapp/types';
import { formatDate, formatShort, weekday, WEEKDAYS_SHORT } from '@/lib/time';
import { useApi } from '../api';
import { ErrorState, Loading, ProgressBar, pctClass } from '../ui';

export function StatsScreen() {
  const [period, setPeriod] = useState<7 | 30>(7);
  const { data, error, reload } = useApi<StatsView>(`stats?period=${period}`);

  const tabs = (
    <div className="pad-x" style={{ paddingTop: 12 }}>
      <div className="segmented">
        {([7, 30] as const).map((p) => (
          <button key={p} type="button" className={`stab ${period === p ? 'on' : ''}`} onClick={() => setPeriod(p)}>
            {p} kun
          </button>
        ))}
      </div>
    </div>
  );

  const head = (
    <div className="page-head">
      <div className="page-title">Hisobot</div>
      <div className="page-sub">
        {data ? `${formatDate(data.from)} – ${formatDate(data.to)}` : 'Davolanishga rioya darajasi'}
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

  const t = data.totals;
  const max = Math.max(1, ...data.days.map((d) => d.total));

  return (
    <>
      {head}
      {tabs}

      {t.total === 0 ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="empty" style={{ paddingBottom: 22 }}>
            <div className="e-title">Ma'lumot yo'q</div>
            <div className="e-text">Bu davrda dori rejalashtirilmagan.</div>
          </div>
        </div>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className={`kpi-v ${pctClass(data.percent)}`}>{data.percent === null ? '—' : `${data.percent}%`}</div>
              <div className="kpi-k">rioya darajasi</div>
            </div>
            <div className="kpi">
              <div className="kpi-v">🔥 {data.streak}</div>
              <div className="kpi-k">ketma-ket to'liq kun</div>
            </div>
            <div className="kpi">
              <div className="kpi-v pct-ok">{t.taken}</div>
              <div className="kpi-k">ichilgan doza</div>
            </div>
            <div className="kpi">
              <div className={`kpi-v ${t.missed + t.skipped ? 'pct-bad' : ''}`}>{t.missed + t.skipped}</div>
              <div className="kpi-k">
                o'tkazilgan{t.skipped && t.missed ? ` (${t.skipped} + ${t.missed})` : ''}
              </div>
            </div>
          </div>

          <div className="sec-title">Kunlar bo'yicha</div>
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
                    ? WEEKDAYS_SHORT[weekday(d.date)]
                    : i % 5 === 0 || i === data.days.length - 1
                      ? formatShort(d.date)
                      : ''}
                </div>
              ))}
            </div>
            <div className="legend" style={{ marginTop: 10 }}>
              <span className="lg"><span className="sw ok" />ichildi</span>
              <span className="lg"><span className="sw warn" />o'tkazildi</span>
              <span className="lg"><span className="sw bad" />belgilanmadi</span>
            </div>
          </div>

          {data.medications.length > 0 && (
            <>
              <div className="sec-title">Dorilar bo'yicha</div>
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

          <div className="sec-note">
            Rioya — natijasi ma'lum dozalardan (ichildi, o'tkazildi, belgilanmadi) nechtasi ichilgani. Hali vaqti
            kelmagan dozalar hisobga olinmaydi.
          </div>
        </>
      )}
    </>
  );
}
