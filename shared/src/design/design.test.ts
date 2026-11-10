import { describe, expect, it } from 'vitest';
import {
  applyAutoArrange, autoArrange, convexDistance, convexOverlap, createDefaultConfig, designConfigSchema, generateBuilding, localToPlan, localToHeight, planToLocal, pointInPolygon,
  polygonArea, polygonInside, rectCorners, regenerateRoof, renderDesignSvg, rotatePoint, rowShadowGapM, sectionBasis3D, summarizeDesign, validateLayout, MAX_PANELS,
  type DesignConfig, type Panel,
} from '..';

const rect = (w: number, h: number) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const flat = (l = 10, w = 6) => createDefaultConfig({ lengthM: l, widthM: w, floors: 2, roofType: 'FLAT' });
const mkPanel = (c: DesignConfig, over: Partial<Panel> = {}): Panel => ({ id: `t-${Math.random().toString(36).slice(2, 8)}`, sectionId: c.roofSections[0]!.id, typeId: c.panelTypes[0]!.id, x: 5, y: 3, rotationDeg: 0, orientation: 'PORTRAIT', tiltDeg: 0, ...over });

describe('geometry', () => {
  it('area and point-in-polygon, including a concave L and boundary points', () => {
    expect(polygonArea(rect(4, 3))).toBe(12);
    const L = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 }];
    expect(polygonArea(L)).toBe(12);
    expect(pointInPolygon({ x: 1, y: 3 }, L)).toBe(true);
    expect(pointInPolygon({ x: 3, y: 3 }, L)).toBe(false); // the notch
    expect(pointInPolygon({ x: 4, y: 1 }, L)).toBe(true); // on the boundary counts as inside
  });
  it('rotates clockwise about a point', () => {
    const p = rotatePoint({ x: 1, y: 0 }, 90);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(1, 9);
  });
  it('overlap needs real penetration: touching panels do not overlap, gaps are measured', () => {
    const a = rectCorners(0, 0, 1, 2);
    expect(convexOverlap(a, rectCorners(1, 0, 1, 2))).toBe(false); // edge contact
    expect(convexOverlap(a, rectCorners(0.9, 0, 1, 2))).toBe(true);
    expect(convexDistance(a, rectCorners(1.5, 0, 1, 2))).toBeCloseTo(0.5, 9);
    expect(convexDistance(a, rectCorners(0.5, 0, 1, 2))).toBe(0);
  });
  it('detects a rotated rectangle that pokes out of a polygon', () => {
    const roof = rect(10, 6);
    expect(polygonInside(rectCorners(5, 3, 2, 1, 0), roof)).toBe(true);
    expect(polygonInside(rectCorners(5, 3, 2, 1, 45), roof)).toBe(true);
    expect(polygonInside(rectCorners(1, 3, 2, 1, 80), roof)).toBe(true); // rotated footprint is only 0.67 m wide
    expect(polygonInside(rectCorners(0.5, 3, 2, 1, 80), roof)).toBe(false); // now it crosses x = 0
  });
});

