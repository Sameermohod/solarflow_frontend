import { z } from 'zod';

/**
 * Phase 5 shared rules: projects and tasks, material allocation, maintenance and warranty, document templates.
 * Dates are date-only values stored as UTC midnight, the same convention as quotations (z.coerce.date from "YYYY-MM-DD").
 */
const uuid = z.string().uuid();
const date = z.coerce.date();
const optDate = z.coerce.date().nullish().transform((v) => v ?? null);
const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const money = z.number().finite().positive().max(1e12).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Use at most 2 decimals');
const qty = z.number().finite().positive().max(1e9).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'Use at most 3 decimals');

/* ------------------------------------------------------------------ projects */
export const PROJECT_STATUSES = ['PLANNING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as const;
export const PROJECT_STATUS_LABELS: Record<(typeof PROJECT_STATUSES)[number], string> = { PLANNING: 'Planning', IN_PROGRESS: 'In progress', ON_HOLD: 'On hold', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
export const PROJECT_TRANSITIONS: Record<string, readonly string[]> = {
  PLANNING: ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['PLANNING', 'IN_PROGRESS', 'CANCELLED'],
  COMPLETED: ['IN_PROGRESS'],
  CANCELLED: [],
};
export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE'] as const;
export const TASK_STATUS_LABELS: Record<(typeof TASK_STATUSES)[number], string> = { TODO: 'To do', IN_PROGRESS: 'In progress', BLOCKED: 'Blocked', DONE: 'Done' };
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export const projectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  customerId: uuid,
  quotationId: uuid.nullish().transform((v) => v ?? null),
  siteAddress: optText(400),
  capacityKw: z.number().finite().positive().max(1e6).nullish().transform((v) => v ?? null),
  /** Planned total cost; the finance tracker compares it with the actual cost. */
  budget: money.nullish().transform((v) => v ?? null),
  managerId: uuid.nullish().transform((v) => v ?? null),
  startDate: optDate,
  targetDate: optDate,
  notes: optText(4000),
  /** When creating from a quotation: copy its catalogue-linked lines as planned materials. */
  copyMaterials: z.boolean().default(true),
}).refine((p) => !p.startDate || !p.targetDate || p.targetDate >= p.startDate, { message: 'Target date cannot be before the start date', path: ['targetDate'] });
export const projectUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120), siteAddress: optText(400), capacityKw: z.number().finite().positive().max(1e6).nullish().transform((v) => v ?? null), budget: money.nullish().transform((v) => v ?? null),
  managerId: uuid.nullish().transform((v) => v ?? null), startDate: optDate, targetDate: optDate, notes: optText(4000),
}).partial();
export const projectStatusSchema = z.object({ status: z.enum(PROJECT_STATUSES), note: optText(500) });

export const projectMilestoneSchema = z.object({ name: z.string().trim().min(2).max(120), dueDate: optDate, weight: z.number().int().min(1).max(100).default(1) });
export const projectMilestoneUpdateSchema = projectMilestoneSchema.partial().extend({ completed: z.boolean().optional() });

export const taskSchema = z.object({
  title: z.string().trim().min(2).max(160), description: optText(4000), milestoneId: uuid.nullish().transform((v) => v ?? null),
  priority: z.enum(PRIORITIES).default('MEDIUM'), assigneeId: uuid.nullish().transform((v) => v ?? null), startDate: optDate, dueDate: optDate,
});
export const taskUpdateSchema = taskSchema.partial().extend({ status: z.enum(TASK_STATUSES).optional() });

export const materialPlanSchema = z.object({ equipmentId: uuid, quantityPlanned: z.number().finite().min(0).max(1e9).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'Use at most 3 decimals') });
export const materialMoveSchema = z.object({ equipmentId: uuid, quantity: qty, serials: z.array(z.string().trim().min(1).max(80)).max(1000).optional(), note: optText(300) });

export const expenseSchema = z.object({ description: z.string().trim().min(2).max(200), category: optText(60), amount: money, incurredOn: date });
export const issueSchema = z.object({ title: z.string().trim().min(2).max(160), description: optText(4000), severity: z.enum(SEVERITIES).default('MEDIUM') });
export const issueUpdateSchema = z.object({ title: z.string().trim().min(2).max(160).optional(), description: optText(4000).optional(), severity: z.enum(SEVERITIES).optional(), status: z.enum(['OPEN', 'RESOLVED']).optional(), resolution: optText(1000).optional() });

