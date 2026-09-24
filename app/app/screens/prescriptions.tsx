'use client';

import type { PrescriptionSummary, PrescriptionsView } from '@/lib/webapp/types';
import { formatDate, formatShort } from '@/lib/time';
import { useApi } from '../api';
import type { Nav } from '../mini-app';
import { ErrorState, Icon, Loading, ProgressBar, pctClass } from '../ui';

export function PrescriptionsScreen({ nav }: { nav: Nav }) {
  const { data, error, reload } = useApi<PrescriptionsView>('prescriptions');
  if (!data) return error ? <ErrorState message={error.message} onRetry={reload} /> : <Loading />;

  const canAdd = data.active.length < data.limit;

  return (
    <>
      <div className="page-head">
        <div className="page-title">Retseptlar</div>
        <div className="page-sub">Shifokor yozib bergan davolanish kurslari</div>
      </div>

      <div className="sec-title">
        Faol
        {canAdd && data.active.length > 0 && (
          <button type="button" className="sec-link" onClick={nav.openNew}>
            + Yangi
          </button>
        )}
      </div>
      {data.active.length === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="empty-ic">
              <Icon.tabRx />
            </div>
            <div className="e-title">Faol retsept yo'q</div>
            <div className="e-text">
              Retseptdagi dorilar, kuniga necha marta va qaysi soatlarda ichilishini kiriting — qolganini bot eslatib turadi.
            </div>
          </div>
          <div className="e-actions">
            <button className="btn" type="button" onClick={nav.openNew}>
              <Icon.plus /> Retsept qo'shish
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
      {!canAdd && (
        <div className="sec-note">
          Bir vaqtda ko'pi bilan {data.limit} ta faol retsept. Yangisini qo'shish uchun keraksizini yakunlang.
        </div>
      )}

      {data.finished.length > 0 && (
        <>
          <div className="sec-title">Tarix</div>
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
  const active = p.status === 'ACTIVE';
  const status = !active
    ? `${formatDate(p.startDate)} – ${formatDate(p.endDate)} · ${p.totalDays} kun`
    : p.day === 0
      ? `${formatShort(p.startDate)} dan boshlanadi · ${p.totalDays} kun`
      : `${p.day}-kun / ${p.totalDays} · ${formatShort(p.endDate)} gacha`;
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
