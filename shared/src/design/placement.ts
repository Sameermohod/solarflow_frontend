import {
  bbox, convexCircleDistance, convexDistance, convexOverlap, distanceToBoundary, polygonArea, polygonInside, polygonsIntersect, rad, rectCorners, type Vec2,
} from './geometry';
import { uid, type DesignConfig, type Obstacle, type Panel, type PanelType, type RoofSection } from './types';

/** Tolerance when comparing clearances, so a panel placed exactly on its setback line is accepted. */
const TOL = 1e-4;

export type IssueType = 'OUTSIDE' | 'SETBACK' | 'OBSTACLE' | 'RESTRICTED' | 'OVERLAP' | 'SPACING' | 'UNKNOWN';
export interface PanelIssue { type: IssueType; severity: 'error' | 'warning'; message: string; otherId?: string }

export const ISSUE_LABELS: Record<IssueType, string> = {
  OUTSIDE: 'Outside usable roof', SETBACK: 'Inside setback', OBSTACLE: 'Too close to obstacle', RESTRICTED: 'In restricted zone',
  OVERLAP: 'Overlaps another panel', SPACING: 'Spacing below minimum', UNKNOWN: 'Invalid reference',
};

/** Plan-view footprint of a panel (rows tilted on a flat roof foreshorten by cos(tilt)). */
export function panelSize(p: Pick<Panel, 'orientation' | 'tiltDeg'>, t: Pick<PanelType, 'widthM' | 'lengthM'>) {
  const portrait = p.orientation === 'PORTRAIT';
  const w = portrait ? t.widthM : t.lengthM;
  const h = (portrait ? t.lengthM : t.widthM) * Math.cos(rad(p.tiltDeg));
  return { w, h, fullH: portrait ? t.lengthM : t.widthM };
}

export function panelCorners(p: Panel, t: PanelType): Vec2[] {
  const s = panelSize(p, t);
  return rectCorners(p.x, p.y, s.w, s.h, p.rotationDeg);
}

function obstacleClearance(corners: Vec2[], o: Obstacle): number {
  return o.shape === 'CIRCLE' ? convexCircleDistance(corners, { x: o.x, y: o.y }, o.r) : convexDistance(corners, rectCorners(o.x, o.y, o.w, o.h, 0));
}

export interface LayoutReport {
  issues: Record<string, PanelIssue[]>;
  validIds: Set<string>;
  errorIds: Set<string>;
  minSpacingM: number | null;
}