/** Progress 0–100: weighted completed milestones when there are milestones, otherwise done tasks ÷ tasks. */
export function projectProgress(milestones: { weight: number; completedAt: unknown }[], tasks: { status: string }[]): number {
  if (milestones.length) {
    const total = milestones.reduce((a, m) => a + m.weight, 0);
    const done = milestones.filter((m) => m.completedAt).reduce((a, m) => a + m.weight, 0);
    return total ? Math.round((done / total) * 100) : 0;
  }
  const active = tasks.filter((t) => t.status !== 'CANCELLED');
  return active.length ? Math.round((active.filter((t) => t.status === 'DONE').length / active.length) * 100) : 0;
}

/* ------------------------------------------------------------------ maintenance */
export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export const TICKET_STATUS_LABELS: Record<(typeof TICKET_STATUSES)[number], string> = { OPEN: 'Open', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', CLOSED: 'Closed' };
export const TICKET_TRANSITIONS: Record<string, readonly string[]> = { OPEN: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'], IN_PROGRESS: ['OPEN', 'RESOLVED', 'CLOSED'], RESOLVED: ['CLOSED', 'IN_PROGRESS'], CLOSED: ['IN_PROGRESS'] };

export const warrantySchema = z.object({
  customerId: uuid, projectId: uuid.nullish().transform((v) => v ?? null), equipmentId: uuid.nullish().transform((v) => v ?? null),
  description: z.string().trim().min(2).max(200), serial: optText(80), startDate: date, endDate: date, terms: optText(2000),
}).refine((w) => w.endDate > w.startDate, { message: 'The warranty must end after it starts', path: ['endDate'] });
export const warrantyUpdateSchema = z.object({ description: z.string().trim().min(2).max(200), serial: optText(80), startDate: date, endDate: date, terms: optText(2000) }).partial();

export type WarrantyState = 'ACTIVE' | 'EXPIRING' | 'EXPIRED';
/** Expiring = ends within `soonDays` (default 60). `today` is a date-only UTC midnight. */
export function warrantyState(endDate: Date, today: Date, soonDays = 60): WarrantyState {
  const days = Math.round((endDate.getTime() - today.getTime()) / 86_400_000);
  return days < 0 ? 'EXPIRED' : days <= soonDays ? 'EXPIRING' : 'ACTIVE';
}

export const amcSchema = z.object({
  customerId: uuid, projectId: uuid.nullish().transform((v) => v ?? null), startDate: date, endDate: date,
  visitsPerYear: z.number().int().min(1).max(12).default(2), annualFee: money.nullish().transform((v) => v ?? null), notes: optText(2000),
}).refine((a) => a.endDate > a.startDate, { message: 'The contract must end after it starts', path: ['endDate'] });

/**
 * Evenly spaced preventive-maintenance visits over the contract: round(term in years x visits per year) visits, each in
 * the middle of its interval, so all fall strictly inside the term. Pure: the same input always gives the same dates.
 */
export function scheduleVisits(start: Date, end: Date, visitsPerYear: number): Date[] {
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  const count = Math.max(1, Math.round((days / 365) * visitsPerYear));
  const step = days / count;
  return Array.from({ length: count }, (_, i) => new Date(start.getTime() + Math.round(step * (i + 0.5)) * 86_400_000));
}
export const visitCompleteSchema = z.object({ notes: optText(2000), technicianId: uuid.nullish().transform((v) => v ?? null) });

export const ticketSchema = z.object({
  customerId: uuid, projectId: uuid.nullish().transform((v) => v ?? null), warrantyId: uuid.nullish().transform((v) => v ?? null), amcId: uuid.nullish().transform((v) => v ?? null),
  title: z.string().trim().min(2).max(160), description: optText(4000), priority: z.enum(PRIORITIES).default('MEDIUM'), assigneeId: uuid.nullish().transform((v) => v ?? null),
});
export const ticketUpdateSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(), description: optText(4000).optional(), priority: z.enum(PRIORITIES).optional(), assigneeId: uuid.nullish().transform((v) => v ?? null).optional(),
  status: z.enum(TICKET_STATUSES).optional(), resolution: optText(2000).optional(),
});
export const replacementSchema = z.object({
  customerId: uuid, ticketId: uuid.nullish().transform((v) => v ?? null), projectId: uuid.nullish().transform((v) => v ?? null), equipmentId: uuid.nullish().transform((v) => v ?? null),
  description: z.string().trim().min(2).max(200), oldSerial: optText(80), newSerial: optText(80), replacedOn: date, reason: optText(500), underWarranty: z.boolean().default(false),
});

