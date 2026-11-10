import { z } from 'zod';
import { DAYS_IN_MONTH, MONTH_LABELS, performanceRatio, type LossStack } from './solar';

/**
 * The company's reusable proposal content ("proposal profile"): written once by an administrator and attached
 * automatically to every quotation's proposal PDF. Images are stored as small PNG/JPEG data URLs (the client
 * downsizes them before saving).
 */
const dataImage = z.string().max(600_000).regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/, 'Images must be PNG or JPEG');
const image = dataImage.nullable().default(null);
const lines = (max: number) => z.array(z.string().trim().min(1).max(400)).max(max).default([]);
const years = z.number().int().min(0).max(100).nullable().default(null);

export const proposalProfileSchema = z.object({
  /** {{customer}} is replaced by the customer's name. */
  welcomeLetter: z.string().max(3000).default(''),
  aboutUs: z.string().max(4000).default(''),
  directorName: z.string().trim().max(80).default(''),
  directorTitle: z.string().trim().max(80).default(''),
  directorMessage: z.string().max(1500).default(''),
  directorPhoto: image,
  coverImage: image,
  welcomeImage: image,
  closingImage: image,
  /** Extra pages the administrator wants every proposal to carry (certifications, why choose us, case studies…). */
  highlights: z.array(z.object({ title: z.string().trim().min(1).max(80), body: z.string().max(3000).default(''), image })).max(6).default([]),
  clients: z.array(z.object({ name: z.string().trim().min(1).max(120), kw: z.number().min(0).max(1e6).nullable().default(null) })).max(40).default([]),
  clientsFootnote: z.string().trim().max(200).default(''),
  ourScope: lines(15),
  customerScope: lines(15),
  timeline: z.array(z.object({ label: z.string().trim().min(1).max(60), days: z.number().int().min(0).max(365) })).max(6).default([]),
  terms: lines(30),
  paymentTerms: lines(10),
  balanceOfSystem: lines(20),
  warranty: z.object({ panelYears: years, performanceYears: years, inverterYears: years, maintenanceYears: years }).default({ panelYears: null, performanceYears: null, inverterYears: null, maintenanceYears: null }),
  brandLogos: z.array(z.object({ name: z.string().trim().min(1).max(60), image })).max(8).default([]),
}).superRefine((p, ctx) => {
  const all = [p.directorPhoto, p.coverImage, p.welcomeImage, p.closingImage, ...p.highlights.map((h) => h.image), ...p.brandLogos.map((b) => b.image)];
  const total = all.reduce((a, s) => a + (s?.length ?? 0), 0);
  if (total > 3_500_000) ctx.addIssue({ code: 'custom', message: 'The images are too large in total (limit about 3.5 MB). Use smaller images.' });
});
export type ProposalProfile = z.infer<typeof proposalProfileSchema>;
export const emptyProposalProfile = (): ProposalProfile => proposalProfileSchema.parse({});

/** True when the profile has nothing for a proposal to attach. */
export function proposalProfileIsEmpty(p: ProposalProfile): boolean {
  return JSON.stringify(p) === JSON.stringify(emptyProposalProfile());
}

export const fillCustomer = (text: string, customer: string) => text.replace(/\{\{\s*customer\s*\}\}/gi, customer);

export interface SavingsInput {
  kwp: number;
  /** 12 monthly plane-of-array peak sun hours (kWh/m²/day). */
  monthlyPeakSunHours: number[];
  losses: LossStack;
  /** Flat average grid tariff the customer pays per kWh. */
  tariffPerKwh: number;
  /** Cost the payback is measured against (net of subsidy). */
  netCost: number;
  co2KgPerKwh: number;
  kgCo2PerTreePerYear: number;
}
export interface SavingsResult {
  monthlyKwh: number[]; monthlySavings: number[]; annualKwh: number; annualSavings: number;
  /** null when savings are zero. */
  paybackYears: number | null; co2Tonnes: number; trees: number; performanceRatio: number;
}

/** First-year generation and bill savings: kWp x peak sun hours x days x performance ratio, valued at a flat tariff. */
export function proposalSavings(i: SavingsInput): SavingsResult {
  if (!(i.kwp > 0) || i.monthlyPeakSunHours.length !== 12 || i.monthlyPeakSunHours.some((h) => !(h > 0 && h < 12))) throw new Error('Enter a system size and 12 monthly peak sun hours (0–12).');
  if (!(i.tariffPerKwh > 0)) throw new Error('Enter the electricity tariff per unit.');
  const pr = performanceRatio(i.losses);
  const monthlyKwh = i.monthlyPeakSunHours.map((h, m) => i.kwp * h * DAYS_IN_MONTH[m]! * pr);
  const monthlySavings = monthlyKwh.map((k) => k * i.tariffPerKwh);
  const annualKwh = monthlyKwh.reduce((a, b) => a + b, 0);
  const annualSavings = monthlySavings.reduce((a, b) => a + b, 0);
  const co2 = (annualKwh * i.co2KgPerKwh) / 1000;
  return {
    monthlyKwh, monthlySavings, annualKwh, annualSavings, paybackYears: annualSavings > 0 && i.netCost > 0 ? i.netCost / annualSavings : null,
    co2Tonnes: co2, trees: i.kgCo2PerTreePerYear > 0 ? Math.round((annualKwh * i.co2KgPerKwh) / i.kgCo2PerTreePerYear) : 0, performanceRatio: pr,
  };
}
export { MONTH_LABELS as PROPOSAL_MONTHS };
