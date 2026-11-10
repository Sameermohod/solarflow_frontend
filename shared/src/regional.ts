/**
 * Regional presets are only *starting values* copied into an organization's own
 * configuration on sign-up. Tax rates and legal rules live in per-tenant config
 * and must be reviewed by the company's accountant — they are not authoritative.
 */
export interface RegionalPreset {
  country: string;
  currency: string;
  timezone: string;
  locale: string;
  measurementSystem: 'METRIC' | 'IMPERIAL';
  taxConfig: {
    regime: string;
    pricesIncludeTax: boolean;
    rates: { code: string; label: string; rate: number; active: boolean }[];
  };
}

export const REGIONAL_PRESETS: Record<string, RegionalPreset> = {
  IN: {
    country: 'IN',
    currency: 'INR',
    timezone: 'Asia/Kolkata',
    locale: 'en-IN',
    measurementSystem: 'METRIC',
    taxConfig: {
      regime: 'GST',
      pricesIncludeTax: false,
      // Example starting rates — editable, verify against current GST notifications.
      rates: [
        { code: 'GST_0', label: 'GST 0%', rate: 0, active: true },
        { code: 'GST_5', label: 'GST 5%', rate: 5, active: true },
        { code: 'GST_12', label: 'GST 12%', rate: 12, active: true },
        { code: 'GST_18', label: 'GST 18%', rate: 18, active: true },
      ],
    },
  },
};

export const GENERIC_PRESET: RegionalPreset = {
  country: 'US',
  currency: 'USD',
  timezone: 'UTC',
  locale: 'en-US',
  measurementSystem: 'IMPERIAL',
  taxConfig: { regime: 'SALES_TAX', pricesIncludeTax: false, rates: [] },
};

export function presetFor(country: string): RegionalPreset {
  return REGIONAL_PRESETS[country.toUpperCase()] ?? { ...GENERIC_PRESET, country: country.toUpperCase() };
}
