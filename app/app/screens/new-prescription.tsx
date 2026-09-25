'use client';

import { useRef, useState } from 'react';
import {
  COURSE_DAY_PRESETS,
  DOSAGE_PRESET_KEYS,
  INTERVAL_HOURS,
  LIMITS,
  MAX_PER_DAY_OPTIONS,
  MEAL_KEY,
  MEALS,
  type Meal,
} from '@/lib/constants';
import { intervalTimes, suggestedTimes, weekdayShort } from '@/lib/time';
import type { NewMedicationBody } from '@/lib/webapp/types';
import { ApiRequestError, api } from '../api';
import { useLang, useNav, useT } from '../store';
import { confirmDialog, haptic } from '../telegram';
import { Icon, Switch } from '../ui';
import { TimesEditor } from './times-editor';

type Mode = 'times' | 'interval' | 'prn';
type Freq = 1 | 2 | 3 | 'week';

interface MedDraft {
  key: number;
  name: string;
  dosage: string;
  meal: Meal;
  mode: Mode;
  times: string[];
  intervalHours: number;
  firstDose: string;
  maxPerDay: number | null;
  freq: Freq;
  weekdays: number[];
  wholeCourse: boolean;
  days: number;
  stock: string;
}

// Hafta kunlari dushanbadan boshlab.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

let seq = 0;
const emptyMed = (): MedDraft => ({
  key: ++seq,
  name: '',
  dosage: '',
  meal: 'ANY',
  mode: 'times',
  times: suggestedTimes(2),
  intervalHours: 8,
  firstDose: '06:00',
  maxPerDay: null,
  freq: 1,
  weekdays: [],
  wholeCourse: true,
  days: 3,
  stock: '',
});

