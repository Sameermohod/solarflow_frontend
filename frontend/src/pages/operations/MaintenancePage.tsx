import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { PRIORITIES, TICKET_STATUSES, TICKET_STATUS_LABELS, TICKET_TRANSITIONS } from '@solarflow/shared';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { label, useLocale, type Page } from '@/lib/format';
import { useCustomerOptions } from '@/lib/hooks';
import { useDebounced, Tabs } from '@/components/ui/extra';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { PRIORITY_TONE, TICKET_TONE, UserSelect, WARRANTY_TONE, showDate, todayYmd, useNames } from './common';

interface Warranty { id: string; description: string; serial: string | null; startDate: string; endDate: string; state: string; customer: { id: string; name: string }; project?: { id: string; number: string } | null; terms?: string | null }
interface Amc { id: string; number: string; status: string; startDate: string; endDate: string; annualFee: string | null; visitsPerYear: number; visitsTotal: number; visitsDone: number; visitsOverdue: number; customer: { id: string; name: string } }
interface Ticket { id: string; number: string; title: string; status: string; priority: string; assigneeId: string | null; createdAt: string; customer: { id: string; name: string } }
interface Summary { expiringWarranties: Warranty[]; expiredWarranties: number; overdueVisits: number; upcomingVisits: { id: string; dueDate: string; amc: { id: string; number: string; customer: { name: string } } }[]; openTickets: number; urgentTickets: number }

function Table_<T extends { id: string }>({ q, empty, head, row }: { q: ReturnType<typeof useQuery<Page<T>>>; empty: ReactNode; head: ReactNode; row: (r: T) => ReactNode }) {
  if (q.isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data?.data.length) return <>{empty}</>;
  return <Table><thead><tr>{head}</tr></thead><tbody>{q.data.data.map((r) => <tr key={r.id} className="hover:bg-surface-alt/50">{row(r)}</tr>)}</tbody></Table>;
}

function Overview() {
  const locale = useLocale();
  const s = useQuery({ queryKey: ['maint-summary'], queryFn: () => api.get<Summary>('/maintenance/summary') });
  if (s.isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (!s.data) return <ErrorNote error={s.error} />;
  const d = s.data;
  const tile = (title: string, v: number, tone: string) => <Card><CardBody><p className="text-xs text-ink-muted">{title}</p><p className={`text-2xl font-semibold ${v ? tone : ''}`}>{v}</p></CardBody></Card>;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-4">{tile('Open tickets', d.openTickets, '')}{tile('Urgent tickets', d.urgentTickets, 'text-red-600')}{tile('Expired warranties', d.expiredWarranties, 'text-amber-700')}{tile('Overdue AMC visits', d.overdueVisits, 'text-red-600')}</div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Warranties ending within 60 days" />
          {!d.expiringWarranties.length ? <EmptyState title="None expiring soon" /> : <ul className="divide-y divide-surface-line text-sm">{d.expiringWarranties.map((w) => <li key={w.id} className="flex justify-between px-5 py-2"><span>{w.description} <span className="text-ink-muted">· {w.customer.name}</span></span><span className="text-amber-700">{showDate(w.endDate, locale)}</span></li>)}</ul>}
        </Card>
        <Card><CardHeader title="AMC visits due in 30 days" />
          {!d.upcomingVisits.length ? <EmptyState title="No visits due" /> : <ul className="divide-y divide-surface-line text-sm">{d.upcomingVisits.map((v) => <li key={v.id} className="flex justify-between px-5 py-2"><span>{v.amc.number} <span className="text-ink-muted">· {v.amc.customer.name}</span></span><span>{showDate(v.dueDate, locale)}</span></li>)}</ul>}
        </Card>
      </div>
    </div>
  );
}

