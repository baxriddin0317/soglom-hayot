'use client';

import { useState } from 'react';
import { MAX_TIMES_PER_DAY, suggestedTimes } from '@/lib/time';
import { useT } from '../store';
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
  const t = useT();
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
        {times.length === 0 && <span className="label">{t('app.times.none')}</span>}
        {times.map((tm) => (
          <button
            key={tm}
            type="button"
            className="chip on"
            aria-label={t('app.times.remove', { t: tm })}
            onClick={() => onChange(times.filter((x) => x !== tm))}
          >
            {tm} <span className="x">×</span>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          className="input time"
          type="time"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={t('app.times.new')}
        />
        <button type="button" className="btn quiet small" disabled={full || times.includes(draft)} onClick={add}>
          {t('app.times.add')}
        </button>
      </div>
      {presets && (
      <div className="chips">
        {[1, 2, 3, 4].map((n) => (
          <button key={n} type="button" className="chip add" onClick={() => onChange(suggestedTimes(n))}>
            {t('app.times.preset', { n, list: suggestedTimes(n).join(', ') })}
          </button>
        ))}
      </div>
      )}
    </div>
  );
}
