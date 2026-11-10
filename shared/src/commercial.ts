import { z } from 'zod';
import { validateLayout } from './design/placement';
import type { DesignConfig } from './design/types';

/**
 * Phase 4: money maths for quotations and invoices, and BOM generation from a design.
 * All money is computed in integer minor units (cents/paise) and rounded per line, so totals always equal the sum
 * of the printed lines. Tax rates are never defined here: callers pass the percentage taken from the organization's
 * own tax configuration (and issued documents keep that percentage as a snapshot).
 */

export interface DocLineInput {
  quantity: number;
  /** Price per unit. Tax-exclusive unless `pricesIncludeTax` is true. */
  unitPrice: number;
  discountPct: number;
  taxPercent: number;
}
export interface DocLineResult {
  /** Quantity × price before discount (as entered). */
  base: number;
  discount: number;
  /** Amount excluding tax after discount. */
  taxable: number;
  tax: number;
  /** What the customer pays for this line (taxable + tax). */
  total: number;
}
export interface TaxBucket { percent: number; taxable: number; tax: number }
export interface DocTotals {
  lines: DocLineResult[];
  /** Sum of taxable amounts (after discount, excluding tax). */
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  taxBreakdown: TaxBucket[];
}

const cents = (x: number) => Math.round(x * 100);
const major = (c: number) => c / 100;

export function computeDocument(lines: DocLineInput[], opts: { pricesIncludeTax?: boolean } = {}): DocTotals {
  const inclusive = !!opts.pricesIncludeTax;
  const buckets = new Map<number, { taxable: number; tax: number }>();
  let sub = 0, disc = 0, taxSum = 0, tot = 0;
  const out: DocLineResult[] = lines.map((l) => {
    if (!(l.quantity >= 0) || !(l.unitPrice >= 0) || !(l.discountPct >= 0 && l.discountPct <= 100) || !(l.taxPercent >= 0)) throw new Error('Invalid line values');
    const base = Math.round(l.quantity * cents(l.unitPrice));
    const discount = Math.round((base * l.discountPct) / 100);
    const net = base - discount;
    let taxable: number, tax: number, total: number;
    if (inclusive) { taxable = Math.round((net * 100) / (100 + l.taxPercent)); tax = net - taxable; total = net; }
    else { taxable = net; tax = Math.round((net * l.taxPercent) / 100); total = net + tax; }
    sub += taxable; disc += discount; taxSum += tax; tot += total;
    const b = buckets.get(l.taxPercent) ?? { taxable: 0, tax: 0 };
    b.taxable += taxable; b.tax += tax; buckets.set(l.taxPercent, b);
    return { base: major(base), discount: major(discount), taxable: major(taxable), tax: major(tax), total: major(total) };
  });
  return {
    lines: out, subtotal: major(sub), discountTotal: major(disc), taxTotal: major(taxSum), total: major(tot),
    taxBreakdown: [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([percent, b]) => ({ percent, taxable: major(b.taxable), tax: major(b.tax) })),
  };
}

/** Round to 2 decimals as a string suitable for a Decimal column. */
export const money2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/* ───────── document schemas ───────── */
const uuid = z.string().uuid();
const optUuid = uuid.nullish().transform((v) => v ?? null);
const optText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const qty = z.coerce.number().positive().max(1e7);
const price = z.coerce.number().min(0).max(1e10);

export const docLineSchema = z.object({
  equipmentId: optUuid,
  description: z.string().trim().min(1).max(300),
  unit: z.string().trim().min(1).max(20).default('nos'),
  quantity: qty,
  unitCost: z.coerce.number().min(0).max(1e10).default(0),
  unitPrice: price,
  discountPct: z.coerce.number().min(0).max(100).default(0),
  /** Code in the organization's tax configuration; the percentage is looked up on the server. */
  taxRateCode: optText(30),
  hsnCode: optText(20),
});
export type DocLine = z.infer<typeof docLineSchema>;

export const BOM_STATUSES = ['DRAFT', 'FINAL'] as const;
export const bomRuleSchema = z.object({
  equipmentId: uuid,
  basis: z.enum(['PER_PANEL', 'PER_KWP', 'FIXED']),
  quantity: z.coerce.number().positive().max(1e6),
});
export type BomRule = z.infer<typeof bomRuleSchema>;
export const RULE_BASIS_LABELS: Record<BomRule['basis'], string> = { PER_PANEL: 'per panel', PER_KWP: 'per kWp', FIXED: 'fixed quantity' };