export function validateLayout(c: DesignConfig): LayoutReport {
  const types = new Map(c.panelTypes.map((t) => [t.id, t]));
  const sections = new Map(c.roofSections.map((s) => [s.id, s]));
  const issues: Record<string, PanelIssue[]> = {};
  const add = (id: string, i: PanelIssue) => { (issues[id] ??= []).push(i); };
  const bySection = new Map<string, { p: Panel; corners: Vec2[]; cx: number; cy: number; r: number }[]>();

  for (const p of c.panels) {
    const t = types.get(p.typeId);
    const s = sections.get(p.sectionId);
    if (!t || !s) { add(p.id, { type: 'UNKNOWN', severity: 'error', message: 'References a missing roof section or panel type' }); continue; }
    const corners = panelCorners(p, t);
    const sz = panelSize(p, t);
    (bySection.get(p.sectionId) ?? bySection.set(p.sectionId, []).get(p.sectionId)!).push({ p, corners, cx: p.x, cy: p.y, r: Math.hypot(sz.w, sz.h) / 2 });

    if (!polygonInside(corners, s.polygon)) add(p.id, { type: 'OUTSIDE', severity: 'error', message: 'Extends beyond the roof edge' });
    else if (s.setbackM > 0 && distanceToBoundary(corners, s.polygon) < s.setbackM - TOL) add(p.id, { type: 'SETBACK', severity: 'error', message: `Closer than the ${s.setbackM} m edge setback` });

    for (const o of c.obstacles) {
      if (o.sectionId !== s.id) continue;
      const d = obstacleClearance(corners, o);
      if (d < o.clearanceM - TOL) add(p.id, { type: 'OBSTACLE', severity: 'error', message: d <= TOL ? 'Overlaps an obstacle' : `Only ${d.toFixed(2)} m from an obstacle (needs ${o.clearanceM} m)` });
    }
    for (const z of c.zones) if (z.sectionId === s.id && polygonsIntersect(corners, z.polygon)) add(p.id, { type: 'RESTRICTED', severity: 'error', message: `Inside restricted zone “${z.name}”` });
  }

  let minGap: number | null = null;
  for (const list of bySection.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        const dc = Math.hypot(a.cx - b.cx, a.cy - b.cy);
        if (dc > a.r + b.r + c.layout.minSpacingM + 0.5) continue; // cheap bounding-circle reject
        if (convexOverlap(a.corners, b.corners)) {
          add(a.p.id, { type: 'OVERLAP', severity: 'error', message: 'Overlaps another panel', otherId: b.p.id });
          add(b.p.id, { type: 'OVERLAP', severity: 'error', message: 'Overlaps another panel', otherId: a.p.id });
          continue;
        }
        const gap = convexDistance(a.corners, b.corners);
        if (dc <= a.r + b.r + 1) minGap = minGap === null ? gap : Math.min(minGap, gap);
        if (gap < c.layout.minSpacingM - TOL) {
          add(a.p.id, { type: 'SPACING', severity: 'warning', message: `Only ${(gap * 1000).toFixed(0)} mm from a neighbouring panel`, otherId: b.p.id });
          add(b.p.id, { type: 'SPACING', severity: 'warning', message: `Only ${(gap * 1000).toFixed(0)} mm from a neighbouring panel`, otherId: a.p.id });
        }
      }
    }
  }

  const errorIds = new Set<string>();
  const validIds = new Set<string>();
  for (const p of c.panels) {
    if ((issues[p.id] ?? []).some((i) => i.severity === 'error')) errorIds.add(p.id);
    else validIds.add(p.id);
  }
  return { issues, validIds, errorIds, minSpacingM: minGap };
}

export interface DesignSummary {
  panelCount: number;
  validPanelCount: number;
  invalidPanelCount: number;
  warningCount: number;
  /** Capacity of panels with no errors; this is the number to quote. */
  installedKwp: number;
  /** Capacity of every placed panel, including invalid ones. */
  placedKwp: number;
  panelAreaM2: number;
  roofAreaM2: number;
  coveragePercent: number;
  issueCounts: Partial<Record<IssueType, number>>;
  bySection: { id: string; name: string; panels: number; kwp: number; roofAreaM2: number; azimuthDeg: number; tiltDeg: number }[];
  minSpacingM: number | null;
  targetPanels: number | null;
  targetDeltaPanels: number | null;
}

