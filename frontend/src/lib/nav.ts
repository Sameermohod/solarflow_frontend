import {
  BarChart3, Boxes, Box, Building2, CalendarClock, Calculator, Cuboid, FileText, FolderKanban, Gauge, LayoutDashboard,
  Package, PencilRuler, Receipt, Settings, ScrollText, Users, Wallet, Wrench, type LucideIcon,
} from 'lucide-react';
import type { PermissionKey } from '@solarflow/shared';

export interface NavItem {
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
  /** permission(s) needed to see the item; any one suffices */
  perms: PermissionKey[];
  /** delivery phase; 1 = live now */
  phase: number;
  summary: string;
  planned: string[];
}

export const NAV: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, perms: ['dashboard:view'], phase: 1, summary: '', planned: [] },
  { key: 'crm', label: 'CRM', path: '/crm', icon: Gauge, perms: ['lead:view'], phase: 2, summary: 'Lead pipeline from New to Won/Lost, follow-up reminders and conversion to customers and projects.', planned: ['Lead pipeline board', 'Assignment to sales reps', 'Follow-ups and notes', 'Convert lead → customer → project'] },
  { key: 'customers', label: 'Customers', path: '/customers', icon: Users, perms: ['customer:view'], phase: 2, summary: 'Individual and business customers with multiple installation addresses and documents.', planned: ['Customer profiles', 'Multiple addresses', 'Document uploads', 'Communication history'] },
  { key: 'surveys', label: 'Site Surveys', path: '/surveys', icon: Building2, perms: ['survey:view'], phase: 2, summary: 'Mobile-friendly survey forms for building, roof and electrical data with photo attachments.', planned: ['Roof & building measurements', 'Electrical connection details', 'Photo attachments', 'Map-based location capture'] },
  { key: 'calculator', label: 'Solar Calculator', path: '/calculator', icon: Calculator, perms: ['calculator:view'], phase: 2, summary: 'Solar sizing and the Solar ROI Simulator that compares electricity bills before and after installation.', planned: ['System sizing (kW, panels, inverter)', 'Generation estimates with shown losses', 'ROI Simulator: monthly bill before vs after solar', 'Payback and savings (estimates, never guarantees)'] },
  { key: 'designer2d', label: '2D Designer', path: '/designer-2d', icon: PencilRuler, perms: ['design:view'], phase: 3, summary: 'Interactive roof layout editor with automatic panel placement and validation.', planned: ['Roof sections & obstacles', 'Auto panel placement', 'Overlap / out-of-bounds detection', 'PNG, SVG, PDF export'] },
  { key: 'designer3d', label: '3D Designer', path: '/designer-3d', icon: Cuboid, perms: ['design:view'], phase: 3, summary: 'Three.js visualisation sharing the same geometry as the 2D designer.', planned: ['Building & roof types', 'Panels on roof', 'Camera views', 'Screenshot and report export'] },
  { key: 'equipment', label: 'Equipment', path: '/equipment', icon: Package, perms: ['equipment:view'], phase: 2, summary: 'Catalogue of panels, inverters, batteries and accessories with specs and datasheets.', planned: ['Product catalogue', 'Specifications & datasheets', 'Suppliers', 'Tax rates per product'] },
  { key: 'inventory', label: 'Inventory', path: '/inventory', icon: Boxes, perms: ['inventory:view'], phase: 2, summary: 'Stock levels, movements, purchase orders and serial number tracking.', planned: ['Stock movements', 'Purchase orders', 'Low-stock alerts', 'Serial numbers & project allocation'] },
  { key: 'bom', label: 'BOM', path: '/bom', icon: Box, perms: ['bom:view'], phase: 4, summary: 'Bill of materials generated from the design using configurable engineering rules.', planned: ['Auto-generated BOM', 'Manual quantity overrides', 'Cost & margin', 'Versioning linked to quotations'] },
  { key: 'quotations', label: 'Quotations', path: '/quotations', icon: ScrollText, perms: ['quotation:view'], phase: 4, summary: 'Branded quotations with versions, approval workflow and PDF output.', planned: ['Versions & approvals', 'PDF & email', 'Customer acceptance', 'Convert to project & contract'] },
  { key: 'projects', label: 'Projects', path: '/projects', icon: FolderKanban, perms: ['project:view'], phase: 5, summary: 'Installation project lifecycle from approval to handover.', planned: ['Milestones & tasks', 'Material allocation', 'Progress photos', 'Issues and expenses'] },
  { key: 'invoices', label: 'Invoices', path: '/invoices', icon: Receipt, perms: ['invoice:view'], phase: 4, summary: 'Proforma, advance, tax and final invoices with configurable tax and tax snapshots.', planned: ['Invoice types & credit/debit notes', 'Configurable tax rules', 'PDF with company branding', 'Payment reminders'] },
  { key: 'payments', label: 'Payments', path: '/payments', icon: Wallet, perms: ['payment:view'], phase: 4, summary: 'Payments, partial payments, receipts and outstanding balances.', planned: ['Payment recording & allocation', 'Receipts', 'Outstanding tracking'] },
  { key: 'documents', label: 'Documents', path: '/documents', icon: FileText, perms: ['document:view'], phase: 5, summary: 'Template-driven documents, including configurable regulatory packs per jurisdiction.', planned: ['Branded templates with placeholders', 'Version & approval status', 'Regulatory pack configuration', 'Audit history'] },
  { key: 'maintenance', label: 'Maintenance', path: '/maintenance', icon: Wrench, perms: ['maintenance:view'], phase: 5, summary: 'Warranty, AMC, service tickets and preventive maintenance.', planned: ['Warranty tracking', 'AMC schedules', 'Service tickets', 'Replacement history'] },
  { key: 'reports', label: 'Reports', path: '/reports', icon: BarChart3, perms: ['report:view'], phase: 6, summary: 'Cross-module business analytics and exports.', planned: ['Revenue & pipeline', 'Installation statistics', 'Export to CSV/PDF'] },
  { key: 'settings', label: 'Settings', path: '/settings', icon: Settings, perms: ['organization:view', 'user:view', 'role:view', 'auditLog:view'], phase: 1, summary: '', planned: [] },
];

export const SETTINGS_TABS: { path: string; label: string; icon: LucideIcon; perms: PermissionKey[] }[] = [
  { path: 'organization', label: 'Organization', icon: Building2, perms: ['organization:view'] },
  { path: 'branding', label: 'Branding', icon: PencilRuler, perms: ['organization:view'] },
  { path: 'regional', label: 'Regional & tax', icon: Gauge, perms: ['organization:view'] },
  { path: 'invoice', label: 'Invoice branding', icon: Receipt, perms: ['organization:view'] },
  { path: 'proposal', label: 'Proposal profile', icon: FileText, perms: ['organization:view'] },
  { path: 'domain', label: 'Custom domain', icon: CalendarClock, perms: ['organization:view'] },
  { path: 'users', label: 'Team', icon: Users, perms: ['user:view'] },
  { path: 'roles', label: 'Roles & permissions', icon: ScrollText, perms: ['role:view'] },
  { path: 'audit', label: 'Audit log', icon: FileText, perms: ['auditLog:view'] },
  { path: 'account', label: 'My account', icon: Settings, perms: [] },
];

/** Highest delivered phase. A module is live once its phase is delivered. */
export const CURRENT_PHASE = 6;
export const isLive = (n: NavItem) => n.phase <= CURRENT_PHASE;
