import { describe, expect, it } from 'vitest';
import { analyzeShading, buildReport, createDefaultConfig, DEFAULT_REPORT_INPUTS, localToPlan, planToLocal, shadowPolygons, sunPosition, type DesignConfig, type Obstacle, type Panel } from '..';

const PSH = [5, 5.5, 6.2, 6.5, 6.6, 5.2, 4.2, 4.3, 4.9, 5.4, 5, 4.7];

function withObstacle(farM: number): { c: DesignConfig; panelId: string } {
  const c = createDefaultConfig({ lengthM: 20, widthM: 14, floors: 2, roofType: 'FLAT' });
  const s = c.roofSections[0]!;
  const ob = localToPlan(s, 10, 7); // obstacle plan position
  const pl = planToLocal(s, ob.x, ob.y - farM); // panel to the NORTH of the obstacle (shadow falls north in winter noon)
  const o: Obstacle = { id: 'ob1', sectionId: s.id, type: 'WATER_TANK', shape: 'RECT', x: 10, y: 7, w: 1, h: 1, r: 0.5, heightM: 3, clearanceM: 0 };
  const p: Panel = { id: 'p1', sectionId: s.id, typeId: c.panelTypes[0]!.id, x: pl.x, y: pl.y, rotationDeg: 0, orientation: 'PORTRAIT', tiltDeg: 0 };
  return { c: { ...c, obstacles: [o], panels: [p] }, panelId: 'p1' };
}

describe('sunPosition', () => {
  it('equator at equinox noon: sun overhead', () => {
    expect(sunPosition(0, 80, 12).elevationDeg).toBeGreaterThan(89);
  });
  it('noon elevation at 21°N follows 90 − lat + declination (summer vs winter)', () => {
    expect(sunPosition(21, 355, 12).elevationDeg).toBeCloseTo(90 - 21 - 23.44, 0); // Dec 21, sun due south
    expect(sunPosition(21, 355, 12).azimuthDeg).toBeCloseTo(180, 0);
    expect(sunPosition(21, 172, 12).elevationDeg).toBeCloseTo(90 - 21 + 23.44 > 90 ? 180 - (90 - 21 + 23.44) : 90 - 21 + 23.44, 0);
  });
  it('morning sun is in the east, afternoon in the west', () => {
    expect(sunPosition(21, 80, 9).azimuthDeg).toBeLessThan(180);
    expect(sunPosition(21, 80, 15).azimuthDeg).toBeGreaterThan(180);
  });
});

describe('analyzeShading', () => {
  it('a 3 m tank right beside a panel shades it at winter noon', () => {
    const { c, panelId } = withObstacle(1.5);
    const r = analyzeShading(c, 21);
    expect(r.panelMonthly[panelId]![11]!).toBeLessThan(0.9); // December
    expect(r.panelAnnual[panelId]!).toBeLessThan(1);
    expect(r.shadowFreePercent).toBeLessThan(100);
  });
  it('the same tank 30 m away (off the roof edge distance) does not shade the panel', () => {
    const { c } = withObstacle(1.5);
    const far = { ...c, panels: [{ ...c.panels[0]!, ...planToLocal(c.roofSections[0]!, localToPlan(c.roofSections[0]!, 10, 7).x, localToPlan(c.roofSections[0]!, 10, 7).y + 40) }] };
    const r = analyzeShading(far, 21);
    expect(r.panelAnnual['p1']).toBeCloseTo(1, 6);
    expect(r.shadowFreePercent).toBeCloseTo(100, 6);
  });
  it('no obstacles means 100% shadow free', () => {
    const c = createDefaultConfig({ lengthM: 10, widthM: 6 });
    expect(analyzeShading({ ...c, panels: [{ id: 'a', sectionId: c.roofSections[0]!.id, typeId: c.panelTypes[0]!.id, x: 5, y: 3, rotationDeg: 0, orientation: 'PORTRAIT', tiltDeg: 0 }] }, 21).shadowFreePercent).toBe(100);
  });
  it('shadow polygons point away from the sun (north at noon in the northern hemisphere)', () => {
    const { c } = withObstacle(1.5);
    const o = localToPlan(c.roofSections[0]!, 10, 7);
    const poly = shadowPolygons(c, sunPosition(21, 355, 12))[0]!;
    expect(Math.min(...poly.map((p) => p.y))).toBeLessThan(o.y - 2); // extends north (−y) by ≈ 3 / tan(45.6°)
    expect(Math.max(...poly.map((p) => p.y))).toBeLessThan(o.y + 0.6);
  });
});