export function NewPrescriptionScreen() {
  const t = useT();
  const lang = useLang();
  const nav = useNav();
  const [title, setTitle] = useState('');
  const [doctor, setDoctor] = useState('');
  const [notes, setNotes] = useState('');
  const [days, setDays] = useState(7);
  const [startOffset, setStartOffset] = useState<0 | 1>(0);
  const [meds, setMeds] = useState<MedDraft[]>(() => [emptyMed()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  const patchMed = (key: number, patch: Partial<MedDraft>) =>
    setMeds((list) => list.map((m) => (m.key === key ? { ...m, ...patch } : m)));

  const removeMed = async (m: MedDraft) => {
    if (m.name && !(await confirmDialog(t('app.new.confirmRemove', { name: m.name })))) return;
    setMeds((list) => list.filter((x) => x.key !== m.key));
  };

  const fail = (message: string) => {
    haptic.error();
    setError(message);
    requestAnimationFrame(() => errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  const toBody = (m: MedDraft): NewMedicationBody => {
    const stock = m.stock.trim() ? Number(m.stock.replace(',', '.')) : null;
    const base = {
      name: m.name.trim(),
      dosage: m.dosage.trim() || null,
      meal: m.meal,
      days: m.wholeCourse ? null : Math.min(m.days, days),
      stock: stock !== null && Number.isFinite(stock) ? stock : null,
    };
    if (m.mode === 'prn') return { ...base, times: [], asNeeded: true, maxPerDay: m.maxPerDay };
    return {
      ...base,
      times: m.times,
      everyDays: m.freq === 'week' ? 1 : m.freq,
      weekdays: m.freq === 'week' ? m.weekdays : [],
    };
  };

  const submit = async () => {
    if (busy) return;
    setError(null);
    const unnamed = meds.findIndex((m) => !m.name.trim());
    if (unnamed >= 0) return fail(t('app.new.errName', { n: unnamed + 1 }));
    const noTimes = meds.find((m) => m.mode !== 'prn' && m.times.length === 0);
    if (noTimes) return fail(t('app.new.errTimes', { name: noTimes.name }));
    const noDays = meds.find((m) => m.mode !== 'prn' && m.freq === 'week' && m.weekdays.length === 0);
    if (noDays) return fail(t('app.new.errWeekdays', { name: noDays.name }));

    setBusy(true);
    try {
      const res = await api<{ id: string }>('prescriptions', {
        title: title.trim(),
        doctor: doctor.trim() || null,
        notes: notes.trim() || null,
        days,
        startOffset,
        medications: meds.map(toBody),
      });
      haptic.success();
      nav.changed();
      nav.toast(t('app.new.saved'));
      nav.openPrescription(res.id);
    } catch (err) {
      fail(err instanceof ApiRequestError ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div className="page-title">{t('app.new.title')}</div>
        <div className="page-sub">{t('app.new.sub')}</div>
      </div>

      <div className="sec-title">{t('app.new.section')}</div>
      <div className="card form">
        <div className="field">
          <label className="label" htmlFor="rx-title">{t('app.new.name')}</label>
          <input
            id="rx-title"
            className="input"
            placeholder={t('app.new.namePh')}
            maxLength={LIMITS.nameLength}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="field">
          <span className="label">{t('app.new.duration')}</span>
          <div className="chips">
            {COURSE_DAY_PRESETS.map((d) => (
              <button key={d} type="button" className={`chip ${days === d ? 'on' : ''}`} onClick={() => setDays(d)}>
                {t('common.days', { n: d })}
              </button>
            ))}
          </div>
          <div className="stepper">
            <button type="button" onClick={() => setDays((d) => Math.max(1, d - 1))} aria-label={t('app.new.dec')}>
              −
            </button>
            <div className="stepper-v">{t('common.days', { n: days })}</div>
            <button type="button" onClick={() => setDays((d) => Math.min(LIMITS.maxCourseDays, d + 1))} aria-label={t('app.new.inc')}>
              +
            </button>
          </div>
        </div>
        <div className="field">
          <span className="label">{t('app.new.start')}</span>
          <div className="segmented">
            <button type="button" className={`stab ${startOffset === 0 ? 'on' : ''}`} onClick={() => setStartOffset(0)}>
              {t('app.new.today')}
            </button>
            <button type="button" className={`stab ${startOffset === 1 ? 'on' : ''}`} onClick={() => setStartOffset(1)}>
              {t('app.new.tomorrow')}
            </button>
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="rx-doctor">{t('app.new.doctor')}</label>
          <input
            id="rx-doctor"
            className="input"
            placeholder={t('app.new.doctorPh')}
            maxLength={LIMITS.nameLength}
            value={doctor}
            onChange={(e) => setDoctor(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="rx-notes">{t('app.new.notes')}</label>
          <textarea
            id="rx-notes"
            className="input"
            placeholder={t('app.new.notesPh')}
            maxLength={LIMITS.notesLength}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      {meds.map((m, i) => (
        <div key={m.key}>
          <div className="med-card-head">
            <span className="med-card-title">{t('app.new.medN', { n: i + 1 })}</span>
            {meds.length > 1 && (
              <button type="button" className="link-btn danger" onClick={() => removeMed(m)}>
                {t('app.new.remove')}
              </button>
            )}
          </div>
          <div className="card form">
            <div className="field">
              <input
                className="input"
                placeholder={t('app.new.medPh')}
                maxLength={LIMITS.nameLength}
                value={m.name}
                onChange={(e) => patchMed(m.key, { name: e.target.value })}
                aria-label={t('app.new.medAria')}
              />
            </div>
            <div className="field">
              <span className="label">{t('app.new.dosage')}</span>
              <div className="chips">
                {DOSAGE_PRESET_KEYS.map((k) => {
                  const d = t(k);
                  return (
                    <button
                      key={k}
                      type="button"
                      className={`chip ${m.dosage === d ? 'on' : ''}`}
                      onClick={() => patchMed(m.key, { dosage: m.dosage === d ? '' : d })}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <input
                className="input"
                placeholder={t('app.new.dosagePh')}
                maxLength={40}
                value={m.dosage}
                onChange={(e) => patchMed(m.key, { dosage: e.target.value })}
                aria-label={t('app.new.dosageAria')}
              />
            </div>

            <div className="field">
              <span className="label">{t('app.new.mode')}</span>
              <div className="segmented">
                {(
                  [
                    ['times', 'app.new.modeTimes'],
                    ['interval', 'app.new.modeInterval'],
                    ['prn', 'app.new.modePrn'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={`stab ${m.mode === mode ? 'on' : ''}`}
                    onClick={() =>
                      patchMed(m.key, {
                        mode,
                        ...(mode === 'interval' ? { times: intervalTimes(m.intervalHours, m.firstDose) } : {}),
                        ...(mode === 'times' ? { times: suggestedTimes(Math.max(1, Math.min(6, m.times.length || 2))) } : {}),
                      })
                    }
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
            </div>

            {m.mode === 'times' && (
              <div className="field">
                <span className="label">{t('app.new.perDay')}</span>
                <div className="segmented">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`stab ${m.times.length === n ? 'on' : ''}`}
                      onClick={() => patchMed(m.key, { times: suggestedTimes(n) })}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {m.mode === 'interval' && (
              <div className="field">
                <span className="label">{t('app.new.interval')}</span>
                <div className="chips">
                  {INTERVAL_HOURS.map((h) => (
                    <button
                      key={h}
                      type="button"
                      className={`chip ${m.intervalHours === h ? 'on' : ''}`}
                      onClick={() => patchMed(m.key, { intervalHours: h, times: intervalTimes(h, m.firstDose) })}
                    >
                      {t('common.hours', { n: h })}
                    </button>
                  ))}
                </div>
                <div className="toggle-row">
                  <span className="label">{t('app.new.firstDose')}</span>
                  <input
                    className="input time"
                    type="time"
                    value={m.firstDose}
                    onChange={(e) =>
                      patchMed(m.key, { firstDose: e.target.value, times: intervalTimes(m.intervalHours, e.target.value) })
                    }
                    aria-label={t('app.new.firstDose')}
                  />
                </div>
              </div>
            )}

            {m.mode === 'prn' ? (
              <div className="field">
                <span className="label">{t('app.new.maxPerDay')}</span>
                <div className="chips">
                  <button
                    type="button"
                    className={`chip ${m.maxPerDay === null ? 'on' : ''}`}
                    onClick={() => patchMed(m.key, { maxPerDay: null })}
                  >
                    {t('app.new.noLimit')}
                  </button>
                  {MAX_PER_DAY_OPTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`chip ${m.maxPerDay === n ? 'on' : ''}`}
                      onClick={() => patchMed(m.key, { maxPerDay: n })}
                    >
                      {t('common.times', { n })}
                    </button>
                  ))}
                </div>
                <span className="label">{t('app.new.prnNote')}</span>
              </div>
            ) : (
              <div className="field">
                <span className="label">{t('app.new.times')}</span>
                <TimesEditor times={m.times} presets={false} onChange={(times) => patchMed(m.key, { times })} />
              </div>
            )}

            {m.mode !== 'prn' && days > 2 && (
              <div className="field">
                <span className="label">{t('app.new.freq')}</span>
                <div className="chips">
                  {(
                    [
                      [1, 'app.new.freqDaily'],
                      [2, 'app.new.freqOther'],
                      [3, 'app.new.freq3'],
                      ['week', 'app.new.freqWeek'],
                    ] as const
                  ).map(([freq, label]) => (
                    <button
                      key={String(freq)}
                      type="button"
                      className={`chip ${m.freq === freq ? 'on' : ''}`}
                      onClick={() => patchMed(m.key, { freq })}
                    >
                      {t(label)}
                    </button>
                  ))}
                </div>
                {m.freq === 'week' && (
                  <div className="chips">
                    {WEEK_ORDER.map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`chip day ${m.weekdays.includes(d) ? 'on' : ''}`}
                        onClick={() =>
                          patchMed(m.key, {
                            weekdays: m.weekdays.includes(d) ? m.weekdays.filter((x) => x !== d) : [...m.weekdays, d],
                          })
                        }
                      >
                        {weekdayShort(d, lang)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="field">
              <span className="label">{t('app.new.meal')}</span>
              <div className="chips">
                {MEALS.map((meal) => (
                  <button
                    key={meal}
                    type="button"
                    className={`chip ${m.meal === meal ? 'on' : ''}`}
                    onClick={() => patchMed(m.key, { meal })}
                  >
                    {t(MEAL_KEY[meal])}
                  </button>
                ))}
              </div>
            </div>
            {days > 1 && (
              <div className="field">
                <div className="toggle-row">
                  <span>{t('app.new.whole', { days: t('common.days', { n: days }) })}</span>
                  <Switch on={m.wholeCourse} onChange={(v) => patchMed(m.key, { wholeCourse: v, days: Math.min(m.days, days) })} />
                </div>
                {!m.wholeCourse && (
                  <div className="stepper">
                    <button type="button" onClick={() => patchMed(m.key, { days: Math.max(1, m.days - 1) })}>
                      −
                    </button>
                    <div className="stepper-v">{t('common.days', { n: Math.min(m.days, days) })}</div>
                    <button type="button" onClick={() => patchMed(m.key, { days: Math.min(days, m.days + 1) })}>
                      +
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="field">
              <label className="label" htmlFor={`stock-${m.key}`}>{t('app.new.stock')}</label>
              <input
                id={`stock-${m.key}`}
                className="input"
                inputMode="decimal"
                placeholder={t('app.new.stockPh')}
                value={m.stock}
                onChange={(e) => patchMed(m.key, { stock: e.target.value.replace(/[^\d.,]/g, '') })}
              />
              <span className="label">{t('app.new.stockHint')}</span>
            </div>
          </div>
        </div>
      ))}

      {meds.length < LIMITS.medicationsPerPrescription && (
        <div style={{ padding: '12px 16px 0' }}>
          <button type="button" className="btn quiet" onClick={() => setMeds((list) => [...list, emptyMed()])}>
            <Icon.plus /> {t('app.new.addMed')}
          </button>
        </div>
      )}

      {error && (
        <div className="err" ref={errorRef} role="alert">
          {error}
        </div>
      )}
      <div className="disclaimer">{t('app.new.disclaimer')}</div>

      <div className="bottom-bar">
        <button type="button" className="btn" disabled={busy} onClick={submit}>
          {busy ? t('app.new.saving') : t('app.new.submit')}
        </button>
      </div>
    </>
  );
}
