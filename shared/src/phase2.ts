import { z } from 'zod';
import { emailSchema } from './schemas';

const optStr = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const optEmail = z.union([emailSchema, z.literal('')]).optional().nullable().transform((v) => (v ? v : null));
const uuid = z.string().uuid();
const optUuid = z.string().uuid().optional().nullable().transform((v) => v ?? null);
const num = (min = 0, max = 1e12) => z.coerce.number().min(min).max(max);
/** Optional numeric field. Form inputs deliver strings, so the declared input type is wider than zod infers for coerce. */
const optNum = (min = 0, max = 1e12) =>
  z
    .union([z.coerce.number().min(min).max(max), z.literal(''), z.null(), z.undefined()])
    .transform((v) => (v === '' || v === null || v === undefined ? null : Number(v))) as unknown as z.ZodType<number | null, z.ZodTypeDef, number | string | null | undefined>;
const optDate = z.union([z.coerce.date(), z.literal(''), z.null(), z.undefined()]).transform((v) => (v === '' || v === null || v === undefined ? null : (v as Date)));

/* ───────── Customers ───────── */
export const CUSTOMER_TYPES = ['INDIVIDUAL', 'BUSINESS'] as const;

export const addressSchema = z.object({
  label: z.string().trim().min(1).max(60).default('Installation site'),
  line1: z.string().trim().min(1, 'Address line is required').max(200),
  line2: optStr(200),
  city: optStr(80),
  state: optStr(80),
  postalCode: optStr(20),
  country: optStr(80),
  latitude: optNum(-90, 90),
  longitude: optNum(-180, 180),
  isDefault: z.boolean().default(false),
});

export const customerSchema = z.object({
  type: z.enum(CUSTOMER_TYPES).default('INDIVIDUAL'),
  name: z.string().trim().min(2, 'Name is required').max(160),
  contactPerson: optStr(120),
  email: optEmail,
  phone: optStr(30),
  altPhone: optStr(30),
  taxId: optStr(40),
  notes: optStr(2000),
});
export const createCustomerSchema = customerSchema.extend({ addresses: z.array(addressSchema).max(10).default([]) });
export const noteSchema = z.object({ body: z.string().trim().min(1).max(4000), type: z.enum(['NOTE', 'CALL', 'EMAIL', 'MEETING']).default('NOTE') });

/* ───────── Leads ───────── */
export const LEAD_STAGES = ['NEW', 'CONTACTED', 'SITE_SURVEY', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] as const;
export type LeadStageKey = (typeof LEAD_STAGES)[number];
export const LEAD_STAGE_LABELS: Record<LeadStageKey, string> = {
  NEW: 'New', CONTACTED: 'Contacted', SITE_SURVEY: 'Site survey', PROPOSAL: 'Proposal', NEGOTIATION: 'Negotiation', WON: 'Won', LOST: 'Lost',
};
export const LEAD_SOURCES = ['WEBSITE', 'REFERRAL', 'WALK_IN', 'CAMPAIGN', 'SOCIAL', 'COLD_CALL', 'PARTNER', 'OTHER'] as const;

export const leadSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(160),
  companyName: optStr(160),
  phone: optStr(30),
  email: optEmail,
  address: optStr(300),
  source: z.enum(LEAD_SOURCES).default('OTHER'),
  assignedToId: optUuid,
  expectedCapacityKw: optNum(0, 100000),
  expectedValue: optNum(0, 1e12),
  notes: optStr(4000),
});
export const stageChangeSchema = z.object({ stage: z.enum(LEAD_STAGES), lostReason: optStr(300) });
export const activitySchema = z.object({
  type: z.enum(['NOTE', 'CALL', 'EMAIL', 'MEETING', 'FOLLOW_UP']).default('NOTE'),
  body: z.string().trim().min(1).max(4000),
  dueAt: optDate,
});
export const convertLeadSchema = z.object({
  /** Link to an existing customer instead of creating a new one. */
  customerId: optUuid,
  customerType: z.enum(CUSTOMER_TYPES).default('INDIVIDUAL'),
  createSurvey: z.boolean().default(false),
  surveyScheduledAt: optDate,
});

