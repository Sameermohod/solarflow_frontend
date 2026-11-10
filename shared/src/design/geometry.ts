/**
 * 2D computational geometry for solar layout validation. Pure functions, metres, plan/section axes
 * as supplied by the caller. Tolerances are explicit so touching panels are not reported as overlapping.
 */
export interface Vec2 { x: number; y: number }
export const EPS = 1e-6;

export const rad = (deg: number) => (deg * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
export const len = (a: Vec2) => Math.hypot(a.x, a.y);

/** Rotate clockwise (for y-down plan axes) by `degrees` about `c`. */
export function rotatePoint(p: Vec2, degrees: number, c: Vec2 = { x: 0, y: 0 }): Vec2 {
  const r = rad(degrees);
  const cs = Math.cos(r);
  const sn = Math.sin(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs };
}

/** Absolute polygon area (shoelace). */
export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function bbox(poly: Vec2[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS * EPS) return len(sub(p, a));
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return len(sub(p, { x: a.x + ab.x * t, y: a.y + ab.y * t }));
}

/** True when p lies in the polygon; points within EPS of the boundary count as inside. */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  for (let i = 0; i < poly.length; i++) if (pointSegmentDistance(p, poly[i]!, poly[(i + 1) % poly.length]!) < 1e-7) return true;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const orient = (a: Vec2, b: Vec2, c: Vec2) => cross(sub(b, a), sub(c, a));

/** Segments cross at a single interior point of both (touching endpoints / collinear overlap do not count). */
export function segmentsCrossProperly(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  const t = 1e-9;
  return ((o1 > t && o2 < -t) || (o1 < -t && o2 > t)) && ((o3 > t && o4 < -t) || (o3 < -t && o4 > t));
}

export function segmentSegmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (segmentsCrossProperly(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

/** Corners (counter-clockwise in a y-up frame) of a w×h rectangle centred at (cx, cy), rotated by `rotDeg`. */
export function rectCorners(cx: number, cy: number, w: number, h: number, rotDeg = 0): Vec2[] {
  const c = { x: cx, y: cy };
  return [
    { x: cx - w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy + h / 2 }, { x: cx - w / 2, y: cy + h / 2 },
  ].map((p) => (rotDeg === 0 ? p : rotatePoint(p, rotDeg, c)));
}

function projectOnto(poly: Vec2[], axis: Vec2): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly) {
    const d = dot(p, axis);
    lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  return [lo, hi];
}

/** Separating-axis test for two convex polygons. Overlap must exceed `tol` metres, so edge contact is not overlap. */
export function convexOverlap(A: Vec2[], B: Vec2[], tol = 1e-4): boolean {
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const e = sub(poly[(i + 1) % poly.length]!, poly[i]!);
      const l = len(e);
      if (l < EPS) continue;
      const axis = { x: -e.y / l, y: e.x / l };
      const [a0, a1] = projectOnto(A, axis);
      const [b0, b1] = projectOnto(B, axis);
      if (Math.min(a1, b1) - Math.max(a0, b0) <= tol) return false;
    }
  }
  return true;
}

function pointConvexDistance(p: Vec2, poly: Vec2[]): number {
  if (pointInPolygon(p, poly)) return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, pointSegmentDistance(p, poly[i]!, poly[(i + 1) % poly.length]!));
  return d;
}

/** Minimum distance between two convex polygons (0 when overlapping or touching). */
export function convexDistance(A: Vec2[], B: Vec2[]): number {
  if (convexOverlap(A, B, -1e-9)) return 0;
  let d = Infinity;
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) d = Math.min(d, segmentSegmentDistance(A[i]!, A[(i + 1) % A.length]!, B[j]!, B[(j + 1) % B.length]!));
  return d;
}

/** Distance from a convex polygon (panel) to a circle's edge; 0 when overlapping. */
export function convexCircleDistance(poly: Vec2[], c: Vec2, r: number): number {
  return Math.max(0, pointConvexDistance(c, poly) - r);
}

/** True when `inner` (convex) lies fully inside `outer` (any simple polygon). Boundary contact is allowed. */
export function polygonInside(inner: Vec2[], outer: Vec2[]): boolean {
  if (!inner.every((p) => pointInPolygon(p, outer))) return false;
  for (let i = 0; i < inner.length; i++) {
    for (let j = 0; j < outer.length; j++) {
      if (segmentsCrossProperly(inner[i]!, inner[(i + 1) % inner.length]!, outer[j]!, outer[(j + 1) % outer.length]!)) return false;
    }
  }
  return true;
}

/** Shortest distance from a convex polygon to the boundary (edges) of `outer`. */
export function distanceToBoundary(inner: Vec2[], outer: Vec2[]): number {
  let d = Infinity;
  for (let j = 0; j < outer.length; j++) {
    const a = outer[j]!;
    const b = outer[(j + 1) % outer.length]!;
    for (let i = 0; i < inner.length; i++) d = Math.min(d, segmentSegmentDistance(inner[i]!, inner[(i + 1) % inner.length]!, a, b));
  }
  return d;
}

/** Any-overlap test between a convex polygon and an arbitrary (possibly concave) polygon. */
export function polygonsIntersect(convex: Vec2[], other: Vec2[]): boolean {
  if (convex.some((p) => pointInPolygon(p, other)) && convex.some((p) => !pointOnBoundary(p, other))) return true;
  if (other.some((p) => pointInPolygon(p, convex) && !pointOnBoundary(p, convex))) return true;
  for (let i = 0; i < convex.length; i++) for (let j = 0; j < other.length; j++) if (segmentsCrossProperly(convex[i]!, convex[(i + 1) % convex.length]!, other[j]!, other[(j + 1) % other.length]!)) return true;
  return false;
}

function pointOnBoundary(p: Vec2, poly: Vec2[]) {
  for (let i = 0; i < poly.length; i++) if (pointSegmentDistance(p, poly[i]!, poly[(i + 1) % poly.length]!) < 1e-7) return true;
  return false;
}

export const snap = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v);

/**
 * Offset a simple polygon inwards by `d` (used to DRAW the setback boundary; validation uses exact distances instead).
 * Returns null when the polygon collapses (too thin for the offset).
 */
export function insetPolygon(poly: Vec2[], d: number): Vec2[] | null {
  const n = poly.length;
  if (n < 3) return null;
  if (d <= 0) return poly.map((p) => ({ ...p }));
  let area2 = 0;
  for (let i = 0; i < n; i++) { const p = poly[i]!; const q = poly[(i + 1) % n]!; area2 += p.x * q.y - q.x * p.y; }
  const sign = area2 >= 0 ? 1 : -1;
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n]!;
    const e = sub(q, p);
    const l = len(e) || 1;
    const nrm = { x: (-e.y / l) * sign, y: (e.x / l) * sign };
    return { p: { x: p.x + nrm.x * d, y: p.y + nrm.y * d }, e };
  });
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = lines[(i + n - 1) % n]!;
    const b = lines[i]!;
    const den = cross(a.e, b.e);
    if (Math.abs(den) < 1e-9) { out.push(b.p); continue; }
    const t = cross(sub(b.p, a.p), b.e) / den;
    out.push({ x: a.p.x + a.e.x * t, y: a.p.y + a.e.y * t });
  }
  let a2 = 0;
  for (let i = 0; i < n; i++) { const p = out[i]!; const q = out[(i + 1) % n]!; a2 += p.x * q.y - q.x * p.y; }
  if (a2 * sign <= 1e-9) return null;
  return out.every((p) => pointInPolygon(p, poly)) ? out : null;
}
