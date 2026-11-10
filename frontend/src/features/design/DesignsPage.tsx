import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { ROOF_TYPES, ROOF_TYPE_LABELS } from '@solarflow/shared';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { dateOnly, label, useLocale, type Page } from '@/lib/format';
import { useCustomerOptions } from '@/lib/hooks';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { Notice, useDebounced } from '@/components/ui/extra';
import type { DesignRecord } from './api';

interface Row extends DesignRecord { latest: { version: number; validPanelCount: number; installedKwp: string; issueCount: number } | null }

function NewDesignModal({ mode, preset, onClose }: { mode: '2d' | '3d'; preset: { surveyId?: string; customerId?: string; calculationId?: string }; onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const customers = useCustomerOptions();
  const surveys = useQuery({ queryKey: ['survey-options'], enabled: can('survey:view'), queryFn: () => api.get<Page<{ id: string; status: string; customer: { id: string; name: string }; address: { line1: string } | null; roofLengthM: string | null; roofWidthM: string | null; availableRoofAreaM2: string | null }>>(`/site-surveys${qs({ pageSize: 100 })}`).then((r) => r.data) });
  const calcs = useQuery({ queryKey: ['calc-options'], enabled: can('calculator:view'), queryFn: () => api.get<Page<{ id: string; name: string; customer: { id: string } | null; results: { installedKwp: number; panelCount: number } }>>(`/solar-calculator/calculations${qs({ pageSize: 100 })}`).then((r) => r.data) });
  const [name, setName] = useState('');
  const [customerId, setCustomerId] = useState(preset.customerId ?? '');
  const [surveyId, setSurveyId] = useState(preset.surveyId ?? '');
  const [calculationId, setCalc] = useState(preset.calculationId ?? '');
  const [length, setLength] = useState('12');
  const [width, setWidth] = useState('8');
  const [floors, setFloors] = useState('2');
  const [roofType, setRoofType] = useState<(typeof ROOF_TYPES)[number]>('FLAT');
  const [angle, setAngle] = useState('25');
  const survey = surveys.data?.find((s) => s.id === surveyId);
  const surveyHasDims = !!survey && ((survey.roofLengthM && survey.roofWidthM) || survey.availableRoofAreaM2);
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/solar-designs', {
      name, customerId: customerId || null, surveyId: surveyId || null, calculationId: calculationId || null,
      ...(surveyId && surveyHasDims ? {} : { building: { lengthM: Number(length), widthM: Number(width), floors: Number(floors), roofType, roofAngleDeg: roofType === 'FLAT' ? 0 : Number(angle) } }),
    }),
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: ['designs'] }); nav(`/designer-${mode}/${d.id}`); },
  });
  const valid = name.trim().length >= 2 && (surveyHasDims || (Number(length) > 0 && Number(width) > 0));
  return (
    <Modal open wide title="New solar design" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate(); }}>
        <Field label="Design name" htmlFor="d-name"><Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sharma residence: main roof" autoFocus /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer" htmlFor="d-cust"><Select id="d-cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">None</option>{customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          {can('survey:view') && <Field label="Start from a site survey" htmlFor="d-sv" hint="Uses its roof dimensions and roof type"><Select id="d-sv" value={surveyId} onChange={(e) => { setSurveyId(e.target.value); const s = surveys.data?.find((x) => x.id === e.target.value); if (s) setCustomerId(s.customer.id); }}>
            <option value="">No survey</option>{surveys.data?.map((s) => <option key={s.id} value={s.id}>{s.customer.name}{s.address ? `: ${s.address.line1}` : ''} ({label(s.status)})</option>)}</Select></Field>}
        </div>
        {can('calculator:view') && <Field label="Link a calculator result" htmlFor="d-calc" hint="Shows the recommended panel count in the editor so you can compare"><Select id="d-calc" value={calculationId} onChange={(e) => setCalc(e.target.value)}>
          <option value="">None</option>{calcs.data?.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.results.installedKwp} kWp, {c.results.panelCount} panels)</option>)}</Select></Field>}
        {surveyId && !surveyHasDims && <Notice tone="warn">This survey has no roof dimensions yet, so enter them below (or complete the survey first).</Notice>}
        {(!surveyId || !surveyHasDims) && (
          <fieldset className="space-y-3 rounded-lg border border-surface-line p-3">
            <legend className="px-1 text-sm font-medium">Building</legend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Length (m)" htmlFor="d-l"><Input id="d-l" inputMode="decimal" value={length} onChange={(e) => setLength(e.target.value)} /></Field>
              <Field label="Width (m)" htmlFor="d-w"><Input id="d-w" inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} /></Field>
              <Field label="Floors" htmlFor="d-f"><Input id="d-f" inputMode="numeric" value={floors} onChange={(e) => setFloors(e.target.value)} /></Field>
              <Field label="Roof type" htmlFor="d-rt"><Select id="d-rt" value={roofType} onChange={(e) => setRoofType(e.target.value as typeof roofType)}>{ROOF_TYPES.map((t) => <option key={t} value={t}>{ROOF_TYPE_LABELS[t]}</option>)}</Select></Field>
              {roofType !== 'FLAT' && <Field label="Roof angle (°)" htmlFor="d-a"><Input id="d-a" inputMode="decimal" value={angle} onChange={(e) => setAngle(e.target.value)} /></Field>}
            </div>
            <p className="text-xs text-ink-muted">You can change all of this later in the editor.</p>
          </fieldset>
        )}
        <ErrorNote error={create.error} />
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" variant="accent" loading={create.isPending} disabled={!valid}>Create and open</Button></div>
      </form>
    </Modal>
  );
}

