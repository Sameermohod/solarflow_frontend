import { ISSUE_LABELS, renderDesignSvg, summarizeDesign, validateLayout, type DesignConfig, type DesignSummary } from '@solarflow/shared';

export const DISCLAIMER =
  'Preliminary layout and visualisation produced for planning and quotation support. It is not a certified structural, electrical or fire-safety design. ' +
  'Roof loading, wind/snow loads, cable sizing, protection and local code compliance must be verified by a qualified engineer before installation.';

const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'design';

export function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export const downloadDataUrl = async (fileName: string, dataUrl: string) => downloadBlob(fileName, await (await fetch(dataUrl)).blob());

export function exportSvg(config: DesignConfig, name: string, sectionId?: string) {
  const svg = renderDesignSvg(config, { sectionId, title: sectionId ? undefined : `${name}: plan view` });
  downloadBlob(`${safeName(name)}${sectionId ? `-${sectionId}` : '-plan'}.svg`, new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
}

/** Rasterise the vector drawing so PNG, SVG and PDF always show exactly the same layout. */
export function svgToPngDataUrl(svg: string, widthPx = 1600): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
      const ratio = img.height / img.width || 1;
      const canvas = document.createElement('canvas');
      canvas.width = widthPx;
      canvas.height = Math.round(widthPx * ratio);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas not available'));
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve({ dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not render the drawing')); };
    img.src = url;
  });
}

export async function exportPng(config: DesignConfig, name: string, sectionId?: string) {
  const svg = renderDesignSvg(config, { sectionId, title: sectionId ? undefined : `${name}: plan view`, widthPx: 1600 });
  const { dataUrl } = await svgToPngDataUrl(svg, 2000);
  await downloadDataUrl(`${safeName(name)}${sectionId ? `-${sectionId}` : '-plan'}.png`, dataUrl);
}

export interface PdfMeta { name: string; customer?: string | null; version: number; status?: string; screenshot3d?: string | null }