/* ───────── Surveys ───────── */
export const SURVEY_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export const ATTACHMENT_CATEGORIES = ['ROOF_PHOTO', 'BUILDING_PHOTO', 'METER_PHOTO', 'SITE_LAYOUT', 'MEASUREMENT_DOC', 'SURVEY_REPORT', 'OTHER'] as const;
export const ATTACHMENT_LABELS: Record<(typeof ATTACHMENT_CATEGORIES)[number], string> = {
  ROOF_PHOTO: 'Roof photographs', BUILDING_PHOTO: 'Building photographs', METER_PHOTO: 'Electrical meter', SITE_LAYOUT: 'Site layout',
  MEASUREMENT_DOC: 'Measurement documents', SURVEY_REPORT: 'Survey report', OTHER: 'Other',
};

const surveyFields = {
  addressId: optUuid,
  leadId: optUuid,
  engineerId: optUuid,
  scheduledAt: optDate,
  propertyType: optStr(60),
  buildingType: optStr(60),
  floors: optNum(0, 200).transform((v) => (v === null ? null : Math.round(v))),
  roofType: optStr(60),
  roofMaterial: optStr(60),
  roofLengthM: optNum(0, 10000),
  roofWidthM: optNum(0, 10000),
  roofOrientationDeg: optNum(0, 360),
  roofSlopeDeg: optNum(0, 90),
  availableRoofAreaM2: optNum(0, 1e7),
  roofAccess: optStr(500),
  shadingNotes: optStr(1000),
  connectionType: optStr(60),
  phase: z.enum(['SINGLE', 'THREE']).optional().nullable().transform((v) => v ?? null),
  monthlyConsumptionKwh: optNum(0, 1e7),
  avgMonthlyBill: optNum(0, 1e10),
  existingSolar: z.boolean().default(false),
  existingSolarKw: optNum(0, 1e5),
  gridConnectivity: optStr(120),
  sanctionedLoadKw: optNum(0, 1e5),
  backupRequirement: optStr(300),
  latitude: optNum(-90, 90),
  longitude: optNum(-180, 180),
  notes: optStr(4000),
};
export const createSurveySchema = z.object({ customerId: uuid, ...surveyFields });
export const updateSurveySchema = z.object(surveyFields).partial();
export const surveyStatusSchema = z.object({ status: z.enum(SURVEY_STATUSES) });

/** What a survey needs before it can be marked completed (so designers and the calculator get usable data). */
export function missingSurveyFields(s: {
  roofLengthM?: unknown; roofWidthM?: unknown; availableRoofAreaM2?: unknown; monthlyConsumptionKwh?: unknown; avgMonthlyBill?: unknown; roofType?: unknown;
}): string[] {
  const m: string[] = [];
  const has = (v: unknown) => v !== null && v !== undefined && v !== '';
  if (!has(s.roofType)) m.push('Roof type');
  if (!has(s.availableRoofAreaM2) && !(has(s.roofLengthM) && has(s.roofWidthM))) m.push('Roof area or roof length and width');
  if (!has(s.monthlyConsumptionKwh) && !has(s.avgMonthlyBill)) m.push('Monthly consumption or average bill');
  return m;
}

/* ───────── Calculator ───────── */
export const SYSTEM_TYPES = ['ON_GRID', 'OFF_GRID', 'HYBRID'] as const;
export const EXPORT_MODES = ['NET_METERING', 'NET_BILLING', 'NONE'] as const;

export const tariffSlabSchema = z.object({ upToKwh: z.union([z.coerce.number().positive(), z.null()]), rate: num(0, 1e6) });
export const tariffPlanSchema = z.object({
  name: z.string().trim().min(2).max(80),
  fixedChargePerMonth: num(0, 1e8).default(0),
  slabs: z.array(tariffSlabSchema).min(1).max(12),
  taxPercent: num(0, 100).default(0),
  exportMode: z.enum(EXPORT_MODES).default('NET_METERING'),
  exportRate: num(0, 1e6).default(0),
  annualEscalationPercent: num(0, 50).default(3),
  isDefault: z.boolean().default(false),
});

