import { z } from 'zod';

/**
 * Timesheets and the finance tracker. Pay is a MONTHLY SALARY only: nobody is paid by the hour. Logged time measures
 * effort and is used to spread each person's monthly salary over the projects they worked on (an internal costing
 * estimate), never to calculate pay.
 */
const uuid = z.string().uuid();
const date = z.coerce.date();
const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

export const DEFAULT_HOURS_PER_DAY = 8;
export const MAX_HOURS_PER_DAY = 24;

/* ------------------------------------------------------------------ timesheets */
export const TIME_ENTRY_STATUSES = ['OPEN', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export const TIME_ENTRY_STATUS_LABELS: Record<(typeof TIME_ENTRY_STATUSES)[number], string> = { OPEN: 'Not submitted', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved', REJECTED: 'Rejected' };

const hours = z.number().finite().min(0.25).max(MAX_HOURS_PER_DAY).refine((h) => Math.abs(h * 4 - Math.round(h * 4)) < 1e-9, 'Use steps of 15 minutes (0.25 h)');
export const timeEntrySchema = z.object({ projectId: uuid, taskId: uuid.nullish().transform((v) => v ?? null), workDate: date, hours, note: optText(500) });
export const timeEntryUpdateSchema = z.object({ taskId: uuid.nullish().transform((v) => v ?? null), workDate: date, hours, note: optText(500) }).partial();
export const submitSchema = z.object({ from: date, to: date }).refine((r) => r.to >= r.from, { message: 'The end date is before the start date', path: ['to'] }).refine((r) => (r.to.getTime() - r.from.getTime()) / 86_400_000 <= 31, { message: 'Submit at most 31 days at a time', path: ['to'] });
export const decideSchema = z.object({ ids: z.array(uuid).min(1).max(300), decision: z.enum(['APPROVED', 'REJECTED']), note: optText(500) });

export const hoursToMinutes = (h: number) => Math.round(h * 60);
export const minutesToHours = (m: number) => Math.round((m / 60) * 100) / 100;

/** Monday to Friday days between two date-only (UTC midnight) dates, inclusive. Public holidays are not known to the system. */
export function weekdaysInRange(from: Date, to: Date): number {
  let n = 0;
  for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) { const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) n++; }
  return n;
}
/** "2026-03" to its first and last day. */
export function monthRange(ym: string): { from: Date; to: Date } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym);
  if (!m) throw new Error('Month must look like 2026-03');
  const y = Number(m[1]); const mo = Number(m[2]);
  return { from: new Date(Date.UTC(y, mo - 1, 1)), to: new Date(Date.UTC(y, mo, 0)) };
}
export const monthKey = (d: Date) => d.toISOString().slice(0, 7);
export function monthsBetween(from: Date, to: Date): string[] {
  const out: string[] = []; const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (d <= to) { out.push(monthKey(d)); d.setUTCMonth(d.getUTCMonth() + 1); }
  return out;
}

/* ------------------------------------------------------------------ salaries */
const money = z.number().finite().positive().max(1e9).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Use at most 2 decimals');
export const salarySchema = z.object({ monthlySalary: money, effectiveFrom: date, note: optText(300) });

/** The salary in force on a day: the latest entry that started on or before it (history is kept, never overwritten). */
export function salaryOn<T extends { effectiveFrom: Date; monthlySalary: number | string | { toString(): string } }>(history: T[], day: Date): number | null {
  let best: T | null = null;
  for (const h of history) if (h.effectiveFrom <= day && (!best || h.effectiveFrom > best.effectiveFrom)) best = h;
  return best ? Number(best.monthlySalary) : null;
}

/**
 * Spreads one person's monthly salary over the projects they logged approved time on, in whole cents.
 * The share of a project is minutes ÷ max(minutes logged in total, expected minutes of the month). Time that was not logged
 * stays unallocated (bench/overhead), so a person who logged half the expected month charges half of the salary to projects.
 * allocated + unallocated always equals the salary exactly (largest-remainder rounding).
 */
export function allocateLabour(salaryCents: number, minutesByProject: Record<string, number>, expectedMinutes: number): { byProject: Record<string, number>; unallocatedCents: number } {
  const ids = Object.keys(minutesByProject).filter((k) => minutesByProject[k]! > 0);
  const total = ids.reduce((a, k) => a + minutesByProject[k]!, 0);
  const denom = Math.max(total, expectedMinutes);
  if (!ids.length || denom <= 0 || salaryCents <= 0) return { byProject: {}, unallocatedCents: Math.max(0, salaryCents) };
  const exact = ids.map((k) => ({ k, v: (salaryCents * minutesByProject[k]!) / denom }));
  const allocatedTarget = Math.round(exact.reduce((a, e) => a + e.v, 0));
  const floors = exact.map((e) => ({ k: e.k, base: Math.floor(e.v), rem: e.v - Math.floor(e.v) }));
  let left = allocatedTarget - floors.reduce((a, f) => a + f.base, 0);
  const byProject: Record<string, number> = {};
  for (const f of floors) byProject[f.k] = f.base;
  for (const f of [...floors].sort((a, b) => b.rem - a.rem || a.k.localeCompare(b.k))) { if (left <= 0) break; byProject[f.k]! += 1; left--; }
  return { byProject, unallocatedCents: salaryCents - allocatedTarget };
}

/** Profit of a project in cents: revenue (net of tax) minus material, expenses and allocated labour. */
export function projectResult(i: { revenueCents: number; materialCents: number; expenseCents: number; labourCents: number; budgetCents?: number | null }) {
  const cost = i.materialCents + i.expenseCents + i.labourCents;
  const profit = i.revenueCents - cost;
  return {
    costCents: cost, profitCents: profit,
    marginPct: i.revenueCents > 0 ? Math.round((profit / i.revenueCents) * 1000) / 10 : null,
    budgetUsedPct: i.budgetCents && i.budgetCents > 0 ? Math.round((cost / i.budgetCents) * 1000) / 10 : null,
    overBudget: !!i.budgetCents && i.budgetCents > 0 && cost > i.budgetCents,
  };
}
