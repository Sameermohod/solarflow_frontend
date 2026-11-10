import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/[0-9]/, 'Include a number');

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and hyphens only');

export const registerSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  organizationSlug: slugSchema,
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  email: emailSchema,
  password: passwordSchema,
  country: z.string().length(2).toUpperCase().default('IN'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #RRGGBB colour');

export const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/, 'Enter a valid domain, e.g. app.example.com');

export const taxRateSchema = z.object({
  code: z.string().trim().min(1).max(30),
  label: z.string().trim().min(1).max(80),
  rate: z.number().min(0).max(100),
  active: z.boolean().default(true),
});

export const organizationProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(160).nullish(),
  registrationNumber: z.string().trim().max(60).nullish(),
  taxId: z.string().trim().max(40).nullish(),
  email: emailSchema.nullish(),
  phone: z.string().trim().max(30).nullish(),
  website: z.string().trim().url().max(200).nullish().or(z.literal('')),
  address: z
    .object({
      line1: z.string().max(160).optional(),
      line2: z.string().max(160).optional(),
      city: z.string().max(80).optional(),
      state: z.string().max(80).optional(),
      postalCode: z.string().max(20).optional(),
      country: z.string().max(80).optional(),
    })
    .nullish(),
});

export const regionalSettingsSchema = z.object({
  country: z.string().length(2).toUpperCase(),
  currency: z.string().length(3).toUpperCase(),
  timezone: z.string().min(1).max(64),
  locale: z.string().min(2).max(20),
  measurementSystem: z.enum(['METRIC', 'IMPERIAL']),
  /** Configurable tax rules. Never hard-coded; issued invoices snapshot these. */
  taxConfig: z.object({
    regime: z.string().trim().min(1).max(30),
    pricesIncludeTax: z.boolean().default(false),
    rates: z.array(taxRateSchema).max(50),
  }),
});

export const invoiceSettingsSchema = z.object({
  prefix: z.string().trim().max(12).default('INV'),
  paymentTermsDays: z.number().int().min(0).max(365).default(15),
  termsAndConditions: z.string().max(5000).default(''),
  footerNote: z.string().max(1000).default(''),
  bankDetails: z.string().max(1000).default(''),
  showLogo: z.boolean().default(true),
  showSignatureBlock: z.boolean().default(true),
  accentColor: hex.optional(),
});

export const brandingSchema = z.object({
  primaryColor: hex,
  accentColor: hex,
});

export const customDomainSchema = z.object({ domain: hostnameSchema.nullable() });

export const createUserSchema = z.object({
  email: emailSchema,
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  phone: z.string().trim().max(30).optional(),
  password: passwordSchema,
  roleIds: z.array(z.string().uuid()).min(1).max(5),
});

export const updateUserSchema = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  phone: z.string().trim().max(30).nullish(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  roleIds: z.array(z.string().uuid()).min(1).max(5).optional(),
});

export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).optional(),
  permissions: z.array(z.string()).max(500),
});
export const updateRolePermissionsSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(200).nullish(),
  permissions: z.array(z.string()).max(500),
});

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(100).optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}
