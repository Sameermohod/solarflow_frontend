import { bbox, type Vec2 } from './geometry';
import { generateBuilding, localToPlan } from './planes';
import { panelCorners, summarizeDesign, validateLayout, type LayoutReport } from './placement';
import { OBSTACLE_LABELS, type DesignConfig } from './types';

/**
 * Vector rendering of a design (used for SVG export and as the source image for PDF reports).
 * Everything is drawn from the same DesignConfig the editors use.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const f = (n: number) => (Math.round(n * 1000) / 1000).toString();
const pts = (p: Vec2[]) => p.map((q) => `${f(q.x)},${f(q.y)}`).join(' ');

export interface SvgOptions {
  /** Draw one roof section in its own true-size frame; omit for the whole-building plan view. */
  sectionId?: string;
  title?: string;
  report?: LayoutReport;
  widthPx?: number;
  /** Plan view only: colour for each panel (e.g. solar access heat map). */
  panelFill?: (panelId: string) => string | undefined;
  /** Plan view only: shadow polygons in plan coordinates, drawn under the panels. */
  shadows?: Vec2[][];
  subtitle?: string;
}

export function renderDesignSvg(c: DesignConfig, o: SvgOptions = {}): string {
  const report = o.report ?? validateLayout(c);
  const types = new Map(c.panelTypes.map((t) => [t.id, t]));
  const body: string[] = [];
  let all: Vec2[] = [];
  const flip = (p: Vec2): Vec2 => ({ x: p.x, y: -p.y }); // section frame has v up

  if (o.sectionId) {
    const s = c.roofSections.find((x) => x.id === o.sectionId);
    if (!s) throw new Error('Roof section not found');
    const poly = s.polygon.map(flip);
    all = [...poly];
    body.push(`<polygon points="${pts(poly)}" fill="#f1f5f9" stroke="#0f2a43" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
    for (const z of c.zones.filter((z) => z.sectionId === s.id)) body.push(`<polygon points="${pts(z.polygon.map(flip))}" fill="#fecaca" fill-opacity="0.6" stroke="#dc2626" stroke-dasharray="4 3" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`);
    for (const ob of c.obstacles.filter((x) => x.sectionId === s.id)) {
      const label = `<text x="${f(ob.x)}" y="${f(-ob.y)}" font-size="0.35" text-anchor="middle" fill="#1f2937">${esc(OBSTACLE_LABELS[ob.type])}</text>`;
      body.push(ob.shape === 'CIRCLE'
        ? `<circle cx="${f(ob.x)}" cy="${f(-ob.y)}" r="${f(ob.r)}" fill="#fde68a" stroke="#b45309" stroke-width="1.5" vector-effect="non-scaling-stroke"/>${label}`
        : `<rect x="${f(ob.x - ob.w / 2)}" y="${f(-ob.y - ob.h / 2)}" width="${f(ob.w)}" height="${f(ob.h)}" fill="#fde68a" stroke="#b45309" stroke-width="1.5" vector-effect="non-scaling-stroke"/>${label}`);
      all.push({ x: ob.x - (ob.shape === 'CIRCLE' ? ob.r : ob.w / 2), y: -ob.y - (ob.shape === 'CIRCLE' ? ob.r : ob.h / 2) }, { x: ob.x + (ob.shape === 'CIRCLE' ? ob.r : ob.w / 2), y: -ob.y + (ob.shape === 'CIRCLE' ? ob.r : ob.h / 2) });
    }
    for (const p of c.panels.filter((x) => x.sectionId === s.id)) {
      const t = types.get(p.typeId);
      if (!t) continue;
      const bad = report.errorIds.has(p.id);
      body.push(`<polygon points="${pts(panelCorners(p, t).map(flip))}" fill="${bad ? '#fecaca' : '#bfdbfe'}" stroke="${bad ? '#dc2626' : '#1e3a8a'}" stroke-width="1" vector-effect="non-scaling-stroke"/>`);
    }
    const b = bbox(poly);
    body.push(`<text x="${f(b.minX + b.width / 2)}" y="${f(b.maxY + 0.9)}" font-size="0.45" text-anchor="middle" fill="#0f2a43">${f(Math.max(...s.polygon.map((p) => p.x)) - Math.min(...s.polygon.map((p) => p.x)))} m wide · setback ${s.setbackM} m · tilt ${s.tiltDeg}° · faces ${Math.round(s.azimuthDeg)}°</text>`);
  } else {
    const g = generateBuilding(c.building);
    all = [...g.footprint];
    body.push(`<polygon points="${pts(g.footprint)}" fill="#e5e7eb" stroke="#475569" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
    for (const s of c.roofSections) {
      const poly = s.polygon.map((p) => localToPlan(s, p.x, p.y));
      all.push(...poly);
      body.push(`<polygon points="${pts(poly)}" fill="#f8fafc" fill-opacity="0.85" stroke="#0f2a43" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`);
      const m = poly.reduce((a, p) => ({ x: a.x + p.x / poly.length, y: a.y + p.y / poly.length }), { x: 0, y: 0 });
      body.push(`<text x="${f(m.x)}" y="${f(m.y)}" font-size="0.5" text-anchor="middle" fill="#64748b">${esc(s.name)}</text>`);
    }
    for (const ob of c.obstacles) {
      const s = c.roofSections.find((x) => x.id === ob.sectionId);
      if (!s) continue;
      const m = localToPlan(s, ob.x, ob.y);
      body.push(`<circle cx="${f(m.x)}" cy="${f(m.y)}" r="${f(ob.shape === 'CIRCLE' ? ob.r : Math.max(ob.w, ob.h) / 2)}" fill="#fde68a" stroke="#b45309" vector-effect="non-scaling-stroke"/>`);
    }
    for (const p of c.panels) {
      const s = c.roofSections.find((x) => x.id === p.sectionId);
      const t = types.get(p.typeId);
      if (!s || !t) continue;
      const bad = report.errorIds.has(p.id);
      body.push(`<polygon points="${pts(panelCorners(p, t).map((q) => localToPlan(s, q.x, q.y)))}" fill="${bad ? '#fecaca' : (o.panelFill?.(p.id) ?? '#bfdbfe')}" stroke="${bad ? '#dc2626' : '#1e3a8a'}" stroke-width="0.8" vector-effect="non-scaling-stroke"/>`);
    }
    for (const sh of o.shadows ?? []) body.push(`<polygon points="${pts(sh)}" fill="#0f172a" fill-opacity="0.4"/>`);
    for (const e of c.equipment) {
      body.push(`<rect x="${f(e.x - e.widthM / 2)}" y="${f(e.y - e.depthM / 2)}" width="${f(e.widthM)}" height="${f(e.depthM)}" fill="#a7f3d0" stroke="#047857" vector-effect="non-scaling-stroke"/><text x="${f(e.x)}" y="${f(e.y - e.depthM)}" font-size="0.4" text-anchor="middle">${esc(e.label || e.kind)}</text>`);
      all.push({ x: e.x - e.widthM / 2, y: e.y - e.depthM / 2 }, { x: e.x + e.widthM / 2, y: e.y + e.depthM / 2 });
    }
  }

  const b = bbox(all.length ? all : [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  const pad = Math.max(1.5, Math.max(b.width, b.height) * 0.06);
  const sum = summarizeDesign(c, report);
  const titleH = Math.max(2.4, b.height * 0.09);
  const vx = b.minX - pad;
  const vy = b.minY - pad - titleH;
  const vw = b.width + pad * 2;
  const vh = b.height + pad * 2 + titleH;
  const wpx = o.widthPx ?? 1200;
  const hpx = Math.round((wpx * vh) / vw);
  const title = o.title ?? (o.sectionId ? `Roof layout: ${c.roofSections.find((s) => s.id === o.sectionId)?.name}` : 'Roof layout: plan view');
  const fs = Math.max(0.4, vw / 45);
  const header = `<text x="${f(vx + pad / 2)}" y="${f(vy + fs * 1.3)}" font-size="${f(fs)}" font-weight="700" fill="#0f2a43">${esc(title)}</text>` +
    `<text x="${f(vx + pad / 2)}" y="${f(vy + fs * 2.6)}" font-size="${f(fs * 0.7)}" fill="#475569">${o.subtitle ?? `${sum.validPanelCount} panels · ${sum.installedKwp} kWp${sum.invalidPanelCount ? ` · ${sum.invalidPanelCount} need attention` : ''} · preliminary layout, not a certified design`}</text>` +
    (o.sectionId ? '' : `<text x="${f(vx + vw - pad / 2)}" y="${f(vy + fs * 1.3)}" font-size="${f(fs)}" font-weight="700" text-anchor="end" fill="#0f2a43">N ↑</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${wpx}" height="${hpx}" viewBox="${f(vx)} ${f(vy)} ${f(vw)} ${f(vh)}" font-family="Inter, Arial, sans-serif"><rect x="${f(vx)}" y="${f(vy)}" width="${f(vw)}" height="${f(vh)}" fill="#ffffff"/>${header}${body.join('')}</svg>`;
}