/** Design report: summary, plan + per-section layouts, panel placement table, assumptions and the engineering disclaimer. */
export async function exportPdf(config: DesignConfig, meta: PdfMeta, summary: DesignSummary = summarizeDesign(config)) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const W = 297;
  const H = 210;
  const M = 12;
  const report = validateLayout(config);
  const types = new Map(config.panelTypes.map((t) => [t.id, t]));
  const date = new Date().toLocaleDateString('en-GB', { dateStyle: 'long' });
  let page = 1;

  const footer = () => {
    doc.setFontSize(7); doc.setTextColor(100);
    doc.text(doc.splitTextToSize(DISCLAIMER, W - M * 2), M, H - 9);
    doc.text(`Page ${page}`, W - M, H - 4, { align: 'right' });
    doc.setTextColor(0);
  };
  const header = (title: string) => {
    doc.setFillColor(15, 42, 67); doc.rect(0, 0, W, 16, 'F');
    doc.setTextColor(255); doc.setFontSize(13); doc.text(title, M, 10.5);
    doc.setFontSize(8); doc.text(`${meta.name} · v${meta.version}${meta.customer ? ` · ${meta.customer}` : ''}`, W - M, 10.5, { align: 'right' });
    doc.setTextColor(0);
  };
  const newPage = (title: string) => { footer(); doc.addPage(); page++; header(title); };
  const fitImage = async (svg: string, x: number, y: number, maxW: number, maxH: number) => {
    const img = await svgToPngDataUrl(svg, 1500);
    const r = Math.min(maxW / img.width, maxH / img.height);
    doc.addImage(img.dataUrl, 'PNG', x, y, img.width * r, img.height * r, undefined, 'FAST');
  };

  // Page 1: summary + plan
  header('Solar roof layout report');
  doc.setFontSize(10);
  const rows: [string, string][] = [
    ['Design', meta.name], ['Customer', meta.customer ?? '-'], ['Version', `v${meta.version}${meta.status ? ` (${meta.status.toLowerCase()})` : ''}`], ['Date', date],
    ['Building', `${config.building.lengthM} × ${config.building.widthM} m, ${config.building.floors} floor(s), ${config.building.roofType.toLowerCase()} roof`],
    ['Valid panels', `${summary.validPanelCount}${summary.invalidPanelCount ? ` (+${summary.invalidPanelCount} with errors)` : ''}`],
    ['Installed capacity', `${summary.installedKwp} kWp`], ['Panel area', `${summary.panelAreaM2} m²`], ['Roof area', `${summary.roofAreaM2} m²  (coverage ${summary.coveragePercent}%)`],
    ['Min. panel spacing', summary.minSpacingM === null ? '-' : `${summary.minSpacingM} m`],
  ];
  if (summary.targetPanels !== null) rows.push(['Calculator target', `${summary.targetPanels} panels (${summary.targetDeltaPanels! >= 0 ? '+' : ''}${summary.targetDeltaPanels})`]);
  let y = 26;
  for (const [k, v] of rows) { doc.setFont('helvetica', 'bold'); doc.text(k, M, y); doc.setFont('helvetica', 'normal'); doc.text(doc.splitTextToSize(v, 80), M + 38, y); y += 6.5; }
  y += 3;
  doc.setFont('helvetica', 'bold'); doc.text('By roof section', M, y); y += 5; doc.setFontSize(8.5);
  for (const s of summary.bySection) { doc.setFont('helvetica', 'normal'); doc.text(`${s.name}: ${s.panels} panels, ${s.kwp} kWp, ${s.roofAreaM2} m², faces ${s.azimuthDeg}°, tilt ${s.tiltDeg}°`, M, y); y += 5; if (y > H - 20) break; }
  await fitImage(renderDesignSvg(config, { report }), 135, 22, W - 135 - M, H - 40);
  if (meta.screenshot3d) doc.addImage(meta.screenshot3d, 'PNG', M, H - 78, 100, 60, undefined, 'FAST');

  // One page per roof section that has panels (or all sections when none)
  const withPanels = config.roofSections.filter((s) => config.panels.some((p) => p.sectionId === s.id));
  for (const s of withPanels.length ? withPanels : config.roofSections) {
    newPage(`Roof layout: ${s.name}`);
    await fitImage(renderDesignSvg(config, { sectionId: s.id, report }), M, 22, W - M * 2, H - 40);
  }

  // Panel placement report
  const list = config.panels;
  if (list.length) {
    const perPage = 34;
    for (let i = 0; i < list.length; i += perPage) {
      newPage(`Panel placement report (${i + 1}-${Math.min(i + perPage, list.length)} of ${list.length})`);
      doc.setFontSize(8); doc.setFont('helvetica', 'bold');
      const cols = [M, M + 22, M + 70, M + 112, M + 136, M + 160, M + 186, M + 212];
      ['Panel', 'Roof section', 'Type', 'x (m)', 'y (m)', 'Rot. (°)', 'Tilt (°)', 'Status'].forEach((h, k) => doc.text(h, cols[k]!, 24));
      doc.setFont('helvetica', 'normal');
      list.slice(i, i + perPage).forEach((p, k) => {
        const yy = 30 + k * 4.9;
        const t = types.get(p.typeId);
        const sec = config.roofSections.find((s) => s.id === p.sectionId);
        const issues = report.issues[p.id] ?? [];
        const status = issues.length ? issues.map((x) => ISSUE_LABELS[x.type]).join('; ') : 'OK';
        const cells = [`#${i + k + 1}`, sec?.name ?? '?', t ? `${t.wattage} W` : '?', p.x.toFixed(2), p.y.toFixed(2), p.rotationDeg.toFixed(0), p.tiltDeg.toFixed(0), status];
        cells.forEach((c, j) => doc.text(doc.splitTextToSize(String(c), j === 7 ? W - cols[7]! - M : 44)[0] ?? '', cols[j]!, yy));
      });
    }
  }

  newPage('Assumptions and limitations');
  doc.setFontSize(9.5);
  const notes = [
    `Panels: ${config.panelTypes.map((t) => `${t.name} (${t.widthM} × ${t.lengthM} m, ${t.wattage} W)`).join('; ')}.`,
    `Spacing: ${config.layout.gapXM} m between panels in a row, ${config.layout.gapYM} m between rows; edge setbacks per roof section (${config.roofSections.map((s) => `${s.name} ${s.setbackM} m`).join(', ')}).`,
    config.layout.mountTiltDeg > 0 ? `Tilted racks at ${config.layout.mountTiltDeg}° with row spacing sized for a ${config.layout.designSunElevationDeg}° design sun elevation (assumption).` : 'Panels are mounted flush with the roof surface.',
    'Obstacle clearances and restricted zones are applied as entered by the designer.',
    'Capacity counts only panels with no errors. Panels outside the roof, inside setbacks, overlapping or blocked by obstacles are excluded.',
    DISCLAIMER,
  ];
  let ny = 28;
  for (const n of notes) { const lines = doc.splitTextToSize(`• ${n}`, W - M * 2); doc.text(lines, M, ny); ny += lines.length * 5 + 3; }
  footer();
  doc.save(`${safeName(meta.name)}-report-v${meta.version}.pdf`);
}
