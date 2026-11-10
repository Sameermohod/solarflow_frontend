import { describe, expect, it } from 'vitest';
import {
  billToKwh, DEFAULT_LOSSES, energyCharge, monthlyBill, performanceRatio, runCalculator, simulateRoi, sizeSystem, validateTariff,
  type Tariff,
} from './solar';

const slabTariff: Tariff = {
  fixedChargePerMonth: 50, taxPercent: 10, exportMode: 'NET_METERING', exportRate: 0, annualEscalationPercent: 0,
  slabs: [{ upToKwh: 100, rate: 5 }, { upToKwh: 300, rate: 7 }, { upToKwh: null, rate: 9 }],
};
const flat = (rate: number, over: Partial<Tariff> = {}): Tariff => ({
  fixedChargePerMonth: 0, taxPercent: 0, exportMode: 'NET_METERING', exportRate: 0, annualEscalationPercent: 0, slabs: [{ upToKwh: null, rate }], ...over,
});
const twelve = (v: number) => Array<number>(12).fill(v);

describe('tariff', () => {
  it('computes slab energy charges', () => {
    expect(energyCharge(0, slabTariff.slabs)).toBe(0);
    expect(energyCharge(80, slabTariff.slabs)).toBe(400);
    expect(energyCharge(250, slabTariff.slabs)).toBe(100 * 5 + 150 * 7); // 1550
    expect(energyCharge(400, slabTariff.slabs)).toBe(100 * 5 + 200 * 7 + 100 * 9); // 2800
  });
  it('adds fixed charge and tax', () => {
    expect(monthlyBill(250, slabTariff)).toBeCloseTo((1550 + 50) * 1.1, 6); // 1760
    expect(monthlyBill(0, slabTariff)).toBeCloseTo(55, 6); // fixed charge is payable even with zero import
  });
  it('inverts a bill back to kWh', () => {
    expect(billToKwh(1760, slabTariff)).toBeCloseTo(250, 3);
    expect(billToKwh(3135, slabTariff)).toBeCloseTo(400, 3);
    expect(billToKwh(10, slabTariff)).toBe(0);
  });
  it('validates slab ordering', () => {
    expect(validateTariff(slabTariff)).toEqual([]);
    expect(validateTariff({ ...slabTariff, slabs: [{ upToKwh: 300, rate: 1 }, { upToKwh: 100, rate: 2 }] }).length).toBeGreaterThan(0);
    expect(validateTariff({ ...slabTariff, slabs: [{ upToKwh: null, rate: 1 }, { upToKwh: null, rate: 2 }] }).length).toBeGreaterThan(0);
    expect(validateTariff({ ...slabTariff, slabs: [] }).length).toBeGreaterThan(0);
  });
});

describe('performance ratio', () => {
  it('multiplies the loss stack and is overridable', () => {
    const pr = performanceRatio(DEFAULT_LOSSES);
    expect(pr).toBeGreaterThan(0.77);
    expect(pr).toBeLessThan(0.82);
    expect(performanceRatio({ ...DEFAULT_LOSSES, soiling: 0, temperature: 0, dcWiring: 0, mismatch: 0, inverter: 0, acWiring: 0, availability: 0, irradianceAndOther: 0 })).toBe(1);
  });
});

