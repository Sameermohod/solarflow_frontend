import { deg, pointInPolygon, pointSegmentDistance, polygonArea, rad, type Vec2 } from './geometry';

/**
 * Site-location geometry: turns map coordinates (a traced roof outline or an OpenStreetMap building footprint)
 * into the metre-based building parameters the designer uses. Pure functions, no network.
 *
 * Accuracy notes: an equirectangular projection about the outline's own centre is used; over a building-sized
 * area the error is far below the accuracy of a hand-traced outline. The parametric building is a rectangle, so an
 * irregular footprint is approximated by its minimum-area bounding rectangle (see minAreaRect).
 */
export interface LatLon { lat: number; lon: number }

const EARTH_R = 6371008.8;

export const validLatLon = (p: LatLon) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

export function centroidLatLon(pts: LatLon[]): LatLon {
  const n = pts.length || 1;
  return { lat: pts.reduce((a, p) => a + p.lat, 0) / n, lon: pts.reduce((a, p) => a + p.lon, 0) / n };
}

/** Project to the plan frame used by the designer: x = east, y = south (y down), metres, relative to origin. */
export function toPlanMetres(pts: LatLon[], origin: LatLon): Vec2[] {
  const k = Math.cos(rad(origin.lat));
  return pts.map((p) => ({ x: rad(p.lon - origin.lon) * EARTH_R * k, y: -rad(p.lat - origin.lat) * EARTH_R }));
}

export function convexHull(points: Vec2[]): Vec2[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cr = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: Vec2[] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  const up: Vec2[] = [];
  for (const q of [...p].reverse()) { while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

export interface FootprintRect {
  /** Long side, short side (m). */
  lengthM: number; widthM: number;
  /** Direction of the long side in the plan frame (clockwise from east, y down), in (-90, 90]. Matches Building.orientationDeg. */
  orientationDeg: number;
  centre: Vec2;
  corners: Vec2[];
  /** Footprint area divided by rectangle area (1 = the outline is a perfect rectangle). */
  fill: number;
}

/** Minimum-area bounding rectangle (rotating calipers over the convex hull). */
export function minAreaRect(poly: Vec2[]): FootprintRect | null {
  const hull = convexHull(poly);
  if (hull.length < 3 || polygonArea(poly) < 1e-6) return null;
  let best: { area: number; ang: number; minX: number; maxX: number; minY: number; maxY: number } | null = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!; const b = hull[(i + 1) % hull.length]!;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const c = Math.cos(-ang); const s = Math.sin(-ang);
    let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
    for (const p of hull) { const x = p.x * c - p.y * s; const y = p.x * s + p.y * c; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const area = (maxX - minX) * (maxY - minY);
    if (!best || area < best.area - 1e-9) best = { area, ang, minX, maxX, minY, maxY };
  }
  if (!best) return null;
  let { ang } = best;
  let w = best.maxX - best.minX; let h = best.maxY - best.minY;
  if (h > w) { [w, h] = [h, w]; ang += Math.PI / 2; }
  let od = deg(ang);
  while (od > 90) od -= 180;
  while (od <= -90) od += 180;
  const cx = (best.minX + best.maxX) / 2; const cy = (best.minY + best.maxY) / 2;
  const c0 = Math.cos(best.ang); const s0 = Math.sin(best.ang);
  const centre = { x: cx * c0 - cy * s0, y: cx * s0 + cy * c0 };
  const u = { x: Math.cos(rad(od)), y: Math.sin(rad(od)) }; const v = { x: -u.y, y: u.x };
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => ({ x: centre.x + (i! * w * u.x + j! * h * v.x) / 2, y: centre.y + (i! * w * u.y + j! * h * v.y) / 2 }));
  return { lengthM: w, widthM: h, orientationDeg: od, centre, corners, fill: polygonArea(poly) / (w * h) };
}

/** Measure a traced / fetched outline. Returns null for degenerate outlines. */
export function measureOutline(ring: LatLon[]) {
  if (ring.length < 3 || ring.some((p) => !validLatLon(p))) return null;
  const origin = centroidLatLon(ring);
  const plan = toPlanMetres(ring, origin);
  const rect = minAreaRect(plan);
  if (!rect) return null;
  const rectCentre: LatLon = { lat: origin.lat - deg(rect.centre.y / EARTH_R), lon: origin.lon + deg(rect.centre.x / (EARTH_R * Math.cos(rad(origin.lat)))) };
  const perimeterM = plan.reduce((a, p, i) => { const q = plan[(i + 1) % plan.length]!; return a + Math.hypot(p.x - q.x, p.y - q.y); }, 0);
  return { areaM2: polygonArea(plan), perimeterM, rect, centre: rectCentre, origin };
}

export interface OsmBuilding { id: number; ring: LatLon[]; tags: Record<string, string> }

/** Reads an Overpass API response for way[building] queries made with "out geom". */
export function parseOverpassBuildings(json: unknown): OsmBuilding[] {
  const els = (json as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(els)) return [];
  const out: OsmBuilding[] = [];
  for (const e of els as { type?: string; id?: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[]) {
    if (e?.type !== 'way' || !Array.isArray(e.geometry) || e.geometry.length < 4) continue;
    let ring = e.geometry.map((g) => ({ lat: g.lat, lon: g.lon }));
    const f = ring[0]!; const l = ring[ring.length - 1]!;
    if (f.lat === l.lat && f.lon === l.lon) ring = ring.slice(0, -1);
    if (ring.length >= 3 && ring.every(validLatLon) && typeof e.id === 'number') out.push({ id: e.id, ring, tags: e.tags ?? {} });
  }
  return out;
}

/** The building containing the point, otherwise the nearest outline within maxM. */
export function pickBuilding(buildings: OsmBuilding[], at: LatLon, maxM = 25): { building: OsmBuilding; inside: boolean; distanceM: number } | null {
  let best: { building: OsmBuilding; inside: boolean; distanceM: number } | null = null;
  for (const b of buildings) {
    const plan = toPlanMetres(b.ring, at);
    const origin = { x: 0, y: 0 };
    const inside = pointInPolygon(origin, plan);
    let d = 0;
    if (!inside) { d = Infinity; for (let i = 0; i < plan.length; i++) d = Math.min(d, pointSegmentDistance(origin, plan[i]!, plan[(i + 1) % plan.length]!)); }
    if (!inside && d > maxM) continue;
    if (!best || (inside && !best.inside) || (inside === best.inside && d < best.distanceM)) best = { building: b, inside, distanceM: d };
  }
  return best;
}

/** Real tag values only: storeys from building:levels, never guessed. */
export function osmFloors(tags: Record<string, string>): number | null {
  const n = Number.parseInt(tags['building:levels'] ?? '', 10);
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : null;
}

/** Inverse of toPlanMetres. */
export function fromPlanMetres(pts: Vec2[], origin: LatLon): LatLon[] {
  const k = Math.cos(rad(origin.lat));
  return pts.map((p) => ({ lat: origin.lat - deg(p.y / EARTH_R), lon: origin.lon + deg(p.x / (EARTH_R * k)) }));
}