describe('building generation: shared geometry for 2D and 3D', () => {
  const base = { lengthM: 10, widthM: 6, floors: 2, floorHeightM: 3, roofAngleDeg: 30, ridgeAlong: 'LENGTH' as const, orientationDeg: 0 };

  it('flat roof is one section covering the footprint at eave height', () => {
    const g = generateBuilding({ ...base, roofType: 'FLAT', roofAngleDeg: 0 });
    expect(g.sections).toHaveLength(1);
    const s = g.sections[0]!;
    expect(polygonArea(s.polygon)).toBeCloseTo(60, 6);
    const corners = s.polygon.map((p) => localToPlan(s, p.x, p.y));
    expect(Math.min(...corners.map((c) => c.x))).toBeCloseTo(-5, 9);
    expect(Math.max(...corners.map((c) => c.y))).toBeCloseTo(3, 9);
    expect(g.ridgeHeightM).toBe(6);
  });
  it('gable: both slopes meet exactly at the ridge, at the right height', () => {
    const g = generateBuilding({ ...base, roofType: 'GABLE' });
    expect(g.sections.map((s) => s.id)).toEqual(['roof-1', 'roof-2']);
    const run = 3 / Math.cos((30 * Math.PI) / 180);
    const expectedRidge = 6 + 3 * Math.tan((30 * Math.PI) / 180);
    expect(g.ridgeHeightM).toBeCloseTo(expectedRidge, 9);
    for (const s of g.sections) {
      const top = localToPlan(s, 0, run);
      expect(top.y).toBeCloseTo(0, 9); // ridge line
      expect(localToHeight(s, run)).toBeCloseTo(expectedRidge, 9);
      expect(localToPlan(s, 0, 0).y).toBeCloseTo(s.id === 'roof-1' ? 3 : -3, 9); // eaves on the long walls
    }
    expect(g.sections[0]!.azimuthDeg).toBe(180);
    expect(g.sections[1]!.azimuthDeg).toBe(0);
    expect(g.walls).toHaveLength(4); // two eave walls + two gable ends
    expect(Math.max(...g.walls.flat().map((p) => p.z))).toBeCloseTo(expectedRidge, 9);
  });
  it('shed: single slope rises across the width', () => {
    const g = generateBuilding({ ...base, roofType: 'SHED', roofAngleDeg: 20 });
    const s = g.sections[0]!;
    const hi = Math.tan((20 * Math.PI) / 180) * 6;
    expect(g.ridgeHeightM).toBeCloseTo(6 + hi, 9);
    const topV = Math.max(...s.polygon.map((p) => p.y));
    expect(localToPlan(s, 0, topV).y).toBeCloseTo(-3, 9);
    expect(localToHeight(s, topV)).toBeCloseTo(6 + hi, 9);
  });
  it('hip: four faces whose edges meet along the ridge and the hips', () => {
    const g = generateBuilding({ ...base, roofType: 'HIP' });
    expect(g.sections).toHaveLength(4);
    const [south, north, east, west] = g.sections as [typeof g.sections[0], typeof g.sections[0], typeof g.sections[0], typeof g.sections[0]];
    const run = 3 / Math.cos((30 * Math.PI) / 180);
    const ridgeW = localToPlan(south, 3, run); // trapezoid's top-left
    const ridgeE = localToPlan(south, 7, run);
    expect(ridgeW.x).toBeCloseTo(-2, 9); expect(ridgeW.y).toBeCloseTo(0, 9);
    expect(ridgeE.x).toBeCloseTo(2, 9);
    const apexE = localToPlan(east, 3, run); // triangle apex
    expect(apexE.x).toBeCloseTo(2, 9); expect(apexE.y).toBeCloseTo(0, 9);
    const apexW = localToPlan(west, 3, run);
    expect(apexW.x).toBeCloseTo(-2, 9); expect(apexW.y).toBeCloseTo(0, 9);
    expect(localToPlan(north, 3, run).x).toBeCloseTo(2, 9);
    // roof surface area = footprint / cos(angle) for equal pitch
    const area = g.sections.reduce((n, s) => n + polygonArea(s.polygon), 0);
    expect(area).toBeCloseTo(60 / Math.cos((30 * Math.PI) / 180), 6);
  });
  it('ridge along width turns the gable 90° and orientation rotates everything together', () => {
    const g = generateBuilding({ ...base, roofType: 'GABLE', ridgeAlong: 'WIDTH' });
    for (const s of g.sections) expect(localToPlan(s, 0, 5 / Math.cos((30 * Math.PI) / 180)).x).toBeCloseTo(0, 9); // ridge now runs north–south (half-span = 10/2)
    const rotated = generateBuilding({ ...base, roofType: 'GABLE', orientationDeg: 90 });
    expect(rotated.sections[0]!.azimuthDeg).toBe(270);
    const r = localToPlan(rotated.sections[0]!, 0, 3 / Math.cos((30 * Math.PI) / 180));
    expect(r.x).toBeCloseTo(0, 9);
    expect(rotated.ridgeHeightM).toBeCloseTo(generateBuilding({ ...base, roofType: 'GABLE' }).ridgeHeightM, 9);
  });
  it('plan ⇄ section conversion round-trips on a rotated, tilted section', () => {
    const s = generateBuilding({ ...base, roofType: 'GABLE', orientationDeg: 37 }).sections[1]!;
    for (const [u, v] of [[0, 0], [2.5, 1.1], [9, 3.4]] as [number, number][]) {
      const p = localToPlan(s, u, v);
      const back = planToLocal(s, p.x, p.y);
      expect(back.x).toBeCloseTo(u, 9);
      expect(back.y).toBeCloseTo(v, 9);
    }
  });
  it('3D basis is orthonormal, right-handed and points up', () => {
    for (const roofType of ['FLAT', 'SHED', 'GABLE', 'HIP'] as const) {
      for (const s of generateBuilding({ ...base, roofType, orientationDeg: 25 }).sections) {
        const b = sectionBasis3D(s);
        expect(Math.hypot(...b.u)).toBeCloseTo(1, 9);
        expect(Math.hypot(...b.v)).toBeCloseTo(1, 9);
        expect(b.u[0] * b.v[0] + b.u[1] * b.v[1] + b.u[2] * b.v[2]).toBeCloseTo(0, 9);
        expect(b.n[1]).toBeGreaterThan(0);
        expect(b.n[1]).toBeCloseTo(Math.cos((s.tiltDeg * Math.PI) / 180), 9);
      }
    }
  });
});

