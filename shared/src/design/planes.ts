import { rad, rotatePoint, type Vec2 } from './geometry';
import { DEFAULT_PANEL_TYPE, type Building, type DesignConfig, type RoofSection, type RoofType } from './types';

/**
 * Section frame ⇄ plan ⇄ world transforms. Used by BOTH the 2D editor and the 3D viewer, which is what
 * guarantees they show the same geometry.
 *
 * Plan: x east, y south, z up (height). Section: u right, v up-slope.
 * The slope faces azimuth α: f = (sin α, −cos α) in plan. U = (f.y, −f.x) (rightwards looking up-slope),
 * V = (−f.x, −f.y) (horizontal direction of increasing v). A point (u, v) on a section tilted by θ is at
 *   plan   = origin + u·U + v·cosθ·V
 *   height = baseHeight + v·sinθ
 */
export interface Vec3 { x: number; y: number; z: number }

export function sectionAxes(s: Pick<RoofSection, 'azimuthDeg'>) {
  const a = rad(s.azimuthDeg);
  const f = { x: Math.sin(a), y: -Math.cos(a) };
  return { U: { x: f.y, y: -f.x }, V: { x: -f.x, y: -f.y } };
}

export function localToPlan(s: RoofSection, u: number, v: number): Vec2 {
  const { U, V } = sectionAxes(s);
  const c = Math.cos(rad(s.tiltDeg));
  return { x: s.originX + u * U.x + v * c * V.x, y: s.originY + u * U.y + v * c * V.y };
}

export const localToHeight = (s: RoofSection, v: number) => s.baseHeightM + v * Math.sin(rad(s.tiltDeg));

export function localToWorld(s: RoofSection, u: number, v: number): Vec3 {
  const p = localToPlan(s, u, v);
  return { x: p.x, y: p.y, z: localToHeight(s, v) };
}

export function planToLocal(s: RoofSection, x: number, y: number): Vec2 {
  const { U, V } = sectionAxes(s);
  const dx = x - s.originX;
  const dy = y - s.originY;
  const c = Math.cos(rad(s.tiltDeg));
  return { x: dx * U.x + dy * U.y, y: (dx * V.x + dy * V.y) / (c || 1) };
}

/** Basis for placing the section in a 3D scene with Three.js axes (x east, y UP, z south). */
export function sectionBasis3D(s: RoofSection) {
  const { U, V } = sectionAxes(s);
  const t = rad(s.tiltDeg);
  const u: [number, number, number] = [U.x, 0, U.y];
  const v: [number, number, number] = [V.x * Math.cos(t), Math.sin(t), V.y * Math.cos(t)];
  const n: [number, number, number] = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return { origin: [s.originX, s.baseHeightM, s.originY] as [number, number, number], u, v, n };
}

/** Wall polygons are in (x, y plan, z height). */
export interface GeneratedBuilding {
  footprint: Vec2[];
  walls: Vec3[][];
  sections: RoofSection[];
  eaveHeightM: number;
  ridgeHeightM: number;
}

const poly = (pts: [number, number][]) => pts.map(([x, y]) => ({ x, y }));
const rectPoly = (w: number, h: number) => poly([[0, 0], [w, 0], [w, h], [0, h]]);

export function eaveHeight(b: Pick<Building, 'floors' | 'floorHeightM'>) {
  return b.floors * b.floorHeightM;
}

/**
 * Build the walls and roof sections for a parametric building. Section ids are deterministic per roof type
 * (roof-1 … roof-4) so panels survive edits to dimensions and angles.
 */
