import { useEffect, useState } from 'react';
import { Select } from '@/components/ui';
import { fetchBlob } from '@/lib/api';
import { useDirectory } from '@/lib/hooks';

/** Count bubble for a tab; nothing when the count is 0. */
export const countBadge = (n: number) => (n > 0 ? <span className="rounded-full bg-surface-alt px-1.5 py-0.5 text-xs font-medium text-ink-muted">{n}</span> : undefined);
export const dateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
/** Date-only values are UTC midnight; show them without timezone shifts. */
export const showDate = (iso: string | null | undefined, locale: string) => (iso ? new Date(iso).toLocaleDateString(locale, { dateStyle: 'medium', timeZone: 'UTC' }) : '—');
export const todayYmd = () => new Date().toISOString().slice(0, 10);

type Tone = 'neutral' | 'green' | 'yellow' | 'red' | 'blue';
export const PROJECT_TONE: Record<string, Tone> = { PLANNING: 'blue', IN_PROGRESS: 'yellow', ON_HOLD: 'neutral', COMPLETED: 'green', CANCELLED: 'red' };
export const TASK_TONE: Record<string, Tone> = { TODO: 'neutral', IN_PROGRESS: 'blue', BLOCKED: 'red', DONE: 'green' };
export const PRIORITY_TONE: Record<string, Tone> = { LOW: 'neutral', MEDIUM: 'blue', HIGH: 'yellow', URGENT: 'red', CRITICAL: 'red' };
export const TICKET_TONE: Record<string, Tone> = { OPEN: 'yellow', IN_PROGRESS: 'blue', RESOLVED: 'green', CLOSED: 'neutral' };
export const DOC_TONE: Record<string, Tone> = { DRAFT: 'neutral', PENDING_APPROVAL: 'yellow', APPROVED: 'green', REJECTED: 'red' };
export const WARRANTY_TONE: Record<string, Tone> = { ACTIVE: 'green', EXPIRING: 'yellow', EXPIRED: 'red' };

/** Team members for assignee pickers; falls back to an empty list when the user cannot see the directory. */
export function useNames() {
  const d = useDirectory();
  const map = new Map((d.data ?? []).map((u) => [u.id, u.name]));
  return { users: d.data ?? [], name: (id: string | null | undefined) => (id ? map.get(id) ?? 'Unknown user' : '—') };
}

export function UserSelect({ value, onChange, label = 'Unassigned', ...p }: { value: string; onChange: (v: string) => void; label?: string; 'aria-label'?: string; className?: string }) {
  const { users } = useNames();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label={p['aria-label']} className={p.className}>
      <option value="">{label}</option>
      {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
    </Select>
  );
}

/** Image behind the bearer token: fetched as a blob and shown through an object URL. */
export function AuthImage({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let off = false; let u: string | null = null;
    fetchBlob(path).then((b) => { if (!off) { u = URL.createObjectURL(b); setUrl(u); } }).catch(() => undefined);
    return () => { off = true; if (u) URL.revokeObjectURL(u); };
  }, [path]);
  return url ? <img src={url} alt={alt} className={className} /> : <div className={`${className ?? ''} animate-pulse bg-surface-alt`} aria-label="Loading picture" />;
}

/** Download a protected file (CSV etc.) through the API client so the bearer token is sent. */
export async function downloadProtected(path: string, fileName: string) {
  const blob = await fetchBlob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
