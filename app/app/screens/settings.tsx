'use client';

import { useState } from 'react';
import { FOLLOW_UP_OPTIONS, LEAD_OPTIONS, TIMEZONE_OPTIONS } from '@/lib/constants';
import type { SettingsView } from '@/lib/webapp/types';
import { formatDate } from '@/lib/time';
import { ApiRequestError, api, useApi } from '../api';
import type { Nav } from '../mini-app';
import { haptic } from '../telegram';
import { ErrorState, Loading, Switch } from '../ui';

const leadLabel = (n: number) => (n === 0 ? 'Vaqtida' : `${n} daq`);
const followLabel = (n: number) => (n === 0 ? "O'chiq" : `${n} daq`);

export function SettingsScreen({ nav }: { nav: Nav }) {
  const { data, error, reload } = useApi<SettingsView>('settings');
  const [saving, setSaving] = useState(false);
  const [local, setLocal] = useState<SettingsView | null>(null);
  const s = local ?? data;

  if (!s) return error ? <ErrorState message={error.message} onRetry={reload} /> : <Loading />;

  const save = async (patch: Partial<SettingsView>) => {
    if (saving) return;
    const previous = s;
    setLocal({ ...s, ...patch });
    setSaving(true);
    try {
      const updated = await api<SettingsView>('settings', patch);
      setLocal(updated);
      haptic.select();
      nav.changed();
    } catch (err) {
      setLocal(previous);
      haptic.error();
      nav.toast(err instanceof ApiRequestError ? err.message : "Saqlab bo'lmadi. Qayta urinib ko'ring.");
    } finally {
      setSaving(false);
    }
  };

  const tzKnown = TIMEZONE_OPTIONS.some((o) => o.tz === s.timezone);

  return (
    <>
      <div className="p-head">
        <div className="p-av">{s.initials}</div>
        <div>
          <div className="p-nm">{s.name}</div>
          {s.username && <div className="un">@{s.username}</div>}
          <div className="un" style={{ fontSize: 13 }}>
            {formatDate(s.since)} dan beri foydalanuvchi
          </div>
        </div>
      </div>

      <div className="sec-title">Eslatmalar</div>
      <div className="card">
        <div className="row">
          <div>
            <div className="row-k">Eslatmalar</div>
            <div className="row-sub">Dori vaqtida botga xabar keladi</div>
          </div>
          <Switch on={s.remindersEnabled} disabled={saving} onChange={(v) => save({ remindersEnabled: v })} />
        </div>
        <div className="field" style={{ borderTop: '1px solid var(--sep)' }}>
          <span className="row-k">Oldindan eslatish</span>
          <div className="segmented">
            {LEAD_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                className={`stab ${s.leadMinutes === n ? 'on' : ''}`}
                disabled={saving}
                onClick={() => save({ leadMinutes: n })}
              >
                {leadLabel(n)}
              </button>
            ))}
          </div>
        </div>
        <div className="field" style={{ borderTop: '1px solid var(--sep)' }}>
          <span className="row-k">Javob bo'lmasa qayta eslatish</span>
          <div className="segmented">
            {FOLLOW_UP_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                className={`stab ${s.followUpMinutes === n ? 'on' : ''}`}
                disabled={saving}
                onClick={() => save({ followUpMinutes: n })}
              >
                {followLabel(n)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="sec-note">
        Eslatmaga 3 soat ichida javob berilmasa, doza "belgilanmadi" deb hisoblanadi — uni keyin ham "Bugun"
        bo'limidan tuzatish mumkin.
      </div>

      <div className="sec-title">Vaqt</div>
      <div className="card">
        <label className="row">
          <div>
            <div className="row-k">Vaqt zonasi</div>
            <div className="row-sub">Hozir {s.nowTime}</div>
          </div>
          <select
            className="select"
            value={s.timezone}
            disabled={saving}
            onChange={(e) => save({ timezone: e.target.value })}
          >
            {!tzKnown && <option value={s.timezone}>{s.timezone}</option>}
            {TIMEZONE_OPTIONS.map((o) => (
              <option key={o.tz} value={o.tz}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="sec-title">Ilova haqida</div>
      <div className="card pad" style={{ fontSize: 14.5, lineHeight: 1.45 }}>
        <b>Sog'lom Hayot</b> — shifokor yozib bergan retsept bo'yicha dori ichishni eslatib turuvchi yordamchi.
        Retseptni kiriting, bot har bir dori vaqtida eslatadi, siz esa «Ichdim» deb belgilaysiz. Kurs oxirida natijani
        ko'rasiz.
      </div>
      <div className="disclaimer">
        ⚠️ Ilova shifokor o'rnini bosmaydi. Dori, miqdor va muddat bo'yicha faqat shifokoringiz bilan maslahatlashing.
      </div>
    </>
  );
}
