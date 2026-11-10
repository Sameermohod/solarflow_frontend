import { jsPDF } from 'jspdf';
import { INVOICE_TYPE_LABELS, type InvoiceType } from '@solarflow/shared';
import { downloadBlob } from '@/features/design/exporters';
import type { CommercialOptions, ContractRow, DocItem, InvoiceRow, PaymentRow, QuotationRow, Totals } from './api';

/**
 * Branded PDFs for quotations, invoices, contracts and payment receipts. Everything printed comes from the stored
 * document (issued invoices print their own snapshot), the organization's invoice settings and its logo.
 * jsPDF's built-in fonts only cover Latin text, so amounts print with the ISO currency code (e.g. "INR 1,000.00")
 * and names in other scripts will not render; this is documented in the README.
 */
const hex = (h: string): [number, number, number] => { const m = /^#?([0-9a-f]{6})$/i.exec(h); const v = m ? parseInt(m[1]!, 16) : 0x0f2a43; return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const clean = (s: string | null | undefined) => (s ?? '').replace(/[^\x20-\x7E -ÿ–—•‘’“”]/g, '?');
const safe = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'document';

async function loadLogo(url: string | null | undefined): Promise<{ data: string; fmt: 'PNG' | 'JPEG'; w: number; h: number } | null> {
  if (!url) return null;
  try {
    const blob = await (await fetch(url)).blob();
    const fmt = blob.type === 'image/png' ? 'PNG' : blob.type === 'image/jpeg' ? 'JPEG' : null;
    if (!fmt) return null; // webp/svg are not supported by jsPDF; the company name is printed instead
    const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob); });
    const dim = await new Promise<{ w: number; h: number }>((res, rej) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = rej; i.src = data; });
    return { data, fmt, ...dim };
  } catch { return null; }
}

interface PdfInput {
  title: string;            // "QUOTATION", "TAX INVOICE", ...
  number: string;
  meta: [string, string][]; // right-hand block under the number
  billTo: { heading: string; name: string; lines: string[] };
  items: DocItem[];
  totals: Totals;
  breakdown?: { percent: number; taxable: number; tax: number }[];
  currency: string;
  locale: string;
  pricesIncludeTax: boolean;
  intro?: string;
  notes?: string | null;
  terms?: string | null;
  payment?: { paid: string; outstanding: string };
  schedule?: { label: string; percent: number; amount: string }[];
  /** Contracts and receipts show one total, without a tax split. */
  plain?: boolean;
  stamp?: string;           // "VOID", "DRAFT"
  signLabels?: [string, string];
  footerExtra?: string;
}

