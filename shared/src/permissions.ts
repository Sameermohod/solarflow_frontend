export const ACTIONS = ['view', 'create', 'edit', 'delete', 'approve', 'export'] as const;
export type Action = (typeof ACTIONS)[number];

export const RESOURCES = [
  'dashboard', 'customer', 'lead', 'survey', 'calculator', 'design', 'equipment',
  'inventory', 'bom', 'quotation', 'contract', 'invoice', 'payment', 'document',
  'project', 'task', 'maintenance', 'report', 'organization', 'user', 'role', 'auditLog',
] as const;
export type Resource = (typeof RESOURCES)[number];

export type PermissionKey = `${Resource}:${Action}`;
export const perm = (r: Resource, a: Action): PermissionKey => `${r}:${a}`;

export const ALL_PERMISSIONS: PermissionKey[] = RESOURCES.flatMap((r) => ACTIONS.map((a) => perm(r, a)));

export const ROLE_KEYS = [
  'SUPER_ADMIN', 'ORG_OWNER', 'ORG_ADMIN', 'SALES_MANAGER', 'SALES_EXECUTIVE', 'SOLAR_DESIGNER',
  'SURVEY_ENGINEER', 'PROJECT_MANAGER', 'INSTALLATION_TECHNICIAN', 'ACCOUNTANT', 'CUSTOMER',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  SUPER_ADMIN: 'Super Admin',
  ORG_OWNER: 'Organization Owner',
  ORG_ADMIN: 'Organization Admin',
  SALES_MANAGER: 'Sales Manager',
  SALES_EXECUTIVE: 'Sales Executive',
  SOLAR_DESIGNER: 'Solar Designer',
  SURVEY_ENGINEER: 'Site Survey Engineer',
  PROJECT_MANAGER: 'Project Manager',
  INSTALLATION_TECHNICIAN: 'Installation Technician',
  ACCOUNTANT: 'Accountant',
  CUSTOMER: 'Customer',
};

type Grant = Partial<Record<Resource, readonly Action[]>>;
const RW: Action[] = ['view', 'create', 'edit'];
const RWD: Action[] = ['view', 'create', 'edit', 'delete'];
const V: Action[] = ['view'];
const FULL: Action[] = [...ACTIONS];

const GRANTS: Record<RoleKey, Grant> = {
  SUPER_ADMIN: Object.fromEntries(RESOURCES.map((r) => [r, FULL])) as Grant,
  ORG_OWNER: Object.fromEntries(RESOURCES.map((r) => [r, FULL])) as Grant,
  ORG_ADMIN: {
    ...(Object.fromEntries(RESOURCES.map((r) => [r, FULL])) as Grant),
    organization: ['view', 'edit'],
  },
  SALES_MANAGER: {
    dashboard: V, customer: [...RWD, 'export'], lead: [...RWD, 'export'], survey: RW, calculator: RW,
    design: V, equipment: V, bom: V, quotation: [...RW, 'approve', 'export'], contract: RW,
    document: [...RW, 'export'], project: V, report: ['view', 'export'], user: V,
  },
  SALES_EXECUTIVE: {
    dashboard: V, customer: RW, lead: RW, survey: RW, calculator: RW, design: V, equipment: V,
    bom: V, quotation: [...RW, 'export'], document: V, project: V,
  },
  SOLAR_DESIGNER: {
    dashboard: V, customer: V, lead: V, survey: V, calculator: RW, design: [...RWD, 'export'],
    equipment: V, bom: RW, quotation: V, document: [...RW, 'export'], project: V,
  },
  SURVEY_ENGINEER: {
    dashboard: V, customer: V, lead: V, survey: RW, calculator: V, design: V, document: RW, project: V,
  },
  PROJECT_MANAGER: {
    dashboard: V, customer: V, survey: V, design: V, equipment: V, inventory: [...RW, 'approve'],
    bom: V, quotation: V, contract: V, document: [...RW, 'approve', 'export'],
    project: [...RWD, 'approve'], task: RWD, maintenance: RW, report: ['view', 'export'],
  },
  INSTALLATION_TECHNICIAN: {
    dashboard: V, project: V, task: ['view', 'edit'], inventory: V, document: ['view', 'create'], maintenance: ['view', 'edit'],
  },
  ACCOUNTANT: {
    dashboard: V, customer: V, quotation: V, contract: V, invoice: [...RWD, 'approve', 'export'],
    payment: [...RW, 'export'], document: V, report: ['view', 'export'], project: V,
  },
  CUSTOMER: {
    quotation: V, invoice: V, payment: V, document: V, project: V, maintenance: ['view', 'create'],
  },
};

export function defaultPermissionsFor(role: RoleKey): PermissionKey[] {
  const grant = GRANTS[role];
  const out: PermissionKey[] = [];
  for (const r of RESOURCES) for (const a of grant[r] ?? []) out.push(perm(r, a));
  return out;
}

export function hasPermission(held: Iterable<string>, needed: PermissionKey): boolean {
  const set = held instanceof Set ? held : new Set(held);
  return set.has(needed);
}
