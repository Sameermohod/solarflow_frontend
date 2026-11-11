import type { ReactNode } from 'react';
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { defaultPermissionsFor } from '@solarflow/shared';
import { LoginPage } from '@/pages/AuthPages';
import { ModulePlaceholder } from '@/pages/ModulePlaceholder';
import { NAV } from '@/lib/nav';
import { useAuth, type SessionPayload } from '@/store/auth';

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>
);
const session = (perms: string[]): SessionPayload => ({
  accessToken: 't', user: { id: '1', email: 'a@b.co', firstName: 'A', lastName: 'B', phone: null },
  organization: { id: 'o', name: 'Sun Co', slug: 'sun', logoUrl: null, primaryColor: '#0f2a43', accentColor: '#16a34a', currency: 'INR', country: 'IN', locale: 'en-IN', timezone: 'Asia/Kolkata', measurementSystem: 'METRIC' },
  roles: [], permissions: perms,
});
const visibleFor = () => NAV.filter((n) => useAuth.getState().canAny(...n.perms)).map((n) => n.key);

describe('LoginPage', () => {
  beforeEach(() => useAuth.setState({ status: 'anonymous', session: null }));
  it('validates before calling the API', async () => {
    render(wrap(<LoginPage />));
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
  });
});

describe('navigation & permissions', () => {
  it('lists the 18 modules from the spec in order, plus Timesheets and Finance before Reports', () => {
    expect(NAV.map((n) => n.label)).toEqual(['Dashboard', 'CRM', 'Customers', 'Site Surveys', 'Solar Calculator', '2D Designer', '3D Designer', 'Equipment', 'Inventory', 'BOM', 'Quotations', 'Projects', 'Invoices', 'Payments', 'Documents', 'Maintenance', 'Timesheets', 'Finance', 'Reports', 'Settings']);
  });
  it('technicians do not see finance or settings; sales executives get the calculator but no settings', () => {
    useAuth.setState({ status: 'authenticated', session: session(defaultPermissionsFor('INSTALLATION_TECHNICIAN')) });
    expect(visibleFor()).not.toContain('invoices');
    expect(visibleFor()).not.toContain('settings');
    expect(visibleFor()).not.toContain('finance'); // salaries are for payroll roles only
    expect(visibleFor()).toContain('timesheets');
    useAuth.setState({ session: session(defaultPermissionsFor('ACCOUNTANT')) });
    expect(visibleFor()).toContain('finance');
    useAuth.setState({ session: session(defaultPermissionsFor('PROJECT_MANAGER')) });
    expect(visibleFor()).not.toContain('finance');
    useAuth.setState({ session: session(defaultPermissionsFor('SALES_EXECUTIVE')) });
    expect(visibleFor()).toContain('calculator');
    expect(visibleFor()).not.toContain('settings');
  });
});

describe('ModulePlaceholder', () => {
  it('is honest about unbuilt modules and lists the ROI simulator under the calculator', () => {
    useAuth.setState({ status: 'authenticated', session: session(defaultPermissionsFor('ORG_OWNER')) });
    render(wrap(<ModulePlaceholder item={NAV.find((n) => n.key === 'calculator')!} />));
    expect(screen.getByText(/Scheduled · Phase 2/)).toBeInTheDocument();
    expect(screen.getByText(/ROI Simulator/i, { selector: 'li' })).toBeInTheDocument();
    expect(screen.getByText(/nothing here is mocked/i)).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