export function DesignsPage({ mode }: { mode: '2d' | '3d' }) {
  const can = useAuth((s) => s.can);
  const locale = useLocale();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const preset = { surveyId: params.get('survey') ?? undefined, customerId: params.get('customer') ?? undefined, calculationId: params.get('calc') ?? undefined };
  const [creating, setCreating] = useState(!!(preset.surveyId || preset.customerId || preset.calculationId || params.has('new')));
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const q = useDebounced(search);
  const { data, isLoading, error } = useQuery({ queryKey: ['designs', page, q, status], queryFn: () => api.get<Page<Row>>(`/solar-designs${qs({ page, pageSize: 15, search: q, status })}`), placeholderData: (p) => p });
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/solar-designs/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['designs'] }) });
  const title = mode === '2d' ? '2D designer' : '3D designer';
  return (
    <>
      <PageHeader title={title} description={mode === '2d' ? 'Lay out panels on the roof, with automatic placement and live validation' : 'Visualise the same design in 3D: building, roof, panels and equipment'}
        actions={can('design:create') ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New design</Button> : undefined} />
      <Notice>2D and 3D are two views of one design: edit in either and the other updates. Layouts are preliminary visualisations, not certified structural or electrical designs.</Notice>
      <Card className="mt-4">
        <div className="flex flex-wrap gap-2 border-b border-surface-line px-5 py-4">
          <Input aria-label="Search designs" placeholder="Search design or customer…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
          <Select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40"><option value="">All statuses</option><option value="DRAFT">Draft</option><option value="APPROVED">Approved</option></Select>
        </div>
        <ErrorNote error={error ?? del.error} />
        {isLoading ? <div className="flex justify-center py-14"><Spinner className="h-7 w-7" /></div> : !data?.data.length ? <EmptyState title="No designs yet" description="Create one from a site survey or enter the building dimensions." action={can('design:create') ? <Button onClick={() => setCreating(true)}>New design</Button> : undefined} /> : (
          <>
            <Table>
              <thead><tr><Th>Design</Th><Th>Customer</Th><Th>Status</Th><Th className="text-right">Panels</Th><Th className="text-right">Capacity</Th><Th>Updated</Th><Th className="text-right">Actions</Th></tr></thead>
              <tbody>{data.data.map((d) => (
                <tr key={d.id} className="cursor-pointer hover:bg-surface-alt" onClick={() => nav(`/designer-${mode}/${d.id}`)}>
                  <Td><Link to={`/designer-${mode}/${d.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{d.name}</Link><p className="text-xs text-ink-muted">v{d.latestVersion}</p></Td>
                  <Td>{d.customer?.name ?? '—'}</Td>
                  <Td>{d.status === 'APPROVED' ? <Badge tone="green">Approved v{d.approvedVersion}</Badge> : <Badge>Draft</Badge>}{!!d.latest?.issueCount && <> <Badge tone="red">{d.latest.issueCount} issues</Badge></>}</Td>
                  <Td className="text-right">{d.latest?.validPanelCount ?? 0}</Td><Td className="text-right">{d.latest ? `${Number(d.latest.installedKwp)} kWp` : '—'}</Td><Td className="text-ink-muted">{dateOnly(d.updatedAt, locale)}</Td>
                  <Td className="text-right">
                    <span onClick={(e) => e.stopPropagation()}>
                    <Link to={`/designer-${mode === '2d' ? '3d' : '2d'}/${d.id}`}><Button size="sm" variant="ghost">Open in {mode === '2d' ? '3D' : '2D'}</Button></Link>
                    {can('design:delete') && <Button size="icon" variant="ghost" aria-label={`Delete ${d.name}`} onClick={() => { if (window.confirm(`Delete design “${d.name}”?`)) del.mutate(d.id); }}><Trash2 className="h-4 w-4 text-red-600" /></Button>}
                    </span>
                  </Td>
                </tr>))}</tbody>
            </Table>
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      {creating && <NewDesignModal mode={mode} preset={preset} onClose={() => { setCreating(false); setParams({}); }} />}
    </>
  );
}
