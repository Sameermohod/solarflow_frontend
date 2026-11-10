import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Save, Trash2 } from 'lucide-react';
import { DEFAULT_LOSSES, EXPORT_MODES, LOSS_LABELS, MONTH_LABELS, SYSTEM_TYPES, type RoiResult, type SizingResult } from '@solarflow/shared';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { dateOnly, label, num, useLocale, useMoney, type Page } from '@/lib/format';
import { useCustomerOptions } from '@/lib/hooks';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { Notice, StatCard, Tabs } from '@/components/ui/extra';
import { SlabEditor, SolarResourceTab, TariffsTab, fromSlabRows, toSlabRows, useProfiles, useTariffs } from './CalcSettings';

interface F {
  systemType: string; consMode: 'kwh' | 'bill'; kwh: string; bill: string;
  tariffId: string; cFixed: string; cTax: string; cMode: string; cExport: string; cEsc: string; cSlabs: { upTo: string; rate: string }[];
  resMode: 'profile' | 'manual'; profileId: string; psh: string;
  roofArea: string; util: string; panelWatt: string; panelArea: string; inverterKw: string; offset: string;
  backupHours: string; criticalLoad: string; nightShare: string; autonomy: string;
  costKwp: string; costBatt: string; subsidy: string;
  selfShare: string; years: string; degr: string; growth: string; om: string; disc: string;
  losses: Record<string, string>;
  customerId: string; surveyId: string;
}
const blank = (): F => ({
  systemType: 'ON_GRID', consMode: 'kwh', kwh: '', bill: '', tariffId: '', cFixed: '0', cTax: '0', cMode: 'NET_METERING', cExport: '0', cEsc: '3', cSlabs: [{ upTo: '', rate: '' }],
  resMode: 'profile', profileId: '', psh: '', roofArea: '', util: '', panelWatt: '550', panelArea: '', inverterKw: '', offset: '100',
  backupHours: '', criticalLoad: '', nightShare: '', autonomy: '', costKwp: '', costBatt: '', subsidy: '',
  selfShare: '', years: '25', degr: '0.5', growth: '0', om: '1', disc: '8', losses: {}, customerId: '', surveyId: '',
});
const N = (s: string) => (s.trim() === '' || Number.isNaN(Number(s)) ? null : Number(s));

function toPayload(f: F) {
  const losses: Record<string, number> = {};
  for (const [k, v] of Object.entries(f.losses)) if (v.trim() !== '' && Number(v) !== (DEFAULT_LOSSES as unknown as Record<string, number>)[k]) losses[k] = Number(v);
  return {
    systemType: f.systemType,
    monthlyConsumptionKwh: f.consMode === 'kwh' ? N(f.kwh) : null,
    avgMonthlyBill: f.consMode === 'bill' ? N(f.bill) : null,
    tariffPlanId: f.tariffId && f.tariffId !== 'custom' ? f.tariffId : null,
    tariff: f.tariffId === 'custom' ? { fixedChargePerMonth: Number(f.cFixed || 0), taxPercent: Number(f.cTax || 0), exportMode: f.cMode, exportRate: Number(f.cExport || 0), annualEscalationPercent: Number(f.cEsc || 0), slabs: fromSlabRows(f.cSlabs) } : undefined,
    irradiationProfileId: f.resMode === 'profile' && f.profileId ? f.profileId : null,
    annualPeakSunHours: f.resMode === 'manual' ? N(f.psh) : null,
    availableRoofAreaM2: N(f.roofArea), roofAreaUtilization: N(f.util) === null ? null : Number(f.util) / 100,
    panelWatt: N(f.panelWatt), panelAreaM2: N(f.panelArea), inverterKw: N(f.inverterKw), offsetPercent: N(f.offset),
    losses: Object.keys(losses).length ? losses : undefined,
    backupHours: N(f.backupHours), criticalLoadKw: N(f.criticalLoad), nightShare: N(f.nightShare), autonomyDays: N(f.autonomy),
    costPerKwp: N(f.costKwp), costPerBatteryKwh: N(f.costBatt), subsidy: N(f.subsidy),
    selfConsumptionShare: N(f.selfShare) === null ? null : Number(f.selfShare) / 100,
    years: N(f.years), degradationPercent: N(f.degr), consumptionGrowthPercent: N(f.growth), omPercentOfCapexPerYear: N(f.om), discountRatePercent: N(f.disc),
  };
}

