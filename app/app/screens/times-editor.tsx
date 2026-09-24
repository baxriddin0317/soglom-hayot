'use client';

import { useState } from 'react';
import { MAX_TIMES_PER_DAY, suggestedTimes } from '@/lib/time';
import { haptic } from '../telegram';

// Qabul vaqtlari: tanlangan vaqtlar (bosib o'chiriladi), yangi vaqt qo'shish va tez tanlovlar.
export function TimesEditor({
  times,
  onChange,
  presets = true,
}: {
  times: string[];
  onChange: (times: string[]) => void;
  presets?: boolean;
}) {
  const [draft, setDraft] = useState('12:00');
  const full = times.length >= MAX_TIMES_PER_DAY;

  const add = () => {
    if (!/^\d{2}:\d{2}$/.test(draft) || times.includes(draft) || full) return;
    haptic.select();
    onChange([...times, draft].sort());
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="chips">
        {times.length === 0 && <span className="label">Vaqt tanlanmagan</span>}
        {times.map((t) => (
          <button
            key={t}
            type="button"
            className="chip on"
            aria-label={`${t} ni olib tashlash`}
            onClick={() => onChange(times.filter((x) => x !== t))}
          >
            {t} <span className="x">×</span>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          className="input time"
          type="time"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Yangi vaqt"
        />
        <button type="button" className="btn quiet small" disabled={full || times.includes(draft)} onClick={add}>
          + Qo'shish
        </button>
      </div>
      {presets && (
      <div className="chips">
        {[1, 2, 3, 4].map((n) => (
          <button key={n} type="button" className="chip add" onClick={() => onChange(suggestedTimes(n))}>
            {n} mahal: {suggestedTimes(n).join(', ')}
          </button>
        ))}
      </div>
      )}
    </div>
  );
}