export function summarizeDesign(c: DesignConfig, report: LayoutReport = validateLayout(c)): DesignSummary {
  const types = new Map(c.panelTypes.map((t) => [t.id, t]));
  const secs = new Map(c.roofSections.map((s) => [s.id, s]));
  let installed = 0;
  let placed = 0;
  let area = 0;
  const per = new Map<string, { panels: number; kwp: number }>();
  for (const p of c.panels) {
    const t = types.get(p.typeId);
    if (!t) continue;
    const kw = t.wattage / 1000;
    placed += kw;
    area += t.widthM * t.lengthM;
    if (report.validIds.has(p.id)) {
      installed += kw;
      const e = per.get(p.sectionId) ?? { panels: 0, kwp: 0 };
      e.panels++; e.kwp += kw;
      per.set(p.sectionId, e);
    }
  }
  const roofArea = c.roofSections.reduce((n, s) => n + polygonArea(s.polygon), 0);
  const counts: Partial<Record<IssueType, number>> = {};
  let warnings = 0;
  for (const list of Object.values(report.issues)) for (const i of list) { counts[i.type] = (counts[i.type] ?? 0) + 1; if (i.severity === 'warning') warnings++; }
  const target = c.meta.targetPanels ?? null;
  return {
    panelCount: c.panels.length,
    validPanelCount: report.validIds.size,
    invalidPanelCount: report.errorIds.size,
    warningCount: warnings,
    installedKwp: round(installed, 3),
    placedKwp: round(placed, 3),
    panelAreaM2: round(area, 2),
    roofAreaM2: round(roofArea, 2),
    coveragePercent: roofArea > 0 ? round((area / roofArea) * 100, 1) : 0,
    issueCounts: counts,
    bySection: c.roofSections.map((s) => ({ id: s.id, name: s.name, panels: per.get(s.id)?.panels ?? 0, kwp: round(per.get(s.id)?.kwp ?? 0, 3), roofAreaM2: round(polygonArea(secs.get(s.id)!.polygon), 2), azimuthDeg: Math.round(s.azimuthDeg), tiltDeg: s.tiltDeg })),
    minSpacingM: report.minSpacingM === null ? null : round(report.minSpacingM, 3),
    targetPanels: target,
    targetDeltaPanels: target === null ? null : report.validIds.size - target,
  };
}

const round = (n: number, dp: number) => { const f = 10 ** dp; return Math.round((n + Number.EPSILON) * f) / f; };

/**
 * Minimum row-to-row clearance so a rack of height `lengthM·sin(tilt)` does not shade the row behind it when the sun
 * is `sunElevationDeg` above the horizon (flat-roof rows only).
 */
export function rowShadowGapM(lengthM: number, tiltDeg: number, sunElevationDeg: number): number {
  if (tiltDeg <= 0) return 0;
  return (lengthM * Math.sin(rad(tiltDeg))) / Math.tan(rad(Math.max(1, sunElevationDeg)));
}

export interface AutoArrangeOptions {
  typeId?: string;
  orientation?: 'PORTRAIT' | 'LANDSCAPE' | 'AUTO';
  gapXM?: number;
  gapYM?: number;
  mountTiltDeg?: number;
  sunElevationDeg?: number;
  /** Stop after this many panels (e.g. the calculator's recommendation). */
  maxPanels?: number;
  /** Keep existing valid panels in the section and only fill free space. */
  keepExisting?: boolean;
  /** Candidate grid offsets tried per axis; more = better packing on odd shapes, slower. */
  phases?: number;
}

export interface AutoArrangeResult {
  panels: Panel[];
  placed: number;
  orientation: 'PORTRAIT' | 'LANDSCAPE';
  rowGapM: number;
  /** Panels that would fit if the target cap were ignored. */
  capacity: number;
}

/** Whether a candidate panel is acceptable for `section` (roof, setback, obstacles, zones) ignoring other panels. */
function fitsSection(c: DesignConfig, s: RoofSection, corners: Vec2[]): boolean {
  if (!polygonInside(corners, s.polygon)) return false;
  if (s.setbackM > 0 && distanceToBoundary(corners, s.polygon) < s.setbackM - TOL) return false;
  for (const o of c.obstacles) if (o.sectionId === s.id && obstacleClearance(corners, o) < o.clearanceM - TOL) return false;
  for (const z of c.zones) if (z.sectionId === s.id && polygonsIntersect(corners, z.polygon)) return false;
  return true;
}

/**
 * Fill a roof section with panels on a regular grid. Tries both orientations (when AUTO) and several grid
 * offsets and keeps the arrangement that fits the most panels. Pure: returns the new panel list for the section.
 */
