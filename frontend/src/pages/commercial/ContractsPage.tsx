import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Trash2 } from 'lucide-react';
import { INVOICE_TYPES, INVOICE_TYPE_LABELS, CONTRACT_STATUSES, scheduleError } from '@solarflow/shared';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { dateOnly, label, useLocale, type Page } from '@/lib/format';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { Notice, useDebounced } from '@/components/ui/extra';
import { CONTRACT_TONE, INVOICE_TONE, dateUtc, useCommercialOptions, useMoney2, type ContractRow, type Milestone, type QuotationRow } from '@/features/commercial/api';

const dateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

function ScheduleEditor({ value, onChange, disabled }: { value: { label: string; percent: string }[]; onChange: (v: { label: string; percent: string }[]) => void; disabled?: boolean }) {
  const total = Math.round(value.reduce((s, m) => s + (Number(m.percent) || 0), 0) * 1e6) / 1e6;
  return (
    <div className="space-y-2">
      {value.map((m, k) => (
        <div key={k} className="grid grid-cols-[1fr_6rem_2.5rem] gap-2">
          <Input aria-label={`Milestone ${k + 1} name`} placeholder="e.g. Advance on order" value={m.label} disabled={disabled} onChange={(e) => onChange(value.map((x, i) => (i === k ? { ...x, label: e.target.value } : x)))} />
          <Input aria-label={`Milestone ${k + 1} percent`} inputMode="decimal" placeholder="%" value={m.percent} disabled={disabled} onChange={(e) => onChange(value.map((x, i) => (i === k ? { ...x, percent: e.target.value } : x)))} />
          {!disabled && <Button variant="ghost" size="sm" aria-label={`Remove milestone ${k + 1}`} onClick={() => onChange(value.filter((_, i) => i !== k))}><Trash2 className="h-4 w-4" /></Button>}
        </div>
      ))}
      {!disabled && <Button variant="outline" size="sm" onClick={() => onChange([...value, { label: '', percent: '' }])}><Plus className="h-4 w-4" />Add milestone</Button>}
      {value.length > 0 && <p className={`text-xs ${total === 100 ? 'text-ink-muted' : 'text-amber-700'}`}>Total {total}% {total === 100 ? '' : '(must be exactly 100%)'}</p>}
    </div>
  );
}
const toSchedule = (s: { label: string; percent: string }[]): Milestone[] => s.map((m) => ({ label: m.label.trim(), percent: Number(m.percent) }));
const scheduleProblem = (s: { label: string; percent: string }[]) => (s.some((m) => !m.label.trim() || !(Number(m.percent) > 0)) ? 'Every milestone needs a name and a percentage.' : scheduleError(toSchedule(s)));

/** Turn an accepted quotation into a contract. */
export function ContractModal({ quotation, onClose }: { quotation: QuotationRow; onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const money = useMoney2();
  const { data: opts } = useCommercialOptions();
  const [terms, setTerms] = useState(quotation.terms ?? opts?.invoiceSettings.termsAndConditions ?? '');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [schedule, setSchedule] = useState<{ label: string; percent: string }[]>([]);
  const problem = scheduleProblem(schedule) ?? (start && end && end < start ? 'The completion date is before the start date.' : null);
  const create = useMutation({
    mutationFn: () => api.post<ContractRow>('/contracts', { quotationId: quotation.id, terms: terms || null, startDate: start || null, completionDate: end || null, paymentSchedule: toSchedule(schedule) }),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ['quotation', quotation.id] }); qc.invalidateQueries({ queryKey: ['contracts'] }); nav(`/contracts/${c.id}`); },
  });
  return (
    <Modal open wide title={`Create contract from ${quotation.number}`} onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Notice>Contract value: <strong>{money(quotation.total)}</strong> (the accepted quotation total, taxes included).</Notice>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start date" htmlFor="c-start"><Input id="c-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Completion date" htmlFor="c-end"><Input id="c-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <Field label="Payment schedule" hint="Optional. Each milestone can be invoiced separately."><ScheduleEditor value={schedule} onChange={setSchedule} /></Field>
        <Field label="Terms" htmlFor="c-terms"><Textarea id="c-terms" rows={5} value={terms} onChange={(e) => setTerms(e.target.value)} /></Field>
        <ErrorNote error={create.error} />
        {problem && <p className="text-xs text-amber-700">{problem}</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={create.isPending} disabled={!!problem}>Create contract</Button></div>
      </form>
    </Modal>
  );
}