describe('buildReport', () => {
  const base = () => {
    const c = createDefaultConfig({ lengthM: 20, widthM: 14, floors: 2, roofType: 'FLAT' });
    const s = c.roofSections[0]!;
    const panels: Panel[] = [0, 1, 2, 3].map((i) => ({ id: `p${i}`, sectionId: s.id, typeId: c.panelTypes[0]!.id, x: 4 + i * 1.2, y: 6, rotationDeg: 0, orientation: 'PORTRAIT', tiltDeg: 0 }));
    return { ...c, panels };
  };
  const inputs = { ...DEFAULT_REPORT_INPUTS, latitudeDeg: 21, monthlyPeakSunHours: PSH, acCapacityKw: 2 };

  it('annual energy equals kWp × irradiation × the loss stack with no shading', () => {
    const c = base();
    const r = buildReport(c, inputs);
    const kwp = 4 * 0.55;
    expect(r.installedKwp).toBeCloseTo(kwp, 6);
    const poa = PSH.reduce((a, h, m) => a + h * [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m]!, 0);
    const L = inputs.losses;
    const pr = Object.values(L).reduce((a, l) => a * (1 - l / 100), 1);
    expect(r.annualAcKwh).toBeCloseTo(kwp * poa * pr, 0);
    expect(r.performanceRatioPercent).toBeCloseTo(pr * 100, 1);
    expect(r.specificGeneration).toBeCloseTo((kwp * poa * pr) / kwp, 0);
    expect(r.months).toHaveLength(12);
    expect(r.shadowFreePercent).toBe(100);
  });
  it('shading lowers production and the waterfall is monotonic', () => {
    const c = base();
    const none = buildReport(c, inputs);
    const s = c.roofSections[0]!;
    const shaded = buildReport({ ...c, obstacles: [{ id: 'o', sectionId: s.id, type: 'WATER_TANK', shape: 'RECT', x: 5, y: 8, w: 2, h: 1, r: 0.5, heightM: 3, clearanceM: 0 }] }, inputs);
    expect(shaded.annualAcKwh).toBeLessThan(none.annualAcKwh);
    const v = shaded.losses.filter((l) => l.unit === 'kWh').map((l) => l.value);
    for (let i = 1; i < v.length; i++) expect(v[i]!).toBeLessThanOrEqual(v[i - 1]! + 1e-9);
    expect(shaded.losses[v.length ? shaded.losses.length - 1 : 0]!.value).toBeCloseTo(shaded.annualAcKwh, 0);
  });
  it('groups segments, counts inverters and computes CO₂ from the supplied factor', () => {
    const r = buildReport(base(), { ...inputs, inverterName: 'Inv 1 kW', inverterKw: 1, co2KgPerKwh: 1, kgCo2PerTreePerYear: 20 });
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0]!.modules).toBe(4);
    expect(r.components.find((x) => x.label === 'Inverters')!.quantity).toBe(2);
    expect(r.environment.co2Tonnes).toBeCloseTo(r.annualAcKwh / 1000, 1);
    expect(r.environment.trees).toBe(Math.round(r.annualAcKwh / 20));
  });
  it('rejects a profile that is not 12 months', () => {
    expect(() => buildReport(base(), { ...inputs, monthlyPeakSunHours: [5] })).toThrow();
  });
});