function Warranties() {
  const locale = useLocale(); const qc = useQueryClient(); const can = useAuth((s) => s.can);
  const [page, setPage] = useState(1); const [search, setSearch] = useState(''); const [state, setState] = useState('');
  const [adding, setAdding] = useState(false); const [gen, setGen] = useState(false);
  const q = useDebounced(search);
  const list = useQuery({ queryKey: ['warranties', page, q, state], queryFn: () => api.get<Page<Warranty>>(`/maintenance/warranties${qs({ page, pageSize: 15, search: q, state })}`), placeholderData: (p) => p });
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/maintenance/warranties/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['warranties'] }) });
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-surface-line px-5 py-4">
        <Input aria-label="Search warranties" placeholder="Search item, serial or customer…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
        <Select aria-label="State" value={state} onChange={(e) => { setState(e.target.value); setPage(1); }} className="max-w-[10rem]"><option value="">All</option><option value="ACTIVE">Active</option><option value="EXPIRING">Expiring (60 days)</option><option value="EXPIRED">Expired</option></Select>
        {can('maintenance:create') && <div className="ml-auto flex gap-2"><Button size="sm" variant="outline" onClick={() => setGen(true)}>From a project</Button><Button size="sm" onClick={() => setAdding(true)}>Add warranty</Button></div>}
      </div>
      <ErrorNote error={del.error} />
      <Table_ q={list} empty={<EmptyState title="No warranties" description="Add one, or generate them from a completed project." />}
        head={<><Th>Item</Th><Th>Serial</Th><Th>Customer</Th><Th>From</Th><Th>Until</Th><Th>State</Th><Th /></>}
        row={(w) => <><Td className="font-medium">{w.description}</Td><Td>{w.serial ?? '—'}</Td><Td>{w.customer.name}</Td><Td>{showDate(w.startDate, locale)}</Td><Td>{showDate(w.endDate, locale)}</Td><Td><Badge tone={WARRANTY_TONE[w.state]}>{label(w.state)}</Badge></Td>
          <Td>{can('maintenance:delete') && <Button size="icon" variant="ghost" aria-label={`Delete warranty ${w.description}`} onClick={() => del.mutate(w.id)}><Trash2 className="h-4 w-4" /></Button>}</Td></>} />
      {list.data && <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={setPage} />}
      {adding && <WarrantyModal onClose={() => setAdding(false)} />}
      {gen && <FromProjectModal onClose={() => setGen(false)} />}
    </Card>
  );
}
function WarrantyModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient(); const customers = useCustomerOptions();
  const [f, setF] = useState({ customerId: '', description: '', serial: '', startDate: todayYmd(), endDate: '', terms: '' });
  const m = useMutation({ mutationFn: () => api.post('/maintenance/warranties', { customerId: f.customerId, description: f.description, serial: f.serial || null, startDate: f.startDate, endDate: f.endDate, terms: f.terms || null }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['warranties'] }); qc.invalidateQueries({ queryKey: ['maint-summary'] }); onClose(); } });
  return (
    <Modal open title="Add warranty" onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer"><Select value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}><option value="">Choose…</option>{customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Item"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Inverter 3.3 kW" /></Field>
        <Field label="Serial number"><Input value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} /></Field>
        <div />
        <Field label="Starts"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="Ends"><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><Field label="Terms"><Textarea rows={2} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} /></Field></div>
      <ErrorNote error={m.error} />
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={!f.customerId || f.description.trim().length < 2 || !f.endDate} onClick={() => m.mutate()}>Add</Button></div>
    </Modal>
  );
}
function FromProjectModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ['projects-pick'], queryFn: () => api.get<Page<{ id: string; number: string; name: string }>>(`/projects${qs({ pageSize: 100 })}`).then((r) => r.data) });
  const [pid, setPid] = useState('');
  const m = useMutation({ mutationFn: () => api.post<{ created: number }>(`/maintenance/warranties/from-project/${pid}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['warranties'] }); qc.invalidateQueries({ queryKey: ['maint-summary'] }); } });
  return (
    <Modal open title="Create warranties from a project" onClose={onClose}>
      <p className="mb-3 text-sm text-ink-muted">One warranty per item still on site (issued minus returned), using the warranty years in your equipment catalogue. Items already covered are skipped.</p>
      <Field label="Project"><Select value={pid} onChange={(e) => setPid(e.target.value)}><option value="">Choose…</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}</Select></Field>
      {m.data && <p role="status" className="mt-3 rounded bg-green-50 px-3 py-2 text-sm text-green-800">{m.data.created} warranty record(s) created.</p>}
      <ErrorNote error={m.error} />
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Close</Button><Button loading={m.isPending} disabled={!pid} onClick={() => m.mutate()}>Create warranties</Button></div>
    </Modal>
  );
}

function AmcTab() {
  const locale = useLocale(); const can = useAuth((s) => s.can);
  const [page, setPage] = useState(1); const [adding, setAdding] = useState(false); const [open, setOpen] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['amc', page], queryFn: () => api.get<Page<Amc>>(`/maintenance/amc${qs({ page, pageSize: 15 })}`), placeholderData: (p) => p });
  return (
    <Card>
      <CardHeader title="AMC contracts" description="Annual maintenance contracts with scheduled preventive visits." action={can('maintenance:create') ? <Button size="sm" onClick={() => setAdding(true)}>New AMC</Button> : undefined} />
      <Table_ q={list} empty={<EmptyState title="No AMC contracts" />}
        head={<><Th>Number</Th><Th>Customer</Th><Th>Term</Th><Th>Visits</Th><Th>Status</Th></>}
        row={(c) => <><Td><button type="button" className="font-medium text-brand hover:underline" onClick={() => setOpen(c.id)}>{c.number}</button></Td><Td>{c.customer.name}</Td><Td>{showDate(c.startDate, locale)} – {showDate(c.endDate, locale)}</Td>
          <Td>{c.visitsDone}/{c.visitsTotal}{c.visitsOverdue ? <span className="ml-1 text-red-600">({c.visitsOverdue} overdue)</span> : null}</Td><Td><Badge tone={c.status === 'ACTIVE' ? 'green' : c.status === 'EXPIRED' ? 'yellow' : 'neutral'}>{label(c.status)}</Badge></Td></>} />
      {list.data && <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={setPage} />}
      {adding && <AmcModal onClose={() => setAdding(false)} />}
      {open && <AmcDetail id={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}
function AmcModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient(); const customers = useCustomerOptions();
  const [f, setF] = useState({ customerId: '', startDate: todayYmd(), endDate: '', visitsPerYear: '2', annualFee: '', notes: '' });
  const m = useMutation({ mutationFn: () => api.post('/maintenance/amc', { customerId: f.customerId, startDate: f.startDate, endDate: f.endDate, visitsPerYear: Number(f.visitsPerYear), annualFee: f.annualFee ? Number(f.annualFee) : null, notes: f.notes || null }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['amc'] }); onClose(); } });
  return (
    <Modal open title="New AMC contract" onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer"><Select value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}><option value="">Choose…</option>{customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Visits per year" hint="Visits are spaced evenly over the term"><Input inputMode="numeric" value={f.visitsPerYear} onChange={(e) => setF({ ...f, visitsPerYear: e.target.value })} /></Field>
        <Field label="Starts"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="Ends"><Input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        <Field label="Annual fee"><Input inputMode="decimal" value={f.annualFee} onChange={(e) => setF({ ...f, annualFee: e.target.value })} /></Field>
      </div>
      <ErrorNote error={m.error} />
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={!f.customerId || !f.endDate} onClick={() => m.mutate()}>Create</Button></div>
    </Modal>
  );
}
function AmcDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const locale = useLocale(); const qc = useQueryClient(); const can = useAuth((s) => s.can);
  const d = useQuery({ queryKey: ['amc', id], queryFn: () => api.get<{ number: string; status: string; startDate: string; endDate: string; annualFee: string | null; customer: { name: string }; visits: { id: string; dueDate: string; completedAt: string | null; notes: string | null }[]; tickets: { id: string; number: string; title: string; status: string }[] }>(`/maintenance/amc/${id}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['amc'] }); qc.invalidateQueries({ queryKey: ['maint-summary'] }); };
  const run = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh });
  const today = todayYmd();
  return (
    <Modal open wide title={d.data ? `${d.data.number} · ${d.data.customer.name}` : 'AMC contract'} onClose={onClose}>
      {!d.data ? <Spinner /> : (
        <>
          <p className="mb-3 text-sm text-ink-muted">{showDate(d.data.startDate, locale)} – {showDate(d.data.endDate, locale)} · {label(d.data.status)}</p>
          <ul className="divide-y divide-surface-line rounded-lg border border-surface-line text-sm">
            {d.data.visits.map((v) => (
              <li key={v.id} className="flex items-center gap-3 px-4 py-2">
                <span className="w-32">{showDate(v.dueDate, locale)}</span>
                {v.completedAt ? <Badge tone="green">Done {showDate(v.completedAt, locale)}</Badge> : v.dueDate.slice(0, 10) < today ? <Badge tone="red">Overdue</Badge> : <Badge tone="neutral">Scheduled</Badge>}
                <span className="flex-1 text-ink-muted">{v.notes}</span>
                {!v.completedAt && can('maintenance:edit') && d.data!.status === 'ACTIVE' && <Button size="sm" variant="outline" loading={run.isPending} onClick={() => { const notes = window.prompt('Visit notes (optional)') ?? ''; run.mutate(async () => { await api.post(`/maintenance/amc/${id}/visits/${v.id}/complete`, { notes: notes || null }); await qc.invalidateQueries({ queryKey: ['amc', id] }); }); }}>Mark done</Button>}
              </li>
            ))}
          </ul>
          <ErrorNote error={run.error} />
          <div className="mt-4 flex justify-between">
            {can('maintenance:edit') && d.data.status === 'ACTIVE' ? <Button variant="outline" onClick={() => { if (window.confirm('Cancel this AMC contract?')) run.mutate(async () => { await api.post(`/maintenance/amc/${id}/cancel`); onClose(); }); }}>Cancel contract</Button> : <span />}
            <Button onClick={onClose}>Close</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function Tickets() {
  const can = useAuth((s) => s.can); const { name } = useNames();
  const [page, setPage] = useState(1); const [search, setSearch] = useState(''); const [open, setOpen] = useState('true'); const [adding, setAdding] = useState(false); const [sel, setSel] = useState<string | null>(null);
  const q = useDebounced(search);
  const list = useQuery({ queryKey: ['tickets', page, q, open], queryFn: () => api.get<Page<Ticket>>(`/maintenance/tickets${qs({ page, pageSize: 15, search: q, open: open === 'true' ? 'true' : '' })}`), placeholderData: (p) => p });
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-surface-line px-5 py-4">
        <Input aria-label="Search tickets" placeholder="Search number, title or customer…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
        <Select aria-label="Show" value={open} onChange={(e) => { setOpen(e.target.value); setPage(1); }} className="max-w-[10rem]"><option value="true">Open tickets</option><option value="">All tickets</option></Select>
        {can('maintenance:create') && <Button size="sm" className="ml-auto" onClick={() => setAdding(true)}>New ticket</Button>}
      </div>
      <Table_ q={list} empty={<EmptyState title="No tickets" description="Service requests from customers appear here." />}
        head={<><Th>Ticket</Th><Th>Title</Th><Th>Customer</Th><Th>Assignee</Th><Th>Priority</Th><Th>Status</Th></>}
        row={(t) => <><Td><button type="button" className="font-medium text-brand hover:underline" onClick={() => setSel(t.id)}>{t.number}</button></Td><Td>{t.title}</Td><Td>{t.customer.name}</Td><Td>{name(t.assigneeId)}</Td>
          <Td><Badge tone={PRIORITY_TONE[t.priority]}>{label(t.priority)}</Badge></Td><Td><Badge tone={TICKET_TONE[t.status]}>{TICKET_STATUS_LABELS[t.status as keyof typeof TICKET_STATUS_LABELS]}</Badge></Td></>} />
      {list.data && <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={setPage} />}
      {adding && <TicketModal onClose={() => setAdding(false)} />}
      {sel && <TicketDetail id={sel} onClose={() => setSel(null)} />}
    </Card>
  );
}
function TicketModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient(); const customers = useCustomerOptions();
  const [f, setF] = useState({ customerId: '', title: '', description: '', priority: 'MEDIUM', assigneeId: '' });
  const m = useMutation({ mutationFn: () => api.post('/maintenance/tickets', { customerId: f.customerId, title: f.title, description: f.description || null, priority: f.priority, assigneeId: f.assigneeId || null }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['tickets'] }); qc.invalidateQueries({ queryKey: ['maint-summary'] }); onClose(); } });
  return (
    <Modal open title="New service ticket" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Customer"><Select value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}><option value="">Choose…</option>{customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Problem"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Details"><Textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Priority"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}</Select></Field><Field label="Assign to"><UserSelect value={f.assigneeId} onChange={(v) => setF({ ...f, assigneeId: v })} /></Field></div>
        <ErrorNote error={m.error} />
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={!f.customerId || f.title.trim().length < 2} onClick={() => m.mutate()}>Create ticket</Button></div>
    </Modal>
  );
}
function TicketDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const locale = useLocale(); const qc = useQueryClient(); const can = useAuth((s) => s.can);
  const d = useQuery({ queryKey: ['ticket', id], queryFn: () => api.get<{ id: string; number: string; title: string; description: string | null; status: string; priority: string; assigneeId: string | null; resolution: string | null; customerId: string; customer: { id: string; name: string }; replacements: { id: string; description: string; oldSerial: string | null; newSerial: string | null; replacedOn: string; underWarranty: boolean }[] }>(`/maintenance/tickets/${id}`) });
  const [resolution, setResolution] = useState<string | null>(null);
  const [rep, setRep] = useState({ description: '', oldSerial: '', newSerial: '', underWarranty: false });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['ticket', id] }); qc.invalidateQueries({ queryKey: ['tickets'] }); qc.invalidateQueries({ queryKey: ['replacements'] }); qc.invalidateQueries({ queryKey: ['maint-summary'] }); };
  const run = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh });
  const t = d.data;
  return (
    <Modal open wide title={t ? `${t.number} · ${t.title}` : 'Ticket'} onClose={onClose}>
      {!t ? <Spinner /> : (
        <div className="space-y-4 text-sm">
          <p className="text-ink-muted">{t.customer.name}{t.description ? ` · ${t.description}` : ''}</p>
          {can('maintenance:edit') && (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Status"><Select value={t.status} onChange={(e) => { const status = e.target.value; run.mutate(() => api.patch(`/maintenance/tickets/${id}`, { status, ...(resolution ? { resolution } : {}) })); }}>{TICKET_STATUSES.filter((s) => s === t.status || TICKET_TRANSITIONS[t.status]?.includes(s)).map((s) => <option key={s} value={s}>{TICKET_STATUS_LABELS[s]}</option>)}</Select></Field>
              <Field label="Assignee"><UserSelect value={t.assigneeId ?? ''} onChange={(v) => run.mutate(() => api.patch(`/maintenance/tickets/${id}`, { assigneeId: v || null }))} /></Field>
              <Field label="Priority"><Select value={t.priority} onChange={(e) => { const priority = e.target.value; run.mutate(() => api.patch(`/maintenance/tickets/${id}`, { priority })); }}>{PRIORITIES.map((p) => <option key={p} value={p}>{label(p)}</option>)}</Select></Field>
            </div>
          )}
          <Field label="Resolution" hint="Required before the ticket can be resolved"><Textarea rows={2} value={resolution ?? t.resolution ?? ''} onChange={(e) => setResolution(e.target.value)} disabled={!can('maintenance:edit')} /></Field>
          {can('maintenance:edit') && resolution !== null && resolution !== (t.resolution ?? '') && <Button size="sm" variant="outline" loading={run.isPending} onClick={() => run.mutate(async () => { await api.patch(`/maintenance/tickets/${id}`, { resolution }); setResolution(null); })}>Save resolution</Button>}
          <div>
            <h3 className="mb-1 font-medium">Replacements</h3>
            {!t.replacements.length ? <p className="text-ink-muted">None recorded.</p> : <ul className="divide-y divide-surface-line rounded-lg border border-surface-line">{t.replacements.map((r) => <li key={r.id} className="px-3 py-2">{r.description} · {r.oldSerial ?? '?'} → {r.newSerial ?? '?'} <span className="text-ink-muted">· {showDate(r.replacedOn, locale)}{r.underWarranty ? ' · under warranty' : ''}</span></li>)}</ul>}
            {can('maintenance:create') && (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <Field label="Part replaced"><Input value={rep.description} onChange={(e) => setRep({ ...rep, description: e.target.value })} /></Field>
                <Field label="Old serial"><Input className="w-32" value={rep.oldSerial} onChange={(e) => setRep({ ...rep, oldSerial: e.target.value })} /></Field>
                <Field label="New serial"><Input className="w-32" value={rep.newSerial} onChange={(e) => setRep({ ...rep, newSerial: e.target.value })} /></Field>
                <label className="mb-2 flex items-center gap-1 text-xs"><input type="checkbox" checked={rep.underWarranty} onChange={(e) => setRep({ ...rep, underWarranty: e.target.checked })} />Under warranty</label>
                <Button size="sm" loading={run.isPending} disabled={rep.description.trim().length < 2} onClick={() => run.mutate(async () => { await api.post('/maintenance/replacements', { customerId: t.customerId ?? t.customer.id, ticketId: id, description: rep.description, oldSerial: rep.oldSerial || null, newSerial: rep.newSerial || null, replacedOn: todayYmd(), underWarranty: rep.underWarranty }); setRep({ description: '', oldSerial: '', newSerial: '', underWarranty: false }); })}>Record</Button>
              </div>
            )}
          </div>
          <ErrorNote error={run.error} />
          <div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>
        </div>
      )}
    </Modal>
  );
}