const month12 = z.array(num(0, 12)).length(12);
export const irradiationProfileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  region: optStr(120),
  monthlyPeakSunHours: month12,
  source: optStr(200),
  isDefault: z.boolean().default(false),
});

export const calculatorInputSchema = z
  .object({
    systemType: z.enum(SYSTEM_TYPES).default('ON_GRID'),
    monthlyConsumptionKwh: optNum(0, 1e7),
    monthlyConsumptionKwh12: z.array(num(0, 1e7)).length(12).optional().nullable().transform((v) => v ?? undefined),
    avgMonthlyBill: optNum(0, 1e10),
    tariffPlanId: optUuid,
    tariff: z
      .object({
        fixedChargePerMonth: num(0, 1e8).default(0),
        slabs: z.array(tariffSlabSchema).min(1).max(12),
        taxPercent: num(0, 100).default(0),
        exportMode: z.enum(EXPORT_MODES).default('NET_METERING'),
        exportRate: num(0, 1e6).default(0),
        annualEscalationPercent: num(0, 50).default(3),
      })
      .optional(),
    irradiationProfileId: optUuid,
    annualPeakSunHours: optNum(0.5, 12),
    availableRoofAreaM2: optNum(0, 1e7),
    roofAreaUtilization: optNum(0.1, 1),
    panelWatt: optNum(100, 1000),
    panelAreaM2: optNum(0.5, 5),
    inverterKw: optNum(0.1, 10000),
    dcAcRatio: optNum(1, 2),
    offsetPercent: optNum(1, 200),
    losses: z.record(z.coerce.number().min(0).max(50)).optional(),
    backupHours: optNum(0, 240),
    criticalLoadKw: optNum(0, 10000),
    nightShare: optNum(0, 1),
    autonomyDays: optNum(0, 10),
    costPerKwp: optNum(0, 1e9),
    costPerBatteryKwh: optNum(0, 1e9),
    subsidy: optNum(0, 1e12),
    // ROI
    selfConsumptionShare: optNum(0, 1),
    years: optNum(1, 40),
    degradationPercent: optNum(0, 5),
    consumptionGrowthPercent: optNum(-10, 20),
    omPercentOfCapexPerYear: optNum(0, 10),
    discountRatePercent: optNum(0, 50),
  })
  .refine((v) => v.monthlyConsumptionKwh !== null || v.monthlyConsumptionKwh12 !== undefined || v.avgMonthlyBill !== null, {
    message: 'Enter monthly consumption (kWh) or the average monthly bill',
    path: ['monthlyConsumptionKwh'],
  });
export type CalculatorInput = z.infer<typeof calculatorInputSchema>;

export const saveCalculationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  customerId: optUuid,
  surveyId: optUuid,
  input: calculatorInputSchema,
});

/* ───────── Equipment / inventory ───────── */
export const EQUIPMENT_CATEGORIES = [
  'SOLAR_PANEL', 'INVERTER', 'BATTERY', 'MOUNTING_STRUCTURE', 'DC_CABLE', 'AC_CABLE', 'JUNCTION_BOX', 'CONNECTOR', 'EARTHING',
  'LIGHTNING_PROTECTION', 'PROTECTION_DEVICE', 'MONITORING', 'OTHER',
] as const;
export const EQUIPMENT_CATEGORY_LABELS: Record<(typeof EQUIPMENT_CATEGORIES)[number], string> = {
  SOLAR_PANEL: 'Solar panels', INVERTER: 'Inverters', BATTERY: 'Batteries', MOUNTING_STRUCTURE: 'Mounting structures', DC_CABLE: 'DC cables',
  AC_CABLE: 'AC cables', JUNCTION_BOX: 'Junction boxes', CONNECTOR: 'Connectors', EARTHING: 'Earthing equipment',
  LIGHTNING_PROTECTION: 'Lightning protection', PROTECTION_DEVICE: 'Electrical protection', MONITORING: 'Monitoring systems', OTHER: 'Other accessories',
};