export const generateBomSchema = z.object({
  designId: uuid,
  version: z.coerce.number().int().positive().optional(),
  name: z.string().trim().min(2).max(120).optional(),
  rules: z.array(bomRuleSchema).max(50).default([]),
});
export const bomSchema = z.object({
  name: z.string().trim().min(2).max(120),
  customerId: optUuid,
  notes: optText(2000),
  status: z.enum(BOM_STATUSES).default('DRAFT'),
  items: z.array(docLineSchema).min(1).max(300),
});

export const QUOTATION_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];
export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  DRAFT: 'Draft', PENDING_APPROVAL: 'Pending approval', APPROVED: 'Approved', SENT: 'Sent', ACCEPTED: 'Accepted', REJECTED: 'Rejected', EXPIRED: 'Expired',
};
/** Allowed manual transitions. EXPIRED is also applied automatically when validUntil has passed. */
export const QUOTATION_TRANSITIONS: Record<QuotationStatus, QuotationStatus[]> = {
  DRAFT: ['PENDING_APPROVAL'],
  PENDING_APPROVAL: ['APPROVED', 'DRAFT'],
  APPROVED: ['SENT', 'DRAFT'],
  SENT: ['ACCEPTED', 'REJECTED'],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
};
export const quotationSchema = z.object({
  customerId: uuid,
  title: z.string().trim().min(2).max(160),
  designId: optUuid,
  bomId: optUuid,
  validUntil: z.coerce.date().nullish().transform((v) => v ?? null),
  terms: optText(5000),
  notes: optText(2000),
  items: z.array(docLineSchema).min(1).max(300),
});
export const quotationStatusSchema = z.object({ status: z.enum(QUOTATION_STATUSES), note: optText(500) });

export const CONTRACT_STATUSES = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export const milestoneSchema = z.object({ label: z.string().trim().min(1).max(80), percent: z.coerce.number().gt(0).max(100) });
export const contractSchema = z.object({
  quotationId: uuid,
  terms: optText(8000),
  startDate: z.coerce.date().nullish().transform((v) => v ?? null),
  completionDate: z.coerce.date().nullish().transform((v) => v ?? null),
  paymentSchedule: z.array(milestoneSchema).max(12).default([]),
});
export const contractUpdateSchema = z.object({
  terms: optText(8000).optional(),
  startDate: z.coerce.date().nullish().optional(),
  completionDate: z.coerce.date().nullish().optional(),
  paymentSchedule: z.array(milestoneSchema).max(12).optional(),
});
export const contractStatusSchema = z.object({ status: z.enum(CONTRACT_STATUSES), note: optText(500) });
/** Milestone percentages must add up to exactly 100 (or the schedule is empty). */
export function scheduleError(s: { percent: number }[]): string | null {
  if (!s.length) return null;
  const sum = Math.round(s.reduce((a, m) => a + m.percent, 0) * 1e6) / 1e6;
  return sum === 100 ? null : `Milestones add up to ${sum}%, they must total 100%`;
}

export const INVOICE_TYPES = ['PROFORMA', 'ADVANCE', 'TAX', 'FINAL'] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];
export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = { PROFORMA: 'Proforma invoice', ADVANCE: 'Advance invoice', TAX: 'Tax invoice', FINAL: 'Final invoice' };
export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const invoiceSchema = z.object({
  type: z.enum(INVOICE_TYPES).default('TAX'),
  customerId: uuid,
  quotationId: optUuid,
  contractId: optUuid,
  issueDate: z.coerce.date().nullish().transform((v) => v ?? null),
  dueDate: z.coerce.date().nullish().transform((v) => v ?? null),
  notes: optText(2000),
  items: z.array(docLineSchema).min(1).max(300),
});
/** Create an invoice for one contract milestone: a share of the contract value. */
export const invoiceFromContractSchema = z.object({
  contractId: uuid,
  type: z.enum(INVOICE_TYPES).default('ADVANCE'),
  milestoneIndex: z.coerce.number().int().min(0).max(11).optional(),
  percent: z.coerce.number().gt(0).max(100).optional(),
  dueDate: z.coerce.date().nullish().transform((v) => v ?? null),
});

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'UPI', 'CARD', 'OTHER'] as const;
export const paymentSchema = z.object({
  invoiceId: uuid,
  amount: z.coerce.number().positive().max(1e10),
  method: z.enum(PAYMENT_METHODS),
  reference: optText(100),
  paidAt: z.coerce.date().nullish().refine((d) => !d || d.getTime() <= Date.now() + 86_400_000, 'Payment date cannot be in the future').transform((v) => v ?? null),
  notes: optText(500),
});
export const voidSchema = z.object({ reason: z.string().trim().min(3).max(300) });

