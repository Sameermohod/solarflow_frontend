import { describe, expect, it } from 'vitest';
import { DEFAULT_LOSSES, performanceRatio } from './solar';
import { emptyProposalProfile, fillCustomer, proposalProfileIsEmpty, proposalProfileSchema, proposalSavings } from './proposal';

const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('proposal profile', () => {
  it('parses an empty body into the empty profile', () => {
    const p = proposalProfileSchema.parse({});
    expect(proposalProfileIsEmpty(p)).toBe(true);
    expect(p.highlights).toEqual([]); expect(p.directorPhoto).toBeNull();
  });
  it('rejects non-image and oversized images, and too many items', () => {
    expect(proposalProfileSchema.safeParse({ coverImage: 'https://x/y.png' }).success).toBe(false);
    expect(proposalProfileSchema.safeParse({ coverImage: 'data:image/svg+xml;base64,AAAA' }).success).toBe(false);
    expect(proposalProfileSchema.safeParse({ coverImage: PX }).success).toBe(true);
    expect(proposalProfileSchema.safeParse({ highlights: Array(7).fill({ title: 't' }) }).success).toBe(false);
    const big = 'data:image/png;base64,' + 'A'.repeat(590_000);
    expect(proposalProfileSchema.safeParse({ coverImage: big, welcomeImage: big, directorPhoto: big, closingImage: big, brandLogos: [{ name: 'a', image: big }], highlights: [{ title: 'h', image: big }] }).success).toBe(false);
  });
  it('is not empty once content exists, and fills the customer name', () => {
    expect(proposalProfileIsEmpty(proposalProfileSchema.parse({ aboutUs: 'x' }))).toBe(false);
    expect(fillCustomer('Dear {{customer}}, hi {{ Customer }}', 'Mr. Singh')).toBe('Dear Mr. Singh, hi Mr. Singh');
    expect(emptyProposalProfile().terms).toEqual([]);
  });
});

describe('proposalSavings', () => {
  const psh = [5.2, 5.8, 6.3, 6.5, 6.4, 5, 3.8, 3.9, 4.8, 5.4, 5.1, 4.9];
  const base = { kwp: 3.3, monthlyPeakSunHours: psh, losses: DEFAULT_LOSSES, tariffPerKwh: 9, netCost: 127000, co2KgPerKwh: 0.82, kgCo2PerTreePerYear: 21 };
  it('computes generation, savings, payback and CO2 from the inputs', () => {
    const r = proposalSavings(base);
    const pr = performanceRatio(DEFAULT_LOSSES);
    const jan = 3.3 * 5.2 * 31 * pr;
    expect(r.monthlyKwh[0]).toBeCloseTo(jan, 6);
    expect(r.annualKwh).toBeCloseTo(r.monthlyKwh.reduce((a, b) => a + b, 0), 6);
    expect(r.annualSavings).toBeCloseTo(r.annualKwh * 9, 6);
    expect(r.paybackYears).toBeCloseTo(127000 / r.annualSavings, 9);
    expect(r.co2Tonnes).toBeCloseTo((r.annualKwh * 0.82) / 1000, 9);
    expect(r.trees).toBe(Math.round((r.annualKwh * 0.82) / 21));
  });
  it('payback is null with no cost, and bad input throws', () => {
    expect(proposalSavings({ ...base, netCost: 0 }).paybackYears).toBeNull();
    expect(() => proposalSavings({ ...base, kwp: 0 })).toThrow();
    expect(() => proposalSavings({ ...base, monthlyPeakSunHours: [1, 2] })).toThrow();
    expect(() => proposalSavings({ ...base, tariffPerKwh: 0 })).toThrow();
  });
});