export function autoArrange(c: DesignConfig, sectionId: string, o: AutoArrangeOptions = {}): AutoArrangeResult {
  const s = c.roofSections.find((x) => x.id === sectionId);
  if (!s) throw new Error('Roof section not found');
  const typeId = o.typeId ?? c.layout.typeId ?? c.panelTypes[0]!.id;
  const t = c.panelTypes.find((x) => x.id === typeId);
  if (!t) throw new Error('Panel type not found');
  const gapX = o.gapXM ?? c.layout.gapXM;
  const gapY = o.gapYM ?? c.layout.gapYM;
  const tilt = o.mountTiltDeg ?? c.layout.mountTiltDeg;
  const sun = o.sunElevationDeg ?? c.layout.designSunElevationDeg;
  const orientations: ('PORTRAIT' | 'LANDSCAPE')[] = (o.orientation ?? c.layout.orientation) === 'AUTO' ? ['PORTRAIT', 'LANDSCAPE'] : [o.orientation ?? c.layout.orientation] as ('PORTRAIT' | 'LANDSCAPE')[];
  const phases = Math.max(1, o.phases ?? 5);
  const box = bbox(s.polygon);
  const kept = o.keepExisting ? c.panels.filter((p) => p.sectionId === sectionId) : [];
  const keptReport = o.keepExisting ? validateLayout({ ...c, panels: kept }) : null;
  const keptValid = keptReport ? kept.filter((p) => keptReport.validIds.has(p.id)) : [];
  const keptCorners = keptValid.map((p) => panelCorners(p, c.panelTypes.find((x) => x.id === p.typeId)!));

  let best: { list: Panel[]; orientation: 'PORTRAIT' | 'LANDSCAPE'; rowGap: number } | null = null;
  for (const orientation of orientations) {
    const probe: Panel = { id: 'probe', sectionId, typeId, x: 0, y: 0, rotationDeg: 0, orientation, tiltDeg: tilt };
    const sz = panelSize(probe, t);
    const rowGap = Math.max(gapY, rowShadowGapM(sz.fullH, tilt, sun));
    const pitchX = sz.w + gapX;
    const pitchY = sz.h + rowGap;
    for (let px = 0; px < phases; px++) {
      for (let py = 0; py < phases; py++) {
        const x0 = box.minX + (px / phases) * pitchX;
        const y0 = box.minY + (py / phases) * pitchY;
        const list: Panel[] = [];
        for (let j = 0; y0 + j * pitchY + sz.h <= box.maxY + TOL; j++) {
          for (let i = 0; x0 + i * pitchX + sz.w <= box.maxX + TOL; i++) {
            const cx = x0 + i * pitchX + sz.w / 2;
            const cy = y0 + j * pitchY + sz.h / 2;
            const corners = rectCorners(cx, cy, sz.w, sz.h, 0);
            if (!fitsSection(c, s, corners)) continue;
            if (keptCorners.some((k) => convexOverlap(corners, k))) continue;
            list.push({ id: uid('p'), sectionId, typeId, x: cx, y: cy, rotationDeg: 0, orientation, tiltDeg: tilt });
          }
        }
        if (!best || list.length > best.list.length) best = { list, orientation, rowGap };
      }
    }
  }
  const capacity = best?.list.length ?? 0;
  let list = best?.list ?? [];
  if (o.maxPanels !== undefined) list = list.slice(0, Math.max(0, o.maxPanels - keptValid.length));
  return { panels: [...keptValid, ...list], placed: list.length, orientation: best?.orientation ?? 'PORTRAIT', rowGapM: best?.rowGap ?? gapY, capacity };
}

/** Replace the panels of one section with the arrangement from `autoArrange`; other sections are untouched. */
export function applyAutoArrange(c: DesignConfig, sectionId: string, o: AutoArrangeOptions = {}): { config: DesignConfig; result: AutoArrangeResult } {
  const result = autoArrange(c, sectionId, o);
  return { config: { ...c, panels: [...c.panels.filter((p) => p.sectionId !== sectionId), ...result.panels] }, result };
}