/* ------------------------------------------------------------------ document templates */
export const TEMPLATE_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export const DOCUMENT_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'] as const;
export const DOCUMENT_STATUS_LABELS: Record<(typeof DOCUMENT_STATUSES)[number], string> = { DRAFT: 'Draft', PENDING_APPROVAL: 'Pending approval', APPROVED: 'Approved', REJECTED: 'Rejected' };
export const DOCUMENT_TRANSITIONS: Record<string, readonly string[]> = { DRAFT: ['PENDING_APPROVAL'], PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'DRAFT'], APPROVED: [], REJECTED: ['DRAFT'] };

/** Placeholders a template may use. Anything else is reported, never silently left in a document. */
export const PLACEHOLDERS = [
  ['company.name', 'Your company name'], ['company.address', 'Your company address'], ['company.phone', 'Your phone'], ['company.email', 'Your email'], ['company.taxId', 'Your tax ID'],
  ['customer.name', 'Customer name'], ['customer.address', 'Customer address'], ['customer.phone', 'Customer phone'], ['customer.email', 'Customer email'],
  ['project.name', 'Project name'], ['project.number', 'Project number'], ['project.address', 'Project site address'], ['project.capacityKw', 'Project capacity (kW)'], ['project.startDate', 'Project start date'], ['project.targetDate', 'Project target date'],
  ['quotation.number', 'Quotation number'], ['quotation.total', 'Quotation total'], ['quotation.title', 'Quotation title'],
  ['date.today', "Today's date"],
] as const;
export type PlaceholderKey = (typeof PLACEHOLDERS)[number][0];
const PLACEHOLDER_KEYS = new Set<string>(PLACEHOLDERS.map((p) => p[0]));
const PH_RE = /\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/g;

export function extractPlaceholders(body: string): string[] { return [...new Set([...body.matchAll(PH_RE)].map((m) => m[1]!))]; }
export const unknownPlaceholders = (body: string) => extractPlaceholders(body).filter((k) => !PLACEHOLDER_KEYS.has(k));

/** Fills placeholders from the context. Values that are missing for this document are listed in `missing` and printed as "[key]". */
export function renderTemplate(body: string, ctx: Partial<Record<string, string | null | undefined>>): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = body.replace(PH_RE, (_m, key: string) => {
    const v = ctx[key];
    if (v === undefined || v === null || v === '') { missing.add(key); return `[${key}]`; }
    return v;
  });
  return { text, missing: [...missing] };
}

export const templateSchema = z.object({
  name: z.string().trim().min(2).max(120), category: z.string().trim().min(2).max(40).default('GENERAL'), jurisdiction: optText(80),
  body: z.string().min(1).max(50_000), status: z.enum(TEMPLATE_STATUSES).default('DRAFT'),
}).superRefine((t, ctx) => { const bad = unknownPlaceholders(t.body); if (bad.length) ctx.addIssue({ code: 'custom', path: ['body'], message: `Unknown placeholder(s): ${bad.map((b) => `{{${b}}}`).join(', ')}` }); });
export const documentSchema = z.object({
  title: z.string().trim().min(2).max(160), templateId: uuid.nullish().transform((v) => v ?? null), customerId: uuid.nullish().transform((v) => v ?? null),
  projectId: uuid.nullish().transform((v) => v ?? null), quotationId: uuid.nullish().transform((v) => v ?? null), content: z.string().max(100_000).optional(),
});
export const documentUpdateSchema = z.object({ title: z.string().trim().min(2).max(160).optional(), content: z.string().min(1).max(100_000) });
export const documentStatusSchema = z.object({ status: z.enum(DOCUMENT_STATUSES), note: optText(500) });
export const packSchema = z.object({
  name: z.string().trim().min(2).max(120), jurisdiction: z.string().trim().min(2).max(80), description: optText(1000), isActive: z.boolean().default(true),
  items: z.array(z.object({ title: z.string().trim().min(2).max(160), templateId: uuid, required: z.boolean().default(true) })).min(1).max(40),
});
export const applyPackSchema = z.object({ projectId: uuid });
