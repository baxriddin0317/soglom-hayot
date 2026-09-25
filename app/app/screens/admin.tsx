'use client';

import { useEffect, useState } from 'react';
import { isLang, LANG_LABELS, type T } from '@/lib/i18n';
import type { AdminOverview, AdminUserRow, MeView } from '@/lib/webapp/types';
import { formatDate, formatShort } from '@/lib/time';
import { ApiRequestError, api, useApi } from '../api';
import { useApp, useNav, useT } from '../store';
import { haptic } from '../telegram';
import { ErrorState, Loading, pctClass } from '../ui';

function ago(ms: number, t: T): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return t('common.minutes', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t('common.hours', { n: hours });
  return t('common.days', { n: Math.round(hours / 24) });
}

const since = (iso: string, t: T) => t('app.admin.lastRun', { ago: ago(Date.now() - new Date(iso).getTime(), t) });

export function AdminScreen() {
  const t = useT();
  const nav = useNav();
  const setMe = useApp((s) => s.setMe);
  const { data, error, reload } = useApi<AdminOverview>('admin?view=overview', { pollMs: 60_000 });
  const [busy, setBusy] = useState(false);

  const toUserMode = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const me = await api<MeView>('admin', { adminMode: false });
      haptic.success();
      setMe(me);
      nav.toast(t('app.admin.userModeToast'));
      nav.goTab('today');
    } catch (err) {
      haptic.error();
      nav.toast(err instanceof ApiRequestError ? err.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const head = (
    <div className="page-head">
      <div className="page-title">{t('app.admin.title')}</div>
      <div className="page-sub">{t('app.admin.sub')}</div>
      <button type="button" className="btn quiet small" style={{ marginTop: 10 }} disabled={busy} onClick={toUserMode}>
        👤 {t('app.admin.toUser')}
      </button>
    </div>
  );

  if (!data) return error ? <ErrorState message={error.message} onRetry={reload} /> : <>{head}<Loading /></>;

  const u = data.users;
  const pct = (p: number | null) => (p === null ? '—' : `${p}%`);
  const kpis: [string | number, string, string?][] = [
    [u.total, t('app.admin.users')],
    [u.activeToday, t('app.admin.activeToday')],
    [u.active7, t('app.admin.active7')],
    [u.new7, t('app.admin.new7')],
    [u.withActiveRx, t('app.admin.withRx')],
    [data.activePrescriptions, t('app.admin.activeRx')],
    [data.remindersToday, t('app.admin.remindersToday')],
    [pct(data.adherence7), t('app.admin.adherence7'), pctClass(data.adherence7)],
    [pct(data.retentionD7), t('app.admin.retention')],
    [u.blocked, t('app.admin.blocked'), u.blocked ? 'pct-bad' : ''],
  ];
  const maxNew = Math.max(1, ...data.newByDay.map((d) => d.count));
  const cron = data.cron;

  return (
    <>
      {head}

      <div className="kpis">
        {kpis.map(([value, label, cls]) => (
          <div className="kpi" key={label}>
            <div className={`kpi-v ${cls ?? ''}`}>{value}</div>
            <div className="kpi-k">{label}</div>
          </div>
        ))}
      </div>

      <div className="sec-title">{t('app.admin.system')}</div>
      <div className="card">
        <div className="row">
          <div>
            <div className="row-k">{t('app.admin.cron')}</div>
            <div className="row-sub">{cron.lastRunAt ? since(cron.lastRunAt, t) : '—'}</div>
          </div>
          <span className={`status-chip ${!cron.lastRunAt || cron.stale ? 'MISSED' : 'TAKEN'}`}>
            {!cron.lastRunAt ? t('app.admin.cronNever') : cron.stale ? t('app.admin.cronStale') : t('app.admin.cronOk')}
          </span>
        </div>
        {cron.lastError && cron.lastErrorAt && (
          <div className="row">
            <div style={{ minWidth: 0 }}>
              <div className="row-k">{t('app.admin.lastError')}</div>
              <div className="row-sub mono">{cron.lastError}</div>
            </div>
            <span className="row-v">{since(cron.lastErrorAt, t)}</span>
          </div>
        )}
        {data.webhook && (
          <div className="row">
            <div style={{ minWidth: 0 }}>
              <div className="row-k">{t('app.admin.webhook')}</div>
              {data.webhook.lastError && <div className="row-sub mono">{data.webhook.lastError}</div>}
            </div>
            <span className={`status-chip ${data.webhook.pending > 20 || data.webhook.lastError ? 'SKIPPED' : 'TAKEN'}`}>
              {t('app.admin.pending', { n: data.webhook.pending })}
            </span>
          </div>
        )}
      </div>

      <div className="sec-title">{t('app.admin.newChart')}</div>
      <div className="card chart">
        <div className="plot" style={{ height: 100 }}>
          {data.newByDay.map((d) => (
            <div key={d.date} className={`col ${d.date === data.today ? 'today' : ''}`} title={`${formatShort(d.date)}: ${d.count}`}>
              <div className="col-stack" style={{ height: `${Math.max(3, (d.count / maxNew) * 100)}%` }}>
                {d.count > 0 && <div className="c-ok" style={{ height: '100%' }} />}
              </div>
            </div>
          ))}
        </div>
        <div className="xaxis">
          {data.newByDay.map((d, i) => (
            <div key={d.date} className="xlab">
              {i % 3 === 0 || i === data.newByDay.length - 1 ? formatShort(d.date) : ''}
            </div>
          ))}
        </div>
      </div>

      <div className="sec-title">{t('app.admin.langs')}</div>
      <div className="card">
        {data.languages.map((l) => (
          <div className="row" key={l.language ?? 'auto'}>
            <span className="row-k">{isLang(l.language) ? LANG_LABELS[l.language] : '🌐 auto'}</span>
            <span className="row-v">{l.count}</span>
          </div>
        ))}
      </div>

      <UsersList />
    </>
  );
}

function UsersList() {
  const t = useT();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    const path = `admin?view=users&q=${encodeURIComponent(debounced)}&page=${page}`;
    api<{ users: AdminUserRow[]; hasMore: boolean }>(path)
      .then((res) => {
        if (cancelled) return;
        setRows((prev) => (page === 0 ? res.users : [...prev, ...res.users]));
        setHasMore(res.hasMore);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, page]);

  return (
    <>
      <div className="sec-title">{t('app.admin.usersList')}</div>
      <div className="card">
        <div className="field">
          <input
            className="input"
            type="search"
            placeholder={t('app.admin.search')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
              setLoading(true);
            }}
          />
        </div>
        {rows.length === 0 && !loading && <div className="sec-note" style={{ padding: '4px 16px 14px' }}>{t('app.admin.noUsers')}</div>}
        {rows.map((r) => (
          <div className="urow" key={r.id}>
            <div className="urow-main">
              <div className="row-k">
                {r.name} {r.username && <span className="row-sub">@{r.username}</span>}
              </div>
              <div className="row-sub">
                {[
                  t('app.admin.lastSeen', { when: formatDate(r.lastActiveAt.slice(0, 10)) }),
                  t('app.admin.joined', { date: formatDate(r.createdAt.slice(0, 10)) }),
                  r.activePrescriptions ? t('app.admin.rxCount', { n: r.activePrescriptions }) : null,
                  isLang(r.language) ? LANG_LABELS[r.language] : null,
                  `ID ${r.telegramId}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            {r.blocked && <span className="status-chip MISSED">{t('app.admin.blockedBadge')}</span>}
          </div>
        ))}
        {loading && <div className="sec-note" style={{ padding: '8px 16px 14px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>}
        {hasMore && !loading && (
          <div style={{ padding: '6px 16px 14px' }}>
            <button
              type="button"
              className="btn quiet small"
              onClick={() => {
                setLoading(true);
                setPage((p) => p + 1);
              }}
            >
              {t('app.admin.more')}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
