import { jsPDF } from 'jspdf';
import { fillCustomer, type ProposalProfile, type SavingsResult } from '@solarflow/shared';
import { downloadBlob } from '@/features/design/exporters';
import type { CatalogueRow, CommercialOptions, QuotationRow } from './api';

/**
 * Multi-page customer proposal built from the quotation (customer, price, items, dates) and the company's proposal
 * profile (letters, about us, highlight pages, scope, terms, client list, brand logos). Pages whose content is empty
 * are skipped. jsPDF's built-in fonts cover Latin text only (documented in the README).
 */
type RGB = [number, number, number];
const hex = (h: string): RGB => { const m = /^#?([0-9a-f]{6})$/i.exec(h); const v = m ? parseInt(m[1]!, 16) : 0x0f2a43; return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const clean = (s: string | null | undefined) => (s ?? '').replace(/[^\x20-\x7E\n\r -ÿ–—•‘’“”]/g, '?');
const safe = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'proposal';
const WHITE: RGB = [255, 255, 255]; const INK: RGB = [30, 41, 59]; const MUTED: RGB = [100, 116, 139];

export interface ProposalOptions {
  proposalNo: string;
  systemKw: number;
  structureType: string;
  inverterDetails: string;
  /** Subsidy deducted from the total to give the net effective cost (0 = none). */
  subsidy: number;
  projectAddress: string;
  location: { lat: number; lon: number } | null;
  /** Pre-fetched satellite pictures (data URLs) for the location page. */
  mapOverview: string | null;
  mapDetail: string | null;
  savings: SavingsResult | null;
  tariffPerKwh: number | null;
  /** Extra paragraph under the welcome letter, specific to this proposal. */
  personalNote: string;
}

export interface ProposalData {
  quote: QuotationRow;
  options: CommercialOptions;
  profile: ProposalProfile;
  logoUrl: string | null | undefined;
  catalogue: CatalogueRow[];
  opts: ProposalOptions;
}

export async function loadImage(src: string | null | undefined): Promise<{ data: string; fmt: 'PNG' | 'JPEG'; w: number; h: number } | null> {
  if (!src) return null;
  try {
    let data = src;
    let type = /^data:image\/(png|jpeg)/.exec(src)?.[1];
    if (!src.startsWith('data:')) {
      const blob = await (await fetch(src)).blob();
      type = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpeg' : undefined;
      if (!type) return null;
      data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob); });
    }
    if (!type) return null;
    const dim = await new Promise<{ w: number; h: number }>((res, rej) => { const i = new Image(); i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = rej; i.src = data; });
    return { data, fmt: type === 'png' ? 'PNG' : 'JPEG', ...dim };
  } catch { return null; }
}

type Img = NonNullable<Awaited<ReturnType<typeof loadImage>>>;
const dateText = (iso: string | null | undefined, locale: string, utc = true) => (iso ? new Date(iso).toLocaleDateString(locale, { dateStyle: 'long', ...(utc ? { timeZone: 'UTC' } : {}) }) : '');