/** Payment status from what has been paid against the total (both in money units, compared in cents). */
export function invoiceStatusFor(total: number, paid: number, current: InvoiceStatus): InvoiceStatus {
  if (current === 'DRAFT' || current === 'VOID') return current;
  const t = Math.round(total * 100), p = Math.round(paid * 100);
  if (p <= 0) return 'ISSUED';
  return p >= t ? 'PAID' : 'PARTIALLY_PAID';
}

/* ───────── BOM generation ───────── */
export interface CatalogueItem {
  id: string; name: string; manufacturer: string; modelNumber: string; unit: string; category: string;
  purchasePrice: number; sellingPrice: number; taxRateCode: string | null; hsnCode: string | null;
}
export interface BomLineDraft {
  equipmentId: string | null;
  description: string;
  unit: string;
  quantity: number;
  unitCost: number;
  unitPrice: number;
  taxRateCode: string | null;
  hsnCode: string | null;
  source: 'DESIGN' | 'RULE';
  /** Reasons the line needs the user's attention (e.g. not linked to the catalogue, no selling price). */
  warnings: string[];
}

/**
 * Builds BOM lines from a design: panels by type (valid, non-flagged panels only), catalogue-linked equipment placed
 * on the plan, then the user's own quantity rules (per panel / per kWp / fixed). Nothing is invented: items that are
 * not linked to the catalogue come back with a price of 0 and a warning.
 */
export function generateBomLines(config: DesignConfig, catalogue: Map<string, CatalogueItem>, rules: BomRule[] = []): { lines: BomLineDraft[]; panelCount: number; kwp: number } {
  const report = validateLayout(config);
  const lines: BomLineDraft[] = [];
  const fromCatalogue = (eq: CatalogueItem, quantity: number, source: BomLineDraft['source']): BomLineDraft => ({
    equipmentId: eq.id, description: `${eq.name} (${eq.manufacturer} ${eq.modelNumber})`, unit: eq.unit, quantity, unitCost: eq.purchasePrice, unitPrice: eq.sellingPrice,
    taxRateCode: eq.taxRateCode, hsnCode: eq.hsnCode, source,
    warnings: eq.sellingPrice > 0 ? [] : ['The catalogue item has no selling price'],
  });

  let panelCount = 0;
  let wattSum = 0;
  for (const t of config.panelTypes) {
    const n = config.panels.filter((p) => p.typeId === t.id && !report.errorIds.has(p.id)).length;
    if (!n) continue;
    panelCount += n; wattSum += n * t.wattage;
    const eq = t.equipmentId ? catalogue.get(t.equipmentId) : undefined;
    lines.push(eq
      ? fromCatalogue(eq, n, 'DESIGN')
      : { equipmentId: null, description: `${t.name} (${t.wattage} Wp)`, unit: 'nos', quantity: n, unitCost: 0, unitPrice: 0, taxRateCode: null, hsnCode: null, source: 'DESIGN', warnings: ['Panel type is not linked to the equipment catalogue, so it has no price'] });
  }
  const kwp = wattSum / 1000;

  const placed = new Map<string, { count: number; label: string; kind: string }>();
  for (const e of config.equipment) {
    const key = e.equipmentId ?? `free:${e.kind}:${e.label}`;
    const cur = placed.get(key) ?? { count: 0, label: e.label || e.kind, kind: e.kind };
    cur.count += 1; placed.set(key, cur);
  }
  for (const [key, v] of placed) {
    const eq = key.startsWith('free:') ? undefined : catalogue.get(key);
    lines.push(eq
      ? fromCatalogue(eq, v.count, 'DESIGN')
      : { equipmentId: null, description: v.label, unit: 'nos', quantity: v.count, unitCost: 0, unitPrice: 0, taxRateCode: null, hsnCode: null, source: 'DESIGN', warnings: ['Equipment on the plan is not linked to the catalogue, so it has no price'] });
  }

  for (const r of rules) {
    const eq = catalogue.get(r.equipmentId);
    if (!eq) continue;
    const quantity = r.basis === 'PER_PANEL' ? r.quantity * panelCount : r.basis === 'PER_KWP' ? r.quantity * kwp : r.quantity;
    if (quantity <= 0) continue;
    // Round up fractional "nos" so you never under-buy; metres/sets keep 3 decimals.
    const q = eq.unit.toLowerCase() === 'nos' ? Math.ceil(quantity - 1e-9) : Math.round(quantity * 1000) / 1000;
    lines.push(fromCatalogue(eq, q, 'RULE'));
  }
  return { lines, panelCount, kwp: Math.round(kwp * 1000) / 1000 };
}

export const DOC_DISCLAIMER = 'Quantities come from a preliminary design and the rules you entered; confirm against a site survey before ordering.';
