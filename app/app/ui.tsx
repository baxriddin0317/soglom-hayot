'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { MEAL_SHORT_KEY, type Meal, type StockUnit } from '@/lib/constants';
import type { Key, T } from '@/lib/i18n';
import { formatQty } from '@/lib/time';
import type { DoseStatus } from '@/lib/webapp/types';
import { useT } from './store';

// ---------------------------------------------------------------------------
// Matn yordamchilari
// ---------------------------------------------------------------------------

export function statusLabel(status: DoseStatus, t: T): string {
  return t(`statusLabel.${status}` as Key);
}

export function medMeta(m: { dosage: string | null; meal: Meal }, t: T): string {
  const meal = MEAL_SHORT_KEY[m.meal];
  return [m.dosage, meal ? t(meal) : null].filter(Boolean).join(' · ');
}

/** "20 tabletka" / "2,5 мл" (t — joriy tildagi tarjima). */
export function qtyText(qty: number, unit: StockUnit, t: T): string {
  return t(`unit.${unit}` as Key, { n: formatQty(qty) });
}

/** "2 soat 15 daqiqadan so'ng" / "45 daqiqadan so'ng" / "hozir" */
export function untilText(iso: string, now: number, t: T): string {
  const minutes = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (minutes <= 0) return t('app.until.now');
  if (minutes < 60) return t('app.until.min', { n: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h >= 24) return t('app.until.day', { n: Math.floor(h / 24) });
  return m ? t('app.until.hourMin', { h, m }) : t('app.until.hour', { h });
}

export function pctClass(p: number | null): string {
  if (p === null) return '';
  return p >= 85 ? 'pct-ok' : p >= 60 ? 'pct-warn' : 'pct-bad';
}

// Har `intervalMs` da yangilanadigan joriy vaqt (qolgan vaqt hisoblagichlari uchun).
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

// ---------------------------------------------------------------------------
// Komponentlar
// ---------------------------------------------------------------------------

export function Loading() {
  return (
    <div className="center-state">
      <div className="spinner" />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="center-state">
      <b>{t('app.loadFailed')}</b>
      <div>{message}</div>
      {onRetry && (
        <button type="button" className="btn quiet" style={{ maxWidth: 240, marginTop: 8 }} onClick={onRetry}>
          {t('app.retry')}
        </button>
      )}
    </div>
  );
}

export function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="grab" />
        {children}
      </div>
    </>
  );
}

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 2600);
    return () => clearTimeout(timer);
  }, [text, onDone]);
  return (
    <div className="toast" role="status">
      {text}
    </div>
  );
}

export function Switch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`switch ${on ? 'on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
    />
  );
}

export function ProgressBar({ value, ok }: { value: number; ok?: boolean }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={`bar ${ok ? 'ok' : ''}`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Kunlik halqa: ichilgan / o'tkazilgan / belgilanmagan ulushlari. */
export function DayRing({ taken, skipped, missed, total }: { taken: number; skipped: number; missed: number; total: number }) {
  const t = useT();
  const r = 36;
  const c = 2 * Math.PI * r;
  const parts = [
    { value: taken, color: 'var(--ok)' },
    { value: skipped, color: 'var(--warn)' },
    { value: missed, color: 'var(--bad)' },
  ];
  let offset = 0;
  return (
    <div className="ring">
      <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
        <circle cx="42" cy="42" r={r} fill="none" stroke="var(--seg-bg)" strokeWidth="8" />
        {total > 0 &&
          parts.map((p, i) => {
            const len = (p.value / total) * c;
            const el = (
              <circle
                key={i}
                cx="42"
                cy="42"
                r={r}
                fill="none"
                stroke={p.color}
                strokeWidth="8"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 42 42)"
              />
            );
            offset += len;
            return p.value > 0 ? el : null;
          })}
      </svg>
      <div className="ring-label">
        <div className="ring-num">
          {taken}/{total}
        </div>
        <div className="ring-unit">{t('app.ring.taken')}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ikonlar
// ---------------------------------------------------------------------------

type IconProps = { size?: number };
const stroke = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const Icon = {
  check: ({ size = 20 }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 20 20" {...stroke} strokeWidth="2.2" aria-hidden="true">
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  ),
  skip: ({ size = 18 }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 20 20" {...stroke} strokeWidth="2" aria-hidden="true">
      <path d="M5 5l6 5-6 5z" />
      <path d="M15 5v10" />
    </svg>
  ),
  cross: ({ size = 18 }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 20 20" {...stroke} strokeWidth="2" aria-hidden="true">
      <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
    </svg>
  ),
  pill: ({ size = 20 }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} strokeWidth="1.8" aria-hidden="true">
      <g transform="rotate(-45 12 12)">
        <rect x="3" y="8" width="18" height="8" rx="4" />
        <path d="M12 8v8" />
        <path d="M12 8h5a4 4 0 010 8h-5z" fill="currentColor" fillOpacity="0.35" stroke="none" />
      </g>
    </svg>
  ),
  clock: ({ size = 20 }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  ),
  left: ({ size = 20 }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 20 20" {...stroke} strokeWidth="2" aria-hidden="true">
      <path d="M12.5 4.5L7 10l5.5 5.5" />
    </svg>
  ),
  right: ({ size = 20 }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 20 20" {...stroke} strokeWidth="2" aria-hidden="true">
      <path d="M7.5 4.5L13 10l-5.5 5.5" />
    </svg>
  ),
  chevron: () => (
    <svg width="8" height="13" viewBox="0 0 8 13" {...stroke} strokeWidth="2" aria-hidden="true">
      <path d="M1.5 1.5l5 5-5 5" />
    </svg>
  ),
  plus: ({ size = 20 }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 20 20" {...stroke} strokeWidth="2.2" aria-hidden="true">
      <path d="M10 4v12M4 10h12" />
    </svg>
  ),
  bell: ({ size = 20 }: IconProps) => (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} strokeWidth="1.8" aria-hidden="true">
      <path d="M6 16.5V11a6 6 0 0112 0v5.5l1.5 1.5h-15z" />
      <path d="M10 20a2 2 0 004 0" />
    </svg>
  ),
  tabToday: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" {...stroke} strokeWidth="1.8" aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" rx="2.5" />
      <path d="M4 10h16M8.5 3v4M15.5 3v4" />
      <path d="M9 14.5l2 2 4-4" />
    </svg>
  ),
  tabRx: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" {...stroke} strokeWidth="1.8" aria-hidden="true">
      <path d="M7 3.5h7.5L19 8v11a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 016 19V5a1.5 1.5 0 011-1.5z" />
      <path d="M14 3.5V8h5M9.5 12.5h5M9.5 16h5" />
    </svg>
  ),
  tabStats: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" {...stroke} strokeWidth="1.8" aria-hidden="true">
      <path d="M5 19V11" />
      <path d="M12 19V5" />
      <path d="M19 19v-5" />
    </svg>
  ),
  tabStock: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" {...stroke} strokeWidth="1.8" aria-hidden="true">
      <path d="M4 8l8-4 8 4v8l-8 4-8-4z" />
      <path d="M4 8l8 4 8-4M12 12v8" />
    </svg>
  ),
  tabAdmin: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" {...stroke} strokeWidth="1.8" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  tabSettings: () => (
    <svg width="24" height="24" viewBox="0 0 24 24" {...stroke} strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0114 0" />
    </svg>
  ),
};