describe('sizing', () => {
  const base = { tariff: flat(8), monthlyConsumptionKwh: 500, annualPeakSunHours: 5, systemType: 'ON_GRID' as const };

  it('sizes capacity, panels, inverter and generation from first principles', () => {
    const r = sizeSystem(base);
    const pr = performanceRatio(DEFAULT_LOSSES);
    const yieldPerKwp = 5 * 365 * pr;
    expect(r.annualConsumptionKwh).toBe(6000);
    expect(r.requiredKwp).toBeCloseTo(6000 / yieldPerKwp, 1); // ~4.14
    expect(r.panelCount).toBe(Math.ceil((r.requiredKwp * 1000) / 550)); // 8
    expect(r.installedKwp).toBe(4.4);
    expect(r.annualGenerationKwh).toBeCloseTo(4.4 * yieldPerKwp, -1);
    expect(r.dailyGenerationKwh).toBeCloseTo(r.annualGenerationKwh / 365, 0);
    expect(r.inverterKw).toBe(4); // 4.4 / 1.2 = 3.67 → next standard size
    expect(r.coveragePercent).toBeGreaterThan(100);
    expect(r.assumptions.join(' ')).toMatch(/not guaranteed/i);
    expect(r.systemCost).toBeNull(); // no cost input → no invented cost
  });
  it('caps by roof area and warns', () => {
    const r = sizeSystem({ ...base, availableRoofAreaM2: 10 }); // 10*0.7/2.58 = 2.7 → 2 panels
    expect(r.panelCount).toBe(2);
    expect(r.limitedByRoof).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/Roof area limits/);
    expect(r.coveragePercent).toBeLessThan(50);
  });
  it('derives consumption from a bill via the tariff', () => {
    const r = sizeSystem({ tariff: slabTariff, avgMonthlyBill: 1760, annualPeakSunHours: 5, systemType: 'ON_GRID' });
    expect(r.monthlyConsumptionKwh[0]).toBeCloseTo(250, 0);
  });
  it('uses monthly irradiation profiles and 12-month consumption', () => {
    const psh = [4, 4.5, 5.5, 6, 6.5, 5, 4, 4, 5, 5, 4.5, 4];
    const cons = [300, 300, 350, 400, 450, 400, 350, 350, 350, 350, 300, 300];
    const r = sizeSystem({ tariff: flat(8), monthlyConsumptionKwh12: cons, monthlyPeakSunHours: psh, systemType: 'ON_GRID' });
    expect(r.monthlyGenerationKwh).toHaveLength(12);
    expect(r.monthlyGenerationKwh[4]!).toBeGreaterThan(r.monthlyGenerationKwh[0]!);
  });
  it('sizes batteries for off-grid and hybrid, none for on-grid', () => {
    expect(sizeSystem(base).batteryKwh).toBe(0);
    const off = sizeSystem({ ...base, systemType: 'OFF_GRID' });
    expect(off.batteryKwh).toBeCloseTo(((6000 / 365) * 0.4) / (0.8 * 0.9), 0);
    const hy = sizeSystem({ ...base, systemType: 'HYBRID', criticalLoadKw: 2, backupHours: 4 });
    expect(hy.batteryKwh).toBeCloseTo(8 / (0.8 * 0.9), 1);
    expect(sizeSystem({ ...base, systemType: 'HYBRID' }).warnings.join(' ')).toMatch(/critical load/);
  });
  it('warns about extreme DC/AC ratios when the inverter is user-supplied', () => {
    expect(sizeSystem({ ...base, inverterKw: 2 }).warnings.join(' ')).toMatch(/clip/);
    expect(sizeSystem({ ...base, inverterKw: 10 }).warnings.join(' ')).toMatch(/oversized/);
  });
  it('computes cost and applies subsidy when a rate is given', () => {
    const r = sizeSystem({ ...base, costPerKwp: 50000, subsidy: 30000 });
    expect(r.systemCost).toBe(220000);
    expect(r.netCost).toBe(190000);
  });
  it('rejects missing inputs', () => {
    expect(() => sizeSystem({ tariff: flat(8), annualPeakSunHours: 5, systemType: 'ON_GRID' })).toThrow(/consumption/);
    expect(() => sizeSystem({ tariff: flat(8), monthlyConsumptionKwh: 100, systemType: 'ON_GRID' })).toThrow(/irradiation/);
  });
});