type Saved = { monthlyConsumptionKwh?: number | null; avgMonthlyBill?: number | null; tariffPlanId?: string | null; irradiationProfileId?: string | null; annualPeakSunHours?: number | null; tariff?: { fixedChargePerMonth: number; taxPercent: number; exportMode: string; exportRate: number; annualEscalationPercent: number; slabs: { upToKwh: number | null; rate: number }[] } } & Record<string, unknown>;
function fromSaved(i: Saved): F {
  const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  const f = blank();
  const pct = (v: unknown) => (v === null || v === undefined ? '' : String(Math.round(Number(v) * 10000) / 100));
  return {
    ...f, systemType: s(i.systemType) || 'ON_GRID', consMode: i.monthlyConsumptionKwh != null ? 'kwh' : 'bill', kwh: s(i.monthlyConsumptionKwh), bill: s(i.avgMonthlyBill),
    tariffId: i.tariff ? 'custom' : s(i.tariffPlanId),
    ...(i.tariff ? { cFixed: s(i.tariff.fixedChargePerMonth), cTax: s(i.tariff.taxPercent), cMode: i.tariff.exportMode, cExport: s(i.tariff.exportRate), cEsc: s(i.tariff.annualEscalationPercent), cSlabs: toSlabRows(i.tariff.slabs) } : {}),
    resMode: i.annualPeakSunHours != null ? 'manual' : 'profile', profileId: s(i.irradiationProfileId), psh: s(i.annualPeakSunHours),
    roofArea: s(i.availableRoofAreaM2), util: pct(i.roofAreaUtilization), panelWatt: s(i.panelWatt) || '550', panelArea: s(i.panelAreaM2), inverterKw: s(i.inverterKw), offset: s(i.offsetPercent) || '100',
    backupHours: s(i.backupHours), criticalLoad: s(i.criticalLoadKw), nightShare: s(i.nightShare), autonomy: s(i.autonomyDays),
    costKwp: s(i.costPerKwp), costBatt: s(i.costPerBatteryKwh), subsidy: s(i.subsidy), selfShare: pct(i.selfConsumptionShare),
    years: s(i.years) || '25', degr: s(i.degradationPercent) || '0.5', growth: s(i.consumptionGrowthPercent) || '0', om: s(i.omPercentOfCapexPerYear) || '1', disc: s(i.discountRatePercent) || '8',
    losses: Object.fromEntries(Object.entries((i.losses as Record<string, number> | undefined) ?? {}).map(([k, v]) => [k, String(v)])),
  };
}

interface Result { sizing: SizingResult; roi: RoiResult | null }

function ChartCard({ title, children, desc }: { title: string; desc: string; children: ReactNode }) {
  return <Card><CardHeader title={title} description={desc} /><CardBody><div className="h-64" role="img" aria-label={`${title}. ${desc}`}>{children}</div></CardBody></Card>;
}