describe('layout validation', () => {
  it('accepts a panel in the middle of the roof and reports a clean summary', () => {
    const c = { ...flat(), panels: [mkPanel(flat())] };
    const r = validateLayout(c);
    expect(r.errorIds.size).toBe(0);
    expect(summarizeDesign(c, r).installedKwp).toBe(0.55);
  });
  it('flags panels outside the roof, inside the setback, and exactly-on-setback as valid', () => {
    const c0 = flat(); // roof 10×6, setback 0.5
    const out = mkPanel(c0, { x: 9.8 }); // sticks out past x = 10
    const tight = mkPanel(c0, { x: 0.5 + 1.134 / 2, y: 3 }); // exactly at the 0.5 m setback line
    const inSetback = mkPanel(c0, { x: 0.3 + 1.134 / 2, y: 3 }); // 0.3 m from the edge
    const one = (p: Panel) => validateLayout({ ...c0, panels: [p] });
    expect(one(out).issues[out.id]!.map((i) => i.type)).toContain('OUTSIDE');
    expect(one(tight).validIds.has(tight.id)).toBe(true);
    expect(one(inSetback).issues[inSetback.id]!.map((i) => i.type)).toEqual(['SETBACK']);
  });
  it('detects overlaps on both panels but allows panels that merely touch (with a spacing warning)', () => {
    const c0 = flat();
    const a = mkPanel(c0, { x: 4, y: 3 });
    const b = mkPanel(c0, { x: 4.5, y: 3 }); // overlaps a
    const r = validateLayout({ ...c0, panels: [a, b] });
    expect(r.issues[a.id]![0]!.type).toBe('OVERLAP');
    expect(r.issues[b.id]![0]!.otherId).toBe(a.id);
    const t1 = mkPanel(c0, { x: 4, y: 3 });
    const t2 = mkPanel(c0, { x: 4 + 1.134, y: 3 }); // exactly touching
    const r2 = validateLayout({ ...c0, panels: [t1, t2] });
    expect(r2.errorIds.size).toBe(0);
    expect(r2.issues[t1.id]![0]!.type).toBe('SPACING');
    expect(r2.issues[t1.id]![0]!.severity).toBe('warning');
    expect(r2.validIds.size).toBe(2); // warnings do not invalidate
  });
  it('enforces obstacle clearance and restricted zones', () => {
    const c0 = flat();
    const withObs: DesignConfig = { ...c0, obstacles: [{ id: 'o1', sectionId: 'roof-1', type: 'WATER_TANK', shape: 'CIRCLE', x: 5, y: 3, w: 1, h: 1, r: 0.6, heightM: 1.5, clearanceM: 0.3 }] };
    const near = mkPanel(c0, { x: 5 + 0.6 + 0.2 + 1.134 / 2 }); // 0.2 m gap < 0.3 m clearance
    const ok = mkPanel(c0, { x: 5 + 0.6 + 0.3 + 1.134 / 2 + 0.001 });
    const on = mkPanel(c0, { x: 5, y: 3 });
    const one = (p: Panel) => validateLayout({ ...withObs, panels: [p] });
    expect(one(near).issues[near.id]![0]!.type).toBe('OBSTACLE');
    expect(one(ok).validIds.has(ok.id)).toBe(true);
    expect(one(on).issues[on.id]![0]!.message).toMatch(/Overlaps an obstacle/);
    const withZone: DesignConfig = { ...c0, zones: [{ id: 'z1', sectionId: 'roof-1', name: 'Skylight void', polygon: rect(2, 2).map((p) => ({ x: p.x + 4, y: p.y + 2 })) }] };
    const inZone = mkPanel(c0, { x: 5, y: 3 });
    const clear = mkPanel(c0, { x: 8, y: 3 });
    const r2 = validateLayout({ ...withZone, panels: [inZone, clear] });
    expect(r2.issues[inZone.id]![0]!.type).toBe('RESTRICTED');
    expect(r2.validIds.has(clear.id)).toBe(true);
  });
  it('uses the panel type of each panel, so different sizes can be mixed', () => {
    const c0: DesignConfig = { ...flat(), panelTypes: [flat().panelTypes[0]!, { id: 'pt-small', name: '400 W', widthM: 1.0, lengthM: 1.7, wattage: 400 }] };
    const big = mkPanel(c0, { x: 3, y: 3 });
    const small = mkPanel(c0, { x: 7, y: 3, typeId: 'pt-small' });
    const s = summarizeDesign({ ...c0, panels: [big, small] });
    expect(s.installedKwp).toBeCloseTo(0.95, 6);
    expect(s.panelAreaM2).toBeCloseTo(1.134 * 2.279 + 1.7, 2);
  });
});

