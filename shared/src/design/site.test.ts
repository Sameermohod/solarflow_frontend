import { describe, expect, it } from 'vitest';
import { generateBuilding } from './planes';
import { measureOutline, minAreaRect, osmFloors, parseOverpassBuildings, pickBuilding, toPlanMetres, type LatLon } from './site';

/** A rectangle of a x b metres at (lat, lon), rotated clockwise by rot degrees (as seen on a north-up map). */
function ring(lat: number, lon: number, a: number, b: number, rot: number): LatLon[] {
  const kLat = 111194.9; const kLon = 111194.9 * Math.cos((lat * Math.PI) / 180);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => {
    const x = (i! * a) / 2; const y = (j! * b) / 2; const t = (rot * Math.PI) / 180;
    const e = x * Math.cos(t) - y * Math.sin(t); const s = x * Math.sin(t) + y * Math.cos(t);
    return { lat: lat - s / kLat, lon: lon + e / kLon };
  });
}

describe('site geometry', () => {
  it('measures a rotated rectangle', () => {
    const m = measureOutline(ring(21.1458, 79.0882, 20, 8, 30))!;
    expect(m.rect.lengthM).toBeCloseTo(20, 1);
    expect(m.rect.widthM).toBeCloseTo(8, 1);
    expect(m.rect.orientationDeg).toBeCloseTo(30, 1);
    expect(m.areaM2).toBeCloseTo(160, 0);
    expect(m.rect.fill).toBeCloseTo(1, 2);
  });

  it('the orientation reproduces the footprint through the building generator', () => {
    for (const rot of [0, 30, -50, 85]) {
      const m = measureOutline(ring(19.07, 72.87, 15, 9, rot))!;
      const g = generateBuilding({ lengthM: m.rect.lengthM, widthM: m.rect.widthM, floors: 1, floorHeightM: 3, roofType: 'FLAT', roofAngleDeg: 0, ridgeAlong: 'LENGTH', orientationDeg: m.rect.orientationDeg });
      const target = toPlanMetres(ring(19.07, 72.87, 15, 9, rot), m.origin);
      for (const c of g.footprint) {
        const near = Math.min(...target.map((t) => Math.hypot(t.x - (c.x + m.rect.centre.x), t.y - (c.y + m.rect.centre.y))));
        expect(near).toBeLessThan(0.05);
      }
    }
  });

  it('approximates an L-shaped outline by its bounding rectangle and reports the fill', () => {
    const l = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }];
    const r = minAreaRect(l)!;
    expect(r.lengthM).toBeCloseTo(10, 6); expect(r.widthM).toBeCloseTo(10, 6);
    expect(r.fill).toBeCloseTo(64 / 100, 6);
  });

  it('rejects degenerate outlines', () => {
    expect(measureOutline([{ lat: 1, lon: 1 }, { lat: 1, lon: 1 }, { lat: 1, lon: 1 }])).toBeNull();
    expect(measureOutline([{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }])).toBeNull();
    expect(measureOutline([{ lat: 100, lon: 1 }, { lat: 1, lon: 1 }, { lat: 2, lon: 2 }])).toBeNull();
  });

  it('parses Overpass output and picks the containing building', () => {
    const a = ring(21.1, 79.1, 20, 10, 0); const b = ring(21.1002, 79.1004, 10, 10, 0);
    const mk = (id: number, r: LatLon[], tags = {}) => ({ type: 'way', id, tags: { building: 'yes', ...tags }, geometry: [...r, r[0]!].map((p) => ({ lat: p.lat, lon: p.lon })) });
    const bs = parseOverpassBuildings({ elements: [mk(1, a, { 'building:levels': '3' }), mk(2, b), { type: 'node', id: 9 }, { type: 'way', id: 3, geometry: [] }] });
    expect(bs.map((x) => x.id)).toEqual([1, 2]);
    expect(bs[0]!.ring).toHaveLength(4);
    const hit = pickBuilding(bs, { lat: 21.1, lon: 79.1 })!;
    expect(hit.building.id).toBe(1); expect(hit.inside).toBe(true);
    expect(osmFloors(hit.building.tags)).toBe(3);
    expect(pickBuilding(bs, { lat: 21.2, lon: 79.2 })).toBeNull();
    expect(osmFloors({})).toBeNull();
  });
});