export function generateBuilding(b: Building, setbackM = 0.5): GeneratedBuilding {
  const H = eaveHeight(b);
  const th = rad(b.roofAngleDeg);
  const tan = Math.tan(th);
  const cos = Math.cos(th);
  const hipAlongWidth = b.roofType === 'HIP' && b.widthM > b.lengthM;
  const alongWidth = hipAlongWidth || (b.roofType !== 'HIP' && b.ridgeAlong === 'WIDTH');
  // Generator frame: ridge runs along x. a = extent along x, bb = extent along y. Rotate 90° if the ridge runs along the width.
  const a = alongWidth ? b.widthM : b.lengthM;
  const bb = alongWidth ? b.lengthM : b.widthM;
  const half = bb / 2;
  const run = cos > 1e-9 ? half / cos : half;
  const sections: Omit<RoofSection, 'setbackM'>[] = [];
  const walls: Vec3[][] = [];
  const W = (pts: [number, number, number][]) => pts.map(([x, y, z]) => ({ x, y, z }));
  const eaveRects = (heightN: number) => {
    walls.push(
      W([[-a / 2, bb / 2, 0], [a / 2, bb / 2, 0], [a / 2, bb / 2, H], [-a / 2, bb / 2, H]]), // south
      W([[a / 2, -bb / 2, 0], [-a / 2, -bb / 2, 0], [-a / 2, -bb / 2, heightN], [a / 2, -bb / 2, heightN]]), // north
    );
  };
  let ridge = H;

  switch (b.roofType) {
    case 'FLAT':
      sections.push({ id: 'roof-1', name: 'Roof', polygon: rectPoly(a, bb), originX: -a / 2, originY: bb / 2, azimuthDeg: 180, tiltDeg: 0, baseHeightM: H });
      eaveRects(H);
      walls.push(W([[a / 2, bb / 2, 0], [a / 2, -bb / 2, 0], [a / 2, -bb / 2, H], [a / 2, bb / 2, H]]), W([[-a / 2, -bb / 2, 0], [-a / 2, bb / 2, 0], [-a / 2, bb / 2, H], [-a / 2, -bb / 2, H]]));
      break;
    case 'SHED': {
      const rise = bb * tan;
      ridge = H + rise;
      sections.push({ id: 'roof-1', name: 'Roof slope', polygon: rectPoly(a, run * 2), originX: -a / 2, originY: bb / 2, azimuthDeg: 180, tiltDeg: b.roofAngleDeg, baseHeightM: H });
      eaveRects(H + rise);
      walls.push(W([[a / 2, bb / 2, 0], [a / 2, -bb / 2, 0], [a / 2, -bb / 2, H + rise], [a / 2, bb / 2, H]]), W([[-a / 2, -bb / 2, 0], [-a / 2, bb / 2, 0], [-a / 2, bb / 2, H], [-a / 2, -bb / 2, H + rise]]));
      break;
    }
    case 'GABLE': {
      ridge = H + half * tan;
      sections.push(
        { id: 'roof-1', name: 'South slope', polygon: rectPoly(a, run), originX: -a / 2, originY: bb / 2, azimuthDeg: 180, tiltDeg: b.roofAngleDeg, baseHeightM: H },
        { id: 'roof-2', name: 'North slope', polygon: rectPoly(a, run), originX: a / 2, originY: -bb / 2, azimuthDeg: 0, tiltDeg: b.roofAngleDeg, baseHeightM: H },
      );
      eaveRects(H);
      walls.push(
        W([[a / 2, bb / 2, 0], [a / 2, -bb / 2, 0], [a / 2, -bb / 2, H], [a / 2, 0, ridge], [a / 2, bb / 2, H]]),
        W([[-a / 2, -bb / 2, 0], [-a / 2, bb / 2, 0], [-a / 2, bb / 2, H], [-a / 2, 0, ridge], [-a / 2, -bb / 2, H]]),
      );
      break;
    }
    case 'HIP': {
      ridge = H + half * tan;
      const trap = poly([[0, 0], [a, 0], [a - half, run], [half, run]]);
      const tri = poly([[0, 0], [bb, 0], [bb / 2, run]]);
      sections.push(
        { id: 'roof-1', name: 'South slope', polygon: trap, originX: -a / 2, originY: bb / 2, azimuthDeg: 180, tiltDeg: b.roofAngleDeg, baseHeightM: H },
        { id: 'roof-2', name: 'North slope', polygon: trap, originX: a / 2, originY: -bb / 2, azimuthDeg: 0, tiltDeg: b.roofAngleDeg, baseHeightM: H },
        { id: 'roof-3', name: 'East hip', polygon: tri, originX: a / 2, originY: bb / 2, azimuthDeg: 90, tiltDeg: b.roofAngleDeg, baseHeightM: H },
        { id: 'roof-4', name: 'West hip', polygon: tri, originX: -a / 2, originY: -bb / 2, azimuthDeg: 270, tiltDeg: b.roofAngleDeg, baseHeightM: H },
      );
      eaveRects(H);
      walls.push(W([[a / 2, bb / 2, 0], [a / 2, -bb / 2, 0], [a / 2, -bb / 2, H], [a / 2, bb / 2, H]]), W([[-a / 2, -bb / 2, 0], [-a / 2, bb / 2, 0], [-a / 2, bb / 2, H], [-a / 2, -bb / 2, H]]));
      break;
    }
  }

  const rho = (alongWidth ? 90 : 0) + b.orientationDeg;
  const R = (p: Vec2) => rotatePoint(p, rho);
  const rotWalls = walls.map((w) => w.map((p) => ({ ...R(p), z: p.z })));
  const footprint = [{ x: -b.lengthM / 2, y: -b.widthM / 2 }, { x: b.lengthM / 2, y: -b.widthM / 2 }, { x: b.lengthM / 2, y: b.widthM / 2 }, { x: -b.lengthM / 2, y: b.widthM / 2 }].map((p) => rotatePoint(p, b.orientationDeg));
  return {
    footprint,
    walls: rotWalls,
    sections: sections.map((s) => ({ ...s, ...(() => { const o = R({ x: s.originX, y: s.originY }); return { originX: o.x, originY: o.y }; })(), azimuthDeg: ((s.azimuthDeg + rho) % 360 + 360) % 360, setbackM })),
    eaveHeightM: H,
    ridgeHeightM: ridge,
  };
}