function Results({ r }: { r: Result }) {
  const money = useMoney();
  const accent = useAuth((s) => s.session?.organization.accentColor ?? '#16a34a');
  const brand = useAuth((s) => s.session?.organization.primaryColor ?? '#0f2a43');
  const z = r.sizing;
  const monthly = MONTH_LABELS.map((m, i) => ({ month: m, Consumption: z.monthlyConsumptionKwh[i], Generation: z.monthlyGenerationKwh[i] }));
  const roi = r.roi;
  const axis = { fontSize: 11, fill: '#5b6b7c' };
  return (
    <div className="space-y-6">
      {z.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Recommended capacity" value={`${z.installedKwp} kWp`} sub={`${z.panelCount} × ${z.panelWatt} W panels${z.limitedByRoof ? ' (roof-limited)' : ''}`} tone="good" />
        <StatCard label="Inverter" value={`${z.inverterKw} kW`} sub={`DC/AC ratio ${z.dcAcRatio}`} />
        <StatCard label="Panel area" value={`${z.panelAreaM2Total} m²`} sub={z.maxPanelsByRoof !== null ? `Roof fits up to ${z.maxPanelsByRoof} panels` : 'Roof area not provided'} />
        <StatCard label="Estimated generation" value={`${num(z.annualGenerationKwh, 0)} kWh/yr`} sub={`≈ ${z.dailyGenerationKwh} kWh/day · ${num(z.annualGenerationKwh / 12, 0)} kWh/month`} />
        <StatCard label="Covers consumption" value={`${z.coveragePercent}%`} sub={`of ${num(z.annualConsumptionKwh, 0)} kWh/yr`} />
        {z.batteryKwh > 0 ? <StatCard label="Battery storage" value={`${z.batteryKwh} kWh`} sub="Usable-capacity based sizing" /> : <StatCard label="Approx. system cost" value={z.systemCost !== null ? money(z.systemCost) : '—'} sub={z.netCost !== null && z.netCost !== z.systemCost ? `${money(z.netCost)} after subsidy` : 'Enter cost per kWp to estimate'} />}
      </div>
      {z.batteryKwh > 0 && <StatCard label="Approx. system cost" value={z.systemCost !== null ? money(z.systemCost) : '—'} sub={z.netCost !== null && z.netCost !== z.systemCost ? `${money(z.netCost)} after subsidy` : 'Enter cost per kWp to estimate'} />}

      <ChartCard title="Monthly consumption vs estimated generation" desc="kWh per month. Estimates, not guarantees.">
        <ResponsiveContainer width="100%" height="100%"><BarChart data={monthly} margin={{ left: -10, right: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e3e8ee" vertical={false} /><XAxis dataKey="month" tick={axis} /><YAxis tick={axis} /><Tooltip /><Legend />
          <Bar dataKey="Consumption" fill="#94a3b8" radius={[3, 3, 0, 0]} /><Bar dataKey="Generation" fill={accent} radius={[3, 3, 0, 0]} />
        </BarChart></ResponsiveContainer>
      </ChartCard>

      {roi ? (
        <>
          <h2 className="pt-2 text-lg font-semibold">ROI simulation: electricity bill before vs after solar</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard label="Annual bill before solar" value={money(roi.summary.annualBillBefore)} />
            <StatCard label="Annual bill after solar" value={money(roi.summary.annualBillAfter)} sub={`Year 1 saving ${money(roi.summary.annualSavingsYear1)} (${roi.summary.savingsPercentYear1}%)`} tone="good" />
            <StatCard label="Estimated payback" value={roi.summary.paybackYears === null ? 'Not within horizon' : `${roi.summary.paybackYears} yrs`} sub={`On net cost ${money(roi.summary.netCost)}`} />
            <StatCard label="Return on investment" value={roi.summary.roiPercent === null ? '—' : `${num(roi.summary.roiPercent, 0)}%`} sub={`Over ${roi.years.length} years`} />
            <StatCard label="IRR" value={roi.summary.irrPercent === null ? '—' : `${roi.summary.irrPercent}%`} />
            <StatCard label="Net present value" value={money(roi.summary.npv)} sub={`Total savings ${money(roi.summary.totalSavingsOverHorizon)}`} />
          </div>
          <ChartCard title="Monthly bill: before vs after solar (year 1)" desc="Electricity bill by month in your currency.">
            <ResponsiveContainer width="100%" height="100%"><BarChart data={roi.year1Monthly} margin={{ left: 0, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e3e8ee" vertical={false} /><XAxis dataKey="month" tick={axis} /><YAxis tick={axis} tickFormatter={(v: number) => money(v, { compact: true })} />
              <Tooltip formatter={(v: number) => money(v)} /><Legend />
              <Bar name="Before solar" dataKey="billBefore" fill="#94a3b8" radius={[3, 3, 0, 0]} /><Bar name="After solar" dataKey="billAfter" fill={accent} radius={[3, 3, 0, 0]} />
            </BarChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Cumulative cash flow" desc="Net savings minus the upfront cost. Payback is where the line crosses zero.">
            <ResponsiveContainer width="100%" height="100%"><LineChart data={[{ year: 0, cumulative: -roi.summary.netCost }, ...roi.years]} margin={{ left: 0, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e3e8ee" vertical={false} /><XAxis dataKey="year" tick={axis} /><YAxis tick={axis} tickFormatter={(v: number) => money(v, { compact: true })} />
              <Tooltip formatter={(v: number) => money(v)} labelFormatter={(y) => `Year ${y}`} /><ReferenceLine y={0} stroke={brand} strokeDasharray="4 4" />
              <Line name="Cumulative" type="monotone" dataKey="cumulative" stroke={accent} strokeWidth={2.5} dot={false} />
            </LineChart></ResponsiveContainer>
          </ChartCard>
          {roi.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
        </>
      ) : <Notice>Enter a <b>cost per kWp</b> under Costs to see bill savings, payback and ROI.</Notice>}

      <Card>
        <CardHeader title="Assumptions and losses" description="Every number above depends on these. They are estimates, not guarantees." />
        <CardBody className="space-y-4">
          <div className="overflow-x-auto"><table className="w-full text-sm"><tbody>
            {(Object.keys(LOSS_LABELS) as (keyof typeof LOSS_LABELS)[]).map((k) => <tr key={k} className="border-b border-surface-line"><td className="py-1.5">{LOSS_LABELS[k]}</td><td className="py-1.5 text-right">{z.losses[k]}%</td></tr>)}
            <tr className="font-semibold"><td className="py-1.5">Overall performance ratio</td><td className="py-1.5 text-right">{(z.performanceRatio * 100).toFixed(1)}%</td></tr>
          </tbody></table></div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">{[...z.assumptions, ...(roi?.assumptions ?? [])].map((a) => <li key={a}>{a}</li>)}</ul>
        </CardBody>
      </Card>
    </div>
  );
}

function Details({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  return <details open={open} className="group rounded-lg border border-surface-line"><summary className="cursor-pointer select-none px-3 py-2.5 text-sm font-semibold">{title}</summary><div className="space-y-3 border-t border-surface-line p-3">{children}</div></details>;
}

function SaveModal({ f, onClose }: { f: F; onClose: () => void }) {
  const qc = useQueryClient();
  const customers = useCustomerOptions();
  const [name, setName] = useState('');
  const [customerId, setCustomerId] = useState(f.customerId);
  const save = useMutation({
    mutationFn: () => api.post('/solar-calculator/calculations', { name, customerId: customerId || null, surveyId: f.surveyId || null, input: toPayload(f) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['calculations'] }); qc.invalidateQueries({ queryKey: ['customer'] }); onClose(); },
  });
  return (
    <Modal open title="Save calculation" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) save.mutate(); }}>
        <Field label="Name" htmlFor="sc-name"><Input id="sc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 5 kW rooftop, option A" autoFocus /></Field>
        <Field label="Customer" htmlFor="sc-cust"><Select id="sc-cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">None</option>{customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        {f.surveyId && <p className="text-xs text-ink-muted">Linked to the site survey you opened this from.</p>}
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending} disabled={name.trim().length < 2}>Save</Button></div>
      </form>
    </Modal>
  );
}

function CalculatorTab() {
  const [params] = useSearchParams();
  const can = useAuth((s) => s.can);
  const tariffs = useTariffs();
  const profiles = useProfiles();
  const customers = useCustomerOptions();
  const [f, setF] = useState<F>(blank);
  const [result, setResult] = useState<Result | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof F>(k: K, v: F[K]) => setF((p) => ({ ...p, [k]: v }));
  const text = (k: keyof F & string, props: { placeholder?: string } = {}) => ({ value: f[k] as string, onChange: (e: { target: { value: string } }) => set(k, e.target.value as never), inputMode: 'decimal' as const, ...props });
  const calc = useMutation({ mutationFn: () => api.post<Result>('/solar-calculator/calculate', toPayload(f)), onSuccess: setResult });
  const defTariff = tariffs.data?.find((t) => t.isDefault);
  const defProfile = profiles.data?.find((p) => p.isDefault);

  // Prefill: ?surveyId=, ?customerId=, ?load=
  const surveyId = params.get('surveyId');
  const loadId = params.get('load');
  const presetCustomer = params.get('customerId');
  const survey = useQuery({ queryKey: ['survey', surveyId], enabled: !!surveyId, queryFn: () => api.get<Record<string, unknown> & { customer: { id: string; name: string } }>(`/site-surveys/${surveyId}`) });
  const loaded = useQuery({ queryKey: ['calculation', loadId], enabled: !!loadId, queryFn: () => api.get<{ id: string; name: string; customerId: string | null; surveyId: string | null; inputs: Saved; results: SizingResult; roi: RoiResult | null }>(`/solar-calculator/calculations/${loadId}`) });
  useEffect(() => {
    const sv = survey.data;
    if (!sv) return;
    const area = sv.availableRoofAreaM2 ?? (sv.roofLengthM && sv.roofWidthM ? Number(sv.roofLengthM) * Number(sv.roofWidthM) : '');
    setF((p) => ({ ...p, surveyId: surveyId ?? '', customerId: sv.customer.id, roofArea: area === '' ? '' : String(Math.round(Number(area) * 100) / 100),
      consMode: sv.monthlyConsumptionKwh ? 'kwh' : sv.avgMonthlyBill ? 'bill' : p.consMode, kwh: sv.monthlyConsumptionKwh ? String(Number(sv.monthlyConsumptionKwh)) : p.kwh, bill: sv.avgMonthlyBill ? String(Number(sv.avgMonthlyBill)) : p.bill }));
  }, [survey.data, surveyId]);
  useEffect(() => { if (presetCustomer) setF((p) => ({ ...p, customerId: presetCustomer })); }, [presetCustomer]);
  useEffect(() => {
    const l = loaded.data;
    if (!l) return;
    setF({ ...fromSaved(l.inputs), customerId: l.customerId ?? '', surveyId: l.surveyId ?? '' });
    setResult({ sizing: l.results, roi: l.roi });
  }, [loaded.data]);

  const noSetup = tariffs.data && profiles.data && !defTariff && !defProfile && f.tariffId === '' && f.resMode === 'profile';
  const customerName = customers.data?.find((c) => c.id === f.customerId)?.name ?? survey.data?.customer.name;
  const offgrid = f.systemType !== 'ON_GRID';

  return (
    <div className="grid gap-6 xl:grid-cols-[430px_1fr]">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); calc.mutate(); }}>
        {(customerName || loaded.data) && <Notice>{loaded.data ? `Loaded “${loaded.data.name}”. ` : ''}{customerName ? `For ${customerName}.` : ''}{f.surveyId ? ' Prefilled from the site survey.' : ''}</Notice>}
        {noSetup && <Notice tone="warn">No default tariff or solar-resource profile yet. Add them under the Tariffs and Solar resource tabs, or enter custom values below.</Notice>}
        <Details title="System" open>
          <Field label="System type" htmlFor="k-type"><Select id="k-type" value={f.systemType} onChange={(e) => set('systemType', e.target.value)}>{SYSTEM_TYPES.map((t) => <option key={t} value={t}>{label(t).replace('grid', '-grid')}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Panel wattage (W)" htmlFor="k-pw"><Input id="k-pw" {...text('panelWatt')} /></Field>
            <Field label="Target offset (%)" htmlFor="k-off" hint="Share of annual use"><Input id="k-off" {...text('offset')} /></Field>
          </div>
          <Field label="Inverter capacity (kW)" htmlFor="k-inv" hint="Leave empty to size automatically"><Input id="k-inv" {...text('inverterKw')} /></Field>
        </Details>
        <Details title="Consumption" open>
          <div className="flex gap-4 text-sm" role="radiogroup" aria-label="Consumption input">
            <label className="flex items-center gap-2"><input type="radio" checked={f.consMode === 'kwh'} onChange={() => set('consMode', 'kwh')} />Monthly kWh</label>
            <label className="flex items-center gap-2"><input type="radio" checked={f.consMode === 'bill'} onChange={() => set('consMode', 'bill')} />Average monthly bill</label>
          </div>
          {f.consMode === 'kwh' ? <Field label="Monthly consumption (kWh)" htmlFor="k-kwh"><Input id="k-kwh" {...text('kwh')} /></Field> : <Field label="Average monthly bill" htmlFor="k-bill" hint="Converted to kWh using the tariff below"><Input id="k-bill" {...text('bill')} /></Field>}
        </Details>
        <Details title="Electricity tariff" open>
          <Field label="Tariff" htmlFor="k-tar"><Select id="k-tar" value={f.tariffId} onChange={(e) => set('tariffId', e.target.value)}>
            <option value="">{defTariff ? `Default: ${defTariff.name}` : 'None selected'}</option>{tariffs.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}<option value="custom">Custom (enter below)…</option></Select></Field>
          {f.tariffId === 'custom' && (
            <div className="space-y-3 rounded-lg bg-surface-alt p-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Fixed charge / month" htmlFor="k-cf"><Input id="k-cf" {...text('cFixed')} /></Field><Field label="Tax / surcharge (%)" htmlFor="k-ct"><Input id="k-ct" {...text('cTax')} /></Field>
                <Field label="Export treatment" htmlFor="k-cm"><Select id="k-cm" value={f.cMode} onChange={(e) => set('cMode', e.target.value)}>{EXPORT_MODES.map((m) => <option key={m} value={m}>{label(m)}</option>)}</Select></Field>
                <Field label="Export rate / kWh" htmlFor="k-ce"><Input id="k-ce" {...text('cExport')} /></Field>
                <Field label="Annual increase (%)" htmlFor="k-cs"><Input id="k-cs" {...text('cEsc')} /></Field>
              </div>
              <SlabEditor slabs={f.cSlabs} onChange={(s) => set('cSlabs', s)} />
            </div>
          )}
        </Details>
        <Details title="Solar resource and roof" open>
          <div className="flex gap-4 text-sm" role="radiogroup" aria-label="Solar resource input">
            <label className="flex items-center gap-2"><input type="radio" checked={f.resMode === 'profile'} onChange={() => set('resMode', 'profile')} />Saved profile</label>
            <label className="flex items-center gap-2"><input type="radio" checked={f.resMode === 'manual'} onChange={() => set('resMode', 'manual')} />Annual average</label>
          </div>
          {f.resMode === 'profile'
            ? <Field label="Irradiation profile" htmlFor="k-prof"><Select id="k-prof" value={f.profileId} onChange={(e) => set('profileId', e.target.value)}><option value="">{defProfile ? `Default: ${defProfile.name}` : 'None selected'}</option>{profiles.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            : <Field label="Peak sun hours per day (annual average)" htmlFor="k-psh"><Input id="k-psh" {...text('psh')} /></Field>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Available roof area (m²)" htmlFor="k-roof"><Input id="k-roof" {...text('roofArea')} /></Field>
            <Field label="Usable share of roof (%)" htmlFor="k-util" hint="Default 70% (spacing, access, obstacles)"><Input id="k-util" {...text('util')} placeholder="70" /></Field>
          </div>
        </Details>
        {offgrid && (
          <Details title="Battery and backup" open>
            {f.systemType === 'HYBRID' ? <div className="grid grid-cols-2 gap-3"><Field label="Critical load (kW)" htmlFor="k-cl"><Input id="k-cl" {...text('criticalLoad')} /></Field><Field label="Backup hours" htmlFor="k-bh"><Input id="k-bh" {...text('backupHours')} /></Field></div>
              : <div className="grid grid-cols-2 gap-3"><Field label="Night-time share of use (0-1)" htmlFor="k-ns" hint="Default 0.4"><Input id="k-ns" {...text('nightShare')} placeholder="0.4" /></Field><Field label="Days of autonomy" htmlFor="k-ad" hint="Default 1"><Input id="k-ad" {...text('autonomy')} placeholder="1" /></Field></div>}
          </Details>
        )}
        <Details title="Costs">
          <Field label="Installed cost per kWp" htmlFor="k-ckwp" hint="Needed for payback and ROI"><Input id="k-ckwp" {...text('costKwp')} /></Field>
          {offgrid && <Field label="Battery cost per kWh" htmlFor="k-cb"><Input id="k-cb" {...text('costBatt')} /></Field>}
          <Field label="Subsidy / incentive (total)" htmlFor="k-sub"><Input id="k-sub" {...text('subsidy')} /></Field>
        </Details>
        <Details title="ROI assumptions">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Horizon (years)" htmlFor="k-y"><Input id="k-y" {...text('years')} /></Field><Field label="Panel degradation (%/yr)" htmlFor="k-dg"><Input id="k-dg" {...text('degr')} /></Field>
            <Field label="Consumption growth (%/yr)" htmlFor="k-gr"><Input id="k-gr" {...text('growth')} /></Field><Field label="O&M (% of cost / yr)" htmlFor="k-om"><Input id="k-om" {...text('om')} /></Field>
            <Field label="Discount rate (%)" htmlFor="k-dr"><Input id="k-dr" {...text('disc')} /></Field><Field label="On-site use of solar (%)" htmlFor="k-ss" hint="Net billing only, default 60%"><Input id="k-ss" {...text('selfShare')} placeholder="60" /></Field>
          </div>
        </Details>
        <Details title="Performance losses (%)">
          <div className="grid grid-cols-2 gap-3">{(Object.keys(LOSS_LABELS) as (keyof typeof LOSS_LABELS)[]).map((k) => (
            <Field key={k} label={LOSS_LABELS[k]} htmlFor={`k-l-${k}`}><Input id={`k-l-${k}`} inputMode="decimal" placeholder={String(DEFAULT_LOSSES[k])} value={f.losses[k] ?? ''} onChange={(e) => set('losses', { ...f.losses, [k]: e.target.value })} /></Field>))}</div>
        </Details>
        <ErrorNote error={calc.error} />
        <div className="sticky bottom-0 flex gap-2 bg-surface-alt py-3">
          <Button type="submit" variant="accent" className="flex-1" loading={calc.isPending}>Calculate</Button>
          {result && can('calculator:create') && <Button variant="outline" onClick={() => setSaving(true)}><Save className="h-4 w-4" />Save</Button>}
          <Button variant="ghost" onClick={() => { setF(blank()); setResult(null); }}>Reset</Button>
        </div>
      </form>
      <div>{calc.isPending && !result ? <div className="flex justify-center py-20"><Spinner className="h-8 w-8" /></div> : result ? <Results r={result} /> : <EmptyState title="Your estimate will appear here" description="Enter consumption, choose a tariff and solar resource, then press Calculate. The results always show the assumptions behind them." />}</div>
      {saving && <SaveModal f={f} onClose={() => setSaving(false)} />}
    </div>
  );
}

interface SavedRow { id: string; name: string; createdAt: string; customer: { id: string; name: string } | null; results: SizingResult }
function SavedTab() {
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({ queryKey: ['calculations', page], queryFn: () => api.get<Page<SavedRow>>(`/solar-calculator/calculations${qs({ page, pageSize: 15 })}`), placeholderData: (p) => p });
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/solar-calculator/calculations/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['calculations'] }) });
  return (
    <Card>
      {isLoading ? <div className="flex justify-center py-14"><Spinner className="h-7 w-7" /></div> : !data?.data.length ? <EmptyState title="No saved calculations" description="Run a calculation and press Save to keep it with a customer." /> : (
        <>
          <Table>
            <thead><tr><Th>Name</Th><Th>Customer</Th><Th>System</Th><Th>Saved</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>{data.data.map((c) => (
              <tr key={c.id}><Td><Link className="font-medium hover:underline" to={`/calculator?load=${c.id}`}>{c.name}</Link></Td><Td>{c.customer ? <Link className="text-accent hover:underline" to={`/customers/${c.customer.id}`}>{c.customer.name}</Link> : '—'}</Td>
                <Td>{c.results?.installedKwp} kWp <Badge>{c.results?.panelCount} panels</Badge></Td><Td>{dateOnly(c.createdAt, locale)}</Td>
                <Td className="text-right">{can('calculator:delete') && <Button size="icon" variant="ghost" aria-label={`Delete ${c.name}`} onClick={() => { if (window.confirm(`Delete “${c.name}”?`)) del.mutate(c.id); }}><Trash2 className="h-4 w-4 text-red-600" /></Button>}</Td></tr>))}</tbody>
          </Table>
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

export function CalculatorPage() {
  const [params] = useSearchParams();
  const can = useAuth((s) => s.can);
  const [tab, setTab] = useState<'calc' | 'saved' | 'tariffs' | 'resource'>('calc');
  const tabs = useMemo(() => [{ id: 'calc' as const, label: 'Calculator & ROI' }, { id: 'saved' as const, label: 'Saved' }, ...(can('calculator:view') ? [{ id: 'tariffs' as const, label: 'Tariffs' }, { id: 'resource' as const, label: 'Solar resource' }] : [])], [can]);
  return (
    <>
      <PageHeader title="Solar calculator" description="Size a system and simulate your customer's electricity bill before and after solar. All results are estimates." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'calc' && <CalculatorTab key={params.toString()} />}
      {tab === 'saved' && <SavedTab />}
      {tab === 'tariffs' && <TariffsTab />}
      {tab === 'resource' && <SolarResourceTab />}
    </>
  );
}
