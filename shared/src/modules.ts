import { RESOURCES, type Resource } from './permissions';

/**
 * Product modules a platform super admin can switch on or off per company. Access is enforced on the server by
 * removing the permissions of disabled modules from every request (see authenticate in the backend), so a disabled
 * module's API and screens are unavailable even to the company's owner.
 *
 * `requires` lists modules whose data this module reads; enabling a module enables its prerequisites too.
 * Dashboard, organization settings, users, roles and the audit log are core and always available.
 */
export interface ModuleDef { key: string; label: string; description: string; resources: readonly Resource[]; requires: readonly string[] }

export const MODULES = [
  { key: 'customers', label: 'Customers', description: 'Customer profiles and addresses', resources: ['customer'], requires: [] },
  { key: 'crm', label: 'CRM', description: 'Lead pipeline and follow-ups', resources: ['lead'], requires: ['customers'] },
  { key: 'surveys', label: 'Site Surveys', description: 'Site survey forms and photos', resources: ['survey'], requires: ['customers'] },
  { key: 'calculator', label: 'Solar Calculator', description: 'System sizing and the ROI simulator', resources: ['calculator'], requires: [] },
  { key: 'designer', label: '2D / 3D Designer', description: 'Roof layouts, 3D view, reports and structure drawings', resources: ['design'], requires: [] },
  { key: 'equipment', label: 'Equipment', description: 'Product catalogue and suppliers', resources: ['equipment'], requires: [] },
  { key: 'inventory', label: 'Inventory', description: 'Stock, purchase orders and serial numbers', resources: ['inventory'], requires: ['equipment'] },
  { key: 'bom', label: 'BOM', description: 'Bill of materials from designs', resources: ['bom'], requires: ['designer', 'equipment'] },
  { key: 'quotations', label: 'Quotations & Contracts', description: 'Quotations, proposals and contracts', resources: ['quotation', 'contract'], requires: ['customers', 'equipment'] },
  { key: 'invoices', label: 'Invoices', description: 'Proforma, advance and tax invoices', resources: ['invoice'], requires: ['customers'] },
  { key: 'payments', label: 'Payments', description: 'Payments and receipts', resources: ['payment'], requires: ['invoices'] },
  { key: 'projects', label: 'Projects & Tasks', description: 'Installation projects and tasks', resources: ['project', 'task'], requires: ['customers'] },
  { key: 'documents', label: 'Documents', description: 'Document templates and packs', resources: ['document'], requires: [] },
  { key: 'maintenance', label: 'Maintenance', description: 'Warranty, AMC and service tickets', resources: ['maintenance'], requires: ['customers'] },
  { key: 'reports', label: 'Reports', description: 'Business analytics and exports', resources: ['report'], requires: [] },
] as const satisfies readonly ModuleDef[];

export type ModuleKey = (typeof MODULES)[number]['key'];
export const ALL_MODULE_KEYS: ModuleKey[] = MODULES.map((m) => m.key);
export const CORE_RESOURCES: readonly Resource[] = ['dashboard', 'organization', 'user', 'role', 'auditLog'];

const byKey = new Map<string, ModuleDef>(MODULES.map((m) => [m.key, m]));
export const isModuleKey = (k: string): k is ModuleKey => byKey.has(k);

/** Selected modules plus every prerequisite (transitively), unknown keys dropped, in catalogue order. */
export function resolveModules(selected: readonly string[]): ModuleKey[] {
  const out = new Set<string>();
  const add = (k: string) => {
    if (out.has(k)) return;
    const m = byKey.get(k);
    if (!m) return;
    out.add(k);
    m.requires.forEach(add);
  };
  selected.forEach(add);
  return ALL_MODULE_KEYS.filter((k) => out.has(k));
}

/** Modules that need `key` (directly or through another module): what would be switched off with it. */
export function dependentsOf(key: string): ModuleKey[] {
  const out = new Set<string>();
  const walk = (k: string) => { for (const m of MODULES) if ((m.requires as readonly string[]).includes(k) && !out.has(m.key)) { out.add(m.key); walk(m.key); } };
  walk(key);
  return ALL_MODULE_KEYS.filter((k) => out.has(k));
}

/** Resources a company may use: the core ones plus those of its enabled modules. */
export function allowedResources(enabled: readonly string[]): Set<Resource> {
  const s = new Set<Resource>(CORE_RESOURCES);
  for (const k of enabled) byKey.get(k)?.resources.forEach((r) => s.add(r));
  return s;
}

/** Drops the permissions of disabled modules ("resource:action" keys). Unknown resources are dropped too. */
export function filterPermissionsByModules<T extends string>(permissions: Iterable<T>, enabled: readonly string[]): T[] {
  const ok = allowedResources(enabled);
  return [...permissions].filter((p) => ok.has(p.split(':')[0] as Resource));
}

/** The module that owns a resource, or null for core resources. */
export function moduleForResource(resource: string): ModuleDef | null {
  return MODULES.find((m) => (m.resources as readonly string[]).includes(resource)) ?? null;
}

// every non-core resource must belong to exactly one module (guards against adding a resource without a module)
export const UNASSIGNED_RESOURCES = RESOURCES.filter((r) => !CORE_RESOURCES.includes(r) && !moduleForResource(r));