describe('automatic panel placement', () => {
  it('packs a 10 × 6 m roof with 0.5 m setbacks to exactly 14 panels (hand-computed) with all panels valid', () => {
    const c = flat();
    const r = autoArrange(c, 'roof-1');
    expect(r.panels).toHaveLength(14);
    expect(r.orientation).toBe('PORTRAIT'); // landscape fits only 12
    const rep = validateLayout({ ...c, panels: r.panels });
    expect(rep.errorIds.size).toBe(0);
    expect(rep.issues).toEqual({});
    expect(autoArrange(c, 'roof-1', { orientation: 'LANDSCAPE' }).panels).toHaveLength(12);
    const s = summarizeDesign({ ...c, panels: r.panels });
    expect(s.installedKwp).toBeCloseTo(7.7, 6);
    expect(s.bySection[0]!.panels).toBe(14);
  });
  it('respects spacing: neighbouring panels are at least the configured gap apart', () => {
    const c = flat();
    const r = autoArrange(c, 'roof-1', { gapXM: 0.1, gapYM: 0.1 });
    const rep = validateLayout({ ...c, panels: r.panels });
    expect(rep.errorIds.size).toBe(0);
    expect(rep.minSpacingM!).toBeGreaterThanOrEqual(0.1 - 1e-6);
    expect(r.panels.length).toBeLessThan(14 + 1);
  });
  it('avoids obstacles and restricted zones and never places invalid panels', () => {
    const c: DesignConfig = {
      ...flat(),
      obstacles: [{ id: 'o1', sectionId: 'roof-1', type: 'HVAC', shape: 'RECT', x: 5, y: 3, w: 2, h: 1.5, r: 0.5, heightM: 1, clearanceM: 0.3 }],
      zones: [{ id: 'z1', sectionId: 'roof-1', name: 'Walkway', polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 1.2 }, { x: 0, y: 1.2 }] }],
    };
    const r = autoArrange(c, 'roof-1');
    expect(r.panels.length).toBeGreaterThan(0);
    expect(r.panels.length).toBeLessThan(14);
    expect(validateLayout({ ...c, panels: r.panels }).errorIds.size).toBe(0);
  });
  it('fills non-rectangular roofs (L-shape, hip faces) with only valid panels', () => {
    const base = flat(12, 12);
    const L = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 12 }, { x: 0, y: 12 }];
    const c: DesignConfig = { ...base, roofSections: [{ ...base.roofSections[0]!, polygon: L }] };
    const r = autoArrange(c, 'roof-1');
    expect(r.panels.length).toBeGreaterThan(10);
    expect(validateLayout({ ...c, panels: r.panels }).errorIds.size).toBe(0);
    const hip = createDefaultConfig({ lengthM: 14, widthM: 8, roofType: 'HIP', roofAngleDeg: 20 });
    for (const s of hip.roofSections) {
      const rr = autoArrange(hip, s.id);
      expect(validateLayout({ ...hip, panels: rr.panels }).errorIds.size).toBe(0);
    }
    const triangle = autoArrange(hip, 'roof-3');
    expect(triangle.panels.length).toBeLessThan(autoArrange(hip, 'roof-1').panels.length); // smaller face, fewer panels
  });
  it('caps at the requested number and can top up around panels already placed', () => {
    const c = flat();
    expect(autoArrange(c, 'roof-1', { maxPanels: 6 }).panels).toHaveLength(6);
    expect(autoArrange(c, 'roof-1', { maxPanels: 6 }).capacity).toBe(14);
    const manual = mkPanel(c, { x: 5, y: 3 });
    const filled = autoArrange({ ...c, panels: [manual] }, 'roof-1', { keepExisting: true });
    expect(filled.panels.some((p) => p.id === manual.id)).toBe(true);
    expect(validateLayout({ ...c, panels: filled.panels }).errorIds.size).toBe(0);
  });
  it('applyAutoArrange only replaces the chosen section', () => {
    const c0 = createDefaultConfig({ lengthM: 14, widthM: 8, roofType: 'GABLE', roofAngleDeg: 20 });
    const first = applyAutoArrange(c0, 'roof-1').config;
    const both = applyAutoArrange(first, 'roof-2').config;
    const n1 = first.panels.length;
    expect(both.panels.filter((p) => p.sectionId === 'roof-1')).toHaveLength(n1);
    expect(both.panels.filter((p) => p.sectionId === 'roof-2').length).toBeGreaterThan(0);
    expect(validateLayout(both).errorIds.size).toBe(0);
  });
  it('sizes row spacing for tilted racks from the sun elevation (shadow = L·sin(tilt)/tan(elevation))', () => {
    expect(rowShadowGapM(2.279, 15, 22)).toBeCloseTo((2.279 * Math.sin((15 * Math.PI) / 180)) / Math.tan((22 * Math.PI) / 180), 9);
    expect(rowShadowGapM(2.279, 0, 22)).toBe(0);
    const c = flat(20, 12);
    const flush = autoArrange(c, 'roof-1', { orientation: 'LANDSCAPE', mountTiltDeg: 0 });
    const racks = autoArrange(c, 'roof-1', { orientation: 'LANDSCAPE', mountTiltDeg: 15 });
    expect(racks.rowGapM).toBeGreaterThan(0.3);
    expect(racks.panels.length).toBeLessThan(flush.panels.length); // wider rows cost capacity
    expect(validateLayout({ ...c, panels: racks.panels }).errorIds.size).toBe(0);
  });
});

