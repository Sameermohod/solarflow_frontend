import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, ROLE_KEYS, defaultPermissionsFor, hasPermission } from './permissions';
import { registerSchema, passwordSchema, hostnameSchema } from './schemas';
import { presetFor } from './regional';

describe('permissions', () => {
  it('every default grant is a known permission', () => {
    const known = new Set(ALL_PERMISSIONS);
    for (const r of ROLE_KEYS) for (const p of defaultPermissionsFor(r)) expect(known.has(p)).toBe(true);
  });
  it('owner has everything, admin cannot delete the organization', () => {
    expect(defaultPermissionsFor('ORG_OWNER')).toHaveLength(ALL_PERMISSIONS.length);
    expect(defaultPermissionsFor('ORG_ADMIN')).not.toContain('organization:delete');
  });
  it('least privilege: technician cannot touch invoices or users, customer is read-mostly', () => {
    const tech = defaultPermissionsFor('INSTALLATION_TECHNICIAN');
    expect(tech).not.toContain('invoice:view');
    expect(tech).not.toContain('user:view');
    expect(defaultPermissionsFor('CUSTOMER').filter((p) => p.endsWith(':delete'))).toEqual([]);
  });
  it('accountant can approve invoices but not edit designs', () => {
    const p = defaultPermissionsFor('ACCOUNTANT');
    expect(hasPermission(p, 'invoice:approve')).toBe(true);
    expect(hasPermission(p, 'design:edit')).toBe(false);
  });
  it('super admin role is platform-only and has all permissions', () => {
    expect(defaultPermissionsFor('SUPER_ADMIN')).toHaveLength(ALL_PERMISSIONS.length);
  });
});

describe('schemas', () => {
  it('rejects weak passwords', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('alllowercase123').success).toBe(false);
    expect(passwordSchema.safeParse('GoodPassw0rdX').success).toBe(true);
  });
  it('normalises email and validates slug', () => {
    const ok = registerSchema.parse({ organizationName: 'Sun Co', organizationSlug: 'sun-co', firstName: 'A', lastName: 'B', email: ' A@B.COM ', password: 'GoodPassw0rdX' });
    expect(ok.email).toBe('a@b.com');
    expect(registerSchema.safeParse({ ...ok, organizationSlug: 'Bad Slug!' }).success).toBe(false);
  });
  it('validates custom domains', () => {
    expect(hostnameSchema.safeParse('app.solarco.in').success).toBe(true);
    expect(hostnameSchema.safeParse('http://evil.com/x').success).toBe(false);
    expect(hostnameSchema.safeParse('localhost').success).toBe(false);
  });
  it('India preset carries configurable GST rates, other countries get none pre-filled', () => {
    expect(presetFor('in').taxConfig.regime).toBe('GST');
    expect(presetFor('DE').taxConfig.rates).toEqual([]);
  });
});