export const supplierSchema = z.object({
  name: z.string().trim().min(2).max(160),
  contactPerson: optStr(120),
  email: optEmail,
  phone: optStr(30),
  address: optStr(300),
  taxId: optStr(40),
  paymentTerms: optStr(200),
  notes: optStr(1000),
});

export const equipmentSchema = z.object({
  name: z.string().trim().min(2).max(160),
  manufacturer: z.string().trim().min(1).max(120),
  modelNumber: z.string().trim().min(1).max(120),
  category: z.enum(EQUIPMENT_CATEGORIES),
  unit: z.string().trim().min(1).max(12).default('nos'),
  description: optStr(2000),
  wattageW: optNum(0, 1e6),
  voltageV: optNum(0, 1e6),
  lengthMm: optNum(0, 1e6),
  widthMm: optNum(0, 1e6),
  thicknessMm: optNum(0, 1e5),
  efficiencyPct: optNum(0, 100),
  warrantyYears: optNum(0, 100).transform((v) => (v === null ? null : Math.round(v))),
  purchasePrice: num(0, 1e10).default(0),
  sellingPrice: num(0, 1e10).default(0),
  taxRateCode: optStr(30),
  hsnCode: optStr(20),
  supplierId: optUuid,
  trackSerial: z.boolean().default(false),
  reorderLevel: num(0, 1e9).default(0),
  isActive: z.boolean().default(true),
  specifications: z.array(z.object({ name: z.string().trim().min(1).max(80), value: z.string().trim().min(1).max(200), unit: optStr(20) })).max(40).default([]),
});

export const MOVEMENT_TYPES = ['RECEIPT', 'ISSUE', 'ADJUSTMENT', 'RETURN'] as const;
export const stockMovementSchema = z.object({
  equipmentId: uuid,
  type: z.enum(MOVEMENT_TYPES),
  /** RECEIPT/ISSUE/RETURN: positive quantity. ADJUSTMENT: signed, non-zero. */
  quantity: z.coerce.number().refine((n) => n !== 0, 'Quantity cannot be zero'),
  unitCost: optNum(0, 1e10),
  reference: optStr(120),
  note: optStr(500),
  serials: z.array(z.string().trim().min(1).max(80)).max(1000).optional(),
});

export const purchaseOrderSchema = z.object({
  supplierId: uuid,
  expectedDate: optDate,
  notes: optStr(1000),
  items: z.array(z.object({ equipmentId: uuid, quantity: num(0.001, 1e9), unitCost: num(0, 1e10) })).min(1, 'Add at least one item').max(100),
});
export const receivePurchaseOrderSchema = z.object({
  items: z.array(z.object({ itemId: uuid, quantity: num(0.001, 1e9), serials: z.array(z.string().trim().min(1).max(80)).optional() })).min(1),
});
export const SERIAL_STATUSES = ['IN_STOCK', 'ALLOCATED', 'INSTALLED', 'RETURNED', 'DEFECTIVE'] as const;
export const serialUpdateSchema = z.object({ status: z.enum(SERIAL_STATUSES), note: optStr(300) });

/** Editable, illustrative starting values only. Replace with PVGIS / NASA POWER / measured data for the real site. */
export const ILLUSTRATIVE_IRRADIATION_TEMPLATE = {
  name: 'Illustrative India average',
  region: 'India (generic)',
  source: 'Illustrative placeholder values. Replace with PVGIS or NASA POWER data for your site.',
  monthlyPeakSunHours: [4.8, 5.6, 6.2, 6.6, 6.4, 5.2, 4.4, 4.3, 5.0, 5.2, 4.8, 4.4],
};
