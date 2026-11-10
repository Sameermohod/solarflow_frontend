import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

const base = 'h-8 w-full rounded-md border border-surface-line bg-white px-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:bg-surface-alt';

/**
 * Numeric input that keeps its own text while typing and commits a parsed value on change when valid.
 * Accepts a display unit conversion so users can type feet while the model stays in metres.
 */
export function NumField({ label, value, onChange, step = 0.1, min, max, suffix, decimals = 2, disabled, toDisplay = (v: number) => v, fromDisplay = (v: number) => v, id }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string; decimals?: number; disabled?: boolean;
  toDisplay?: (v: number) => number; fromDisplay?: (v: number) => number; id?: string;
}) {
  const shown = Number(toDisplay(value).toFixed(decimals));
  const [text, setText] = useState(String(shown));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(String(shown)); }, [shown, focused]);
  const inputId = id ?? `nf-${label.replace(/\W+/g, '-').toLowerCase()}`;
  const commit = (t: string) => {
    const n = Number(t);
    if (t.trim() === '' || Number.isNaN(n)) return;
    let m = fromDisplay(n);
    if (min !== undefined) m = Math.max(min, m);
    if (max !== undefined) m = Math.min(max, m);
    onChange(m);
  };
  return (
    <label htmlFor={inputId} className="block text-xs text-ink-muted">
      {label}{suffix ? ` (${suffix})` : ''}
      <input id={inputId} type="number" inputMode="decimal" step={step} disabled={disabled} className={cn(base, 'mt-1')} value={focused ? text : String(shown)}
        onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setText(String(shown)); }}
        onChange={(e) => { setText(e.target.value); commit(e.target.value); }} />
    </label>
  );
}

export function TextField({ label, value, onChange, disabled, maxLength = 60 }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean; maxLength?: number }) {
  const id = `tf-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return <label htmlFor={id} className="block text-xs text-ink-muted">{label}<input id={id} className={cn(base, 'mt-1')} value={value} maxLength={maxLength} disabled={disabled} onChange={(e) => onChange(e.target.value)} /></label>;
}

export function SelectField<T extends string>({ label, value, onChange, options, disabled }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; disabled?: boolean }) {
  const id = `sf-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <label htmlFor={id} className="block text-xs text-ink-muted">{label}
      <select id={id} className={cn(base, 'mt-1')} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </label>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="flex items-center justify-between gap-2 text-xs text-ink-muted">{label}<input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="h-7 w-12 cursor-pointer rounded border border-surface-line" /></label>;
}

export function PanelSection({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-b border-surface-line px-3 py-3">
      <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h3>{action}</div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'red' | 'green' | 'yellow' }) {
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', tone === 'red' && 'bg-red-50 text-red-700', tone === 'green' && 'bg-green-50 text-green-700', tone === 'yellow' && 'bg-sun-soft text-yellow-800', tone === 'neutral' && 'bg-surface-alt text-ink-muted')}>{children}</span>;
}
