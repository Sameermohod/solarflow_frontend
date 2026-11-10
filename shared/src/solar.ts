/**
 * Solar sizing + ROI simulation engine (pure functions, no I/O).
 *
 * IMPORTANT: everything here is an ESTIMATE under explicit, user-editable assumptions.
 * Results must never be presented as guaranteed generation or savings. Every result
 * carries the assumptions it used (see `assumptions`) so they can be shown next to the numbers.
 * Floating point is fine for estimation; financial *records* (invoices, payments) use Decimal in the DB.
 */

export type SystemType = 'ON_GRID' | 'OFF_GRID' | 'HYBRID';
export type ExportMode = 'NET_METERING' | 'NET_BILLING' | 'NONE';

export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export interface TariffSlab {
  /** Upper bound of the slab in kWh per month; null = no upper bound. */
  upToKwh: number | null;
  rate: number; // currency per kWh
}
export interface Tariff {
  fixedChargePerMonth: number;
  slabs: TariffSlab[];
  /** Duty / surcharge / tax applied on (fixed + energy) charges, in percent. */
  taxPercent: number;
  exportMode: ExportMode;
  /** Credit per exported kWh (NET_BILLING), or payout for leftover banked kWh at year end (NET_METERING). */
  exportRate: number;
  annualEscalationPercent: number;
}

export const round = (n: number, dp = 2) => {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
};
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

/* ───────────────────────────── Tariff ───────────────────────────── */

export function validateTariff(t: Tariff): string[] {
  const errs: string[] = [];
  if (!t.slabs.length) errs.push('Tariff needs at least one slab');
  let prev = 0;
  t.slabs.forEach((s, i) => {
    if (s.rate < 0) errs.push(`Slab ${i + 1}: rate cannot be negative`);
    if (s.upToKwh === null) {
      if (i !== t.slabs.length - 1) errs.push(`Slab ${i + 1}: only the last slab can be unbounded`);
    } else {
      if (s.upToKwh <= prev) errs.push(`Slab ${i + 1}: upper bound must be greater than the previous slab`);
      prev = s.upToKwh;
    }
  });
  return errs;
}

/** Energy charge for `kwh` in one month, before fixed charge and tax. Usage above the top bounded slab uses the last slab's rate. */
export function energyCharge(kwh: number, slabs: TariffSlab[]): number {
  let remaining = Math.max(0, kwh);
  let lower = 0;
  let total = 0;
  for (let i = 0; i < slabs.length && remaining > 0; i++) {
    const s = slabs[i]!;
    const width = s.upToKwh === null || i === slabs.length - 1 ? Infinity : s.upToKwh - lower;
    const used = Math.min(remaining, width);
    total += used * s.rate;
    remaining -= used;
    lower = s.upToKwh ?? lower;
  }
  return total;
}

/** Full monthly bill for `kwh` imported from the grid. */
export function monthlyBill(kwh: number, t: Tariff): number {
  return (t.fixedChargePerMonth + energyCharge(kwh, t.slabs)) * (1 + t.taxPercent / 100);
}