export interface DefaultConfigInput {
  lengthM: number;
  widthM: number;
  floors?: number;
  floorHeightM?: number;
  roofType?: RoofType;
  roofAngleDeg?: number;
  orientationDeg?: number;
  units?: 'METRIC' | 'IMPERIAL';
}

export function createDefaultConfig(i: DefaultConfigInput): DesignConfig {
  const roofType = i.roofType ?? 'FLAT';
  const building: Building = {
    lengthM: i.lengthM, widthM: i.widthM, floors: i.floors ?? 2, floorHeightM: i.floorHeightM ?? 3, roofType,
    roofAngleDeg: roofType === 'FLAT' ? 0 : i.roofAngleDeg ?? 25, ridgeAlong: 'LENGTH', orientationDeg: i.orientationDeg ?? 0,
  };
  const g = generateBuilding(building);
  return {
    schemaVersion: 1,
    units: i.units ?? 'METRIC',
    building,
    roofSections: g.sections,
    obstacles: [], zones: [],
    panelTypes: [DEFAULT_PANEL_TYPE],
    panels: [],
    layout: { orientation: 'AUTO', gapXM: 0.02, gapYM: 0.02, mountTiltDeg: 0, designSunElevationDeg: 22, minSpacingM: 0.01 },
    equipment: [],
    appearance: { panelColor: '#1e3a8a', panelFrameColor: '#cbd5e1', panelMaterial: 'GLOSSY', wallColor: '#e5e7eb', roofColor: '#9a5b4a' },
    meta: {},
  };
}

/**
 * Re-derive the roof sections from the building parameters, keeping the user's setbacks. Panels, obstacles and
 * zones that point at a section id that no longer exists are dropped by the caller (see `reconcileConfig`).
 */
export function regenerateRoof(c: DesignConfig): DesignConfig {
  const setback = c.roofSections[0]?.setbackM ?? 0.5;
  const g = generateBuilding(c.building, setback);
  const prev = new Map(c.roofSections.map((s) => [s.id, s]));
  const roofSections = g.sections.map((s) => ({ ...s, setbackM: prev.get(s.id)?.setbackM ?? setback }));
  return reconcileConfig({ ...c, roofSections });
}

/** Drop items that reference sections / panel types that no longer exist. */
export function reconcileConfig(c: DesignConfig): DesignConfig {
  const sections = new Set(c.roofSections.map((s) => s.id));
  const types = new Set(c.panelTypes.map((t) => t.id));
  return {
    ...c,
    panels: c.panels.filter((p) => sections.has(p.sectionId) && types.has(p.typeId)),
    obstacles: c.obstacles.filter((o) => sections.has(o.sectionId)),
    zones: c.zones.filter((z) => sections.has(z.sectionId)),
  };
}
