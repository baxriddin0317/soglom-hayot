'use client';

import { useState } from 'react';
import type { AsNeededView, DoseActionName, DoseView, TodayView } from '@/lib/webapp/types';
import { addDays, formatDayMonth, relativeDay, weekdayName } from '@/lib/time';
import { ApiRequestError, api, useApi } from '../api';
import { useLang, useNav, useT } from '../store';
import { getWebApp, haptic, safely } from '../telegram';
import { DayRing, ErrorState, Icon, Loading, Sheet, medMeta, statusLabel, untilText, useNow } from '../ui';

const OPEN = new Set(['PENDING', 'MISSED']);
// "Ichdim" tugmasi vaqti yaqinlashgan (2 soat ichida) yoki o'tgan dozalar uchun chiqadi.
const EARLY_MS = 2 * 60 * 60_000;

function alertBox(message: string) {
  const tg = getWebApp();
  try {
    if (!tg || !tg.isVersionAtLeast('6.2')) throw new Error('no popup');
    tg.showAlert(message);
  } catch {
    safely(() => window.alert(message));
  }
}

export function TodayScreen() {
  const t = useT();
  const lang = useLang();
  const nav = useNav();
  const [date, setDate] = useState<string | null>(null);
  const { data, error, reload } = useApi<TodayView>(date ? `today?date=${date}` : 'today', { pollMs: 60_000 });
  const now = useNow();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<DoseView | null>(null);

  if (!data) return error ? <ErrorState message={error.message} onRetry={reload} /> : <Loading />;

  const fail = (err: unknown) => {
    haptic.error();
    nav.toast(err instanceof ApiRequestError ? err.message : t('common.error'));
  };

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
      if (action === 'take') nav.toast(t('app.today.marked', { name: dose.name }));
    } catch (err) {
      fail(err);
    } finally {
      setBusyId(null);
    }
  };

  const takeAsNeeded = async (m: AsNeededView) => {
    if (busyId) return;
    setBusyId(m.id);
    try {
      const res = await api<{ countToday: number; overLimit: boolean; time: string }>('medication', {
        id: m.id,
        action: 'prn',
      });
      haptic.success();
      nav.changed();
      await reload();
      if (res.overLimit) {
        alertBox(t('prn.overLimit', { name: m.name, n: res.countToday, max: m.maxPerDay ?? 0 }));
      } else {
        nav.toast(t('prn.logged', { name: m.name, time: res.time }));
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusyId(null);
    }
  };

  const isToday = data.date === data.today;
  const rel = (d: string) => relativeDay(d, data.today, lang);
  const slots = new Map<string, DoseView[]>();
  for (const d of data.doses) slots.set(d.time, [...(slots.get(d.time) ?? []), d]);
  const nextSlot = isToday ? data.doses.find((d) => OPEN.has(d.status) && new Date(d.scheduledAt).getTime() > now)?.time : undefined;

  return (
    <>
      <div className="hero">
        <div className="avatar">{data.initials}</div>
        <div>
          <div className="hero-name">{t('app.today.hello', { name: data.firstName })}</div>
          <div className="hero-sub">
            {data.activePrescriptions > 0 ? t('app.today.activeRx', { n: data.activePrescriptions }) : t('app.today.healthy')}
          </div>
        </div>
      </div>

      {!data.remindersEnabled && data.activePrescriptions > 0 && (
        <div className="banner">
          <Icon.bell size={18} />
          <div>
            {t('app.today.remOff')}{' '}
            <button type="button" className="link-btn" style={{ padding: 0 }} onClick={() => nav.goTab('settings')}>
              {t('app.today.turnOn')}
            </button>
          </div>
        </div>
      )}

      {isToday && data.lowStock.length > 0 && (
        <div className="banner bad">
          <Icon.tabStock />
          <div>
            {t('app.today.lowStock', { list: data.lowStock.join(', ') })}{' '}
            <button type="button" className="link-btn" style={{ padding: 0 }} onClick={() => nav.goTab('stock')}>
              {t('app.today.lowStockOpen')}
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
            <div className="e-title">{t('app.today.noRx')}</div>
            <div className="e-text">{t('app.today.noRxText')}</div>
          </div>
          <div className="e-actions">
            <button className="btn" type="button" onClick={nav.openNew}>
              <Icon.plus /> {t('app.today.addRx')}
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
                  ? t('app.today.noDoses')
                  : data.counts.taken === data.counts.total
                    ? t('app.today.allTaken')
                    : isToday
                      ? t('app.today.plan')
                      : t('app.today.planOf', { day: rel(data.date) })}
              </div>
              <div className="legend">
                <span className="lg"><span className="sw ok" />{t('app.today.lgTaken', { n: data.counts.taken })}</span>
                {data.counts.skipped > 0 && <span className="lg"><span className="sw warn" />{t('app.today.lgSkipped', { n: data.counts.skipped })}</span>}
                {data.counts.missed > 0 && <span className="lg"><span className="sw bad" />{t('app.today.lgMissed', { n: data.counts.missed })}</span>}
                {data.counts.pending > 0 && <span className="lg"><span className="sw" />{t('app.today.lgPending', { n: data.counts.pending })}</span>}
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
                  {t('app.today.next', {
                    when: `${rel(data.next.date).toLowerCase()} ${data.next.time}`,
                    until: untilText(data.next.scheduledAt, now, t),
                  })}
                </div>
                <div className="next-v">{data.next.names.join(', ')}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {isToday && data.asNeeded.length > 0 && (
        <>
          <div className="sec-title">{t('app.today.prn')}</div>
          <div className="card">
            {data.asNeeded.map((m) => (
              <div key={m.id} className="dose">
                <div className="dose-ic">
                  <Icon.pill />
                </div>
                <div className="dose-body">
                  <div className="dose-name">{m.name}</div>
                  <div className={`dose-meta ${m.maxPerDay && m.countToday >= m.maxPerDay ? 'pct-bad' : ''}`}>
                    {[
                      m.dosage,
                      m.maxPerDay
                        ? t('app.today.prnCountMax', { n: m.countToday, max: m.maxPerDay })
                        : t('app.today.prnCount', { n: m.countToday }),
                      m.lastTime,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn ok small"
                  disabled={busyId === m.id}
                  onClick={() => takeAsNeeded(m)}
                >
                  {t('app.today.take')}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="daynav">
        <button type="button" className="dn-btn" aria-label={t('app.today.prevDay')} onClick={() => setDate(addDays(data.date, -1))}>
          <Icon.left />
        </button>
        <div className="dn-mid">
          <div className="dn-title">
            {rel(data.date)}
            {rel(data.date) !== formatDayMonth(data.date, lang) ? `, ${formatDayMonth(data.date, lang)}` : ''}
          </div>
          {isToday ? (
            <div className="dn-sub">{weekdayName(data.date, lang)}</div>
          ) : (
            <button type="button" className="dn-today" onClick={() => setDate(null)}>
              {t('app.today.backToday')}
            </button>
          )}
        </div>
        <button type="button" className="dn-btn" aria-label={t('app.today.nextDay')} onClick={() => setDate(addDays(data.date, 1))}>
          <Icon.right />
        </button>
      </div>

      {data.doses.length === 0 ? (
        <div className="sec-note" style={{ textAlign: 'center', paddingTop: 16 }}>
          {t('app.today.emptyDay')}
        </div>
      ) : (
        [...slots.entries()].map(([time, doses]) => (
          <div key={time}>
            <div className="slot-time">
              {time}
              {time === nextSlot && <span className="now-pill">{t('app.today.nextPill')}</span>}
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
                      <div className="dose-meta">{[medMeta(d, t), d.prescriptionTitle].filter(Boolean).join(' · ')}</div>
                    </div>
                    {canAct ? (
                      <div className="dose-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={t('app.today.skip')}
                          disabled={busyId === d.id}
                          onClick={() => act(d, 'skip')}
                        >
                          <Icon.skip />
                        </button>
                        <button
                          type="button"
                          className="icon-btn take"
                          aria-label={t('app.today.take')}
                          disabled={busyId === d.id}
                          onClick={() => act(d, 'take')}
                        >
                          <Icon.check />
                        </button>
                      </div>
                    ) : (
                      d.status !== 'PENDING' && <span className={`status-chip ${d.status}`}>{statusLabel(d.status, t)}</span>
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
            {rel(sheet.date)} {sheet.time}
            {medMeta(sheet, t) ? ` · ${medMeta(sheet, t)}` : ''}
            <br />
            {t('app.today.status')} <b>{statusLabel(sheet.status, t)}</b>
          </div>
          <div className="s-actions">
            {sheet.status !== 'TAKEN' && (
              <button className="btn ok" type="button" disabled={!!busyId} onClick={() => act(sheet, 'take')}>
                <Icon.check /> {sheet.status === 'MISSED' ? t('app.today.tookLate') : t('app.today.take')}
              </button>
            )}
            {sheet.status !== 'SKIPPED' && (
              <button className="btn quiet" type="button" disabled={!!busyId} onClick={() => act(sheet, 'skip')}>
                {t('app.today.skipped')}
              </button>
            )}
            {(sheet.status === 'TAKEN' || sheet.status === 'SKIPPED') && (
              <button className="btn ghost" type="button" disabled={!!busyId} onClick={() => act(sheet, 'undo')}>
                {t('app.today.undo')}
              </button>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
