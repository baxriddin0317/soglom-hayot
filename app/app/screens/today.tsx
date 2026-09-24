'use client';

import { useState } from 'react';
import type { DoseActionName, DoseView, TodayView } from '@/lib/webapp/types';
import { addDays, formatDayMonth, relativeDay, weekdayName } from '@/lib/time';
import { ApiRequestError, api, useApi } from '../api';
import type { Nav } from '../mini-app';
import { haptic } from '../telegram';
import { DayRing, ErrorState, Icon, Loading, STATUS_LABEL, Sheet, medMeta, untilText, useNow } from '../ui';

const OPEN = new Set(['PENDING', 'MISSED']);
// "Ichdim" tugmasi vaqti yaqinlashgan (2 soat ichida) yoki o'tgan dozalar uchun chiqadi.
const EARLY_MS = 2 * 60 * 60_000;

export function TodayScreen({ nav }: { nav: Nav }) {
  const [date, setDate] = useState<string | null>(null);
  const { data, error, reload } = useApi<TodayView>(date ? `today?date=${date}` : 'today', { pollMs: 60_000 });
  const now = useNow();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<DoseView | null>(null);

  if (!data) return error ? <ErrorState message={error.message} onRetry={reload} /> : <Loading />;

  const act = async (dose: DoseView, action: DoseActionName) => {
    if (busyId) return;
    setBusyId(dose.id);
    try {
      await api('dose', { doseId: dose.id, action });
      if (action === 'take') haptic.success();
      else haptic.select();
      nav.changed();
      await reload();
      setSheet(null);
      if (action === 'take') nav.toast(`✅ ${dose.name} — belgilandi`);
    } catch (err) {
      haptic.error();
      nav.toast(err instanceof ApiRequestError ? err.message : "Xatolik yuz berdi. Qayta urinib ko'ring.");
    } finally {
      setBusyId(null);
    }
  };

  const isToday = data.date === data.today;
  const slots = new Map<string, DoseView[]>();
  for (const d of data.doses) slots.set(d.time, [...(slots.get(d.time) ?? []), d]);
  const nextSlot = isToday ? data.doses.find((d) => OPEN.has(d.status) && new Date(d.scheduledAt).getTime() > now)?.time : undefined;

  return (
    <>
      <div className="hero">
        <div className="avatar">{data.initials}</div>
        <div>
          <div className="hero-name">Assalomu alaykum, {data.firstName}</div>
          <div className="hero-sub">
            {data.activePrescriptions > 0
              ? `Faol retseptlar: ${data.activePrescriptions} ta`
              : "Sog'lig'ingizni asrang 🌿"}
          </div>
        </div>
      </div>

      {!data.remindersEnabled && data.activePrescriptions > 0 && (
        <div className="banner">
          <Icon.bell size={18} />
          <div>
            Eslatmalar o'chirilgan — botdan xabar kelmaydi.{' '}
            <button type="button" className="link-btn" style={{ padding: 0 }} onClick={() => nav.goTab('settings')}>
              Yoqish
            </button>
          </div>
        </div>
      )}

      {data.activePrescriptions === 0 && data.doses.length === 0 && isToday ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="empty">
            <div className="empty-ic">
              <Icon.pill size={30} />
            </div>
            <div className="e-title">Faol retsept yo'q</div>
            <div className="e-text">
              Shifokor yozib bergan retseptni kiriting — har bir dori vaqtida Telegram'da eslatma olasiz.
            </div>
          </div>
          <div className="e-actions">
            <button className="btn" type="button" onClick={nav.openNew}>
              <Icon.plus /> Retsept qo'shish
            </button>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="summary">
            <DayRing {...data.counts} />
            <div className="sum-body">
              <div className="sum-title">
                {data.counts.total === 0
                  ? 'Bu kunda dori yo\'q'
                  : data.counts.taken === data.counts.total
                    ? 'Barchasi ichildi! 👏'
                    : isToday
                      ? 'Bugungi reja'
                      : `${relativeDay(data.date, data.today)} rejasi`}
              </div>
              <div className="legend">
                <span className="lg"><span className="sw ok" />{data.counts.taken} ichildi</span>
                {data.counts.skipped > 0 && <span className="lg"><span className="sw warn" />{data.counts.skipped} o'tkazildi</span>}
                {data.counts.missed > 0 && <span className="lg"><span className="sw bad" />{data.counts.missed} belgilanmadi</span>}
                {data.counts.pending > 0 && <span className="lg"><span className="sw" />{data.counts.pending} kutilmoqda</span>}
              </div>
            </div>
          </div>
          {data.next && (
            <div className="next">
              <div className="next-ic">
                <Icon.clock />
              </div>
              <div>
                <div className="next-t">
                  Keyingi dori · {relativeDay(data.next.date, data.today).toLowerCase()} {data.next.time} ·{' '}
                  {untilText(data.next.scheduledAt, now)}
                </div>
                <div className="next-v">{data.next.names.join(', ')}</div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="daynav">
        <button type="button" className="dn-btn" aria-label="Oldingi kun" onClick={() => setDate(addDays(data.date, -1))}>
          <Icon.left />
        </button>
        <div className="dn-mid">
          <div className="dn-title">
            {relativeDay(data.date, data.today)}
            {relativeDay(data.date, data.today) !== formatDayMonth(data.date) ? `, ${formatDayMonth(data.date)}` : ''}
          </div>
          {isToday ? (
            <div className="dn-sub">{weekdayName(data.date)}</div>
          ) : (
            <button type="button" className="dn-today" onClick={() => setDate(null)}>
              Bugunga qaytish
            </button>
          )}
        </div>
        <button type="button" className="dn-btn" aria-label="Keyingi kun" onClick={() => setDate(addDays(data.date, 1))}>
          <Icon.right />
        </button>
      </div>

      {data.doses.length === 0 ? (
        <div className="sec-note" style={{ textAlign: 'center', paddingTop: 16 }}>
          Bu kunga dori rejalashtirilmagan.
        </div>
      ) : (
        [...slots.entries()].map(([time, doses]) => (
          <div key={time}>
            <div className="slot-time">
              {time}
              {time === nextSlot && <span className="now-pill">keyingi</span>}
            </div>
            <div className="card">
              {doses.map((d) => {
                const canAct = d.editable && OPEN.has(d.status) && new Date(d.scheduledAt).getTime() <= now + EARLY_MS;
                return (
                  <div key={d.id} className={`dose ${d.status}`}>
                    <div className="dose-ic">
                      {d.status === 'TAKEN' ? <Icon.check /> : d.status === 'SKIPPED' ? <Icon.skip /> : d.status === 'MISSED' ? <Icon.cross /> : <Icon.pill />}
                    </div>
                    <div className="dose-body" onClick={() => d.editable && setSheet(d)}>
                      <div className="dose-name">{d.name}</div>
                      <div className="dose-meta">{[medMeta(d), d.prescriptionTitle].filter(Boolean).join(' · ')}</div>
                    </div>
                    {canAct ? (
                      <div className="dose-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label="O'tkazib yuborish"
                          disabled={busyId === d.id}
                          onClick={() => act(d, 'skip')}
                        >
                          <Icon.skip />
                        </button>
                        <button
                          type="button"
                          className="icon-btn take"
                          aria-label="Ichdim"
                          disabled={busyId === d.id}
                          onClick={() => act(d, 'take')}
                        >
                          <Icon.check />
                        </button>
                      </div>
                    ) : (
                      d.status !== 'PENDING' && <span className={`status-chip ${d.status}`}>{STATUS_LABEL[d.status]}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {sheet && (
        <Sheet onClose={() => setSheet(null)}>
          <div className="s-title">{sheet.name}</div>
          <div className="s-text">
            {relativeDay(sheet.date, data.today)} {sheet.time}
            {medMeta(sheet) ? ` · ${medMeta(sheet)}` : ''}
            <br />
            Holati: <b>{STATUS_LABEL[sheet.status]}</b>
          </div>
          <div className="s-actions">
            {sheet.status !== 'TAKEN' && (
              <button className="btn ok" type="button" disabled={!!busyId} onClick={() => act(sheet, 'take')}>
                <Icon.check /> {sheet.status === 'MISSED' ? 'Ichgan edim' : 'Ichdim'}
              </button>
            )}
            {sheet.status !== 'SKIPPED' && (
              <button className="btn quiet" type="button" disabled={!!busyId} onClick={() => act(sheet, 'skip')}>
                O'tkazib yubordim
              </button>
            )}
            {(sheet.status === 'TAKEN' || sheet.status === 'SKIPPED') && (
              <button className="btn ghost" type="button" disabled={!!busyId} onClick={() => act(sheet, 'undo')}>
                Belgini bekor qilish
              </button>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