describe('ROI simulator', () => {
  const clean = { degradationPercent: 0, omPercentOfCapexPerYear: 0, discountRatePercent: 0 };

  it('hand-checked payback: 500 kWh/month fully offset at 10/kWh costs 120000', () => {
    const r = simulateRoi({ ...clean, monthlyConsumptionKwh: twelve(500), monthlyGenerationKwh: twelve(500), tariff: flat(10), netCost: 120000, systemType: 'ON_GRID' });
    expect(r.summary.annualBillBefore).toBe(60000);
    expect(r.summary.annualBillAfter).toBe(0);
    expect(r.summary.annualSavingsYear1).toBe(60000);
    expect(r.summary.paybackYears).toBe(2);
    expect(r.summary.roiPercent).toBe(1150); // (60000*25 - 120000) / 120000
    expect(r.summary.irrPercent).toBeCloseTo(50, 0);
    expect(r.years).toHaveLength(25);
    expect(r.years[24]!.cumulative).toBe(60000 * 25 - 120000);
  });
  it('compares bills month by month, before vs after', () => {
    const r = simulateRoi({ ...clean, monthlyConsumptionKwh: twelve(300), monthlyGenerationKwh: twelve(150), tariff: slabTariff, netCost: 100000, systemType: 'ON_GRID' });
    const m = r.year1Monthly[0]!;
    expect(m.billBefore).toBeCloseTo(monthlyBill(300, slabTariff), 2);
    expect(m.billAfter).toBeCloseTo(monthlyBill(150, slabTariff), 2);
    expect(m.savings).toBeCloseTo(m.billBefore - m.billAfter, 2);
    expect(m.savings).toBeGreaterThan(0);
  });
  it('net metering banks surplus kWh across months', () => {
    const gen = twelve(100); gen[0] = 200; gen[1] = 0;
    const r = simulateRoi({ ...clean, monthlyConsumptionKwh: twelve(100), monthlyGenerationKwh: gen, tariff: flat(10), netCost: 1000, systemType: 'ON_GRID' });
    expect(r.year1Monthly[0]!.exportKwh).toBe(100);
    expect(r.year1Monthly[1]!.importKwh).toBe(0); // covered by the credit from January
    expect(r.year1Monthly[1]!.billAfter).toBe(0);
  });
  it('net metering pays leftover year-end credit at the export rate', () => {
    const r = simulateRoi({ ...clean, years: 1, monthlyConsumptionKwh: twelve(100), monthlyGenerationKwh: twelve(150), tariff: flat(10, { exportRate: 4 }), netCost: 1000, systemType: 'ON_GRID' });
    expect(r.year1Monthly[11]!.billAfter).toBeCloseTo(-(12 * 50 * 4), 2);
  });
  it('net billing: only the self-consumed share offsets imports; exports earn credit', () => {
    const t = flat(10, { exportMode: 'NET_BILLING', exportRate: 3 });
    const r = simulateRoi({ ...clean, years: 1, selfConsumptionShare: 0.5, monthlyConsumptionKwh: twelve(100), monthlyGenerationKwh: twelve(100), tariff: t, netCost: 1000, systemType: 'ON_GRID' });
    const m = r.year1Monthly[0]!;
    expect(m.importKwh).toBe(50); // 100 − min(100, 100×0.5)
    expect(m.exportKwh).toBe(50);
    expect(m.billAfter).toBe(350); // 50×10 = 500 less 50×3 = 150 credit
  });
  it('no-export mode ignores surplus', () => {
    const r = simulateRoi({ ...clean, years: 1, monthlyConsumptionKwh: twelve(100), monthlyGenerationKwh: twelve(300), tariff: flat(10, { exportMode: 'NONE' }), netCost: 1000, systemType: 'ON_GRID' });
    expect(r.year1Monthly[0]!.billAfter).toBe(0);
    expect(r.year1Monthly[0]!.exportKwh).toBe(0);
  });
  it('tariff escalation raises savings; degradation lowers them; O&M is deducted', () => {
    const args = { monthlyConsumptionKwh: twelve(500), monthlyGenerationKwh: twelve(500), netCost: 120000, systemType: 'ON_GRID' as const };
    const esc = simulateRoi({ ...clean, ...args, tariff: flat(10, { annualEscalationPercent: 5 }) });
    expect(esc.years[1]!.savings).toBeCloseTo(60000 * 1.05, 0);
    const deg = simulateRoi({ ...clean, ...args, degradationPercent: 1, tariff: flat(10) });
    expect(deg.years[1]!.savings).toBeLessThan(60000);
    const om = simulateRoi({ ...clean, ...args, omPercentOfCapexPerYear: 1, tariff: flat(10) });
    expect(om.years[0]!.savings).toBe(60000 - 1200);
  });
  it('reports null payback when savings never recover the cost, and flags off-grid comparisons', () => {
    const r = simulateRoi({ ...clean, years: 10, monthlyConsumptionKwh: twelve(500), monthlyGenerationKwh: twelve(500), tariff: flat(10), netCost: 9_000_000, systemType: 'OFF_GRID' });
    expect(r.summary.paybackYears).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/Off-grid/);
  });
  it('always states that results are estimates', () => {
    const r = simulateRoi({ monthlyConsumptionKwh: twelve(500), monthlyGenerationKwh: twelve(500), tariff: flat(10), netCost: 120000, systemType: 'ON_GRID' });
    expect(r.assumptions.join(' ')).toMatch(/Not a guarantee/i);
  });
});

describe('runCalculator', () => {
  it('chains sizing into ROI only when a cost is known', () => {
    const input = { tariff: flat(8), monthlyConsumptionKwh: 500, annualPeakSunHours: 5, systemType: 'ON_GRID' as const };
    expect(runCalculator(input).roi).toBeNull();
    const withCost = runCalculator({ ...input, costPerKwp: 50000 });
    expect(withCost.roi?.summary.paybackYears).toBeGreaterThan(0);
    expect(withCost.roi?.summary.netCost).toBe(withCost.sizing.netCost);
  });
});
