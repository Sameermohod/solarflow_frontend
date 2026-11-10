import { LOSS_LABELS, MONTH_LABELS, DAYS_IN_MONTH, DEFAULT_LOSSES, type LossStack } from '../solar';
import { deg, pointInPolygon, rad, type Vec2 } from './geometry';
import { localToHeight, localToPlan } from './planes';
import { panelCorners, validateLayout, summarizeDesign } from './placement';
import type { DesignConfig, Obstacle, RoofSection } from './types';

/**
 * Report engine: sun position, near-shading analysis and a monthly energy model, all computed from the same
 * DesignConfig the editors use. Everything here is an ESTIMATE built from stated assumptions (see REPORT_ASSUMPTIONS).
 */

/* ───────────────────────────── Sun position ───────────────────────────── */

export interface SunPosition { elevationDeg: number; azimuthDeg: number }

/** Day of year of the 21st of each month (non-leap). */
export const DAY_OF_21ST = [21, 52, 80, 111, 141, 172, 202, 233, 264, 294, 325, 355];

/** Solar position from latitude, day of year and SOLAR time (hours, 12 = solar noon). Cooper's declination formula. */
export function sunPosition(latitudeDeg: number, dayOfYear: number, solarHour: number): SunPosition {
  const decl = 23.45 * Math.sin(rad((360 / 365) * (284 + dayOfYear)));
  const phi = rad(latitudeDeg);
  const d = rad(decl);
  const w = rad(15 * (solarHour - 12));
  const sinEl = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(w);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const cosAz = (Math.sin(d) - sinEl * Math.sin(phi)) / (Math.cos(el) * Math.cos(phi) || 1e-9);
  let az = deg(Math.acos(Math.max(-1, Math.min(1, cosAz))));
  if (w > 0) az = 360 - az;
  return { elevationDeg: deg(el), azimuthDeg: az };
}

/* ───────────────────────────── Shading ───────────────────────────── */

export interface Prism { poly: Vec2[]; cx: number; cy: number; radius: number; baseZ: number; topZ: number; height: number; convex: Vec2[] }

function circlePoly(c: Vec2, r: number, n = 14): Vec2[] {
  return Array.from({ length: n }, (_, i) => ({ x: c.x + r * Math.cos((2 * Math.PI * i) / n), y: c.y + r * Math.sin((2 * Math.PI * i) / n) }));
}

function obstaclePrism(s: RoofSection, o: Obstacle): Prism {
  let local: Vec2[];
  if (o.shape === 'CIRCLE') local = circlePoly({ x: o.x, y: o.y }, o.r);
  else local = [[-o.w / 2, -o.h / 2], [o.w / 2, -o.h / 2], [o.w / 2, o.h / 2], [-o.w / 2, o.h / 2]].map(([dx, dy]) => ({ x: o.x + dx!, y: o.y + dy! }));
  const poly = local.map((p) => localToPlan(s, p.x, p.y));
  const cx = poly.reduce((a, p) => a + p.x, 0) / poly.length;
  const cy = poly.reduce((a, p) => a + p.y, 0) / poly.length;
  const radius = Math.max(...poly.map((p) => Math.hypot(p.x - cx, p.y - cy)));
  const baseZ = localToHeight(s, o.y);
  return { poly, cx, cy, radius, baseZ, topZ: baseZ + o.heightM, height: o.heightM, convex: poly };
}

export function obstaclePrisms(c: DesignConfig): Prism[] {
  const secs = new Map(c.roofSections.map((s) => [s.id, s]));
  return c.obstacles.flatMap((o) => { const s = secs.get(o.sectionId); return s ? [obstaclePrism(s, o)] : []; });
}

/** Horizontal unit vector in plan (x east, y south) pointing TOWARD the sun. */
const towardSun = (azimuthDeg: number): Vec2 => ({ x: Math.sin(rad(azimuthDeg)), y: -Math.cos(rad(azimuthDeg)) });

