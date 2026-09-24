'use client';

import { useState } from 'react';
import { LIMITS } from '@/lib/constants';
import type { MedicationView, PrescriptionDetailView } from '@/lib/webapp/types';
import { formatDate, formatShort } from '@/lib/time';
import { ApiRequestError, api, useApi } from '../api';
import type { Nav } from '../mini-app';
import { confirmDialog, haptic } from '../telegram';
import { ErrorState, Loading, ProgressBar, Sheet, medMeta, pctClass } from '../ui';
import { TimesEditor } from './times-editor';

type SheetState = { kind: 'times'; med: MedicationView } | { kind: 'days' } | null;

export function PrescriptionScreen({ id, nav }: { id: string; nav: Nav }) {
  const { data, error, reload } = useApi<PrescriptionDetailView>(`prescription?id=${encodeURIComponent(id)}`);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [times, setTimes] = useState<string[]>([]);
  const [days, setDays] = useState(7);

  if (!data) {
    if (error?.status === 404) {
      return <ErrorState message="Retsept topilmadi — u o'chirilgan bo'lishi mumkin." onRetry={nav.back} />;
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
      nav.toast(err instanceof ApiRequestError ? err.message : "Xatolik yuz berdi. Qayta urinib ko'ring.");
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    const ok = await confirmDialog(`«${data.title}» kursini hozir yakunlaysizmi? Kelgusi eslatmalar to'xtaydi, tarix saqlanadi.`);
    if (ok) await run(() => api('prescription', { id, action: 'finish' }), '⏹ Kurs yakunlandi');
  };

  const remove = async () => {
    const ok = await confirmDialog(`«${data.title}» retseptini butunlay o'chirasizmi? Ichish tarixi ham o'chadi.`);
    if (ok) await run(() => api('prescription', { id, action: 'delete' }), "🗑 Retsept o'chirildi", nav.back);
  };

  const stopMed = async (m: MedicationView) => {
    const ok = await confirmDialog(`${m.name} ni to'xtatasizmi? Bu dori bo'yicha eslatmalar endi kelmaydi.`);
    if (ok) await run(() => api('medication', { id: m.id, action: 'stop' }), `⏹ ${m.name} to'xtatildi`);
  };

  return (
    <>
      <div className="detail-head">
        <span className={`badge ${active ? 'active' : ''}`}>
          {active ? (data.day === 0 ? 'Hali boshlanmagan' : `${data.day}-kun / ${data.totalDays}`) : 'Yakunlangan'}
        </span>
        <div className="page-title">{data.title}</div>
        <div className="page-sub">
          {formatDate(data.startDate)} – {formatDate(data.endDate)} · {data.totalDays} kun
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
          <div className="tile-k">rioya</div>
        </div>
        <div className="tile">
          <div className="tile-v">{data.counts.taken}</div>
          <div className="tile-k">ichilgan doza</div>
        </div>
        <div className="tile">
          <div className="tile-v">{data.counts.skipped + data.counts.missed}</div>
          <div className="tile-k">o'tkazilgan</div>
        </div>
      </div>

      {data.notes && (
        <>
          <div className="sec-title">Izoh</div>
          <div className="card pad" style={{ fontSize: 15, lineHeight: 1.4 }}>
            {data.notes}
          </div>
        </>
      )}

      <div className="sec-title">Dorilar</div>
      <div className="card">
        {data.medications.map((m) => (
          <div key={m.id} className={`med ${m.isActive || !active ? '' : 'off'}`}>
            <div className="med-top">
              <div>
                <div className="med-name">{m.name}</div>
                <div className="med-meta">
                  {[medMeta(m), m.endDate !== data.endDate ? `${m.days} kun (${formatShort(m.endDate)} gacha)` : null]
                    .filter(Boolean)
                    .join(' · ') || `Kuniga ${m.times.length} marta`}
                  {active && !m.isActive && " · to'xtatilgan"}
                </div>
              </div>
              {m.percent !== null && <div className={`rx-pct ${pctClass(m.percent)}`}>{m.percent}%</div>}
            </div>
            <div className="time-chips">
              {m.times.map((t) => (
                <span className="tchip" key={t}>
                  {t}
                </span>
              ))}
            </div>
            {active && m.isActive && (
              <div className="med-actions">
                <button
                  type="button"
                  className="btn quiet small"
                  onClick={() => {
                    setTimes(m.times);
                    setSheet({ kind: 'times', med: m });
                  }}
                >
                  Vaqtlarni o'zgartirish
                </button>
                <button type="button" className="btn danger small" onClick={() => stopMed(m)}>
                  To'xtatish
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
              Muddatni o'zgartirish
            </button>
            <button className="btn quiet" type="button" disabled={busy} onClick={finish}>
              Kursni yakunlash
            </button>
          </>
        )}
        <button className="btn ghost" type="button" disabled={busy} onClick={remove}>
          Retseptni o'chirish
        </button>
      </div>

      {sheet?.kind === 'times' && (
        <Sheet onClose={() => setSheet(null)}>
          <div className="s-title">{sheet.med.name}</div>
          <div className="s-text">Qabul vaqtlarini belgilang. O'tgan dozalar tarixi saqlanadi.</div>
          <TimesEditor times={times} onChange={setTimes} />
          <div className="s-actions">
            <button
              className="btn"
              type="button"
              disabled={busy || times.length === 0}
              onClick={() =>
                run(() => api('medication', { id: sheet.med.id, action: 'times', times }), '⏰ Vaqtlar saqlandi')
              }
            >
              Saqlash
            </button>
          </div>
        </Sheet>
      )}

      {sheet?.kind === 'days' && (
        <Sheet onClose={() => setSheet(null)}>
          <div className="s-title">Kurs muddati</div>
          <div className="s-text">
            Kurs {formatDate(data.startDate)} da boshlangan. Jami necha kun davom etsin?
          </div>
          <div className="stepper" style={{ justifyContent: 'center' }}>
            <button type="button" onClick={() => setDays((d) => Math.max(Math.max(1, data.day), d - 1))}>
              −
            </button>
            <div className="stepper-v">{days} kun</div>
            <button type="button" onClick={() => setDays((d) => Math.min(LIMITS.maxCourseDays, d + 1))}>
              +
            </button>
          </div>
          <div className="s-actions">
            <button
              className="btn"
              type="button"
              disabled={busy || days === data.totalDays}
              onClick={() => run(() => api('prescription', { id, action: 'days', days }), '📅 Muddat yangilandi')}
            >
              Saqlash
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