export function ContractsListPage() {
  const money = useMoney2();
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const q = useDebounced(search);
  const { data, isLoading, error } = useQuery({ queryKey: ['contracts', page, q, status], queryFn: () => api.get<Page<ContractRow>>(`/contracts${qs({ page, pageSize: 15, search: q, status })}`), placeholderData: (p) => p });
  return (
    <div>
      <PageHeader title="Contracts" description="Created from accepted quotations. Contracts carry the payment schedule used for invoicing." />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-surface-line px-5 py-4">
          <Input aria-label="Search contracts" placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
          <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="max-w-[10rem]"><option value="">All statuses</option>{CONTRACT_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
        </div>
        <ErrorNote error={error} />
        {isLoading ? <div className="flex justify-center py-12"><Spinner /></div> : !data?.data.length ? <EmptyState title="No contracts yet" description="Accept a quotation, then create the contract from it." /> : (
          <>
            <Table>
              <thead><tr><Th>Number</Th><Th>Title</Th><Th>Customer</Th><Th>Quotation</Th><Th className="text-right">Value</Th><Th>Completion</Th><Th>Status</Th></tr></thead>
              <tbody>{data.data.map((c) => (
                <tr key={c.id} className="hover:bg-surface-alt/50">
                  <Td><Link className="font-medium text-brand hover:underline" to={`/contracts/${c.id}`}>{c.number}</Link></Td><Td>{c.title}</Td><Td>{c.customer.name}</Td>
                  <Td>{c.quotation.number}{c.quotation.revision > 1 ? ` R${c.quotation.revision}` : ''}</Td><Td className="text-right tabular-nums">{money(c.value)}</Td><Td>{dateUtc(c.completionDate, locale)}</Td>
                  <Td><Badge tone={CONTRACT_TONE[c.status]}>{label(c.status)}</Badge></Td>
                </tr>
              ))}</tbody>
            </Table>
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

function InvoiceMilestoneModal({ contract, onClose }: { contract: ContractRow; onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const money = useMoney2();
  const sched = contract.paymentSchedule;
  const [mode, setMode] = useState<string>(sched.length ? '0' : 'pct');
  const [pct, setPct] = useState('');
  const [type, setType] = useState<(typeof INVOICE_TYPES)[number]>(sched.length ? 'ADVANCE' : 'TAX');
  const [due, setDue] = useState('');
  const share = mode === 'pct' ? Number(pct) : sched[Number(mode)]?.percent ?? 0;
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/invoices/from-contract', { contractId: contract.id, type, dueDate: due || null, ...(mode === 'pct' ? { percent: Number(pct) } : { milestoneIndex: Number(mode) }) }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['contract', contract.id] }); qc.invalidateQueries({ queryKey: ['invoices'] }); nav(`/invoices/${r.id}`); },
  });
  return (
    <Modal open title="Create invoice from contract" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <Field label="Bill" htmlFor="im-mode"><Select id="im-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
          {sched.map((m, i) => <option key={i} value={String(i)}>{m.label} ({m.percent}%)</option>)}<option value="pct">A custom percentage</option>
        </Select></Field>
        {mode === 'pct' && <Field label="Percentage of contract" htmlFor="im-pct"><Input id="im-pct" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} /></Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Invoice type" htmlFor="im-type"><Select id="im-type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>{INVOICE_TYPES.map((t) => <option key={t} value={t}>{INVOICE_TYPE_LABELS[t]}</option>)}</Select></Field>
          <Field label="Due date" htmlFor="im-due" hint="Blank = payment terms"><Input id="im-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <p className="text-xs text-ink-muted">Creates a draft scaling every quotation line to {share || 0}% (about {money((Number(contract.value) * (share || 0)) / 100)}). Quantities are rounded to 3 decimals, so the total can differ from that figure by a few paise. Review it, then issue it.</p>
        <ErrorNote error={create.error} />
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={create.isPending} disabled={!(share > 0 && share <= 100)}>Create draft invoice</Button></div>
      </form>
    </Modal>
  );
}

export function ContractDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const org = useAuth((s) => s.session?.organization);
  const money = useMoney2();
  const locale = useLocale();
  const { data: opts } = useCommercialOptions();
  const contract = useQuery({ queryKey: ['contract', id], queryFn: () => api.get<ContractRow>(`/contracts/${id}`) });
  const [invoicing, setInvoicing] = useState(false);
  const [editing, setEditing] = useState<null | { terms: string; start: string; end: string; schedule: { label: string; percent: string }[] }>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['contract', id] }); qc.invalidateQueries({ queryKey: ['contracts'] }); };
  const move = useMutation({ mutationFn: (status: string) => api.post(`/contracts/${id}/status`, { status }), onSuccess: refresh });
  const save = useMutation({
    mutationFn: () => api.put(`/contracts/${id}`, { terms: editing!.terms || null, startDate: editing!.start || null, completionDate: editing!.end || null, paymentSchedule: toSchedule(editing!.schedule) }),
    onSuccess: () => { setEditing(null); refresh(); },
  });
  const customer = useQuery({ queryKey: ['customer-brief', contract.data?.customer.id], enabled: !!contract.data, queryFn: () => api.get<{ name: string; email: string | null; phone: string | null; taxId: string | null; addresses: { line1: string; city: string | null; state: string | null; postalCode: string | null; isDefault: boolean }[] }>(`/customers/${contract.data!.customer.id}`) });
  const pdf = useMutation({
    mutationFn: async () => {
      const { contractPdf } = await import('@/features/commercial/commercialPdf');
      const c = customer.data;
      const a = c?.addresses.find((x) => x.isDefault) ?? c?.addresses[0];
      await contractPdf(contract.data!, opts!, org?.logoUrl, { name: contract.data!.customer.name, lines: [a?.line1 ?? '', [a?.city, a?.state, a?.postalCode].filter(Boolean).join(', '), c?.phone ?? '', c?.taxId ? `Tax ID: ${c.taxId}` : ''] });
    },
  });
  if (contract.isLoading) return <div className="flex justify-center py-16"><Spinner className="h-8 w-8" /></div>;
  if (!contract.data) return <ErrorNote error={contract.error} />;
  const c = contract.data;
  const invoiced = (c.invoices ?? []).filter((i) => i.status !== 'VOID' && i.type !== 'PROFORMA').reduce((s, i) => s + Number(i.total), 0);
  const paid = (c.invoices ?? []).filter((i) => i.status !== 'VOID').reduce((s, i) => s + Number(i.amountPaid), 0);
  const problem = editing ? scheduleProblem(editing.schedule) : null;
  return (
    <div>
      <PageHeader title={`${c.number}: ${c.title}`} description={`${c.customer.name} · quotation ${c.quotation.number}${c.quotation.revision > 1 ? ` R${c.quotation.revision}` : ''}`}
        actions={<>
          <Badge tone={CONTRACT_TONE[c.status]}>{label(c.status)}</Badge>
          <Button variant="outline" onClick={() => pdf.mutate()} loading={pdf.isPending} disabled={!opts || customer.isLoading}><Download className="h-4 w-4" />PDF</Button>
        </>} />
      <ErrorNote error={move.error ?? save.error ?? pdf.error} />
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        {[['Contract value', money(c.value)], ['Invoiced', money(invoiced)], ['Collected', money(paid)], ['Not yet invoiced', money(Math.max(0, Number(c.value) - invoiced))]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-surface-line bg-white p-4 shadow-card"><p className="text-xs uppercase tracking-wide text-ink-muted">{k}</p><p className="mt-1 text-xl font-semibold tabular-nums">{v}</p></div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Details" action={c.status === 'DRAFT' && can('contract:edit') && !editing ? <Button variant="outline" size="sm" onClick={() => setEditing({ terms: c.terms ?? '', start: dateInput(c.startDate), end: dateInput(c.completionDate), schedule: c.paymentSchedule.map((m) => ({ label: m.label, percent: String(m.percent) })) })}>Edit</Button> : undefined} />
          <CardBody className="space-y-3 text-sm">
            {editing ? (
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
                <div className="grid grid-cols-2 gap-3"><Field label="Start" htmlFor="e-s"><Input id="e-s" type="date" value={editing.start} onChange={(e) => setEditing({ ...editing, start: e.target.value })} /></Field><Field label="Completion" htmlFor="e-e"><Input id="e-e" type="date" value={editing.end} onChange={(e) => setEditing({ ...editing, end: e.target.value })} /></Field></div>
                <Field label="Payment schedule"><ScheduleEditor value={editing.schedule} onChange={(schedule) => setEditing({ ...editing, schedule })} /></Field>
                <Field label="Terms" htmlFor="e-t"><Textarea id="e-t" rows={5} value={editing.terms} onChange={(e) => setEditing({ ...editing, terms: e.target.value })} /></Field>
                {problem && <p className="text-xs text-amber-700">{problem}</p>}
                <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" loading={save.isPending} disabled={!!problem}>Save</Button></div>
              </form>
            ) : (
              <>
                <div className="flex justify-between"><span className="text-ink-muted">Start</span><span>{dateUtc(c.startDate, locale)}</span></div>
                <div className="flex justify-between"><span className="text-ink-muted">Completion</span><span>{dateUtc(c.completionDate, locale)}</span></div>
                <div className="flex justify-between"><span className="text-ink-muted">Signed / activated</span><span>{dateOnly(c.signedAt, locale)}</span></div>
                <div><p className="mb-1 text-ink-muted">Payment schedule</p>{c.paymentSchedule.length ? c.paymentSchedule.map((m, i) => <div key={i} className="flex justify-between"><span>{m.label} ({m.percent}%)</span><span className="tabular-nums">{money((Number(c.value) * m.percent) / 100)}</span></div>) : <p>No schedule set.</p>}</div>
                {c.terms && <div><p className="mb-1 text-ink-muted">Terms</p><p className="whitespace-pre-wrap text-xs">{c.terms}</p></div>}
              </>
            )}
            <div className="flex flex-wrap gap-2 border-t border-surface-line pt-3">
              {c.status === 'DRAFT' && can('contract:edit') && <Button onClick={() => move.mutate('ACTIVE')} loading={move.isPending}>Activate (mark signed)</Button>}
              {c.status === 'ACTIVE' && can('contract:edit') && <Button onClick={() => move.mutate('COMPLETED')} loading={move.isPending}>Mark completed</Button>}
              {(c.status === 'DRAFT' || c.status === 'ACTIVE') && can('contract:edit') && <Button variant="ghost" onClick={() => { if (confirm('Cancel this contract?')) move.mutate('CANCELLED'); }}>Cancel contract</Button>}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Invoices" action={(c.status === 'ACTIVE' || c.status === 'DRAFT') && can('invoice:create') ? <Button size="sm" onClick={() => setInvoicing(true)}><Plus className="h-4 w-4" />Invoice</Button> : undefined} />
          {c.status === 'DRAFT' && <div className="p-4 pb-0"><Notice>Activate the contract when it is signed. You can already prepare invoices.</Notice></div>}
          {!c.invoices?.length ? <EmptyState title="Nothing invoiced yet" description="Create an invoice for a milestone." /> : (
            <Table>
              <thead><tr><Th>Number</Th><Th>Type</Th><Th className="text-right">Total</Th><Th className="text-right">Paid</Th><Th>Status</Th></tr></thead>
              <tbody>{c.invoices.map((i) => <tr key={i.id}><Td><Link className="text-brand hover:underline" to={`/invoices/${i.id}`}>{i.number ?? 'Draft'}</Link></Td><Td>{label(i.type)}</Td><Td className="text-right tabular-nums">{money(i.total)}</Td><Td className="text-right tabular-nums">{money(i.amountPaid)}</Td><Td><Badge tone={INVOICE_TONE[i.status]}>{label(i.status)}</Badge></Td></tr>)}</tbody>
            </Table>
          )}
        </Card>
      </div>
      {invoicing && <InvoiceMilestoneModal contract={c} onClose={() => setInvoicing(false)} />}
    </div>
  );
}
