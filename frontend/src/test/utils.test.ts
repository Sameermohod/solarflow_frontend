import { describe, expect, it } from 'vitest';
import { hexToRgbTriplet, readableOn, formatMoney } from '@/lib/utils';

describe('branding utils', () => {
  it('converts hex to an rgb triplet usable in CSS variables', () => {
    expect(hexToRgbTriplet('#0f2a43')).toBe('15 42 67');
    expect(hexToRgbTriplet('nonsense')).toBe('15 42 67');
  });
  it('picks readable text colour for light and dark brand colours', () => {
    expect(readableOn('#ffffff')).toBe('15 42 67');
    expect(readableOn('#f5b301')).toBe('15 42 67');
    expect(readableOn('#0f2a43')).toBe('255 255 255');
    expect(readableOn('#16a34a')).toBe('255 255 255');
  });
  it('formats money using the organization currency and locale', () => {
    expect(formatMoney(1234567.5, 'INR', 'en-IN')).toContain('12,34,567.50');
  });
});
