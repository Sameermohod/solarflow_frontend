import { describe, expect, it } from 'vitest';
import { applyAutoArrange, computeDocument, createDefaultConfig, generateBomLines, invoiceStatusFor, scheduleError, type CatalogueItem } from '.';

describe('computeDocument', () => {
  it('tax-exclusive: discount then tax, totals equal the sum of lines', () => {
    const r = computeDocument([
      { quantity: 10, unitPrice: 100.5, discountPct: 10, taxPercent: 12 },
      { quantity: 2.5, unitPrice: 33.33, discountPct: 0, taxPercent: 18 },
    ]);
    // line 1: base 1005.00, disc 100.50, taxable 904.50, tax 108.54
    expect(r.lines[0]).toEqual({ base: 1005, discount: 100.5, taxable: 904.5, tax: 108.54, total: 1013.04 });
    // line 2: base 83.325→83.33 (cents rounding of 2.5×3333=8332.5→8333), tax 15.00
    expect(r.lines[1]!.base).toBe(83.33);
    expect(r.lines[1]!.tax).toBe(15);
    const sum = (k: 'taxable' | 'tax' | 'total') => Math.round(r.lines.reduce((a, l) => a + l[k], 0) * 100) / 100;
    expect(r.subtotal).toBe(sum('taxable'));
    expect(r.taxTotal).toBe(sum('tax'));
    expect(r.total).toBe(sum('total'));
    expect(r.total).toBeCloseTo(r.subtotal + r.taxTotal, 2);
    expect(r.taxBreakdown.map((b) => b.percent)).toEqual([12, 18]);
  });

  it('tax-inclusive prices: the total is what was entered, tax is extracted', () => {
    const r = computeDocument([{ quantity: 1, unitPrice: 118, discountPct: 0, taxPercent: 18 }], { pricesIncludeTax: true });
    expect(r.total).toBe(118);
    expect(r.subtotal).toBe(100);
    expect(r.taxTotal).toBe(18);
  });

  it('zero tax and zero quantity are fine; invalid input is rejected', () => {
    expect(computeDocument([{ quantity: 0, unitPrice: 50, discountPct: 0, taxPercent: 0 }]).total).toBe(0);
    expect(() => computeDocument([{ quantity: 1, unitPrice: -1, discountPct: 0, taxPercent: 0 }])).toThrow();
    expect(() => computeDocument([{ quantity: 1, unitPrice: 1, discountPct: 101, taxPercent: 0 }])).toThrow();
  });

  it('does not drift on many small lines (0.1 × 3 style cases)', () => {
    const r = computeDocument(Array.from({ length: 1000 }, () => ({ quantity: 1, unitPrice: 0.1, discountPct: 0, taxPercent: 0 })));
    expect(r.total).toBe(100);
  });
});

describe('invoice status and milestones', () => {
  it('derives status from payments and leaves draft/void alone', () => {
    expect(invoiceStatusFor(100, 0, 'ISSUED')).toBe('ISSUED');
    expect(invoiceStatusFor(100, 40, 'ISSUED')).toBe('PARTIALLY_PAID');
    expect(invoiceStatusFor(100, 100, 'PARTIALLY_PAID')).toBe('PAID');
    expect(invoiceStatusFor(100.1, 100.1, 'ISSUED')).toBe('PAID');
    expect(invoiceStatusFor(100, 100, 'VOID')).toBe('VOID');
    expect(invoiceStatusFor(100, 0, 'DRAFT')).toBe('DRAFT');
  });
  it('a payment schedule must total 100%', () => {
    expect(scheduleError([])).toBeNull();
    expect(scheduleError([{ percent: 30 }, { percent: 60 }, { percent: 10 }])).toBeNull();
    expect(scheduleError([{ percent: 33.3 }, { percent: 33.3 }, { percent: 33.3 }])).toMatch(/must total 100/);
  });
});

describe('generateBomLines', () => {
  const cat = (over: Partial<CatalogueItem> & { id: string }): CatalogueItem => ({
    name: 'Item', manufacturer: 'Mk', modelNumber: 'M1', unit: 'nos', category: 'OTHER', purchasePrice: 5, sellingPrice: 10, taxRateCode: 'GST12', hsnCode: '8541', ...over,
  });
  function design() {
    const c = createDefaultConfig({ lengthM: 20, widthM: 12, floors: 1, roofType: 'FLAT' });
    return applyAutoArrange(c, c.roofSections[0]!.id).config;
  }

  it('counts valid panels per type, links the catalogue price, and warns when unlinked', () => {
    const c = design();
    expect(c.panels.length).toBeGreaterThan(5);
    const unlinked = generateBomLines(c, new Map());
    expect(unlinked.panelCount).toBe(c.panels.length);
    expect(unlinked.lines[0]!.quantity).toBe(c.panels.length);
    expect(unlinked.lines[0]!.unitPrice).toBe(0);
    expect(unlinked.lines[0]!.warnings.length).toBe(1);

    const eqId = '11111111-1111-4111-8111-111111111111';
    const linked = { ...c, panelTypes: c.panelTypes.map((t, i) => (i === 0 ? { ...t, equipmentId: eqId } : t)) };
    const r = generateBomLines(linked, new Map([[eqId, cat({ id: eqId, name: 'Mono 550', sellingPrice: 9000, purchasePrice: 7000 })]]));
    expect(r.lines[0]).toMatchObject({ equipmentId: eqId, unitPrice: 9000, unitCost: 7000, quantity: c.panels.length, warnings: [] });
    expect(r.kwp).toBeCloseTo((c.panels.length * c.panelTypes[0]!.wattage) / 1000, 3);
  });

  it('applies per-panel, per-kWp and fixed rules; whole units round up, metres do not', () => {
    const c = design();
    const clip = '22222222-2222-4222-8222-222222222222';
    const cable = '33333333-3333-4333-8333-333333333333';
    const box = '44444444-4444-4444-8444-444444444444';
    const m = new Map([[clip, cat({ id: clip })], [cable, cat({ id: cable, unit: 'm' })], [box, cat({ id: box })]]);
    const r = generateBomLines(c, m, [
      { equipmentId: clip, basis: 'PER_PANEL', quantity: 4 },
      { equipmentId: cable, basis: 'PER_KWP', quantity: 7.5 },
      { equipmentId: box, basis: 'FIXED', quantity: 1 },
      { equipmentId: '99999999-9999-4999-8999-999999999999', basis: 'FIXED', quantity: 1 }, // not in catalogue → skipped
    ]);
    const rule = r.lines.filter((l) => l.source === 'RULE');
    expect(rule).toHaveLength(3);
    expect(rule[0]!.quantity).toBe(4 * c.panels.length);
    expect(rule[1]!.quantity).toBeCloseTo(Math.round(7.5 * r.kwp * 1000) / 1000, 2);
    expect(rule[2]!.quantity).toBe(1);
  });

  it('excludes panels that fail validation', () => {
    const c = design();
    const bad = { ...c, panels: [...c.panels, { ...c.panels[0]!, id: 'dup' }] }; // exact overlap → error on both
    expect(generateBomLines(bad, new Map()).panelCount).toBeLessThan(bad.panels.length);
  });
});