async function render(o: CommercialOptions, logoUrl: string | null | undefined, d: PdfInput, fileName: string) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, H = 297, M = 14;
  const brand = hex(o.invoiceSettings.accentColor || o.primaryColor);
  const fmt = new Intl.NumberFormat(d.locale, { style: 'currency', currency: d.currency, currencyDisplay: 'code', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (v: string | number | null | undefined) => fmt.format(Number(v ?? 0)).replace(/ /g, ' ');
  const logo = o.invoiceSettings.showLogo === false ? null : await loadLogo(logoUrl);
  let y = 0;
  const color = (c: [number, number, number]) => pdf.setTextColor(c[0], c[1], c[2]);
  const ink: [number, number, number] = [30, 41, 59], muted: [number, number, number] = [100, 116, 139];

  const header = () => {
    pdf.setFillColor(...brand); pdf.rect(0, 0, W, 4, 'F');
    let x = M;
    if (logo) { const hh = 14, ww = Math.min(40, (logo.w / logo.h) * hh); pdf.addImage(logo.data, logo.fmt, M, 9, ww, hh); x = M + ww + 4; }
    color(ink); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(logo ? 12 : 15); pdf.text(clean(o.legalName || o.name), x, 15);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); color(muted);
    const a = o.address ?? {};
    const addr = [a.line1, a.line2, [a.city, a.state, a.postalCode].filter(Boolean).join(', '), a.country].filter(Boolean).join(', ');
    const lines = [addr, [o.phone, o.email].filter(Boolean).join('  |  '), o.taxId ? `Tax ID: ${o.taxId}` : '', o.registrationNumber ? `Reg. no: ${o.registrationNumber}` : ''].filter(Boolean);
    pdf.text(lines.map(clean), x, 20, { lineHeightFactor: 1.4 });
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); color(brand); pdf.text(d.title, W - M, 16, { align: 'right' });
    pdf.setFontSize(10); color(ink); pdf.text(clean(d.number), W - M, 22, { align: 'right' });
    y = 36;
    pdf.setDrawColor(226, 232, 240); pdf.line(M, y - 2, W - M, y - 2);
  };
  const footer = (page: number, pages: number) => {
    pdf.setFontSize(7.5); pdf.setFont('helvetica', 'normal'); color(muted);
    const f = clean([o.invoiceSettings.footerNote, d.footerExtra].filter(Boolean).join('  '));
    if (f) pdf.text(pdf.splitTextToSize(f, W - M * 2 - 20).slice(0, 2), M, H - 10);
    pdf.text(`Page ${page} of ${pages}`, W - M, H - 10, { align: 'right' });
  };

  header();
  // bill-to + meta
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); color(muted); pdf.text(d.billTo.heading.toUpperCase(), M, y + 3);
  pdf.setFontSize(11); color(ink); pdf.text(clean(d.billTo.name), M, y + 9);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); color(muted);
  const bl = d.billTo.lines.filter(Boolean).flatMap((l) => pdf.splitTextToSize(clean(l), 90) as string[]);
  pdf.text(bl, M, y + 14, { lineHeightFactor: 1.4 });
  let my = y + 3;
  for (const [k, v] of d.meta) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); color(muted); pdf.text(k, W - M - 45, my, { align: 'right' }); color(ink); pdf.setFont('helvetica', 'bold'); pdf.text(clean(v), W - M, my, { align: 'right' }); my += 5; }
  y = Math.max(y + 14 + bl.length * 4.6, my) + 4;
  if (d.intro) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); color(ink); const il = pdf.splitTextToSize(clean(d.intro), W - M * 2) as string[]; pdf.text(il, M, y, { lineHeightFactor: 1.4 }); y += il.length * 4.4 + 2; }

  // items table
  const cols = [
    { k: 'Description', x: M, w: 74, a: 'left' as const }, { k: 'HSN', x: M + 74, w: 14, a: 'left' as const }, { k: 'Qty', x: M + 88, w: 16, a: 'right' as const },
    { k: 'Rate', x: M + 104, w: 26, a: 'right' as const }, { k: 'Disc', x: M + 130, w: 12, a: 'right' as const }, { k: 'Tax', x: M + 142, w: 12, a: 'right' as const }, { k: 'Amount', x: M + 154, w: 28, a: 'right' as const },
  ];
  const head = () => {
    pdf.setFillColor(...brand); pdf.rect(M, y, W - M * 2, 7, 'F'); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(255, 255, 255);
    for (const c of cols) pdf.text(c.k, c.a === 'right' ? c.x + c.w : c.x + 1.5, y + 4.8, { align: c.a });
    y += 7;
  };
  head();
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5);
  for (const [i, it] of d.items.entries()) {
    const desc = pdf.splitTextToSize(clean(it.description), cols[0]!.w - 3) as string[];
    const rowH = Math.max(7, desc.length * 4 + 3);
    if (y + rowH > H - 20) { pdf.addPage(); header(); head(); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); }
    if (i % 2) { pdf.setFillColor(248, 250, 252); pdf.rect(M, y, W - M * 2, rowH, 'F'); }
    color(ink);
    pdf.text(desc, cols[0]!.x + 1.5, y + 4.6, { lineHeightFactor: 1.2 });
    pdf.text(clean(it.hsnCode ?? ''), cols[1]!.x + 1.5, y + 4.6);
    pdf.text(`${Number(it.quantity)} ${clean(it.unit)}`, cols[2]!.x + cols[2]!.w, y + 4.6, { align: 'right' });
    pdf.text(money(it.unitPrice).replace(/^[A-Z]{3} /, ''), cols[3]!.x + cols[3]!.w, y + 4.6, { align: 'right' });
    pdf.text(Number(it.discountPct) ? `${Number(it.discountPct)}%` : '-', cols[4]!.x + cols[4]!.w, y + 4.6, { align: 'right' });
    pdf.text(it.taxPercent !== undefined ? `${Number(it.taxPercent)}%` : '-', cols[5]!.x + cols[5]!.w, y + 4.6, { align: 'right' });
    pdf.text(money(it.lineTotal ?? 0).replace(/^[A-Z]{3} /, ''), cols[6]!.x + cols[6]!.w, y + 4.6, { align: 'right' });
    y += rowH;
  }
  pdf.setDrawColor(226, 232, 240); pdf.line(M, y, W - M, y); y += 6;
  pdf.setFontSize(7.5); color(muted); pdf.text(`Amounts in ${d.currency}.${d.plain ? '' : d.pricesIncludeTax ? ' Rates include tax.' : ' Rates exclude tax.'}`, M, y);

  // totals (keep together)
  const needs = 26 + (d.breakdown?.length ?? 0) * 4.5 + (d.payment ? 12 : 0) + (d.schedule?.length ? 8 + d.schedule.length * 5 : 0) + 34;
  if (y + needs > H - 18) { pdf.addPage(); header(); y += 8; }
  let ty = y;
  const trow = (k: string, v: string, bold = false) => { pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(bold ? 11 : 9); color(bold ? ink : muted); pdf.text(k, W - M - 88, ty, { align: 'left' }); color(ink); pdf.text(v, W - M, ty, { align: 'right' }); ty += bold ? 7 : 5; };
  if (!d.plain) trow('Subtotal', money(d.totals.subtotal));
  if (!d.plain && Number(d.totals.discountTotal) > 0) trow('Discounts included', money(d.totals.discountTotal));
  if (!d.plain) for (const b of d.breakdown ?? []) if (b.percent > 0 || b.tax > 0) trow(`Tax @ ${b.percent}% on ${money(b.taxable).replace(/^[A-Z]{3} /, '')}`, money(b.tax));
  if (!d.plain && !(d.breakdown ?? []).length) trow('Tax', money(d.totals.taxTotal));
  pdf.setDrawColor(...brand); pdf.line(W - M - 88, ty - 2, W - M, ty - 2); ty += 2;
  trow('Total', money(d.totals.total), true);
  if (d.payment) { trow('Paid', money(d.payment.paid)); trow('Balance due', money(d.payment.outstanding), true); }
  y = Math.max(ty, y) + 4;

  if (d.schedule?.length) {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); color(ink); pdf.text('Payment schedule', M, y); y += 5;
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5);
    for (const s of d.schedule) { color(muted); pdf.text(`${clean(s.label)} (${s.percent}%)`, M, y); color(ink); pdf.text(money(s.amount), M + 80, y, { align: 'right' }); y += 5; }
    y += 3;
  }
  const block = (heading: string, text: string | null | undefined) => {
    if (!text?.trim()) return;
    const lines = text.split(/\r?\n/).flatMap((para) => (para.trim() ? (pdf.splitTextToSize(clean(para), W - M * 2) as string[]) : ['']));
    for (const [i, ln] of lines.entries()) {
      if (y > H - 22) { pdf.addPage(); header(); }
      if (i === 0) { pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); color(ink); pdf.text(heading, M, y); y += 4.5; }
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); color(muted); pdf.text(ln, M, y); y += 3.8;
    }
    y += 3;
  };
  block('Notes', d.notes);
  block('Terms and conditions', d.terms);
  if (d.title.includes('INVOICE')) block('Bank details', o.invoiceSettings.bankDetails);
  if (o.invoiceSettings.showSignatureBlock !== false && d.signLabels) {
    if (y > H - 38) { pdf.addPage(); header(); }
    y += 10; pdf.setDrawColor(148, 163, 184); pdf.line(M, y, M + 60, y); pdf.line(W - M - 60, y, W - M, y);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); color(muted); pdf.text(d.signLabels[0], M, y + 4); pdf.text(d.signLabels[1], W - M - 60, y + 4);
  }

  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p); footer(p, pages);
    if (d.stamp) {
      const GState = (pdf as unknown as { GState: new (o: { opacity: number }) => never }).GState;
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(70); pdf.setTextColor(220, 38, 38);
      pdf.setGState(new GState({ opacity: 0.12 })); pdf.text(d.stamp, W / 2, H / 2, { align: 'center', angle: 35 }); pdf.setGState(new GState({ opacity: 1 }));
    }
  }
  downloadBlob(fileName, pdf.output('blob'));
}