function blocked(prisms: Prism[], x: number, y: number, z: number, h: Vec2, tanEl: number): boolean {
  for (const pr of prisms) {
    const dmax = (pr.topZ - z) / tanEl; // beyond this distance the ray is above the obstacle
    if (dmax <= 0) continue;
    // ray-to-centre distance prune
    const vx = pr.cx - x;
    const vy = pr.cy - y;
    const along = vx * h.x + vy * h.y;
    if (along < -pr.radius || along - pr.radius > dmax) continue;
    const perp = Math.abs(vx * h.y - vy * h.x);
    if (perp > pr.radius) continue;
    const step = Math.max(0.1, pr.radius / 8);
    const start = Math.max(0, along - pr.radius);
    const end = Math.min(dmax, along + pr.radius);
    for (let d = start; d <= end; d += step) {
      if (pointInPolygon({ x: x + h.x * d, y: y + h.y * d }, pr.poly)) return true;
    }
  }
  return false;
}

/** Plan-frame shadow of every obstacle at a given sun position (convex hull of the footprint and its shifted copy). */
export function shadowPolygons(c: DesignConfig, sun: SunPosition): Vec2[][] {
  if (sun.elevationDeg <= 2) return [];
  const h = towardSun(sun.azimuthDeg);
  const t = Math.tan(rad(sun.elevationDeg));
  return obstaclePrisms(c).map((pr) => {
    const len = Math.min(pr.height / t, 60);
    return convexHull([...pr.poly, ...pr.poly.map((p) => ({ x: p.x - h.x * len, y: p.y - h.y * len }))]);
  });
}