/** Inverse of monthlyBill (bill is monotonic in kWh): estimate monthly kWh from a bill amount. */
export function billToKwh(bill: number, t: Tariff): number {
  if (bill <= monthlyBill(0, t)) return 0;
  let lo = 0;
  let hi = 1_000_000;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (monthlyBill(mid, t) < bill) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ───────────────────────────── Losses / performance ratio ───────────────────────────── */

export interface LossStack {
  soiling: number;
  temperature: number;
  dcWiring: number;
  mismatch: number;
  inverter: number;
  acWiring: number;
  availability: number;
  irradianceAndOther: number; // low-light, angle-of-incidence, LID, shading allowance…
}
/** Typical planning values; the user can override each one. They are assumptions, not measurements. */
export const DEFAULT_LOSSES: LossStack = {
  soiling: 3, temperature: 8, dcWiring: 1.5, mismatch: 2, inverter: 3, acWiring: 1, availability: 1, irradianceAndOther: 3,
};
export const LOSS_LABELS: Record<keyof LossStack, string> = {
  soiling: 'Soiling / dust', temperature: 'Temperature', dcWiring: 'DC wiring', mismatch: 'Module mismatch',
  inverter: 'Inverter conversion', acWiring: 'AC wiring', availability: 'Downtime / availability', irradianceAndOther: 'Low-light, angle, LID & shading allowance',
};

export function performanceRatio(losses: LossStack): number {
  return Object.values(losses).reduce((pr, l) => pr * (1 - l / 100), 1);
}

/* ───────────────────────────── Sizing ───────────────────────────── */

export const STANDARD_INVERTER_KW = [1, 1.5, 2, 3, 3.3, 3.6, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100, 125, 150, 200, 250, 500];

export interface SizingInput {
  /** One of the three consumption inputs is required, in priority order. */
  monthlyConsumptionKwh12?: number[]; // Jan..Dec
  monthlyConsumptionKwh?: number; // flat average
  avgMonthlyBill?: number; // converted via the tariff
  tariff: Tariff;
  /** 12 monthly peak-sun-hours values (kWh/m²/day) for the site, from an editable irradiation profile. */
  monthlyPeakSunHours?: number[];
  /** Or a single annual average. */
  annualPeakSunHours?: number;
  availableRoofAreaM2?: number;
  /** Share of the roof area that can actually hold panels after spacing, access paths, obstacles and setbacks. */
  roofAreaUtilization?: number; // 0-1, default 0.7
  panelWatt?: number; // default 550
  panelAreaM2?: number; // default 2.58
  inverterKw?: number;
  dcAcRatio?: number; // default 1.2
  offsetPercent?: number; // share of annual consumption to target, default 100
  systemType: SystemType;
  losses?: Partial<LossStack>;
  // Storage
  backupHours?: number;
  criticalLoadKw?: number;
  nightShare?: number; // off-grid: share of daily energy used when the sun is down, default 0.4
  autonomyDays?: number; // off-grid, default 1
  batteryDepthOfDischarge?: number; // default 0.8
  batteryRoundTripEfficiency?: number; // default 0.9
  // Cost (all optional: no cost → no payback)
  costPerKwp?: number;
  costPerBatteryKwh?: number;
  subsidy?: number;
}

export interface SizingResult {
  monthlyConsumptionKwh: number[];
  annualConsumptionKwh: number;
  performanceRatio: number;
  losses: LossStack;
  annualYieldPerKwp: number; // kWh per kWp per year
  requiredKwp: number;
  panelCount: number;
  panelWatt: number;
  installedKwp: number;
  panelAreaM2Total: number;
  maxPanelsByRoof: number | null;
  limitedByRoof: boolean;
  inverterKw: number;
  dcAcRatio: number;
  batteryKwh: number;
  monthlyGenerationKwh: number[];
  dailyGenerationKwh: number;
  annualGenerationKwh: number;
  coveragePercent: number; // generation / consumption
  systemCost: number | null;
  netCost: number | null;
  assumptions: string[];
  warnings: string[];
}

function resolveConsumption(i: SizingInput): { monthly: number[]; note: string } {
  if (i.monthlyConsumptionKwh12) {
    if (i.monthlyConsumptionKwh12.length !== 12) throw new Error('monthlyConsumptionKwh12 must have 12 values');
    return { monthly: i.monthlyConsumptionKwh12, note: 'Consumption: 12 monthly values supplied.' };
  }
  if (i.monthlyConsumptionKwh !== undefined) {
    return { monthly: Array<number>(12).fill(i.monthlyConsumptionKwh), note: `Consumption: flat ${round(i.monthlyConsumptionKwh)} kWh/month supplied.` };
  }
  if (i.avgMonthlyBill !== undefined) {
    const kwh = billToKwh(i.avgMonthlyBill, i.tariff);
    return { monthly: Array<number>(12).fill(kwh), note: `Consumption estimated from the average bill using the selected tariff: ~${round(kwh)} kWh/month.` };
  }
  throw new Error('Provide monthly consumption (kWh) or an average monthly bill');
}

function resolveSunHours(i: SizingInput): { psh: number[]; note: string } {
  if (i.monthlyPeakSunHours) {
    if (i.monthlyPeakSunHours.length !== 12) throw new Error('monthlyPeakSunHours must have 12 values');
    return { psh: i.monthlyPeakSunHours, note: 'Solar resource: monthly peak-sun-hours from the selected irradiation profile.' };
  }
  if (i.annualPeakSunHours !== undefined) {
    return { psh: Array<number>(12).fill(i.annualPeakSunHours), note: `Solar resource: flat ${i.annualPeakSunHours} peak sun hours/day all year.` };
  }
  throw new Error('Provide an irradiation profile or annual peak sun hours');
}

export function sizeSystem(i: SizingInput): SizingResult {
  const warnings: string[] = [];
  const cons = resolveConsumption(i);
  const sun = resolveSunHours(i);
  const losses: LossStack = { ...DEFAULT_LOSSES, ...i.losses };
  const pr = performanceRatio(losses);
  const panelWatt = i.panelWatt ?? 550;
  const panelArea = i.panelAreaM2 ?? 2.58;
  const offset = (i.offsetPercent ?? 100) / 100;
  const util = i.roofAreaUtilization ?? 0.7;
  const dcAc = i.dcAcRatio ?? 1.2;

  const annualConsumption = sum(cons.monthly);
  const yieldPerKwp = sum(sun.psh.map((h, m) => h * DAYS_IN_MONTH[m]! * pr));
  if (annualConsumption <= 0) warnings.push('Consumption is zero, so no system is required.');

  const requiredKwp = yieldPerKwp > 0 ? (annualConsumption * offset) / yieldPerKwp : 0;
  let panels = Math.ceil((requiredKwp * 1000) / panelWatt);
  let maxPanels: number | null = null;
  let limitedByRoof = false;
  if (i.availableRoofAreaM2 !== undefined) {
    maxPanels = Math.floor((i.availableRoofAreaM2 * util) / panelArea);
    if (panels > maxPanels) {
      panels = maxPanels;
      limitedByRoof = true;
      warnings.push(`Roof area limits the system to ${maxPanels} panels, below the ${Math.ceil((requiredKwp * 1000) / panelWatt)} needed for the target offset.`);
    }
  }
  const installedKwp = (panels * panelWatt) / 1000;
  const monthlyGen = sun.psh.map((h, m) => installedKwp * h * DAYS_IN_MONTH[m]! * pr);
  const annualGen = sum(monthlyGen);

  let inverterKw: number;
  if (i.inverterKw !== undefined) {
    inverterKw = i.inverterKw;
    const ratio = installedKwp / inverterKw;
    if (ratio > 1.5) warnings.push(`DC/AC ratio is ${round(ratio)}: the inverter may clip noticeably (above ~1.5).`);
    if (ratio < 0.9) warnings.push(`DC/AC ratio is ${round(ratio)}: the inverter is oversized for the array.`);
  } else {
    const needed = installedKwp / dcAc;
    inverterKw = STANDARD_INVERTER_KW.find((k) => k >= needed) ?? Math.ceil(needed);
  }

  const dod = i.batteryDepthOfDischarge ?? 0.8;
  const rte = i.batteryRoundTripEfficiency ?? 0.9;
  let batteryKwh = 0;
  if (i.systemType === 'OFF_GRID') {
    const daily = annualConsumption / 365;
    batteryKwh = (daily * (i.nightShare ?? 0.4) * (i.autonomyDays ?? 1)) / (dod * rte);
  } else if (i.systemType === 'HYBRID' && i.criticalLoadKw && i.backupHours) {
    batteryKwh = (i.criticalLoadKw * i.backupHours) / (dod * rte);
  } else if (i.systemType === 'HYBRID') {
    warnings.push('Hybrid system: enter critical load (kW) and backup hours to size the battery.');
  }
  batteryKwh = round(batteryKwh, 1);

  let systemCost: number | null = null;
  let netCost: number | null = null;
  if (i.costPerKwp !== undefined) {
    systemCost = round(installedKwp * i.costPerKwp + batteryKwh * (i.costPerBatteryKwh ?? 0));
    netCost = round(Math.max(0, systemCost - (i.subsidy ?? 0)));
  }

  const assumptions = [
    cons.note,
    sun.note,
    `Performance ratio ${round(pr * 100, 1)}% after losses: ${Object.entries(losses).map(([k, v]) => `${LOSS_LABELS[k as keyof LossStack]} ${v}%`).join(', ')}.`,
    `Panel: ${panelWatt} W, ${panelArea} m² each. Target offset ${round(offset * 100, 0)}% of annual consumption.`,
    i.availableRoofAreaM2 !== undefined ? `Roof: ${i.availableRoofAreaM2} m² available × ${round(util * 100, 0)}% usable (spacing, access, obstacles).` : 'Roof area not provided, so the system is not limited by roof space.',
    i.inverterKw !== undefined ? `Inverter capacity supplied: ${i.inverterKw} kW.` : `Inverter sized at DC/AC ratio ${dcAc} and rounded up to a standard size.`,
    'Generation assumes unshaded, fixed panels at a suitable tilt and orientation; real output varies with weather, shading, orientation and equipment.',
    'These are estimates for planning and quotation support, not guaranteed output or savings.',
  ];

  return {
    monthlyConsumptionKwh: cons.monthly.map((v) => round(v, 1)),
    annualConsumptionKwh: round(annualConsumption, 0),
    performanceRatio: round(pr, 4),
    losses,
    annualYieldPerKwp: round(yieldPerKwp, 0),
    requiredKwp: round(requiredKwp, 2),
    panelCount: panels,
    panelWatt,
    installedKwp: round(installedKwp, 2),
    panelAreaM2Total: round(panels * panelArea, 1),
    maxPanelsByRoof: maxPanels,
    limitedByRoof,
    inverterKw: round(inverterKw, 1),
    dcAcRatio: installedKwp > 0 ? round(installedKwp / inverterKw, 2) : 0,
    batteryKwh,
    monthlyGenerationKwh: monthlyGen.map((v) => round(v, 1)),
    dailyGenerationKwh: round(annualGen / 365, 1),
    annualGenerationKwh: round(annualGen, 0),
    coveragePercent: annualConsumption > 0 ? round((annualGen / annualConsumption) * 100, 1) : 0,
    systemCost,
    netCost,
    assumptions,
    warnings,
  };
}

/* ───────────────────────────── ROI simulator ───────────────────────────── */

export interface RoiInput {
  monthlyConsumptionKwh: number[]; // 12, year 1
  monthlyGenerationKwh: number[]; // 12, year 1
  tariff: Tariff;
  netCost: number; // after subsidy
  systemType: SystemType;
  /** NET_BILLING / NONE only: share of generation consumed on site at the moment it is produced. */
  selfConsumptionShare?: number; // default 0.6
  years?: number; // default 25
  degradationPercent?: number; // per year, default 0.5
  consumptionGrowthPercent?: number; // per year, default 0
  omPercentOfCapexPerYear?: number; // default 1
  discountRatePercent?: number; // for NPV, default 8
}

export interface RoiMonth {
  month: string;
  consumptionKwh: number;
  generationKwh: number;
  importKwh: number;
  exportKwh: number;
  billBefore: number;
  billAfter: number;
  savings: number;
}
export interface RoiYear { year: number; billBefore: number; billAfter: number; om: number; savings: number; cumulative: number }
export interface RoiResult {
  year1Monthly: RoiMonth[];
  years: RoiYear[];
  summary: {
    annualBillBefore: number;
    annualBillAfter: number;
    annualSavingsYear1: number;
    savingsPercentYear1: number;
    paybackYears: number | null;
    roiPercent: number | null;
    irrPercent: number | null;
    npv: number;
    totalSavingsOverHorizon: number;
    netCost: number;
  };
  assumptions: string[];
  warnings: string[];
}

/** Simulates one year of bills; returns monthly rows. `esc` scales all prices (tariff escalation). */
function simulateYear(cons: number[], gen: number[], t: Tariff, esc: number, share: number, mode: ExportMode) {
  const rows: { importKwh: number; exportKwh: number; before: number; after: number }[] = [];
  let bankedKwh = 0; // NET_METERING credit in kWh
  let creditMoney = 0; // NET_BILLING credit in currency
  for (let m = 0; m < 12; m++) {
    const c = cons[m]!;
    const g = gen[m]!;
    const before = monthlyBill(c, t) * esc;
    let importKwh: number;
    let exportKwh = 0;
    let after: number;
    if (mode === 'NET_METERING') {
      const net = c - g;
      if (net > 0) {
        const used = Math.min(bankedKwh, net);
        bankedKwh -= used;
        importKwh = net - used;
      } else {
        bankedKwh += -net;
        importKwh = 0;
        exportKwh = -net;
      }
      after = monthlyBill(importKwh, t) * esc;
      if (m === 11 && bankedKwh > 0) {
        after -= bankedKwh * t.exportRate * esc; // leftover credit paid out at year end
        bankedKwh = 0;
      }
    } else if (mode === 'NET_BILLING') {
      const self = Math.min(c, g * share);
      exportKwh = Math.max(0, g - self);
      importKwh = c - self;
      let bill = monthlyBill(importKwh, t) * esc;
      const credit = exportKwh * t.exportRate * esc + creditMoney;
      const applied = Math.min(bill, credit);
      creditMoney = credit - applied; // unused credit carries to the next month, forfeited at year end
      bill -= applied;
      after = bill;
      if (m === 11) creditMoney = 0;
    } else {
      const self = Math.min(c, g);
      importKwh = c - self;
      after = monthlyBill(importKwh, t) * esc;
    }
    rows.push({ importKwh, exportKwh, before, after });
  }
  return rows;
}

function irr(cashflows: number[]): number | null {
  const npv = (r: number) => cashflows.reduce((s, cf, i) => s + cf / (1 + r) ** i, 0);
  let lo = -0.99;
  let hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export function simulateRoi(i: RoiInput): RoiResult {
  if (i.monthlyConsumptionKwh.length !== 12 || i.monthlyGenerationKwh.length !== 12) throw new Error('Need 12 monthly values for consumption and generation');
  const years = i.years ?? 25;
  const deg = (i.degradationPercent ?? 0.5) / 100;
  const growth = (i.consumptionGrowthPercent ?? 0) / 100;
  const omPct = i.omPercentOfCapexPerYear ?? 1;
  const disc = (i.discountRatePercent ?? 8) / 100;
  const share = i.selfConsumptionShare ?? 0.6;
  const t = i.tariff;
  const mode: ExportMode = i.systemType === 'OFF_GRID' ? 'NONE' : t.exportMode;
  const warnings: string[] = [];
  if (i.systemType === 'OFF_GRID') warnings.push('Off-grid: "bill before" is the grid cost you would otherwise pay. Any load not covered by solar and storage is priced at the grid tariff for comparison only.');
  if (i.netCost <= 0) warnings.push('Net cost is zero, so payback and ROI are not meaningful.');

  const om = (i.netCost * omPct) / 100;
  const out: RoiYear[] = [];
  let year1Monthly: RoiMonth[] = [];
  let cumulative = -i.netCost;
  const cashflows = [-i.netCost];

  for (let y = 1; y <= years; y++) {
    const esc = (1 + t.annualEscalationPercent / 100) ** (y - 1);
    const cons = i.monthlyConsumptionKwh.map((c) => c * (1 + growth) ** (y - 1));
    const gen = i.monthlyGenerationKwh.map((g) => g * (1 - deg) ** (y - 1));
    const rows = simulateYear(cons, gen, t, esc, share, mode);
    const before = sum(rows.map((r) => r.before));
    const after = sum(rows.map((r) => r.after));
    const savings = before - after - om;
    cumulative += savings;
    cashflows.push(savings);
    out.push({ year: y, billBefore: round(before), billAfter: round(after), om: round(om), savings: round(savings), cumulative: round(cumulative) });
    if (y === 1) {
      year1Monthly = rows.map((r, m) => ({
        month: MONTH_LABELS[m]!, consumptionKwh: round(cons[m]!, 1), generationKwh: round(gen[m]!, 1),
        importKwh: round(r.importKwh, 1), exportKwh: round(r.exportKwh, 1),
        billBefore: round(r.before), billAfter: round(r.after), savings: round(r.before - r.after),
      }));
    }
  }

  let payback: number | null = null;
  if (i.netCost <= 0) payback = 0;
  else {
    let prev = -i.netCost;
    for (const y of out) {
      if (y.cumulative >= 0) {
        const s = y.cumulative - prev;
        payback = round(y.year - 1 + (s > 0 ? -prev / s : 0), 1);
        break;
      }
      prev = y.cumulative;
    }
  }
  const y1 = out[0]!;
  const totalSavings = sum(out.map((y) => y.savings));
  const irrVal = i.netCost > 0 ? irr(cashflows) : null;
  const npv = cashflows.reduce((s, cf, k) => s + cf / (1 + disc) ** k, 0);

  const assumptions = [
    `Tariff: ${t.slabs.length} slab(s), fixed charge ${t.fixedChargePerMonth}/month, tax/surcharge ${t.taxPercent}%. Prices rise ${t.annualEscalationPercent}% per year.`,
    mode === 'NET_METERING' ? 'Export: net metering. Surplus kWh are banked month to month; leftover credit at year end is paid at the export rate.'
      : mode === 'NET_BILLING' ? `Export: net billing. ${round(share * 100, 0)}% of generation is used on site as produced; exports earn ${t.exportRate} per kWh as bill credit (carried forward within the year, never refunded).`
      : 'No export credit: only generation used on site offsets the bill.',
    `Panel output degrades ${round(deg * 100, 2)}% per year; consumption grows ${round(growth * 100, 2)}% per year.`,
    `Operation & maintenance ${omPct}% of net cost per year. Inverter or battery replacement and financing costs are not included.`,
    `Horizon ${years} years; NPV discounted at ${round(disc * 100, 1)}%.`,
    'Estimates only: actual bills depend on tariff changes, usage patterns, weather and equipment performance. Not a guarantee of savings.',
  ];

  return {
    year1Monthly,
    years: out,
    summary: {
      annualBillBefore: y1.billBefore,
      annualBillAfter: y1.billAfter,
      annualSavingsYear1: round(y1.billBefore - y1.billAfter),
      savingsPercentYear1: y1.billBefore > 0 ? round(((y1.billBefore - y1.billAfter) / y1.billBefore) * 100, 1) : 0,
      paybackYears: payback,
      roiPercent: i.netCost > 0 ? round((cumulative / i.netCost) * 100, 1) : null,
      irrPercent: irrVal === null ? null : round(irrVal * 100, 1),
      npv: round(npv),
      totalSavingsOverHorizon: round(totalSavings),
      netCost: round(i.netCost),
    },
    assumptions,
    warnings,
  };
}

/** Convenience: size the system, then (if cost is known) simulate the ROI. */
export function runCalculator(input: SizingInput, roi?: Omit<RoiInput, 'monthlyConsumptionKwh' | 'monthlyGenerationKwh' | 'tariff' | 'netCost' | 'systemType'>) {
  const sizing = sizeSystem(input);
  const roiResult = sizing.netCost !== null
    ? simulateRoi({
        ...roi,
        monthlyConsumptionKwh: sizing.monthlyConsumptionKwh,
        monthlyGenerationKwh: sizing.monthlyGenerationKwh,
        tariff: input.tariff,
        netCost: sizing.netCost,
        systemType: input.systemType,
      })
    : null;
  return { sizing, roi: roiResult };
}
