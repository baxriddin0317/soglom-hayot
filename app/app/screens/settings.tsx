'use client';

import { useState } from 'react';
import { FOLLOW_UP_OPTIONS, LEAD_OPTIONS, TIMEZONE_OPTIONS } from '@/lib/constants';
import { LANG_LABELS, LANGS } from '@/lib/i18n';
import type { MeView, SettingsView } from '@/lib/webapp/types';
import { formatDate } from '@/lib/time';
import { ApiRequestError, api, useApi } from '../api';
import { useApp, useNav, useT } from '../store';
import { haptic } from '../telegram';
import { ErrorState, Loading, Switch } from '../ui';

export function SettingsScreen() {
  const t = useT();
  const nav = useNav();
  const { setLang, setMe } = useApp();
  const { data, error, reload } = useApi<SettingsView>('settings');
  const [saving, setSaving] = useState(false);
  const [local, setLocal] = useState<SettingsView | null>(null);
  const s = local ?? data;

  if (!s) return error ? <ErrorState message={error.message} onRetry={reload} /> : <Loading />;

  const fail = (err: unknown) => {
    haptic.error();
    nav.toast(err instanceof ApiRequestError ? err.message : t('app.set.saveFailed'));
  };

  const save = async (patch: Partial<SettingsView>) => {
    if (saving) return;
    const previous = s;
    setLocal({ ...s, ...patch });
    if (patch.language) setLang(patch.language);
    setSaving(true);
    try {
      const updated = await api<SettingsView>('settings', patch);
      setLocal(updated);
      setLang(updated.language);
      haptic.select();
      nav.changed();
    } catch (err) {
      setLocal(previous);
      setLang(previous.language);
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  // Admin <-> foydalanuvchi rejimi: bitta tugma. Bot menyusi ham shunga moslanadi.
  const toggleAdmin = async (on: boolean) => {
    if (saving) return;
    setSaving(true);
    try {
      const me = await api<MeView>('admin', { adminMode: on });
      setMe(me);
      setLocal({ ...s, adminMode: me.adminMode });
      haptic.success();
      nav.toast(t(on ? 'app.admin.adminModeToast' : 'app.admin.userModeToast'));
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  const tzKnown = TIMEZONE_OPTIONS.some((o) => o.tz === s.timezone);
  const leadLabel = (n: number) => (n === 0 ? t('app.set.onTime') : t('app.set.min', { n }));
  const followLabel = (n: number) => (n === 0 ? t('app.set.off') : t('app.set.min', { n }));

  return (
    <>
      <div className="p-head">
        <div className="p-av">{s.initials}</div>
        <div>
          <div className="p-nm">{s.name}</div>
          {s.username && <div className="un">@{s.username}</div>}
          <div className="un" style={{ fontSize: 13 }}>
            {t('app.set.since', { date: formatDate(s.since) })}
          </div>
        </div>
      </div>

      <div className="sec-title">{t('app.set.reminders')}</div>
      <div className="card">
        <div className="row">
          <div>
            <div className="row-k">{t('app.set.reminders')}</div>
            <div className="row-sub">{t('app.set.remindersSub')}</div>
          </div>
          <Switch on={s.remindersEnabled} disabled={saving} onChange={(v) => save({ remindersEnabled: v })} />
        </div>
        <div className="field" style={{ borderTop: '1px solid var(--sep)' }}>
          <span className="row-k">{t('app.set.lead')}</span>
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
          <span className="row-k">{t('app.set.followUp')}</span>
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
      <div className="sec-note">{t('app.set.missNote')}</div>

      <div className="sec-title">{t('app.set.lang')}</div>
      <div className="card">
        <div className="field">
          <div className="segmented">
            {LANGS.map((l) => (
              <button
                key={l}
                type="button"
                className={`stab ${s.language === l ? 'on' : ''}`}
                disabled={saving}
                onClick={() => save({ language: l })}
              >
                {LANG_LABELS[l]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="sec-title">{t('app.set.time')}</div>
      <div className="card">
        <label className="row">
          <div>
            <div className="row-k">{t('app.set.tz')}</div>
            <div className="row-sub">{t('app.set.now', { time: s.nowTime })}</div>
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
                {t(o.key)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {s.isAdmin && (
        <>
          <div className="sec-title">{t('app.admin.title')}</div>
          <div className="card">
            <div className="row">
              <div>
                <div className="row-k">{t('app.admin.mode')}</div>
                <div className="row-sub">{t('app.admin.modeSub')}</div>
              </div>
              <Switch on={s.adminMode} disabled={saving} onChange={toggleAdmin} />
            </div>
          </div>
        </>
      )}

      <div className="sec-title">{t('app.set.about')}</div>
      <div className="card pad" style={{ fontSize: 14.5, lineHeight: 1.45 }}>
        {t('app.set.aboutText')}
      </div>
      <div className="disclaimer">{t('app.set.disclaimer')}</div>
    </>
  );
}
