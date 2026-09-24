'use client';

import { useRef, useState } from 'react';
import { COURSE_DAY_PRESETS, DOSAGE_PRESETS, LIMITS, MEAL_LABELS, MEALS, type Meal } from '@/lib/constants';
import { suggestedTimes } from '@/lib/time';
import { ApiRequestError, api } from '../api';
import type { Nav } from '../mini-app';
import { confirmDialog, haptic } from '../telegram';
import { Icon, Switch } from '../ui';
import { TimesEditor } from './times-editor';

interface MedDraft {
  key: number;
  name: string;
  dosage: string;
  meal: Meal;
  times: string[];
  wholeCourse: boolean;
  days: number;
}

let seq = 0;
const emptyMed = (): MedDraft => ({
  key: ++seq,
  name: '',
  dosage: '',
  meal: 'ANY',
  times: suggestedTimes(2),
  wholeCourse: true,
  days: 3,
});

export function NewPrescriptionScreen({ nav }: { nav: Nav }) {
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
    if (m.name && !(await confirmDialog(`${m.name} ni ro'yxatdan olib tashlaysizmi?`))) return;
    setMeds((list) => list.filter((x) => x.key !== m.key));
  };

  const fail = (message: string) => {
    haptic.error();
    setError(message);
    requestAnimationFrame(() => errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  const submit = async () => {
    if (busy) return;
    setError(null);
    const unnamed = meds.findIndex((m) => !m.name.trim());
    if (unnamed >= 0) return fail(`${unnamed + 1}-dori nomini kiriting`);
    const noTimes = meds.find((m) => m.times.length === 0);
    if (noTimes) return fail(`${noTimes.name}: kamida bitta vaqt tanlang`);

    setBusy(true);
    try {
      const res = await api<{ id: string }>('prescriptions', {
        title: title.trim(),
        doctor: doctor.trim() || null,
        notes: notes.trim() || null,
        days,
        startOffset,
        medications: meds.map((m) => ({
          name: m.name.trim(),
          dosage: m.dosage.trim() || null,
          meal: m.meal,
          times: m.times,
          days: m.wholeCourse ? null : Math.min(m.days, days),
        })),
      });
      haptic.success();
      nav.changed();
      nav.toast("✅ Retsept saqlandi. Eslatmalar botga keladi.");
      nav.openPrescription(res.id);
    } catch (err) {
      fail(err instanceof ApiRequestError ? err.message : "Xatolik yuz berdi. Qayta urinib ko'ring.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div className="page-title">Yangi retsept</div>
        <div className="page-sub">Shifokor yozib bergan retsept bo'yicha to'ldiring</div>
      </div>

      <div className="sec-title">Retsept</div>
      <div className="card form">
        <div className="field">
          <label className="label" htmlFor="rx-title">Nomi yoki kasallik</label>
          <input
            id="rx-title"
            className="input"
            placeholder="Masalan: Gripp, Angina"
            maxLength={LIMITS.nameLength}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="field">
          <span className="label">Davolanish muddati</span>
          <div className="chips">
            {COURSE_DAY_PRESETS.map((d) => (
              <button key={d} type="button" className={`chip ${days === d ? 'on' : ''}`} onClick={() => setDays(d)}>
                {d} kun
              </button>
            ))}
          </div>
          <div className="stepper">
            <button type="button" onClick={() => setDays((d) => Math.max(1, d - 1))} aria-label="Kamaytirish">
              −
            </button>
            <div className="stepper-v">{days} kun</div>
            <button type="button" onClick={() => setDays((d) => Math.min(LIMITS.maxCourseDays, d + 1))} aria-label="Ko'paytirish">
              +
            </button>
          </div>
        </div>
        <div className="field">
          <span className="label">Boshlanishi</span>
          <div className="segmented">
            <button type="button" className={`stab ${startOffset === 0 ? 'on' : ''}`} onClick={() => setStartOffset(0)}>
              Bugundan
            </button>
            <button type="button" className={`stab ${startOffset === 1 ? 'on' : ''}`} onClick={() => setStartOffset(1)}>
              Ertadan
            </button>
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="rx-doctor">Shifokor (ixtiyoriy)</label>
          <input
            id="rx-doctor"
            className="input"
            placeholder="Masalan: Dr. Karimova, terapevt"
            maxLength={LIMITS.nameLength}
            value={doctor}
            onChange={(e) => setDoctor(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="rx-notes">Izoh (ixtiyoriy)</label>
          <textarea
            id="rx-notes"
            className="input"
            placeholder="Shifokor tavsiyalari, parhez va h.k."
            maxLength={LIMITS.notesLength}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      {meds.map((m, i) => (
        <div key={m.key}>
          <div className="med-card-head">
            <span className="med-card-title">{i + 1}-dori</span>
            {meds.length > 1 && (
              <button type="button" className="link-btn danger" onClick={() => removeMed(m)}>
                Olib tashlash
              </button>
            )}
          </div>
          <div className="card form">
            <div className="field">
              <input
                className="input"
                placeholder="Dori nomi, masalan: Paracetamol 500 mg"
                maxLength={LIMITS.nameLength}
                value={m.name}
                onChange={(e) => patchMed(m.key, { name: e.target.value })}
                aria-label="Dori nomi"
              />
            </div>
            <div className="field">
              <span className="label">Bir martalik miqdor</span>
              <div className="chips">
                {DOSAGE_PRESETS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`chip ${m.dosage === d ? 'on' : ''}`}
                    onClick={() => patchMed(m.key, { dosage: m.dosage === d ? '' : d })}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <input
                className="input"
                placeholder="Yoki o'zingiz yozing"
                maxLength={40}
                value={m.dosage}
                onChange={(e) => patchMed(m.key, { dosage: e.target.value })}
                aria-label="Miqdor"
              />
            </div>
            <div className="field">
              <span className="label">Kuniga necha marta</span>
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
            <div className="field">
              <span className="label">Qabul vaqtlari</span>
              <TimesEditor times={m.times} presets={false} onChange={(times) => patchMed(m.key, { times })} />
            </div>
            <div className="field">
              <span className="label">Ovqatga nisbatan</span>
              <div className="chips">
                {MEALS.map((meal) => (
                  <button
                    key={meal}
                    type="button"
                    className={`chip ${m.meal === meal ? 'on' : ''}`}
                    onClick={() => patchMed(m.key, { meal })}
                  >
                    {MEAL_LABELS[meal]}
                  </button>
                ))}
              </div>
            </div>
            {days > 1 && (
              <div className="field">
                <div className="toggle-row">
                  <span>Butun kurs davomida ({days} kun)</span>
                  <Switch on={m.wholeCourse} onChange={(v) => patchMed(m.key, { wholeCourse: v, days: Math.min(m.days, days) })} />
                </div>
                {!m.wholeCourse && (
                  <div className="stepper">
                    <button type="button" onClick={() => patchMed(m.key, { days: Math.max(1, m.days - 1) })}>
                      −
                    </button>
                    <div className="stepper-v">{Math.min(m.days, days)} kun</div>
                    <button type="button" onClick={() => patchMed(m.key, { days: Math.min(days, m.days + 1) })}>
                      +
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ))}

      {meds.length < LIMITS.medicationsPerPrescription && (
        <div style={{ padding: '12px 16px 0' }}>
          <button type="button" className="btn quiet" onClick={() => setMeds((list) => [...list, emptyMed()])}>
            <Icon.plus /> Yana dori qo'shish
          </button>
        </div>
      )}

      {error && (
        <div className="err" ref={errorRef} role="alert">
          {error}
        </div>
      )}
      <div className="disclaimer">
        Dori, miqdor va muddatni faqat shifokor belgilaydi. Ilova faqat eslatib turadi.
      </div>

      <div className="bottom-bar">
        <button type="button" className="btn" disabled={busy} onClick={submit}>
          {busy ? 'Saqlanmoqda…' : 'Retseptni saqlash'}
        </button>
      </div>
    </>
  );
}