const addrLines = (a: { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; country?: string | null } | null | undefined) =>
  a ? [a.line1, a.line2, [a.city, a.state, a.postalCode].filter(Boolean).join(', '), a.country].filter((x): x is string => !!x) : [];
/** Date-only fields are UTC midnight (see dateUtc); real timestamps (created, paid) pass utc=false. */
const date = (iso: string | null | undefined, locale: string, utc = true) => (iso ? new Date(iso).toLocaleDateString(locale, { dateStyle: 'medium', ...(utc ? { timeZone: 'UTC' } : {}) }) : '-');

export async function quotationPdf(q: QuotationRow, o: CommercialOptions, logoUrl: string | null | undefined) {
  const a = q.customer.addresses?.find((x) => x.isDefault) ?? q.customer.addresses?.[0];
  await render(o, logoUrl, {
    title: 'QUOTATION', number: `${q.number}${q.revision > 1 ? ` (Rev ${q.revision})` : ''}`,
    meta: [['Date', date(q.createdAt, o.locale, false)], ['Valid until', q.validUntil ? date(q.validUntil, o.locale) : 'Not specified'], ['Status', q.status.replace(/_/g, ' ')]],
    billTo: { heading: 'Prepared for', name: q.customer.name, lines: [...addrLines(a), q.customer.phone ?? '', q.customer.email ?? '', q.customer.taxId ? `Tax ID: ${q.customer.taxId}` : ''] },
    items: q.items, totals: q, breakdown: q.taxSnapshot.breakdown, currency: q.currency, locale: o.locale, pricesIncludeTax: q.pricesIncludeTax,
    intro: q.title, notes: q.notes, terms: q.terms || o.invoiceSettings.termsAndConditions, stamp: q.status === 'DRAFT' ? 'DRAFT' : q.status === 'EXPIRED' || q.status === 'REJECTED' ? q.status : undefined,
    signLabels: ['Authorised signatory', 'Customer acceptance'],
    footerExtra: 'Quantities are based on a preliminary design; final quantities are confirmed after site survey.',
  }, `${safe(q.number)}${q.revision > 1 ? `-R${q.revision}` : ''}.pdf`);
}

