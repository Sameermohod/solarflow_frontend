import { describe, expect, it } from 'vitest';
import { DEFAULT_SHEET_NOTES, STRUCTURE_PRESETS, buildStructure, renderStructureSvg, sectionThickness, type StructureSpec } from './structure';

const preset = (id: string): StructureSpec => structuredClone(STRUCTURE_PRESETS.find((p) => p.id === id)!.spec);
const ok = (s: StructureSpec) => { const b = buildStructure(s); if (!b.ok) throw new Error(b.problems.join('; ')); return b; };

describe('structure drawing', () => {
  it('reproduces the sample 5 kW walkway part list exactly', () => {
    const b = ok(preset('walkway-10'));
    const rows = b.parts.map((p) => [p.name, p.profile, p.material, p.lengthMm, p.thicknessMm, p.qty]);
    expect(rows).toEqual([
      ['COLUMN 2000', 'C-LIP 140X80X15X2', 'HDG', 2000, 2, 3],
      ['COLUMN 2400', 'C-LIP 140X80X15X2', 'HDG', 2400, 2, 3],
      ['BASE PLATE', 'PLATE 250X250X5', 'HDG', 250, 5, 6],
      ['STIFFENER PLATE', 'PLATE 70X60X10', 'HDG', 70, 10, 18],
      ['RAFTER', 'C-LIP 100X48X15X2', 'HDG', 4500, 2, 3],
      ['HAT PURLIN 1', 'HAT 70X40X25X10X0.9', 'GALVALUME', 2500, 0.9, 4],
      ['HAT PURLIN 2', 'HAT 70X40X25X10X0.9', 'GALVALUME', 3655, 0.9, 4],
      ['HORIZONTAL SUPPORT', 'C-LIP 100X48X15X2', 'HDG', 2330, 2, 3],
      ['WALKWAY CHANNEL 1', 'C-LIP 100X40X15X2', 'PRE-GALVA', 2350, 2, 3],
      ['WALKWAY CHANNEL 2', 'C-LIP 90X30X15X2', 'PRE-GALVA', 2370, 2, 3],
    ]);
    expect(b.parts.every((p) => !p.calculated)).toBe(true);
  });

  it('derives the sample dimensions from the geometry', () => {
    const b = ok(preset('walkway-10'));
    expect(b.geometry.panelCount).toBe(10);
    expect(b.geometry.frontOverhangHorizontalMm).toBeCloseTo(1444.91, 0);
    expect(b.geometry.frameX).toEqual([0, 2289, 4599]);
    // purlins sit 1400 apart under each panel, and the first one is 491 from the panel edge
    expect(b.geometry.purlinS[1]! - b.geometry.purlinS[0]!).toBeCloseTo(1400, 6);
    expect(b.warnings).toEqual([]); // 26 mm height-vs-tilt gap is within tolerance
  });

  it('calculates blanks by stated rules and flags them', () => {
    const b = ok(preset('elevated-10'));
    expect(b.parts.find((p) => p.name === 'RAFTER')!.calculated).toBe(true);
    expect(b.parts.some((p) => p.name.startsWith('WALKWAY'))).toBe(false);
    const g = b.geometry;
    expect(g.frameX).toHaveLength(3);
    // rafter meets the front column top at the tilt
    expect(g.frontColumnMm).toBeCloseTo(2400 - g.spanMm * Math.tan((10 * Math.PI) / 180), 0);
    expect(g.frontOverhangHorizontalMm).toBeGreaterThanOrEqual(0);
    expect(b.warnings.join(' ')).toMatch(/spaced equally/);
  });

  it('merges identical front and back columns', () => {
    const s = preset('walkway-10'); s.frontColumnMm = 2400;
    const b = ok(s);
    expect(b.parts[0]).toMatchObject({ name: 'COLUMN 2400', qty: 6 });
  });

  it('warns when the heights do not match the tilt', () => {
    const s = preset('walkway-10'); s.frontColumnMm = 1500;
    expect(ok(s).warnings.join(' ')).toMatch(/does not match the tilt/);
  });

  it('rejects impossible input with clear messages', () => {
    const s = preset('walkway-10'); s.rafterLengthMm = 3000;
    const b = buildStructure(s);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.problems[0]).toMatch(/too short to reach the front column/);
    const s2 = preset('walkway-10'); s2.frameSpacingsMm = [2000];
    const b2 = buildStructure(s2); expect(b2.ok).toBe(false);
    const s3 = preset('walkway-10'); s3.panelsAlongSlope = 0; expect(buildStructure(s3).ok).toBe(false);
    const s4 = preset('walkway-10'); s4.column.profile = 'C-LIP'; expect(buildStructure(s4).ok).toBe(false);
  });

  it('single piece purlin and thickness parsing', () => {
    expect(sectionThickness('HAT 70X40X25X10X0.9')).toBe(0.9);
    const b = ok(preset('low-single-row'));
    const pur = b.parts.filter((p) => p.name.includes('PURLIN'));
    expect(pur).toHaveLength(1);
    expect(pur[0]!.qty).toBe(2); // 1 row x 2 purlins
    expect(pur[0]!.lengthMm).toBe(Math.round(b.geometry.arrayWidthMm + 200));
  });

  it('renders a complete sheet for every preset', () => {
    for (const p of STRUCTURE_PRESETS) {
      const svg = renderStructureSvg(ok(structuredClone(p.spec)), { company: 'Acme', project: 'P', drawingNo: 'D1', description: 'X', drawnBy: 'A', checkedBy: 'B', approvedBy: 'C', date: '1/1/2026', revNo: '-', revDate: '', notes: DEFAULT_SHEET_NOTES });
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('SIDE VIEW'); expect(svg).toContain('FRONT VIEW'); expect(svg).toContain('DETAIL C'); expect(svg).not.toContain('NaN');
    }
  });
});
