import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { defaultPermissionsFor } from '@solarflow/shared';
import { tokenStore } from '@/lib/api';
import { useAuth, type SessionPayload } from '@/store/auth';
import { CURRENT_PHASE, NAV, isLive } from '@/lib/nav';
import { SlabEditor } from '@/pages/calculator/CalcSettings';
import { CalculatorPage } from '@/pages/calculator/CalculatorPage';
import { CrmPage } from '@/pages/crm/CrmPage';
import { InventoryPage } from '@/pages/inventory/InventoryPage';

const session = (role: Parameters<typeof defaultPermissionsFor>[0]): SessionPayload => ({
  accessToken: 't', user: { id: 'u1', email: 'a@b.co', firstName: 'A', lastName: 'B', phone: null },
  organization: { id: 'o', name: 'Sun Co', slug: 'sun', logoUrl: null, primaryColor: '#0f2a43', accentColor: '#16a34a', currency: 'INR', country: 'IN', locale: 'en-IN', timezone: 'Asia/Kolkata', measurementSystem: 'METRIC' },
  roles: [], permissions: defaultPermissionsFor(role),
});
const wrap = (ui: ReactNode, url = '/') => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter></QueryClientProvider>
);

type Handler = (url: URL, init?: RequestInit) => unknown;
const calls: { url: string; method: string; body?: any }[] = [];
function mockApi(routes: Record<string, Handler>) {
  calls.length = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const key = `${method} ${url.pathname.replace('/api/v1', '')}`;
    calls.push({ url: key, method, body: init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    const h = routes[key];
    if (!h) return new Response(JSON.stringify({ error: { message: `unmocked ${key}` } }), { status: 404 });
    const out = h(url, init);
    return new Response(out === undefined ? null : JSON.stringify(out), { status: out === undefined ? 204 : 200 });
  });
}
const page = <T,>(data: T[]) => ({ data, meta: { page: 1, pageSize: 15, total: data.length, totalPages: 1 } });

beforeEach(() => { tokenStore.set('t'); useAuth.setState({ status: 'authenticated', session: session('ORG_OWNER') }); });
afterEach(() => vi.restoreAllMocks());

describe('navigation after Phase 6', () => {
  it('marks every module of the product live', () => {
    expect(CURRENT_PHASE).toBe(6);
    const live = NAV.filter(isLive).map((n) => n.key);
    expect(live).toEqual(expect.arrayContaining(['dashboard', 'crm', 'customers', 'surveys', 'calculator', 'equipment', 'inventory', 'settings', 'designer2d', 'designer3d', 'bom', 'quotations', 'invoices', 'payments', 'projects', 'documents', 'maintenance', 'reports']));
    expect(live).toHaveLength(NAV.length);
  });
});

