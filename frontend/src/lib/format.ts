import { useAuth } from '@/store/auth';

export interface Page<T> { data: T[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }

/** Prisma Decimals arrive as strings. */
export const n = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? 0 : Number(v));

/** Money formatted in the organization's own currency and locale. */
export function useMoney() {
  const o = useAuth((s) => s.session?.organization);
  return (v: string | number | null | undefined, opts: { compact?: boolean } = {}) =>
    new Intl.NumberFormat(o?.locale ?? 'en-IN', { style: 'currency', currency: o?.currency ?? 'INR', maximumFractionDigits: 0, ...(opts.compact ? { notation: 'compact' as const } : {}) }).format(n(v));
}
export function useLocale() { return useAuth((s) => s.session?.organization.locale ?? 'en-IN'); }
export const num = (v: number | null | undefined, dp = 1) => (v === null || v === undefined ? '—' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: dp }).format(v));
export const dateOnly = (iso: string | null | undefined, locale = 'en-IN') => (iso ? new Date(iso).toLocaleDateString(locale, { dateStyle: 'medium' }) : '—');
export const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
export const label = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
export const fileSize = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export interface Person { id: string; firstName?: string; lastName?: string; name?: string }
export const personName = (p: { firstName?: string; lastName?: string } | null | undefined) => (p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : '—');