export async function invoicePdf(i: InvoiceRow, o: CommercialOptions, logoUrl: string | null | undefined) {
  const snap = i.customerSnapshot?.name ? i.customerSnapshot : null;
  const c = snap ?? { name: i.customer.name, taxId: i.customer.taxId, email: i.customer.email, phone: i.customer.phone, address: null };
  const type = i.type as InvoiceType;
  await render(o, logoUrl, {
    title: (INVOICE_TYPE_LABELS[type] ?? 'Invoice').toUpperCase(), number: i.number ?? 'DRAFT (no number yet)',
    meta: [['Issue date', date(i.issueDate, o.locale)], ['Due date', date(i.dueDate, o.locale)], ...(i.contract ? [['Contract', i.contract.number] as [string, string]] : []), ...(i.quotation ? [['Quotation', i.quotation.number] as [string, string]] : [])],
    billTo: { heading: 'Bill to', name: c.name ?? '', lines: [...addrLines(c.address), c.phone ?? '', c.email ?? '', c.taxId ? `Tax ID: ${c.taxId}` : ''] },
    items: i.items, totals: i, breakdown: i.taxSnapshot.breakdown, currency: i.currency, locale: o.locale, pricesIncludeTax: i.pricesIncludeTax,
    notes: i.notes, terms: o.invoiceSettings.termsAndConditions, payment: i.type === 'PROFORMA' || i.status === 'DRAFT' ? undefined : { paid: i.amountPaid, outstanding: i.outstanding },
    stamp: i.status === 'VOID' ? 'VOID' : i.status === 'DRAFT' ? 'DRAFT' : i.status === 'PAID' ? 'PAID' : undefined,
    signLabels: ['Authorised signatory', 'Received by'],
    footerExtra: i.type === 'PROFORMA' ? 'A proforma invoice is not a demand for payment and is not a tax invoice.' : undefined,
  }, `${safe(i.number ?? `draft-${i.id.slice(0, 8)}`)}.pdf`);
}