describe('design document', () => {
  it('survives a JSON save/load round trip unchanged (design save/load)', () => {
    const c = applyAutoArrange(createDefaultConfig({ lengthM: 12, widthM: 8, roofType: 'GABLE', roofAngleDeg: 25 }), 'roof-1').config;
    const loaded = designConfigSchema.parse(JSON.parse(JSON.stringify(c)));
    expect(loaded).toEqual(c);
    expect(summarizeDesign(loaded)).toEqual(summarizeDesign(c));
  });
  it('rejects dangling references, duplicates and absurd sizes', () => {
    const c = applyAutoArrange(flat(), 'roof-1').config;
    expect(designConfigSchema.safeParse({ ...c, panels: [{ ...c.panels[0]!, sectionId: 'nope' }] }).success).toBe(false);
    expect(designConfigSchema.safeParse({ ...c, panels: [{ ...c.panels[0]!, typeId: 'nope' }] }).success).toBe(false);
    expect(designConfigSchema.safeParse({ ...c, panels: [c.panels[0]!, c.panels[0]!] }).success).toBe(false);
    expect(designConfigSchema.safeParse({ ...c, building: { ...c.building, lengthM: -3 } }).success).toBe(false);
    const many = Array.from({ length: MAX_PANELS + 1 }, (_, i) => ({ ...c.panels[0]!, id: `x${i}` }));
    expect(designConfigSchema.safeParse({ ...c, panels: many }).success).toBe(false);
    expect(designConfigSchema.safeParse({ ...c, building: { ...c.building, roofType: 'DOME' } }).success).toBe(false);
  });
  it('changing the roof type keeps panels on surviving sections and drops the rest', () => {
    let c = applyAutoArrange(applyAutoArrange(createDefaultConfig({ lengthM: 14, widthM: 8, roofType: 'GABLE', roofAngleDeg: 20 }), 'roof-1').config, 'roof-2').config;
    const had2 = c.panels.filter((p) => p.sectionId === 'roof-2').length;
    expect(had2).toBeGreaterThan(0);
    c = regenerateRoof({ ...c, building: { ...c.building, roofType: 'FLAT', roofAngleDeg: 0 } });
    expect(c.roofSections.map((s) => s.id)).toEqual(['roof-1']);
    expect(c.panels.every((p) => p.sectionId === 'roof-1')).toBe(true);
    expect(designConfigSchema.safeParse(c).success).toBe(true);
    // panels that no longer fit the new geometry are reported, not silently kept as valid
    const rep = validateLayout(regenerateRoof({ ...c, building: { ...c.building, lengthM: 4, widthM: 3 } }));
    expect(rep.errorIds.size).toBeGreaterThan(0);
  });
  it('target panel count from the calculator is compared in the summary', () => {
    const c = { ...applyAutoArrange(flat(), 'roof-1').config };
    const s = summarizeDesign({ ...c, meta: { targetPanels: 20 } });
    expect(s.targetPanels).toBe(20);
    expect(s.targetDeltaPanels).toBe(14 - 20);
  });
});

