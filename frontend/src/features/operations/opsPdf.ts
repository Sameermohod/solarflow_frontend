import { jsPDF } from 'jspdf';
import { downloadBlob } from '@/features/design/exporters';
import { loadImage } from '@/features/commercial/proposalPdf';
import type { CommercialOptions } from '@/features/commercial/api';

/** Letterhead-style PDFs for approved text documents and for report tables. Latin text only (jsPDF built-in fonts). */
type RGB = [number, number, number];
const hex = (h: string): RGB => { const m = /^#?([0-9a-f]{6})$/i.exec(h); const v = m ? parseInt(m[1]!, 16) : 0x0f2a43; return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const clean = (s: string | null | undefined) => (s ?? '').replace(/[^\x20-\x7E\n\r -ÿ–—•‘’“”]/g, '?');
const safe = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'document';

async function letterhead(pdf: jsPDF, o: CommercialOptions, logoUrl: string | null | undefined) {
  const W = 210, M = 18;
  const brand = hex(o.primaryColor);
  const logo = await loadImage(logoUrl);
  pdf.setFillColor(...brand); pdf.rect(0, 0, W, 4, 'F');
  let x = M;
  if (logo) { const hh = 14; const ww = Math.min(40, (logo.w / logo.h) * hh); pdf.addImage(logo.data, logo.fmt, M, 9, ww, hh); x = M + ww + 4; }
  pdf.setTextColor(30, 41, 59); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(logo ? 12 : 15); pdf.text(clean(o.legalName || o.name), x, 15);
  const a = o.address ?? {};
  const lines = [[a.line1, a.city, a.state, a.postalCode].filter(Boolean).join(', '), [o.phone, o.email].filter(Boolean).join('  |  ')].filter(Boolean);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(100, 116, 139); pdf.text(lines.map(clean), x, 20, { lineHeightFactor: 1.4 });
  pdf.setDrawColor(226, 232, 240); pdf.line(M, 32, W - M, 32);
}

export interface DocPdfInput { number: string; title: string; version: number; status: string; approvedAt?: string | null; content: string }

export async function documentPdf(d: DocPdfInput, o: CommercialOptions, logoUrl: string | null | undefined) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, H = 297, M = 18;
  const draft = d.status !== 'APPROVED';
  const header = async () => letterhead(pdf, o, logoUrl);
  await header();
  let y = 42;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(30, 41, 59);
  for (const l of pdf.splitTextToSize(clean(d.title), W - 2 * M) as string[]) { pdf.text(l, M, y); y += 7; }
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(100, 116, 139);
  pdf.text(`${clean(d.number)}  |  version ${d.version}  |  ${d.status.replace(/_/g, ' ').toLowerCase()}${d.approvedAt ? `  |  approved ${new Date(d.approvedAt).toLocaleDateString(o.locale, { dateStyle: 'medium' })}` : ''}`, M, y); y += 9;
  pdf.setFontSize(10.5); pdf.setTextColor(30, 41, 59);
  const lh = 10.5 * 0.3528 * 1.5;
  for (const block of clean(d.content).split(/\r?\n/)) {
    if (!block.trim()) { y += lh * 0.7; continue; }
    for (const l of pdf.splitTextToSize(block, W - 2 * M) as string[]) {
      if (y > H - 22) { pdf.addPage(); await header(); y = 42; pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10.5); pdf.setTextColor(30, 41, 59); }
      pdf.text(l, M, y); y += lh;
    }
  }
  const n = pdf.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i);
    if (draft) { pdf.setTextColor(226, 232, 240); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(60); pdf.text(d.status === 'REJECTED' ? 'REJECTED' : 'DRAFT', W / 2, H / 2, { align: 'center', angle: 35 }); }
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(100, 116, 139); pdf.text(`${clean(d.number)}  |  Page ${i} of ${n}`, W - M, H - 8, { align: 'right' });
  }
  downloadBlob(`${safe(d.number)}-${safe(d.title)}.pdf`, pdf.output('blob'));
}

/** A simple titled table report (landscape) for the Reports page. */
export async function reportPdf(title: string, subtitle: string, sections: { heading: string; head: string[]; rows: (string | number)[][] }[], o: CommercialOptions, logoUrl: string | null | undefined) {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = 297, H = 210, M = 14;
  const brand = hex(o.primaryColor);
  const logo = await loadImage(logoUrl);
  const top = () => {
    pdf.setFillColor(...brand); pdf.rect(0, 0, W, 4, 'F');
    if (logo) { const hh = 12; pdf.addImage(logo.data, logo.fmt, M, 8, Math.min(36, (logo.w / logo.h) * hh), hh); }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.setTextColor(30, 41, 59); pdf.text(clean(title), W - M, 15, { align: 'right' });
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(100, 116, 139); pdf.text(clean(`${o.name}  |  ${subtitle}`), W - M, 21, { align: 'right' });
  };
  top(); let y = 30;
  for (const s of sections) {
    if (y > H - 30) { pdf.addPage(); top(); y = 30; }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(30, 41, 59); pdf.text(clean(s.heading), M, y); y += 5;
    const colW = (W - 2 * M) / s.head.length;
    const row = (cells: (string | number)[], bold: boolean, fill: boolean) => {
      if (fill) { pdf.setFillColor(241, 245, 249); pdf.rect(M, y - 4, W - 2 * M, 6.5, 'F'); }
      pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(9); pdf.setTextColor(30, 41, 59);
      cells.forEach((c, i) => { const t = clean(String(c)); const right = i > 0 && /^[-\d.,\s%A-Z]*$/.test(t) && /\d/.test(t); pdf.text(pdf.splitTextToSize(t, colW - 3)[0] as string, right ? M + colW * (i + 1) - 2 : M + colW * i + 1, y, { align: right ? 'right' : 'left' }); });
      y += 6.5;
    };
    row(s.head, true, true);
    s.rows.forEach((r, i) => { if (y > H - 14) { pdf.addPage(); top(); y = 30; row(s.head, true, true); } row(r, false, i % 2 === 1); });
    y += 6;
  }
  downloadBlob(`${safe(title)}.pdf`, pdf.output('blob'));
}
