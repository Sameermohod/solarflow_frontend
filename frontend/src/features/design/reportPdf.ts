import {
  DAYS_IN_MONTH, MONTH_LABELS, DAY_OF_21ST, renderDesignSvg, shadowPolygons, sunPosition, validateLayout,
  type DesignConfig, type DesignReport,
} from '@solarflow/shared';
import { DISCLAIMER, svgToPngDataUrl } from './exporters';

export interface ReportMeta {
  company: string;
  designName: string;
  customer?: string | null;
  address?: string;
  latitudeDeg: number;
  longitudeDeg?: number;
  version: number;
  screenshot3d?: string | null;
  contact?: string;
  degradationPct: number;
}

const NAVY: [number, number, number] = [0, 82, 128];
const BLUE: [number, number, number] = [0, 136, 176];
const TEAL: [number, number, number] = [0, 193, 200];
const GREY: [number, number, number] = [90, 90, 90];
const num = (n: number, dp = 2) => n.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const int = (n: number) => Math.round(n).toLocaleString('en-IN');
const safe = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'design';

/** Heat colour for solar access: red (poor) → amber → green (full sun). */
export const accessColor = (a: number) => {
  const t = Math.max(0, Math.min(1, (a - 0.6) / 0.4));
  const hue = 8 + t * 112; // 8° red → 120° green
  return `hsl(${hue.toFixed(0)}, 70%, ${(62 - t * 12).toFixed(0)}%)`;
};

/**
 * Multi-page yield and shading report (landscape A4): cover, system metrics, components, monthly production,
 * field segments with solar access, shadow analysis, solar-access map, losses, environmental impact, assumptions.
 * Every number comes from buildReport(); nothing is hard-coded.
 */