function convexHull(points: Vec2[]): Vec2[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cr = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: Vec2[] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  const up: Vec2[] = [];
  for (const q of [...p].reverse()) { while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

export interface ShadingResult {
  /** Panel id → fraction of (irradiance-weighted) sun exposure that is NOT blocked, per month (12) and annual. */
  panelMonthly: Record<string, number[]>;
  panelAnnual: Record<string, number>;
  /** Share of all panel-daylight-hours that are shadow free (the headline "shadow free %"). */
  shadowFreePercent: number;
  hoursSimulated: number;
}

const SHADE_START_HOUR = 6;
const SHADE_END_HOUR = 18;
const MIN_ELEVATION = 5;

/**
 * Near-shading from roof obstacles (tanks, chimneys, stair covers…) for the 21st of every month, hourly in solar time.
 * Each panel is sampled at its centre and four inset points; a sample is shaded when the ray to the sun passes through
 * an obstacle prism. Weighted by sin(elevation) as a clear-sky irradiance proxy.
 */
export function analyzeShading(c: DesignConfig, latitudeDeg: number, panelIds?: Set<string>): ShadingResult {
  const prisms = obstaclePrisms(c);
  const secs = new Map(c.roofSections.map((s) => [s.id, s]));
  const types = new Map(c.panelTypes.map((t) => [t.id, t]));
  const panels = c.panels.filter((p) => (!panelIds || panelIds.has(p.id)) && secs.has(p.sectionId) && types.has(p.typeId));
  const samples = panels.map((p) => {
    const s = secs.get(p.sectionId)!;
    const t = types.get(p.typeId)!;
    const corners = panelCorners(p, t);
    const cen = { x: p.x, y: p.y };
    const pts = [cen, ...corners.map((q) => ({ x: cen.x + (q.x - cen.x) * 0.8, y: cen.y + (q.y - cen.y) * 0.8 }))];
    return { id: p.id, pts: pts.map((q) => { const pl = localToPlan(s, q.x, q.y); return { x: pl.x, y: pl.y, z: localToHeight(s, q.y) + 0.1 }; }) };
  });

  const panelMonthly: Record<string, number[]> = {};
  const panelAnnual: Record<string, number> = {};
  const sumW = new Map<string, number[]>();
  const sumLit = new Map<string, number[]>();
  for (const sp of samples) { sumW.set(sp.id, new Array(12).fill(0)); sumLit.set(sp.id, new Array(12).fill(0)); }
  let hours = 0;
  let free = 0;
  let total = 0;

  for (let m = 0; m < 12; m++) {
    for (let hr = SHADE_START_HOUR; hr <= SHADE_END_HOUR; hr++) {
      const sun = sunPosition(latitudeDeg, DAY_OF_21ST[m]!, hr);
      if (sun.elevationDeg < MIN_ELEVATION) continue;
      hours++;
      const w = Math.sin(rad(sun.elevationDeg));
      const h = towardSun(sun.azimuthDeg);
      const tanEl = Math.tan(rad(sun.elevationDeg));
      for (const sp of samples) {
        let lit = 0;
        if (prisms.length) for (const q of sp.pts) if (!blocked(prisms, q.x, q.y, q.z, h, tanEl)) lit++;
        const frac = prisms.length ? lit / sp.pts.length : 1;
        sumW.get(sp.id)![m]! += w;
        sumLit.get(sp.id)![m]! += w * frac;
        free += frac;
        total += 1;
      }
    }
  }
  for (const sp of samples) {
    const w = sumW.get(sp.id)!;
    const l = sumLit.get(sp.id)!;
    panelMonthly[sp.id] = w.map((x, i) => (x > 0 ? l[i]! / x : 1));
    const tw = w.reduce((a, b) => a + b, 0);
    panelAnnual[sp.id] = tw > 0 ? l.reduce((a, b) => a + b, 0) / tw : 1;
  }
  return { panelMonthly, panelAnnual, shadowFreePercent: total ? (free / total) * 100 : 100, hoursSimulated: hours };
}

/* ───────────────────────────── Energy model ───────────────────────────── */

export interface ReportInputs {
  latitudeDeg: number;
  longitudeDeg?: number;
  /** Plane-of-array peak sun hours per day, Jan..Dec (your own irradiation profile). */
  monthlyPeakSunHours: number[];
  losses: LossStack;
  /** Share of plane-of-array irradiance that is direct beam (only the direct part is affected by near shading). */
  directShare: number;
  acCapacityKw: number;
  inverterName?: string;
  inverterKw?: number;
  structureName?: string;
  degradationPctPerYear: number;
  co2KgPerKwh: number;
  kgCo2PerTreePerYear: number;
}

export const DEFAULT_REPORT_INPUTS: Omit<ReportInputs, 'latitudeDeg' | 'monthlyPeakSunHours' | 'acCapacityKw'> = {
  losses: DEFAULT_LOSSES, directShare: 0.75, degradationPctPerYear: 0.5, co2KgPerKwh: 0.82, kgCo2PerTreePerYear: 21,
};

export interface MonthRow {
  month: string;
  poaKwhM2: number;
  effectiveKwhM2: number;
  dcKwh: number;
  acKwh: number;
  specificKwhPerKwp: number;
  performanceRatioPercent: number;
  solarAccessPercent: number;
}
export interface LossStage { label: string; value: number; unit: 'kWh/m²' | 'kWh'; lossPercent?: number; kind: 'irradiance' | 'dc' | 'ac' }
export interface FieldSegment {
  name: string; sectionName: string; orientation: string; tiltDeg: number; azimuthDeg: number; modules: number; kwp: number; solarAccessPercent: number; wattage: number;
}
export interface ComponentRow { label: string; name: string; quantity: number | null }

export interface DesignReport {
  installedKwp: number;
  validPanels: number;
  acKw: number;
  dcAcRatio: number;
  annualAcKwh: number;
  annualDcKwh: number;
  specificGeneration: number;
  performanceRatioPercent: number;
  shadowFreePercent: number;
  months: MonthRow[];
  losses: LossStage[];
  segments: FieldSegment[];
  components: ComponentRow[];
  environment: { co2Tonnes: number; trees: number };
  avgMonthlyKwh: number;
  shading: ShadingResult;
  assumptions: string[];
}

export const REPORT_ASSUMPTIONS = [
  'Energy is estimated from the peak-sun-hour profile you supplied (plane of array) and the loss stack shown; it is not an hourly simulation (no PVsyst/Meteonorm weather file).',
  'Near shading covers roof obstacles (tanks, chimneys, stair covers…) on the 21st of each month, hourly in solar time. Shading from neighbouring buildings, trees, parapets and row-to-row shading of tilted racks is NOT simulated.',
  'Only the direct-beam share of irradiance is reduced by shading; the diffuse share is assumed unaffected.',
  'DC clipping is not modelled; keep the DC/AC ratio sensible. Panels with layout errors are excluded.',
  'CO₂ and tree equivalents use the factors you entered (default grid factor 0.82 kg/kWh, 21 kg CO₂ per tree per year); replace them with your local figures.',
  'Preliminary layout and yield estimate for planning and quotation. Not a certified design or a performance guarantee.',
];

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildReport(c: DesignConfig, i: ReportInputs): DesignReport {
  if (i.monthlyPeakSunHours.length !== 12) throw new Error('Peak sun hours must have 12 monthly values');
  const layout = validateLayout(c);
  const summary = summarizeDesign(c, layout);
  const validIds = new Set(c.panels.filter((p) => !layout.errorIds.has(p.id)).map((p) => p.id));
  const types = new Map(c.panelTypes.map((t) => [t.id, t]));
  const secs = new Map(c.roofSections.map((s) => [s.id, s]));
  const shading = analyzeShading(c, i.latitudeDeg, validIds);
  const L = i.losses;
  const kwp = summary.installedKwp;
  const acKw = i.acCapacityKw > 0 ? i.acCapacityKw : kwp;

  // kWp-weighted solar access per month
  const kwpOf = (id: string) => (types.get(c.panels.find((p) => p.id === id)!.typeId)?.wattage ?? 0) / 1000;
  const wTotal = [...validIds].reduce((a, id) => a + kwpOf(id), 0) || 1;
  const accessM = Array.from({ length: 12 }, (_, m) => [...validIds].reduce((a, id) => a + kwpOf(id) * (shading.panelMonthly[id]?.[m] ?? 1), 0) / wTotal);

  const f = (x: number) => 1 - x / 100;
  const dcFactor = f(L.soiling) * f(L.temperature) * f(L.mismatch) * f(L.dcWiring) * f(L.irradianceAndOther);
  const acFactor = f(L.inverter) * f(L.acWiring) * f(L.availability);

  const months: MonthRow[] = [];
  const stage = { poa: 0, eff: 0, nominal: 0, afterSoil: 0, afterTemp: 0, afterOther: 0, afterMismatch: 0, afterDcWire: 0, afterInv: 0, afterAcWire: 0, afterAvail: 0 };
  for (let m = 0; m < 12; m++) {
    const poa = i.monthlyPeakSunHours[m]! * DAYS_IN_MONTH[m]!;
    const shadeLoss = (1 - accessM[m]!) * i.directShare;
    const eff = poa * (1 - shadeLoss);
    const nominal = kwp * eff;
    const dc = nominal * dcFactor;
    const ac = dc * acFactor;
    stage.poa += poa; stage.eff += eff; stage.nominal += nominal;
    stage.afterSoil += nominal * f(L.soiling);
    stage.afterTemp += nominal * f(L.soiling) * f(L.temperature);
    stage.afterOther += nominal * f(L.soiling) * f(L.temperature) * f(L.irradianceAndOther);
    stage.afterMismatch += nominal * f(L.soiling) * f(L.temperature) * f(L.irradianceAndOther) * f(L.mismatch);
    stage.afterDcWire += dc;
    stage.afterInv += dc * f(L.inverter);
    stage.afterAcWire += dc * f(L.inverter) * f(L.acWiring);
    stage.afterAvail += ac;
    months.push({
      month: MONTH_LABELS[m]!, poaKwhM2: r2(poa), effectiveKwhM2: r2(eff), dcKwh: r2(dc), acKwh: r2(ac),
      specificKwhPerKwp: kwp ? r2(ac / kwp) : 0, performanceRatioPercent: kwp && poa ? r2((ac / (kwp * poa)) * 100) : 0, solarAccessPercent: r2(accessM[m]! * 100),
    });
  }
  const annualAc = sum(months.map((x) => x.acKwh));
  const annualDc = sum(months.map((x) => x.dcKwh));
  const pct = (a: number, b: number) => (b ? r2(-((b - a) / b) * 100) : 0);
  const losses: LossStage[] = [
    { label: 'Plane-of-array irradiation', value: r2(stage.poa), unit: 'kWh/m²', kind: 'irradiance' },
    { label: 'After near shading', value: r2(stage.eff), unit: 'kWh/m²', kind: 'irradiance', lossPercent: pct(stage.eff, stage.poa) },
    { label: 'Nominal energy (STC, after shading)', value: r2(stage.nominal), unit: 'kWh', kind: 'dc' },
    { label: LOSS_LABELS.soiling, value: r2(stage.afterSoil), unit: 'kWh', kind: 'dc', lossPercent: -L.soiling },
    { label: LOSS_LABELS.temperature, value: r2(stage.afterTemp), unit: 'kWh', kind: 'dc', lossPercent: -L.temperature },
    { label: LOSS_LABELS.irradianceAndOther, value: r2(stage.afterOther), unit: 'kWh', kind: 'dc', lossPercent: -L.irradianceAndOther },
    { label: LOSS_LABELS.mismatch, value: r2(stage.afterMismatch), unit: 'kWh', kind: 'dc', lossPercent: -L.mismatch },
    { label: LOSS_LABELS.dcWiring, value: r2(stage.afterDcWire), unit: 'kWh', kind: 'dc', lossPercent: -L.dcWiring },
    { label: LOSS_LABELS.inverter, value: r2(stage.afterInv), unit: 'kWh', kind: 'ac', lossPercent: -L.inverter },
    { label: LOSS_LABELS.acWiring, value: r2(stage.afterAcWire), unit: 'kWh', kind: 'ac', lossPercent: -L.acWiring },
    { label: LOSS_LABELS.availability, value: r2(stage.afterAvail), unit: 'kWh', kind: 'ac', lossPercent: -L.availability },
  ];

  // Field segments: group valid panels by section, orientation, tilt and module type
  const groups = new Map<string, FieldSegment & { _acc: number }>();
  for (const p of c.panels) {
    if (!validIds.has(p.id)) continue;
    const s = secs.get(p.sectionId);
    const t = types.get(p.typeId);
    if (!s || !t) continue;
    const tilt = Math.round((s.tiltDeg + p.tiltDeg) * 100) / 100;
    const key = `${s.id}|${p.orientation}|${tilt}|${t.id}`;
    const g = groups.get(key) ?? { name: `${s.name} · ${t.wattage} W`, sectionName: s.name, orientation: p.orientation === 'PORTRAIT' ? 'Portrait' : 'Landscape', tiltDeg: tilt, azimuthDeg: ((s.azimuthDeg % 360) + 360) % 360, modules: 0, kwp: 0, solarAccessPercent: 0, wattage: t.wattage, _acc: 0 };
    g.modules++; g.kwp += t.wattage / 1000; g._acc += shading.panelAnnual[p.id] ?? 1;
    groups.set(key, g);
  }
  const segments = [...groups.values()].map(({ _acc, ...g }) => ({ ...g, kwp: r2(g.kwp), solarAccessPercent: r2((_acc / g.modules) * 100) }));

  const components: ComponentRow[] = [];
  const counts = new Map<string, number>();
  for (const p of c.panels) if (validIds.has(p.id)) counts.set(p.typeId, (counts.get(p.typeId) ?? 0) + 1);
  for (const [id, n] of counts) components.push({ label: 'Modules', name: types.get(id)?.name ?? 'Module', quantity: n });
  components.push({ label: 'Inverters', name: i.inverterName?.trim() || 'Not specified', quantity: i.inverterKw && i.inverterKw > 0 ? Math.ceil(acKw / i.inverterKw) : null });
  components.push({ label: 'Structure', name: i.structureName?.trim() || 'Not specified', quantity: null });

  const co2Kg = annualAc * i.co2KgPerKwh;
  return {
    installedKwp: kwp, validPanels: summary.validPanelCount, acKw, dcAcRatio: acKw ? r2(kwp / acKw) : 0,
    annualAcKwh: r2(annualAc), annualDcKwh: r2(annualDc), specificGeneration: kwp ? r2(annualAc / kwp) : 0,
    performanceRatioPercent: kwp && stage.poa ? r2((annualAc / (kwp * stage.poa)) * 100) : 0,
    shadowFreePercent: r2(shading.shadowFreePercent), months, losses, segments, components,
    environment: { co2Tonnes: r2(co2Kg / 1000), trees: Math.round(co2Kg / (i.kgCo2PerTreePerYear || 21)) },
    avgMonthlyKwh: r2(annualAc / 12), shading, assumptions: REPORT_ASSUMPTIONS,
  };
}