export async function contractPdf(c: ContractRow, o: CommercialOptions, logoUrl: string | null | undefined, customer: { name: string; lines: string[] }) {
  const value = Number(c.value);
  await render(o, logoUrl, {
    title: 'CONTRACT', number: c.number,
    meta: [['Quotation', `${c.quotation.number}${c.quotation.revision > 1 ? ` R${c.quotation.revision}` : ''}`], ['Start', date(c.startDate, o.locale)], ['Completion', date(c.completionDate, o.locale)], ['Status', c.status]],
    billTo: { heading: 'Customer', name: customer.name, lines: customer.lines },
    items: [{ equipmentId: null, description: c.title, unit: 'lot', quantity: '1', unitPrice: c.value, discountPct: '0', taxRateCode: null, hsnCode: null, lineTotal: c.value }],
    totals: { subtotal: c.value, discountTotal: '0', taxTotal: '0', total: c.value }, breakdown: [], currency: c.currency, locale: o.locale, pricesIncludeTax: true, plain: true,
    intro: 'Contract value is the total of the accepted quotation, inclusive of applicable taxes as itemised in that quotation.',
    schedule: c.paymentSchedule.map((m) => ({ ...m, amount: (Math.round(value * m.percent) / 100).toFixed(2) })),
    terms: c.terms, stamp: c.status === 'DRAFT' ? 'DRAFT' : c.status === 'CANCELLED' ? 'CANCELLED' : undefined, signLabels: ['For the company', 'For the customer'],
  }, `${safe(c.number)}.pdf`);
}

export async function receiptPdf(p: PaymentRow, inv: Pick<InvoiceRow, 'number' | 'total' | 'amountPaid' | 'outstanding' | 'currency'>, customerName: string, o: CommercialOptions, logoUrl: string | null | undefined) {
  await render(o, logoUrl, {
    title: 'PAYMENT RECEIPT', number: p.receiptNumber,
    meta: [['Date', date(p.paidAt, o.locale, false)], ['Method', p.method.replace(/_/g, ' ')], ['Reference', p.reference ?? '-'], ['Invoice', inv.number ?? '-']],
    billTo: { heading: 'Received from', name: customerName, lines: [] },
    items: [{ equipmentId: null, description: `Payment against invoice ${inv.number ?? ''}${p.notes ? ` (${p.notes})` : ''}`, unit: '', quantity: '1', unitPrice: p.amount, discountPct: '0', taxRateCode: null, hsnCode: null, lineTotal: p.amount }],
    totals: { subtotal: p.amount, discountTotal: '0', taxTotal: '0', total: p.amount }, breakdown: [], currency: inv.currency, locale: o.locale, pricesIncludeTax: true, plain: true,
    payment: { paid: inv.amountPaid, outstanding: inv.outstanding },
    intro: 'Total shown is the amount received. Balance reflects all payments recorded against the invoice at the time of printing.',
    stamp: p.voidedAt ? 'VOID' : undefined, signLabels: ['Received by', ''],
  }, `${safe(p.receiptNumber)}.pdf`);
}