/** Esri World Imagery picture centred on a point, `groundM` metres wide. Used for the location page; null when it cannot be fetched. */
export async function fetchSatelliteImage(lat: number, lon: number, groundM: number, px = [900, 640] as [number, number]): Promise<string | null> {
  try {
    const R = 6378137;
    const mx = R * (lon * Math.PI) / 180; const my = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const half = groundM / Math.cos((lat * Math.PI) / 180) / 2; const halfH = half * (px[1] / px[0]);
    const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${mx - half},${my - halfH},${mx + half},${my + halfH}&bboxSR=3857&imageSR=3857&size=${px[0]},${px[1]}&format=jpg&f=image`;
    const r = await fetch(url);
    if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image')) return null;
    const blob = await r.blob();
    return await new Promise<string>((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result)); f.onerror = rej; f.readAsDataURL(blob); });
  } catch { return null; }
}

export async function renderProposal(d: ProposalData): Promise<jsPDF> {
  const { quote: q, options: o, profile: p, opts } = d;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, H = 297, M = 16;
  const navy = hex(o.primaryColor), accent = hex(o.accentColor);
  const company = clean(o.legalName || o.name);
  const customer = clean(q.customer.name);
  const fmt2 = new Intl.NumberFormat(o.locale, { style: 'currency', currency: q.currency, currencyDisplay: 'code', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt0 = new Intl.NumberFormat(o.locale, { style: 'currency', currency: q.currency, currencyDisplay: 'code', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const money2 = (v: number | string) => fmt2.format(Number(v)).replace(/ /g, ' ');
  const money0 = (v: number | string) => fmt0.format(Number(v)).replace(/ /g, ' ');
  const logo = await loadImage(d.logoUrl);
  const [cover, welcomeImg, closingImg, dirPhoto] = await Promise.all([loadImage(p.coverImage), loadImage(p.welcomeImage), loadImage(p.closingImage), loadImage(p.directorPhoto)]);
  const brandImgs = await Promise.all(p.brandLogos.map(async (b) => ({ name: b.name, img: await loadImage(b.image) })));
  const mapOverview = await loadImage(opts.mapOverview); const mapDetail = await loadImage(opts.mapDetail);
  const cat = new Map(d.catalogue.map((c) => [c.id, c]));

  let y = 0;
  const tc = (c: RGB) => pdf.setTextColor(c[0], c[1], c[2]);
  const fc = (c: RGB) => pdf.setFillColor(c[0], c[1], c[2]);
  const poly = (pts: [number, number][], c: RGB) => { fc(c); const [x0, y0] = pts[0]!; pdf.lines(pts.slice(1).map((pt, i) => [pt[0] - pts[i]![0], pt[1] - pts[i]![1]]), x0, y0, [1, 1], 'F', true); };
  const fit = (img: Img, x: number, yy: number, w: number, h: number, align: 'center' | 'left' = 'center') => {
    const k = Math.min(w / img.w, h / img.h); const iw = img.w * k; const ih = img.h * k;
    pdf.addImage(img.data, img.fmt, align === 'center' ? x + (w - iw) / 2 : x, yy + (h - ih) / 2, iw, ih, undefined, 'FAST');
  };
  const cover_ = (img: Img, x: number, yy: number, w: number, h: number) => {
    // fill the box, cropping with a clip so the picture is not distorted
    const k = Math.max(w / img.w, h / img.h); const iw = img.w * k; const ih = img.h * k;
    pdf.saveGraphicsState(); pdf.rect(x, yy, w, h, null); pdf.clip(); pdf.discardPath();
    pdf.addImage(img.data, img.fmt, x + (w - iw) / 2, yy + (h - ih) / 2, iw, ih, undefined, 'FAST');
    pdf.restoreGraphicsState();
  };
  const para = (text: string, x: number, yy: number, w: number, size = 10.5, c: RGB = INK, bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); tc(c);
    const lh = size * 0.3528 * 1.5; let cy = yy;
    for (const block of clean(text).split(/\r?\n/)) {
      if (block.trim() === '') { cy += lh * 0.6; continue; }
      for (const l of pdf.splitTextToSize(block, w) as string[]) { pdf.text(l, x, cy); cy += lh; }
    }
    return cy;
  };
  const logoTopRight = () => { if (logo) fit(logo, W - M - 46, 7, 46, 16); else { pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); tc(navy); pdf.text(company, W - M, 15, { align: 'right' }); } };

  const newPage = (title: string) => {
    pdf.addPage();
    logoTopRight();
    poly([[0, 30], [138, 30], [126, 58], [0, 58]], navy);
    poly([[142, 30], [160, 30], [148, 58], [130, 58]], accent);
    fc(WHITE); pdf.rect(M - 2, 38, 8, 8, 'F');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(title.length > 26 ? 18 : 22); tc(WHITE); pdf.text(clean(title), M + 10, 46);
    y = 74;
  };
  const room = (need: number, title: string) => { if (y + need > H - 18) newPage(`${title} (cont.)`); };

  /* ------------------------------------------------------------------ cover */
  if (cover) cover_(cover, 98, 112, 112, 150);
  poly([[0, 56], [183, 56], [152, 118], [112, 190], [112, 236], [0, 236]], navy);
  poly([[34, 192], [140, 192], [88, 274], [34, 274]], accent);
  if (logo) fit(logo, W - M - 60, 10, 60, 24); else { pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); tc(navy); pdf.text(company, W - M, 22, { align: 'right' }); }
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); tc(INK);
  pdf.text(dateText(q.createdAt, o.locale, false), M, 40); pdf.text(clean(opts.proposalNo), M, 47);
  const kw = Number.isInteger(opts.systemKw) ? String(opts.systemKw) : String(Math.round(opts.systemKw * 100) / 100);
  pdf.setFontSize(38); tc(WHITE); pdf.text(`${kw} kW`, M, 90); pdf.text('Solar Proposal', M, 108);
  let cy = para('For,', M, 134, 90, 12, WHITE, true);
  const a = q.customer.addresses?.find((x) => x.isDefault) ?? q.customer.addresses?.[0];
  cy = para([customer, q.customer.phone ?? '', opts.projectAddress || [a?.city, a?.state].filter(Boolean).join(', ')].filter(Boolean).join('\n'), M, cy, 90, 12, WHITE, true);
  cy = para('By,', M, cy + 8, 90, 12, WHITE, true);
  para([company, o.phone ?? ''].filter(Boolean).join('\n'), M, cy, 90, 12, WHITE, true);

  /* ------------------------------------------------------------------ welcome */
  if (p.welcomeLetter.trim() || opts.personalNote.trim()) {
    newPage('Welcome');
    y = para(`Dear ${customer},`, M, y + 4, W - 2 * M, 11);
    y += 3;
    if (p.welcomeLetter.trim()) y = para(fillCustomer(p.welcomeLetter, customer), M, y, W - 2 * M, 11);
    if (opts.personalNote.trim()) { y += 4; y = para(opts.personalNote, M, y, W - 2 * M, 11); }
    y = para(`\nThanks & Regards,\n${company}\n${o.phone ?? ''}`, M, y + 6, W - 2 * M, 11);
    if (welcomeImg) fit(welcomeImg, M, Math.min(y + 8, 200), W - 2 * M, Math.max(40, H - 20 - Math.min(y + 8, 200)));
  }

  /* ------------------------------------------------------------------ about us */
  if (p.aboutUs.trim() || p.directorMessage.trim()) {
    newPage('About Us');
    if (p.aboutUs.trim()) y = para(p.aboutUs, M, y, W - 2 * M, 10.5);
    if (p.directorMessage.trim()) {
      y += 8;
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); tc(INK); pdf.text('Director’s Message', M, y); y += 7;
      const tw = dirPhoto ? W - 2 * M - 62 : W - 2 * M;
      const yy0 = y;
      let ey = para(p.directorMessage, M, y, tw, 10.5);
      if (p.directorName) { ey += 3; ey = para([p.directorName, p.directorTitle].filter(Boolean).join('\n'), M, ey, tw, 10.5); }
      if (dirPhoto) { fit(dirPhoto, W - M - 52, yy0, 52, 52); }
      y = Math.max(ey, yy0 + (dirPhoto ? 56 : 0));
    }
  }

  /* ------------------------------------------------------------------ highlight pages */
  for (const h of p.highlights) {
    newPage(h.title);
    const hasImg = !!h.image;
    const img = hasImg ? await loadImage(h.image) : null;
    const lines = clean(h.body).split(/\r?\n/);
    for (const line of lines) {
      room(10, h.title);
      const b = /^\s*[-•*]\s+/.test(line);
      if (line.trim() === '') { y += 3; continue; }
      y = para(b ? `• ${line.replace(/^\s*[-•*]\s+/, '')}` : line, b ? M + 3 : M, y, W - 2 * M - (b ? 3 : 0), 10.5) + 0.6;
    }
    if (img) { const room2 = H - 20 - (y + 6); if (room2 > 30) fit(img, M, y + 6, W - 2 * M, Math.min(room2, 110)); }
  }

  /* ------------------------------------------------------------------ specification */
  newPage(`${kw} kW Specification`);
  const tiles: [string, string][] = [['Plant Capacity', `${kw} kW`], ['Structure Type', clean(opts.structureType)], ['Inverter Details', clean(opts.inverterDetails)]];
  tiles.forEach(([k, v], i) => {
    const x = M + i * 61;
    pdf.setDrawColor(226, 232, 240); pdf.roundedRect(x, y, 56, 30, 3, 3, 'S');
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); tc(MUTED); pdf.text(k, x + 28, y + 11, { align: 'center' });
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); tc(INK); pdf.text(pdf.splitTextToSize(v, 50) as string[], x + 28, y + 21, { align: 'center' });
  });
  y += 42;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); tc(INK); pdf.text('Project Location', W / 2, y, { align: 'center' }); y += 6;
  if (opts.projectAddress) { y = para(opts.projectAddress, M, y + 2, W - 2 * M, 10.5, MUTED) ; }
  if (opts.location) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); tc(MUTED); pdf.text(`Coordinates: ${opts.location.lat.toFixed(5)}, ${opts.location.lon.toFixed(5)}`, M, y + 2); y += 8; }
  const pin = (x: number, yy: number) => { pdf.setFillColor(220, 38, 38); pdf.setDrawColor(255, 255, 255); pdf.setLineWidth(0.6); pdf.circle(x, yy, 2.2, 'FD'); };
  if (mapOverview || mapDetail) {
    const iw = 86; const ih = 61;
    if (mapOverview) { fit(mapOverview, M, y, iw, ih); pin(M + iw / 2, y + ih / 2); pdf.setFontSize(8); tc(MUTED); pdf.text('Wide view', M + iw / 2, y + ih + 4, { align: 'center' }); }
    if (mapDetail) { fit(mapDetail, W - M - iw, y, iw, ih); pin(W - M - iw / 2, y + ih / 2); pdf.setFontSize(8); tc(MUTED); pdf.text('Site view', W - M - iw / 2, y + ih + 4, { align: 'center' }); }
    pdf.setFontSize(7.5); tc(MUTED); pdf.text('Imagery © Esri, Maxar, Earthstar Geographics and the GIS user community.', M, y + ih + 9);
    y += ih + 14;
  } else if (!opts.location) { y = para('Location map not included (no site location was set for this design).', M, y + 2, W - 2 * M, 9.5, MUTED); }

  /* ------------------------------------------------------------------ savings */
  if (opts.savings) {
    const s = opts.savings;
    newPage('Savings & Payback Period');
    const net = Number(q.total) - opts.subsidy;
    const items: [string, string][] = [
      ['Payback Period', s.paybackYears === null ? 'n/a' : `${s.paybackYears.toFixed(1)} Years`],
      ['Average Yearly Generation', `${Math.round(s.annualKwh).toLocaleString(o.locale)} Units`],
      ['Average Annual Savings', money0(s.annualSavings)],
      ['Project Cost', money0(net)],
      ['Trees Saved', String(s.trees)],
      ['CO2 Reduction', `${s.co2Tonnes.toFixed(1)} Tonnes`],
    ];
    items.forEach(([k, v], i) => {
      const x = M + (i % 3) * 61; const yy = y + Math.floor(i / 3) * 38;
      pdf.setDrawColor(226, 232, 240); pdf.roundedRect(x, yy, 56, 32, 3, 3, 'S');
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); tc(MUTED); pdf.text(k, x + 28, yy + 10, { align: 'center' });
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(v.length > 14 ? 11 : 14); tc(accent); pdf.text(v, x + 28, yy + 22, { align: 'center' });
    });
    y += 84;
    // monthly savings chart
    const cx0 = M + 14, cx1 = W - M, cy0 = y + 8, cy1 = y + 96;
    const max = Math.max(...s.monthlySavings); const step = niceStep(max / 5);
    const top = Math.ceil(max / step) * step;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); tc(INK); pdf.text('Monthly Savings', (cx0 + cx1) / 2, y + 3, { align: 'center' });
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setDrawColor(226, 232, 240); pdf.setLineWidth(0.2);
    for (let v = 0; v <= top + 1e-9; v += step) { const gy = cy1 - (v / top) * (cy1 - cy0); pdf.line(cx0, gy, cx1, gy); tc(MUTED); pdf.text(Math.round(v).toLocaleString(o.locale), cx0 - 2, gy + 1, { align: 'right' }); }
    const bw = (cx1 - cx0) / 12;
    s.monthlySavings.forEach((v, i) => {
      const bh = (v / top) * (cy1 - cy0); fc(accent); pdf.rect(cx0 + i * bw + bw * 0.15, cy1 - bh, bw * 0.7, bh, 'F');
      tc(MUTED); pdf.text(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i]!, cx0 + i * bw + bw / 2, cy1 + 5, { align: 'center' });
    });
    y = cy1 + 14;
    para(`Estimate for the first year: system size x site peak sun hours x days x performance ratio (${(s.performanceRatio * 100).toFixed(1)} %), valued at a flat ${opts.tariffPerKwh ? money2(opts.tariffPerKwh) : ''} per unit. It ignores panel degradation and tariff changes; actual results depend on weather, shading and usage. Payback is measured against the net cost${opts.subsidy > 0 ? ' after subsidy' : ''}.`, M, y, W - 2 * M, 8.5, MUTED);
  }

  /* ------------------------------------------------------------------ commercial offer */
  newPage('Commercial Offer');
  y = para(`${kw} kW Solar PV Plant System Cost:`, M, y, W - 2 * M, 11);
  y += 2;
  const taxable = Number(q.total) - Number(q.taxTotal);
  const rows: [string, string, boolean][] = [['System Cost', money2(taxable), false]];
  const bd = q.taxSnapshot.breakdown ?? [];
  if (bd.length) for (const b of bd) rows.push([`${q.taxSnapshot.regime || 'Tax'} (${b.percent} %)`, money2(b.tax), false]);
  else if (Number(q.taxTotal) > 0) rows.push([q.taxSnapshot.regime || 'Tax', money2(q.taxTotal), false]);
  rows.push(['Total Project Cost', money2(q.total), true]);
  if (opts.subsidy > 0) { rows.push(['Subsidy', money2(opts.subsidy), false]); rows.push(['Net Effective Cost', money2(Number(q.total) - opts.subsidy), true]); }
  fc(INK); pdf.rect(M, y, W - 2 * M, 9, 'F'); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10.5); tc(WHITE); pdf.text('Description', M + 3, y + 6); pdf.text('Amount', W - M - 3, y + 6, { align: 'right' }); y += 9;
  rows.forEach(([k, v, b], i) => {
    if (i % 2 === 0) { pdf.setFillColor(244, 244, 245); pdf.rect(M, y, W - 2 * M, 9, 'F'); }
    pdf.setFont('helvetica', b ? 'bold' : 'normal'); pdf.setFontSize(10.5); tc(b ? INK : MUTED); pdf.text(clean(k), M + 3, y + 6); pdf.text(clean(v), W - M - 3, y + 6, { align: 'right' }); y += 9;
  });
  if (q.pricesIncludeTax) y = para('Prices include tax.', M, y + 4, W - 2 * M, 9, MUTED);
  if (q.validUntil) y = para(`This offer is valid until ${dateText(q.validUntil, o.locale)}.`, M, y + 4, W - 2 * M, 10);
  const pay = p.paymentTerms;
  if (pay.length) { y += 6; pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); tc(INK); pdf.text('Payment Terms:', M, y); y += 6; pay.forEach((t, i) => { y = para(`${i + 1}) ${t}`, M, y, W - 2 * M, 10); }); }
  const bank = o.invoiceSettings.bankDetails?.trim();
  if (bank || o.taxId) {
    y += 8; room(40, 'Commercial Offer');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); tc(INK); pdf.text('Account Details:', M, y); y += 6;
    if (bank) y = para(bank, M, y, W - 2 * M, 10);
    if (o.taxId) y = para(`Tax ID: ${o.taxId}`, M, y, W - 2 * M, 10);
  }

  /* ------------------------------------------------------------------ bill of materials */
  newPage('Bill of Materials');
  const withCat = q.items.map((it) => ({ it, c: it.equipmentId ? cat.get(it.equipmentId) : undefined }));
  const panels = withCat.filter((x) => x.c?.category === 'SOLAR_PANEL'); const inverters = withCat.filter((x) => x.c?.category === 'INVERTER');
  const qtySum = (a: typeof withCat) => a.reduce((s, x) => s + Number(x.it.quantity), 0);
  const brands = (a: typeof withCat) => [...new Set(a.map((x) => x.c!.manufacturer).filter(Boolean))].join(' / ');
  const section = (title: string) => { room(14, 'Bill of Materials'); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); tc(accent); pdf.text(title, M, y); y += 6; };
  const kv = (pairs: [string, string][]) => { room(8 * Math.ceil(pairs.length / 2), 'Bill of Materials'); pairs.forEach(([k, v], i) => { const x = M + (i % 2) * 92; const yy = y + Math.floor(i / 2) * 7; pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); tc(INK); pdf.text(`${clean(k)}: `, x, yy); pdf.setFont('helvetica', 'bold'); pdf.text(clean(v), x + pdf.getTextWidth(`${clean(k)}: `), yy); }); y += Math.ceil(pairs.length / 2) * 7 + 2; };
  const showLogos = (names: string[]) => {
    const m = brandImgs.filter((b) => b.img && names.some((n) => n.toLowerCase().includes(b.name.toLowerCase())));
    if (!m.length) return;
    room(24, 'Bill of Materials'); m.forEach((b, i) => fit(b.img!, M + i * 48, y, 42, 16)); y += 20;
  };
  if (panels.length) {
    section('Panel');
    const wp = panels[0]!.c!.wattageW ? `${Number(panels[0]!.c!.wattageW)} Wp` : '';
    kv([...(wp ? [['Watt Peak', wp] as [string, string]] : []), ['Panel Qty', `${qtySum(panels)} Nos.`], ['Panel Brand', brands(panels) || '-']]);
    showLogos(panels.map((x) => x.c!.manufacturer)); pdf.setDrawColor(30, 41, 59); pdf.setLineWidth(0.6); pdf.line(M, y, W - M, y); y += 6;
  }
  if (inverters.length) {
    section('Inverter');
    const kwv = inverters[0]!.c!.wattageW ? `${Number(inverters[0]!.c!.wattageW) / 1000} kW` : '';
    kv([...(kwv ? [['Inverter Size', kwv] as [string, string]] : []), ['Qty', `${qtySum(inverters)} Nos.`], ['Brand', brands(inverters) || '-']]);
    showLogos(inverters.map((x) => x.c!.manufacturer)); pdf.setDrawColor(30, 41, 59); pdf.setLineWidth(0.6); pdf.line(M, y, W - M, y); y += 6;
  }
  const w = p.warranty;
  const panelW = panels[0]?.c?.warrantyYears ?? w.panelYears; const invW = inverters[0]?.c?.warrantyYears ?? w.inverterYears;
  const wl: [string, number | null | undefined][] = [['Panel', panelW], ['Panel Performance', w.performanceYears], ['Inverter', invW], ['Comprehensive Maintenance', w.maintenanceYears]];
  if (wl.some(([, v]) => v != null)) { section('Warranty'); kv(wl.filter(([, v]) => v != null).map(([k, v]) => [k, `${v} Year(s)`] as [string, string])); }
  // every line of the quotation
  section('Items in this quotation');
  const cols = [M, M + 100, M + 130, M + 150]; fc(INK); pdf.rect(M, y, W - 2 * M, 7, 'F'); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); tc(WHITE);
  pdf.text('Description', cols[0]! + 2, y + 5); pdf.text('Qty', cols[1]! + 2, y + 5); pdf.text('Unit', cols[2]! + 2, y + 5); y += 7;
  q.items.forEach((it, i) => {
    const desc = pdf.splitTextToSize(clean(it.description), 96) as string[];
    const hh = Math.max(7, desc.length * 4.2 + 3);
    if (y + hh > H - 18) { newPage('Bill of Materials (cont.)'); }
    if (i % 2 === 0) { pdf.setFillColor(244, 244, 245); pdf.rect(M, y, W - 2 * M, hh, 'F'); }
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); tc(INK); pdf.text(desc, cols[0]! + 2, y + 5); pdf.text(String(Number(it.quantity)), cols[1]! + 2, y + 5); pdf.text(clean(it.unit), cols[2]! + 2, y + 5); y += hh;
  });
  if (p.balanceOfSystem.length) { y += 6; section('Balance of System'); p.balanceOfSystem.forEach((l) => { room(7, 'Bill of Materials'); y = para(l, M, y, W - 2 * M, 10); }); }

  /* ------------------------------------------------------------------ timeline and scope */
  if (p.timeline.length || p.ourScope.length || p.customerScope.length) {
    newPage('Project Timeline');
    if (p.timeline.length) {
      const n = p.timeline.length; const bw = (W - 2 * M - (n - 1) * 4) / n;
      p.timeline.forEach((t, i) => {
        const x = M + i * (bw + 4);
        pdf.setDrawColor(navy[0], navy[1], navy[2]); pdf.setLineWidth(0.6); pdf.roundedRect(x, y, bw, 34, 3, 3, 'S');
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); tc(INK); pdf.text(`${t.days} Days`, x + bw / 2, y + 9, { align: 'center' });
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.text(pdf.splitTextToSize(clean(t.label), bw - 6) as string[], x + bw / 2, y + 16, { align: 'center' });
      });
      pdf.setDrawColor(accent[0], accent[1], accent[2]); pdf.setLineWidth(1.2); pdf.line(M + bw / 2, y + 42, W - M - bw / 2, y + 42);
      p.timeline.forEach((_, i) => { const x = M + i * (bw + 4); fc(i % 2 ? accent : navy); pdf.circle(x + bw / 2, y + 42, 4, 'F'); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); tc(WHITE); pdf.text(String(i + 1), x + bw / 2, y + 43.2, { align: 'center' }); });
      y += 60;
    }
    const list = (title: string, items: string[]) => {
      if (!items.length) return;
      room(16, 'Project Timeline'); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); tc(accent); pdf.text(title, M, y); y += 7;
      items.forEach((l, i) => { room(8, 'Project Timeline'); y = para(`${i + 1}. ${l}`, M, y, W - 2 * M, 10.5) + 0.8; });
      y += 5;
    };
    list('Our Scope', p.ourScope); list('Customer Scope', p.customerScope);
  }

  /* ------------------------------------------------------------------ terms */
  const termsLines = [...p.terms, ...(q.validUntil ? [`Prices quoted are valid until ${dateText(q.validUntil, o.locale)}. After this date a reconfirmation from our office should be taken.`] : [])];
  const extra = [q.terms, q.notes].map((s) => (s ?? '').trim()).filter(Boolean);
  if (termsLines.length || extra.length) {
    newPage('Terms & Conditions');
    termsLines.forEach((l) => { room(10, 'Terms & Conditions'); y = para(`• ${l}`, M, y, W - 2 * M, 10.5) + 1; });
    for (const e of extra) { y += 4; room(12, 'Terms & Conditions'); y = para(e, M, y, W - 2 * M, 10.5); }
  }

  /* ------------------------------------------------------------------ client list */
  if (p.clients.length) {
    newPage('Our Client List');
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); tc(INK); pdf.text(`MAJOR CLIENTS OF ${company.toUpperCase()}:`, W / 2, y, { align: 'center' }); y += 8;
    const head = () => { fc(accent); pdf.rect(M, y, W - 2 * M, 8, 'F'); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9.5); tc(INK); pdf.text('CLIENT NAME / COMPANY NAME', M + 3, y + 5.5); pdf.text('KW', W - M - 3, y + 5.5, { align: 'right' }); y += 8; };
    head();
    for (const c of p.clients) {
      const nm = pdf.splitTextToSize(clean(c.name).toUpperCase(), W - 2 * M - 30) as string[]; const hh = Math.max(7.5, nm.length * 4.2 + 3.5);
      if (y + hh > H - 22) { newPage('Our Client List (cont.)'); head(); }
      pdf.setDrawColor(200, 200, 200); pdf.setLineWidth(0.2); pdf.rect(M, y, W - 2 * M, hh);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); tc(INK); pdf.text(nm, M + 3, y + 5); if (c.kw != null) pdf.text(String(c.kw), W - M - 3, y + 5, { align: 'right' }); y += hh;
    }
    if (p.clientsFootnote) { y += 8; pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); tc(INK); pdf.text(clean(p.clientsFootnote).toUpperCase(), W / 2, y, { align: 'center' }); }
  }

  /* ------------------------------------------------------------------ thank you */
  pdf.addPage(); logoTopRight();
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(26); tc(INK); pdf.text('For Further Queries', M, 60); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(26); pdf.text('Contact Us:', M, 72);
  if (closingImg) cover_(closingImg, 100, 140, 110, 130);
  poly([[0, 85], [175, 85], [140, 150], [100, 215], [100, 232], [0, 232]], navy);
  poly([[58, 204], [118, 204], [84, 256], [58, 256]], accent);
  const ad = o.address ?? {};
  const addr = [ad.line1, ad.line2, [ad.city, ad.state, ad.postalCode].filter(Boolean).join(' '), ad.country].filter(Boolean).join(', ');
  let ty = 104;
  const contact = (label: string, v: string | null | undefined) => { if (!v) return; ty = para(`${label} ${v}`, M, ty, 100, 11.5, WHITE, true) + 5; };
  contact('Address.:', addr); contact('Contact No.:', o.phone); contact('E-Mail:', o.email); contact('Visit Us On:', o.website);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(30); tc(WHITE); pdf.text('Thank', M, 180); pdf.text('You !', M, 194);

  // page numbers on content pages (not the cover)
  const n = pdf.getNumberOfPages();
  for (let i = 2; i <= n; i++) { pdf.setPage(i); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); tc(MUTED); pdf.text(`${company}  |  ${clean(opts.proposalNo)}  |  Page ${i} of ${n}`, W - M, H - 8, { align: 'right' }); }
  return pdf;
}

function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(raw))); const f = raw / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
}

export async function proposalPdf(d: ProposalData) {
  const pdf = await renderProposal(d);
  downloadBlob(`${safe(d.opts.proposalNo || d.quote.number)}-proposal.pdf`, pdf.output('blob'));
}