describe('SlabEditor', () => {
  it('adds and removes slabs and labels the unbounded last slab', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<SlabEditor slabs={[{ upTo: '100', rate: '5' }, { upTo: '', rate: '8' }]} onChange={onChange} />);
    expect(screen.getByLabelText('Slab 2 up to kWh')).toHaveAttribute('placeholder', 'Above (no limit)');
    await userEvent.click(screen.getByRole('button', { name: /add slab/i }));
    expect(onChange).toHaveBeenLastCalledWith([{ upTo: '100', rate: '5' }, { upTo: '', rate: '8' }, { upTo: '', rate: '' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Remove slab 1' }));
    expect(onChange).toHaveBeenLastCalledWith([{ upTo: '', rate: '8' }]);
    rerender(<SlabEditor slabs={[{ upTo: '', rate: '8' }]} onChange={onChange} />);
    expect(screen.queryByRole('button', { name: /remove slab/i })).toBeNull(); // cannot remove the only slab
  });
});

describe('Calculator & ROI page', () => {
  const sizing = {
    monthlyConsumptionKwh: Array(12).fill(500), annualConsumptionKwh: 6000, performanceRatio: 0.7944, losses: { soiling: 3, temperature: 8, dcWiring: 1.5, mismatch: 2, inverter: 3, acWiring: 1, availability: 1, irradianceAndOther: 3 },
    annualYieldPerKwp: 1450, requiredKwp: 4.14, panelCount: 8, panelWatt: 550, installedKwp: 4.4, panelAreaM2Total: 20.6, maxPanelsByRoof: null, limitedByRoof: false, inverterKw: 4, dcAcRatio: 1.1, batteryKwh: 0,
    monthlyGenerationKwh: Array(12).fill(532), dailyGenerationKwh: 17.5, annualGenerationKwh: 6379, coveragePercent: 106.3, systemCost: 220000, netCost: 190000,
    assumptions: ['Consumption: flat 500 kWh/month supplied.', 'These are estimates for planning and quotation support, not guaranteed output or savings.'], warnings: ['Roof area limits the system to 6 panels.'],
  };
  const roi = {
    year1Monthly: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m) => ({ month: m, consumptionKwh: 500, generationKwh: 532, importKwh: 0, exportKwh: 32, billBefore: 3000, billAfter: 100, savings: 2900 })),
    years: [{ year: 1, billBefore: 36000, billAfter: 1200, om: 1900, savings: 32900, cumulative: -157100 }],
    summary: { annualBillBefore: 36000, annualBillAfter: 1200, annualSavingsYear1: 34800, savingsPercentYear1: 96.7, paybackYears: 5.6, roiPercent: 312.4, irrPercent: 17.2, npv: 250000, totalSavingsOverHorizon: 782000, netCost: 190000 },
    assumptions: ['Not a guarantee of savings.'], warnings: [],
  };
  const common = {
    'GET /solar-calculator/tariffs': () => ({ data: [{ id: 'tar1', name: 'Domestic', fixedChargePerMonth: '50', slabs: [{ upToKwh: null, rate: 8 }], taxPercent: '5', exportMode: 'NET_METERING', exportRate: '0', annualEscalationPercent: '3', isDefault: true }] }),
    'GET /solar-calculator/irradiation': () => ({ data: [{ id: 'pf1', name: 'Pune', region: 'Pune', monthlyPeakSunHours: Array(12).fill(5), source: 'PVGIS', isDefault: true }] }),
    'GET /customers': () => page([{ id: 'c1', name: 'Asha', phone: null, email: null }]),
  };

  it('sends the entered inputs, then shows size, bills before/after, payback and the assumptions with disclaimer', async () => {
    mockApi({ ...common, 'POST /solar-calculator/calculate': () => ({ sizing, roi }) });
    render(wrap(<CalculatorPage />));
    await userEvent.type(screen.getByLabelText('Monthly consumption (kWh)'), '500');
    await userEvent.click(screen.getByText('Costs'));
    await userEvent.type(screen.getByLabelText('Installed cost per kWp'), '50000');
    await userEvent.type(screen.getByLabelText('Subsidy / incentive (total)'), '30000');
    await userEvent.click(screen.getByRole('button', { name: 'Calculate' }));

    expect(await screen.findByText('4.4 kWp')).toBeInTheDocument();
    expect(screen.getByText(/8 × 550 W panels/)).toBeInTheDocument();
    expect(screen.getByText('5.6 yrs')).toBeInTheDocument();
    expect(screen.getByText('312%')).toBeInTheDocument();
    expect(screen.getByText(/electricity bill before vs after solar/i)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Roof area limits the system'); // warnings are surfaced
    expect(screen.getByText(/not guaranteed output or savings/i)).toBeInTheDocument();
    expect(screen.getByText('Overall performance ratio')).toBeInTheDocument();

    const post = calls.find((c) => c.url === 'POST /solar-calculator/calculate')!;
    expect(post.body).toMatchObject({ systemType: 'ON_GRID', monthlyConsumptionKwh: 500, avgMonthlyBill: null, costPerKwp: 50000, subsidy: 30000, panelWatt: 550, offsetPercent: 100 });
    expect(post.body.tariffPlanId).toBeNull(); // the server falls back to the default tariff
  });

  it('switches to bill-based input and manual sun hours', async () => {
    mockApi({ ...common, 'POST /solar-calculator/calculate': () => ({ sizing, roi: null }) });
    render(wrap(<CalculatorPage />));
    await userEvent.click(screen.getByRole('radio', { name: 'Average monthly bill' }));
    await userEvent.type(screen.getByLabelText('Average monthly bill', { selector: '#k-bill' }), '3000');
    await userEvent.click(screen.getByRole('radio', { name: 'Annual average' }));
    await userEvent.type(screen.getByLabelText('Peak sun hours per day (annual average)'), '5.2');
    await userEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    expect(await screen.findByText(/Enter a/)).toHaveTextContent(/cost per kWp/); // no cost → no ROI, with guidance
    const post = calls.find((c) => c.url === 'POST /solar-calculator/calculate')!;
    expect(post.body).toMatchObject({ avgMonthlyBill: 3000, monthlyConsumptionKwh: null, annualPeakSunHours: 5.2, irradiationProfileId: null });
  });

  it('shows server validation errors instead of a result', async () => {
    mockApi({ ...common, 'POST /solar-calculator/calculate': () => { throw new Error('x'); } });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const p = new URL(String(input)).pathname;
      if (p.endsWith('/calculate')) return new Response(JSON.stringify({ error: { message: 'Choose a tariff plan or enter tariff slabs.' } }), { status: 400 });
      return new Response(JSON.stringify(p.includes('customers') ? page([]) : { data: [] }), { status: 200 });
    });
    render(wrap(<CalculatorPage />));
    await userEvent.type(screen.getByLabelText('Monthly consumption (kWh)'), '400');
    await userEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    expect(await screen.findByText(/Choose a tariff plan/)).toBeInTheDocument();
    expect(screen.getByText('Your estimate will appear here')).toBeInTheDocument();
  });

  it('warns when no default tariff or solar resource exists yet', async () => {
    mockApi({ 'GET /solar-calculator/tariffs': () => ({ data: [] }), 'GET /solar-calculator/irradiation': () => ({ data: [] }), 'GET /customers': () => page([]) });
    render(wrap(<CalculatorPage />));
    expect(await screen.findByText(/No default tariff or solar-resource profile yet/)).toBeInTheDocument();
  });
});

