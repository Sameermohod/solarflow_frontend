import { describe, expect, it } from 'vitest';
import { ALL_MODULE_KEYS, CORE_RESOURCES, MODULES, UNASSIGNED_RESOURCES, allowedResources, dependentsOf, filterPermissionsByModules, moduleForResource, resolveModules } from './modules';
import { ALL_PERMISSIONS, RESOURCES } from './permissions';

describe('modules', () => {
  it('every resource is core or belongs to exactly one module', () => {
    expect(UNASSIGNED_RESOURCES).toEqual([]);
    const seen = new Map<string, string>();
    for (const m of MODULES) for (const r of m.resources) { expect(seen.has(r)).toBe(false); seen.set(r, m.key); }
    for (const r of CORE_RESOURCES) expect(seen.has(r)).toBe(false);
    expect(new Set([...CORE_RESOURCES, ...seen.keys()])).toEqual(new Set(RESOURCES));
  });

  it('prerequisites exist and there are no cycles', () => {
    const keys = new Set<string>(ALL_MODULE_KEYS);
    for (const m of MODULES) for (const r of m.requires) expect(keys.has(r)).toBe(true);
    for (const k of ALL_MODULE_KEYS) expect(resolveModules([k]).length).toBeGreaterThan(0); // terminates
  });

  it('enabling a module enables its prerequisites transitively', () => {
    expect(resolveModules(['payments'])).toEqual(['customers', 'invoices', 'payments']);
    expect(resolveModules(['bom'])).toEqual(['equipment', 'designer', 'bom'].sort((a, b) => ALL_MODULE_KEYS.indexOf(a as never) - ALL_MODULE_KEYS.indexOf(b as never)));
    expect(resolveModules(['nope', 'reports'])).toEqual(['reports']);
    expect(resolveModules([])).toEqual([]);
  });

  it('dependentsOf lists what switches off with a module', () => {
    expect(dependentsOf('invoices')).toEqual(['payments']);
    expect(dependentsOf('customers')).toEqual(expect.arrayContaining(['crm', 'quotations', 'invoices', 'payments', 'surveys']));
    expect(dependentsOf('reports')).toEqual([]);
  });

  it('filters permissions to the enabled modules, always keeping core ones', () => {
    const enabled = resolveModules(['quotations']);
    const p = filterPermissionsByModules(ALL_PERMISSIONS, enabled);
    expect(p).toContain('quotation:view'); expect(p).toContain('contract:edit'); expect(p).toContain('customer:view'); expect(p).toContain('equipment:view');
    expect(p).toContain('dashboard:view'); expect(p).toContain('user:create'); expect(p).toContain('organization:edit');
    expect(p).not.toContain('invoice:view'); expect(p).not.toContain('lead:view'); expect(p).not.toContain('design:view'); expect(p).not.toContain('bom:view');
    expect(filterPermissionsByModules(ALL_PERMISSIONS, [])).toEqual(ALL_PERMISSIONS.filter((x) => allowedResources([]).has(x.split(':')[0] as never)));
    expect(filterPermissionsByModules(['weird:view', 'lead:view'], ['crm'])).toEqual(['lead:view']);
  });

  it('finds the owning module of a resource', () => {
    expect(moduleForResource('quotation')?.key).toBe('quotations');
    expect(moduleForResource('task')?.key).toBe('projects');
    expect(moduleForResource('dashboard')).toBeNull();
  });
});