describe('SVG export', () => {
  it('draws every panel, marks invalid ones, and escapes user-supplied names', () => {
    let c = applyAutoArrange(flat(), 'roof-1').config;
    c = { ...c, roofSections: [{ ...c.roofSections[0]!, name: '<script>alert(1)</script>' }], panels: [...c.panels, mkPanel(c, { x: 9.9 })] };
    const svg = renderDesignSvg(c, { sectionId: 'roof-1' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect((svg.match(/fill="#bfdbfe"/g) ?? []).length).toBe(14);
    expect((svg.match(/fill="#fecaca"/g) ?? []).length).toBe(1); // the out-of-bounds panel
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toMatch(/not a certified design/);
    const plan = renderDesignSvg(c);
    expect(plan).toContain('<polygon');
  });
});

describe('inset polygon (setback outline)', () => {
  it('insets rectangles and L-shapes, and returns null when the roof is too thin', async () => {
    const { insetPolygon } = await import('./geometry');
    const r = insetPolygon([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }], 0.5)!;
    expect(polygonArea(r)).toBeCloseTo(9 * 5, 9);
    const cw = insetPolygon([{ x: 0, y: 0 }, { x: 0, y: 6 }, { x: 10, y: 6 }, { x: 10, y: 0 }], 0.5)!; // opposite winding
    expect(polygonArea(cw)).toBeCloseTo(45, 9);
    const L = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }];
    const li = insetPolygon(L, 0.5)!;
    expect(li).not.toBeNull();
    expect(polygonArea(li)).toBeLessThan(polygonArea(L));
    expect(insetPolygon([{ x: 0, y: 0 }, { x: 0.8, y: 0 }, { x: 0.8, y: 5 }, { x: 0, y: 5 }], 0.5)).toBeNull();
  });
});