export async function exportReportPdf(config: DesignConfig, r: DesignReport, m: ReportMeta) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = 297;
  const H = 210;
  const M = 14;
  let page = 1;
  const date = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const layout = validateLayout(config);

  const footer = () => {
    doc.setDrawColor(200); doc.line(M, H - 16, W - M, H - 16);
    doc.setFontSize(7.5); doc.setTextColor(120); doc.setFont('helvetica', 'normal');
    doc.text(`Generated on ${date}`, M, H - 10.5);
    doc.text(`${m.company}  ·  Page ${page}`, W - M, H - 10.5, { align: 'right' });
    doc.setFontSize(6.5);
    doc.text(doc.splitTextToSize(DISCLAIMER, W - M * 2).slice(0, 2), M, H - 6.5);
    doc.setTextColor(0);
  };
  const next = () => { footer(); doc.addPage(); page++; };
  const title = (t: string) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(24); doc.setTextColor(...NAVY); doc.text(t, M, 26); doc.setTextColor(0); };
  const img = async (svg: string, x: number, y: number, maxW: number, maxH: number) => {
    const p = await svgToPngDataUrl(svg, 1300);
    const k = Math.min(maxW / p.width, maxH / p.height);
    doc.addImage(p.dataUrl, 'PNG', x + (maxW - p.width * k) / 2, y, p.width * k, p.height * k, undefined, 'FAST');
  };
  const tile = (x: number, y: number, w: number, h: number, label: string, value: string, unit: string, fill: [number, number, number]) => {
    doc.setFillColor(...fill); doc.roundedRect(x, y, w, h, 2, 2, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(label, x + w / 2, y + 11, { align: 'center' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.text(value, x + w / 2, y + 28, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text(unit, x + w / 2, y + 36, { align: 'center' });
    doc.setTextColor(0);
  };
  const box = (x: number, y: number, w: number, label: string, value: string) => {
    doc.setDrawColor(210); doc.roundedRect(x, y, w, 20, 1.5, 1.5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...NAVY); doc.text(label, x + 4, y + 7);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(40); doc.text(value, x + 4, y + 15); doc.setTextColor(0);
  };
  const table = (head: string[], rows: string[][], x: number, y: number, widths: number[], rowH = 7.5) => {
    doc.setFillColor(240, 245, 250); doc.rect(x, y - 5, widths.reduce((a, b) => a + b, 0), rowH + 1, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...NAVY);
    let cx = x; head.forEach((h, i) => { doc.text(h, cx + 1.5, y); cx += widths[i]!; });
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...BLUE);
    rows.forEach((row, ri) => {
      const yy = y + (ri + 1) * rowH;
      doc.setDrawColor(228); doc.line(x, yy - 5, x + widths.reduce((a, b) => a + b, 0), yy - 5);
      let rx = x; row.forEach((c, i) => { doc.text(String(c), rx + 1.5, yy, { maxWidth: widths[i]! - 2 }); rx += widths[i]!; });
    });
    doc.setTextColor(0);
  };

  /* 1 ─ Cover */
  doc.setFont('helvetica', 'bold'); doc.setFontSize(26); doc.setTextColor(...NAVY); doc.text(doc.splitTextToSize(m.customer || m.designName, 120), M, 28);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(...BLUE);
  if (m.address) doc.text(doc.splitTextToSize(m.address, 120), M, 48);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(30); doc.setTextColor(...NAVY); doc.text(`${num(r.installedKwp)} kWp`, M, 82);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...BLUE);
  doc.text(`(${m.latitudeDeg.toFixed(5)}${m.longitudeDeg !== undefined ? `, ${m.longitudeDeg.toFixed(5)}` : ''})`, M, 92);
  doc.setTextColor(60); doc.setFontSize(10);
  doc.text(`Design: ${m.designName} · version ${m.version}`, M, 108);
  doc.text(`${config.building.lengthM} × ${config.building.widthM} m building, ${config.building.floors} floor(s), ${config.building.roofType.toLowerCase()} roof`, M, 115);
  doc.text(`Prepared for: ${m.customer || m.designName}`, M, 190);
  doc.setFont('helvetica', 'bold'); doc.setTextColor(...NAVY); doc.text(m.company, W - M, 190, { align: 'right' });
  doc.setTextColor(0);
  await img(renderDesignSvg(config, { report: layout, title: 'Roof layout: plan view', subtitle: `${r.validPanels} panels · ${num(r.installedKwp)} kWp` }), 140, 14, W - 140 - M, 168);
  next();

  /* 2 ─ System metrics */
  title('System Metrics');
  const tw = 58;const X0 = 80;
  tile(X0, 14, tw, 44, 'ANNUAL PRODUCTION', num(r.annualAcKwh / 1000), 'x 1000 kWh (Units)', NAVY);
  tile(X0 + tw + 6, 14, tw, 44, 'PERFORMANCE RATIO', `${num(r.performanceRatioPercent)}%`, 'AC energy / (kWp × irradiation)', BLUE);
  tile(X0 + (tw + 6) * 2, 14, tw, 44, 'SPECIFIC GENERATION', num(r.specificGeneration), 'kWh/kWp/year', TEAL);
  box(X0, 66, tw, 'Module DC nameplate', `${num(r.installedKwp)} kWp`);
  box(X0 + tw + 6, 66, tw, 'AC nameplate', `${num(r.acKw)} kW`);
  box(X0 + (tw + 6) * 2, 66, tw, 'DC-AC ratio', num(r.dcAcRatio));
  box(X0, 92, tw, 'Shadow-free time', `${num(r.shadowFreePercent)}%`);
  box(X0 + tw + 6, 92, tw, 'Irradiation (plane of array)', `${int(r.losses[0]!.value)} kWh/m²`);
  box(X0 + (tw + 6) * 2, 92, tw, 'Weather data', 'User irradiation profile');
  next();

  /* 3 ─ Components */
  title('Components');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...GREY); doc.text('Equipment used in this design', M, 38);
  let y = 28;
  for (const c of r.components) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...NAVY); doc.text(c.label, 100, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...BLUE); doc.text(doc.splitTextToSize(c.name, 150), 100, y + 8);
    if (c.quantity !== null) { doc.setTextColor(...NAVY); doc.text(String(c.quantity), W - M, y + 8, { align: 'right' }); }
    doc.setDrawColor(210); doc.line(100, y + 17, W - M, y + 17);
    y += 26;
  }
  next();

  /* 4 ─ Expected annual production (bar chart) */
  doc.setFillColor(...NAVY); doc.rect(W / 2 - 14, 0, W / 2 + 14, H - 16, 'F');
  title('Expected Annual Production');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...GREY);
  doc.text(doc.splitTextToSize(`During the first year of operation your system is expected to produce ${num(r.annualAcKwh / 1000)} x 1000 kWh.`, 110), M, 40);
  doc.text('Expected average generation', M, 150); doc.setTextColor(...BLUE); doc.setFontSize(13); doc.text(`${num(r.avgMonthlyKwh)} kWh/month`, M, 158);
  doc.setTextColor(...GREY); doc.setFontSize(10.5); doc.text('Yearly degradation rate (input)', M, 172); doc.setTextColor(...BLUE); doc.setFontSize(13);
  doc.text(`${m.degradationPct}% per year (assumption)`, M, 180);
  const maxV = Math.max(...r.months.map((x) => x.acKwh), 1);
  const bx = W / 2 + 6;
  const bw = W - bx - M - 20;
  r.months.forEach((mo, i) => {
    const yy = 22 + i * 13;
    doc.setTextColor(255); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(mo.month, bx - 3, yy + 6, { align: 'right' });
    doc.setFillColor(255, 255, 255); doc.rect(bx, yy, (mo.acKwh / maxV) * bw, 9, 'F');
    doc.setTextColor(60); doc.text(int(mo.acKwh), bx + (mo.acKwh / maxV) * bw - 2, yy + 6, { align: 'right' });
  });
  doc.setTextColor(0);
  next();

  /* 5 ─ Monthly table */
  title('Monthly Table');
  table(['Month', 'Irradiation (kWh/m²)', 'Effective (kWh/m²)', 'DC energy (kWh)', 'AC energy (kWh)', 'Specific gen. (kWh/kWp)', 'Perf. ratio %', 'Solar access %'],
    r.months.map((x) => [x.month, num(x.poaKwhM2), num(x.effectiveKwhM2), num(x.dcKwh), num(x.acKwh), num(x.specificKwhPerKwp), num(x.performanceRatioPercent), num(x.solarAccessPercent)]),
    M, 42, [28, 38, 34, 34, 34, 40, 30, 30], 8.8);
  next();

  /* 6 ─ Field segments (paginated) + section access */
  const segHead = ['Name', 'Orientation', 'Tilt', 'Azimuth', 'Modules', 'Power', 'Solar access'];
  const segRows = r.segments.map((s) => [s.name, s.orientation, `${num(s.tiltDeg)}°`, `${num(s.azimuthDeg)}°`, String(s.modules), `${num(s.kwp)} kWp`, `${num(s.solarAccessPercent)}%`]);
  for (let i = 0; i < Math.max(1, segRows.length); i += 18) {
    title('Field Segments');
    table(segHead, segRows.slice(i, i + 18), M, 42, [78, 30, 24, 28, 26, 32, 36], 7.4);
    next();
  }
  const secRows = config.roofSections.filter((s) => config.panels.some((p) => p.sectionId === s.id)).map((s) => {
    const ps = config.panels.filter((p) => p.sectionId === s.id && r.shading.panelMonthly[p.id]);
    const cols = Array.from({ length: 12 }, (_, k) => ps.length ? Math.round((ps.reduce((a, p) => a + r.shading.panelMonthly[p.id]![k]!, 0) / ps.length) * 100) : 100);
    return [s.name, ...cols.map(String)];
  });
  if (secRows.length) {
    title('Monthly solar access % by roof section');
    table(['Section', ...MONTH_LABELS], secRows.slice(0, 20), M, 42, [50, ...Array(12).fill(18.5)], 7.6);
    next();
  }

  /* 7 ─ Shadow analysis: 21 Jun and 21 Dec, 9:00 and 16:00 solar time */
  const shadowPage = async (label: string, monthIdx: number) => {
    title('Shadow Analysis');
    for (const [k, hr] of [9, 16].entries()) {
      const sun = sunPosition(m.latitudeDeg, DAY_OF_21ST[monthIdx]!, hr);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...GREY);
      const x0 = M + k * 140;
      doc.text(`${label} | ${hr}:00 solar time  (sun elevation ${sun.elevationDeg.toFixed(0)}°, azimuth ${sun.azimuthDeg.toFixed(0)}°)`, x0, 38);
      await img(renderDesignSvg(config, { report: layout, shadows: shadowPolygons(config, sun), title: ' ', subtitle: ' ', panelFill: (id) => accessColor(r.shading.panelMonthly[id]?.[monthIdx] ?? 1) }), x0, 42, 130, 118);
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(60);
    doc.text('Dark areas are obstacle shadows; panels are shaded red to green by their solar access for that month.', M, 170);
    return;
  };
  await shadowPage('June 21', 5); next();
  await shadowPage('December 21', 11);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(40);
  doc.text(`Summary: modules are shadow free for ${num(r.shadowFreePercent)}% of simulated solar time (roof obstacles only).`, M, 180);
  next();

  /* 8 ─ Solar access map (+ 3D view) */
  title('Solar Access');
  await img(renderDesignSvg(config, { report: layout, title: ' ', subtitle: 'Annual solar access per panel', panelFill: (id) => accessColor(r.shading.panelAnnual[id] ?? 1) }), M, 34, m.screenshot3d ? 130 : 150, 130);
  if (m.screenshot3d) doc.addImage(m.screenshot3d, 'PNG', 150, 40, 133, 95, undefined, 'FAST');
  for (let i = 0; i <= 10; i++) { doc.setFillColor(accessHex(0.6 + i * 0.04)); doc.rect(M + i * 9, 172, 9, 4, 'F'); }
  doc.setFontSize(8); doc.setTextColor(90); doc.text('60% access', M, 181); doc.text('100%', M + 99, 181, { align: 'right' });
  next();

  /* 9 ─ Roof section layouts */
  const withPanels = config.roofSections.filter((s) => config.panels.some((p) => p.sectionId === s.id));
  for (const s of withPanels) {
    title(`Roof layout: ${s.name}`);
    await img(renderDesignSvg(config, { sectionId: s.id, report: layout }), M, 34, W - M * 2, 150);
    next();
  }

  /* 10 ─ Production losses */
  doc.setFillColor(...NAVY); doc.rect(0, 0, W, H - 16, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(255); doc.text('System Production Losses', M, 22);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.text('Loss in generation predicted due to environmental and electrical factors', M, 30);
  const lx = 112;
  const lw = W - lx - M - 30;
  const lmax = Math.max(...r.losses.filter((l) => l.unit === 'kWh').map((l) => l.value), 1);
  const imax = Math.max(r.losses[0]!.value, 1);
  r.losses.forEach((l, i) => {
    const yy = 40 + i * 12.2;
    const frac = l.unit === 'kWh' ? l.value / lmax : l.value / imax;
    doc.setTextColor(255); doc.setFontSize(8.5); doc.text(l.label, M, yy + 5);
    doc.setTextColor(200, 225, 240); doc.text(`${int(l.value)} ${l.unit}`, lx - 3, yy + 5, { align: 'right' });
    doc.setFillColor(...(l.kind === 'irradiance' ? [255, 255, 255] as [number, number, number] : l.kind === 'dc' ? BLUE : TEAL));
    doc.rect(lx, yy, Math.max(1, frac * lw), 6, 'F');
    if (l.lossPercent !== undefined) { doc.setTextColor(255); doc.text(`${num(l.lossPercent)}%`, lx + frac * lw + 3, yy + 5); }
  });
  doc.setTextColor(0);
  next();

  /* 11 ─ Environmental impact */
  title('Environmental Impact');
  tile(X0, 14, 90, 52, 'CARBON DIOXIDE OFFSET', num(r.environment.co2Tonnes), 'metric tons / year', NAVY);
  tile(196, 14, 90, 52, 'EQUIVALENT TREES', int(r.environment.trees), 'trees planted per year', BLUE);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GREY);
  doc.text(doc.splitTextToSize('Calculated from first-year AC energy and the grid emission factor and tree absorption rate you entered. Replace the defaults with your local figures.', 180), 100, 80);
  next();

  /* 12 ─ Assumptions + thank you */
  title('Assumptions and limitations');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(40);
  let ny = 40;
  for (const n of r.assumptions) { const lines = doc.splitTextToSize(`• ${n}`, W - M * 2); doc.text(lines, M, ny); ny += lines.length * 5 + 4; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...NAVY); doc.text('Thank you', M, ny + 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...BLUE); doc.text(m.company, M, ny + 22);
  if (m.contact) doc.text(doc.splitTextToSize(m.contact, 150), M, ny + 29);
  footer();
  doc.save(`${safe(m.designName)}-yield-report-v${m.version}.pdf`);
  void DAYS_IN_MONTH;
}

function accessHex(a: number): string {
  const t = Math.max(0, Math.min(1, (a - 0.6) / 0.4));
  const hue = 8 + t * 112; const l = 0.5 - t * 0.08; const s = 0.7;
  const k = (n: number) => (n + hue / 30) % 12;
  const f = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}
