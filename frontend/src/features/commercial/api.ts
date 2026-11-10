import { useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import type { Page } from '@/lib/format';

/** Date-only values (issue, due, validity, contract dates) are UTC midnight, so they are always shown in UTC. */
export const dateUtc = (iso: string | null | undefined, locale = 'en-IN') => (iso ? new Date(iso).toLocaleDateString(locale, { dateStyle: 'medium', timeZone: 'UTC' }) : '—');
/** Overdue = due date is before today (in the organization's timezone). */
export function useIsOverdue() {
  const tz = useAuth((s) => s.session?.organization.timezone) ?? 'UTC';
  let today: string;
  try { today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch { today = new Date().toISOString().slice(0, 10); }
  return (i: { status: string; type: string; dueDate: string | null }) => ['ISSUED', 'PARTIALLY_PAID'].includes(i.status) && i.type !== 'PROFORMA' && !!i.dueDate && i.dueDate.slice(0, 10) < today;
}

export interface TaxRate { code: string; label: string; rate: number; active: boolean }
export interface CommercialOptions {
  name: string; legalName: string | null; registrationNumber: string | null; taxId: string | null; email: string | null; phone: string | null; website: string | null;
  address: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string } | null;
  currency: string; locale: string; primaryColor: string; accentColor: string;
  tax: { regime: string; pricesIncludeTax: boolean; rates: TaxRate[] };
  invoiceSettings: { prefix?: string; paymentTermsDays?: number; termsAndConditions?: string; footerNote?: string; bankDetails?: string; showLogo?: boolean; showSignatureBlock?: boolean; accentColor?: string };
  proposalProfile?: import('@solarflow/shared').ProposalProfile;
  canSeeCost: boolean;
}
export const useCommercialOptions = () => useQuery({ queryKey: ['commercial-options'], queryFn: () => api.get<CommercialOptions>('/commercial/options'), staleTime: 60_000 });

/** Two-decimal money in the organization's own currency (documents must show paise/cents, unlike dashboards). */
export function useMoney2() {
  const o = useAuth((s) => s.session?.organization);
  return (v: string | number | null | undefined) => new Intl.NumberFormat(o?.locale ?? 'en-IN', { style: 'currency', currency: o?.currency ?? 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0));
}

export interface CatalogueRow { id: string; name: string; manufacturer: string; modelNumber: string; category: string; unit: string; wattageW?: string | number | null; warrantyYears?: number | null; sellingPrice: string; purchasePrice: string; taxRateCode: string | null; hsnCode: string | null }
export const useCatalogue = () => useQuery({ queryKey: ['catalogue'], queryFn: () => api.get<Page<CatalogueRow>>(`/equipment${qs({ pageSize: 100, sort: 'name', order: 'asc' })}`).then((r) => r.data), staleTime: 30_000 });

export interface DocItem {
  id?: string; equipmentId: string | null; description: string; unit: string; quantity: string; unitCost?: string; unitPrice: string; discountPct: string;
  taxRateCode: string | null; taxPercent?: string; hsnCode: string | null; taxable?: string; taxAmount?: string; lineTotal?: string; source?: string;
}
export interface CustomerBrief { id: string; name: string; email?: string | null; phone?: string | null; taxId?: string | null; addresses?: { id: string; label: string; line1: string; line2: string | null; city: string | null; state: string | null; postalCode: string | null; country: string | null; isDefault: boolean }[] }
export interface Totals { subtotal: string; discountTotal: string; taxTotal: string; total: string; costTotal?: string }

export interface BomRow { id: string; number: string; name: string; status: 'DRAFT' | 'FINAL'; panelCount: number; kwp: string; designVersion: number | null; customer: { id: string; name: string } | null; design: { id: string; name: string } | null; notes: string | null; updatedAt: string; items: DocItem[]; _count?: { items: number } }
export interface QuotationRow extends Totals {
  id: string; number: string; revision: number; parentId: string | null; title: string; status: string; validUntil: string | null; terms: string | null; notes: string | null; currency: string; pricesIncludeTax: boolean;
  taxSnapshot: { regime?: string; breakdown?: { percent: number; taxable: number; tax: number }[] }; createdAt: string; sentAt: string | null; decidedAt: string | null;
  customer: CustomerBrief; design?: { id: string; name: string } | null; bom?: { id: string; number: string; name: string } | null; items: DocItem[];
  events?: { id: string; fromStatus: string | null; toStatus: string; note: string | null; createdAt: string }[]; contract?: { id: string; number: string; status: string } | null; revisions?: { id: string; revision: number; status: string }[];
}
export interface Milestone { label: string; percent: number }
export interface ContractRow {
  id: string; number: string; title: string; status: string; value: string; currency: string; terms: string | null; startDate: string | null; completionDate: string | null; signedAt: string | null; paymentSchedule: Milestone[];
  customer: { id: string; name: string }; quotation: { id?: string; number: string; revision: number; title?: string; total?: string };
  invoices?: { id: string; number: string | null; type: string; status: string; total: string; amountPaid: string; issueDate: string | null }[];
}
export interface InvoiceRow extends Totals {
  id: string; number: string | null; type: string; status: string; issueDate: string | null; dueDate: string | null; notes: string | null; currency: string; pricesIncludeTax: boolean; amountPaid: string; outstanding: string;
  voidReason: string | null; taxSnapshot: { regime?: string; breakdown?: { percent: number; taxable: number; tax: number }[] };
  customerSnapshot: { name?: string; taxId?: string | null; email?: string | null; phone?: string | null; address?: { line1?: string; line2?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; country?: string | null } | null };
  customer: CustomerBrief; quotation?: { id: string; number: string; revision: number } | null; contract?: { id: string; number: string } | null; items: DocItem[]; payments?: PaymentRow[]; createdAt: string;
}
export interface PaymentRow {
  id: string; receiptNumber: string; amount: string; method: string; reference: string | null; paidAt: string; notes: string | null; voidedAt: string | null; voidReason: string | null;
  invoice?: { id: string; number: string | null; currency: string; customer?: { id: string; name: string } };
}

export const QUOTE_TONE: Record<string, 'neutral' | 'blue' | 'green' | 'yellow' | 'red'> = { DRAFT: 'neutral', PENDING_APPROVAL: 'yellow', APPROVED: 'blue', SENT: 'blue', ACCEPTED: 'green', REJECTED: 'red', EXPIRED: 'red' };
export const INVOICE_TONE: Record<string, 'neutral' | 'blue' | 'green' | 'yellow' | 'red'> = { DRAFT: 'neutral', ISSUED: 'blue', PARTIALLY_PAID: 'yellow', PAID: 'green', VOID: 'red' };
export const CONTRACT_TONE: Record<string, 'neutral' | 'blue' | 'green' | 'yellow' | 'red'> = { DRAFT: 'neutral', ACTIVE: 'blue', COMPLETED: 'green', CANCELLED: 'red' };
