import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, ImageOff } from 'lucide-react';
import { fetchBlob } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Spinner } from '.';

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; badge?: ReactNode }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto border-b border-surface-line">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cn('flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium', value === t.id ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>
          {t.label}{t.badge}
        </button>
      ))}
    </div>
  );
}

/** Image from a protected endpoint, fetched with the bearer token. */
export function AuthImage({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ['blob', path], queryFn: () => fetchBlob(path), staleTime: 5 * 60_000 });
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!data) return;
    const u = URL.createObjectURL(data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [data]);
  if (isLoading) return <div className={cn('flex items-center justify-center bg-surface-alt', className)}><Spinner className="h-4 w-4" /></div>;
  if (isError || !url) return <div className={cn('flex items-center justify-center bg-surface-alt text-ink-muted', className)}><ImageOff className="h-4 w-4" /></div>;
  return <img src={url} alt={alt} className={cn('object-cover', className)} />;
}

export async function downloadProtected(path: string, fileName: string) {
  const blob = await fetchBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DownloadLink({ path, fileName, children }: { path: string; fileName: string; children?: ReactNode }) {
  const [err, setErr] = useState(false);
  return (
    <button type="button" onClick={() => downloadProtected(path, fileName).catch(() => setErr(true))} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
      <Download className="h-3.5 w-3.5" />{children ?? fileName}{err && <span className="text-red-600"> (failed)</span>}
    </button>
  );
}

export function StatCard({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'warn' }) {
  return (
    <div className="rounded-xl border border-surface-line bg-white p-4 shadow-card">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tracking-tight', tone === 'good' && 'text-accent', tone === 'warn' && 'text-yellow-700')}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  return <div role={tone === 'warn' ? 'alert' : 'note'} className={cn('rounded-lg border px-3 py-2 text-sm', tone === 'warn' ? 'border-yellow-200 bg-sun-soft text-yellow-900' : 'border-blue-100 bg-blue-50 text-blue-900')}>{children}</div>;
}