function Replacements() {
  const locale = useLocale();
  const [page, setPage] = useState(1); const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const list = useQuery({ queryKey: ['replacements', page, q], queryFn: () => api.get<Page<{ id: string; description: string; oldSerial: string | null; newSerial: string | null; replacedOn: string; underWarranty: boolean; customer: { name: string }; ticket: { number: string } | null }>>(`/maintenance/replacements${qs({ page, pageSize: 15, search: q })}`), placeholderData: (p) => p });
  return (
    <Card>
      <div className="border-b border-surface-line px-5 py-4"><Input aria-label="Search replacements" placeholder="Search part or serial…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" /></div>
      <Table_ q={list} empty={<EmptyState title="No replacements recorded" description="Record them from a service ticket." />}
        head={<><Th>Date</Th><Th>Part</Th><Th>Old serial</Th><Th>New serial</Th><Th>Customer</Th><Th>Ticket</Th><Th>Warranty</Th></>}
        row={(r) => <><Td>{showDate(r.replacedOn, locale)}</Td><Td>{r.description}</Td><Td>{r.oldSerial ?? '—'}</Td><Td>{r.newSerial ?? '—'}</Td><Td>{r.customer.name}</Td><Td>{r.ticket?.number ?? '—'}</Td><Td>{r.underWarranty ? 'Yes' : 'No'}</Td></>} />
      {list.data && <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={setPage} />}
    </Card>
  );
}

export function MaintenancePage() {
  const [tab, setTab] = useState<'overview' | 'warranties' | 'amc' | 'tickets' | 'replacements'>('overview');
  return (
    <div>
      <PageHeader title="Maintenance" description="Warranty tracking, AMC schedules, service tickets and replacement history." />
      <div className="mb-4"><Tabs tabs={[{ id: 'overview', label: 'Overview' }, { id: 'warranties', label: 'Warranties' }, { id: 'amc', label: 'AMC' }, { id: 'tickets', label: 'Tickets' }, { id: 'replacements', label: 'Replacements' }]} value={tab} onChange={setTab} /></div>
      {tab === 'overview' && <Overview />}{tab === 'warranties' && <Warranties />}{tab === 'amc' && <AmcTab />}{tab === 'tickets' && <Tickets />}{tab === 'replacements' && <Replacements />}
      <p className="mt-3 text-xs text-ink-muted"><Link className="text-brand hover:underline" to="/projects">Projects</Link> generate warranties from the items they installed.</p>
    </div>
  );
}