describe('CRM board', () => {
  const stages = ['NEW', 'CONTACTED', 'SITE_SURVEY', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'];
  const lead = { id: 'l1', name: 'Priya Shah', companyName: null, phone: null, email: null, source: 'REFERRAL', stage: 'NEW', expectedValue: '450000', expectedCapacityKw: '5', nextFollowUpAt: new Date(Date.now() - 3600_000).toISOString(), customerId: null, updatedAt: '', assignedTo: { id: 'u1', firstName: 'A', lastName: 'B' } };
  const LABELS: Record<string, string> = { NEW: 'New', CONTACTED: 'Contacted', SITE_SURVEY: 'Site survey', PROPOSAL: 'Proposal', NEGOTIATION: 'Negotiation', WON: 'Won', LOST: 'Lost' };
  const board = () => ({ stages: stages.map((s) => ({ stage: s, label: LABELS[s], count: s === 'NEW' ? 1 : 0, totalValue: s === 'NEW' ? '450000' : '0', leads: s === 'NEW' ? [lead] : [] })) });
  const base = { 'GET /leads/board': board, 'GET /users/directory': () => ({ data: [{ id: 'u1', name: 'A B', roleKeys: [] }] }) };

  it('renders every pipeline stage, flags overdue follow-ups, and moves a lead via the stage selector', async () => {
    mockApi({ ...base, 'POST /leads/l1/stage': () => ({ ...lead, stage: 'CONTACTED' }) });
    render(wrap(<CrmPage />));
    expect(await screen.findByText('Priya Shah')).toBeInTheDocument();
    for (const s of ['New', 'Contacted', 'Site survey', 'Proposal', 'Negotiation', 'Won', 'Lost']) expect(screen.getByRole('region', { name: `${s} column` })).toBeInTheDocument();
    expect(screen.getByText('Follow-up due', { selector: 'span' })).toBeInTheDocument(); // the overdue badge on the card
    await userEvent.selectOptions(screen.getByLabelText('Move Priya Shah to stage'), 'CONTACTED');
    await waitFor(() => expect(calls.some((c) => c.url === 'POST /leads/l1/stage')).toBe(true));
    expect(calls.find((c) => c.url === 'POST /leads/l1/stage')!.body).toEqual({ stage: 'CONTACTED' });
  });

  it('will not mark a lead lost until a reason is given', async () => {
    mockApi({ ...base, 'POST /leads/l1/stage': () => ({ ...lead, stage: 'LOST' }) });
    render(wrap(<CrmPage />));
    await screen.findByText('Priya Shah');
    await userEvent.selectOptions(screen.getByLabelText('Move Priya Shah to stage'), 'LOST');
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Mark as lost' });
    expect(confirm).toBeDisabled();
    expect(calls.some((c) => c.url === 'POST /leads/l1/stage')).toBe(false);
    await userEvent.type(within(dialog).getByRole('textbox'), 'Chose a competitor');
    await userEvent.click(confirm);
    await waitFor(() => expect(calls.find((c) => c.url === 'POST /leads/l1/stage')?.body).toEqual({ stage: 'LOST', lostReason: 'Chose a competitor' }));
  });

  it('read-only roles cannot move or create leads', async () => {
    useAuth.setState({ session: session('ACCOUNTANT') }); // no lead permissions at all
    mockApi(base);
    render(wrap(<CrmPage />));
    await screen.findByText('Priya Shah');
    expect(screen.queryByLabelText('Move Priya Shah to stage')).toBeNull();
    expect(screen.queryByRole('button', { name: /new lead/i })).toBeNull();
  });
});

describe('Inventory', () => {
  const stock = [
    { id: 'e1', name: 'Mono 550W', manufacturer: 'Acme', modelNumber: 'M550', category: 'SOLAR_PANEL', unit: 'nos', reorderLevel: '10', trackSerial: false, purchasePrice: '10000', quantityOnHand: '4', lowStock: true },
    { id: 'e2', name: 'Inverter 5kW', manufacturer: 'Acme', modelNumber: 'I5', category: 'INVERTER', unit: 'nos', reorderLevel: '2', trackSerial: true, purchasePrice: '40000', quantityOnHand: '9', lowStock: false },
  ];
  const routes = { 'GET /inventory': () => page(stock), 'GET /inventory/summary': () => ({ items: 2, stockValue: '400000', lowStockCount: 1, openPurchaseOrders: 0 }) };

  it('shows stock with low-stock flags and summary', async () => {
    mockApi(routes);
    render(wrap(<InventoryPage />));
    expect(await screen.findByText('Low stock', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getAllByText('OK')).toHaveLength(1);
    expect(await screen.findByText('₹4,00,000')).toBeInTheDocument();
  });

  it('serial-tracked movements show how many serial numbers are still needed and send them', async () => {
    mockApi({ ...routes, 'POST /inventory/movements': () => ({ id: 'm1' }) });
    render(wrap(<InventoryPage />));
    await screen.findByText('Inverter 5kW');
    const row = screen.getByText('Inverter 5kW').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Move stock' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Quantity/), '2');
    expect(within(dialog).getByText(/0 entered, 2 needed/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Serial numbers/), 'SN1{enter}SN2');
    expect(within(dialog).getByText(/2 entered, 2 needed/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(calls.some((c) => c.url === 'POST /inventory/movements')).toBe(true));
    expect(calls.find((c) => c.url === 'POST /inventory/movements')!.body).toMatchObject({ equipmentId: 'e2', type: 'RECEIPT', quantity: 2, serials: ['SN1', 'SN2'] });
  });

  it('adjustments require a reason', async () => {
    mockApi(routes);
    render(wrap(<InventoryPage />));
    await screen.findByText('Mono 550W');
    await userEvent.click(within(screen.getByText('Mono 550W').closest('tr')!).getByRole('button', { name: 'Move stock' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Movement'), 'ADJUSTMENT');
    expect(within(dialog).getByLabelText('Reason (required)')).toBeRequired();
  });
});
