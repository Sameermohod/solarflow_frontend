import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus } from 'lucide-react';
import { INVOICE_STATUSES, INVOICE_TYPES, INVOICE_TYPE_LABELS, PAYMENT_METHODS } from '@solarflow/shared';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { label, useLocale, type Page } from '@/lib/format';
import { useCustomerOptions } from '@/lib/hooks';
import { formatDateTime } from '@/lib/utils';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { Notice, StatCard, useDebounced } from '@/components/ui/extra';
import { INVOICE_TONE, dateUtc, useCommercialOptions, useIsOverdue, useMoney2, type DocItem, type InvoiceRow, type PaymentRow } from '@/features/commercial/api';
import { LineEditor, TotalsBox, itemsProblem, toPayload, usePreview } from '@/features/commercial/LineEditor';

interface Summary { outstanding: string; openCount: number; overdue: string; overdueCount: number; collectedThisMonth: string; drafts: number }
const dateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

export function PaymentModal({ invoice, onClose }: { invoice: Pick<InvoiceRow, 'id' | 'number' | 'outstanding' | 'currency'>; onClose: () => void }) {
  const qc = useQueryClient();
  const money = useMoney2();
  const [amount, setAmount] = useState(invoice.outstanding);
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>('BANK_TRANSFER');
  const [ref, setRef] = useState('');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const over = Number(amount) > Number(invoice.outstanding) + 0.005;
  const save = useMutation({
    mutationFn: () => api.post<PaymentRow>('/payments', { invoiceId: invoice.id, amount: Number(amount), method, reference: ref || null, paidAt: paidAt || null, notes: notes || null }),
    onSuccess: () => { ['invoice', 'invoices', 'payments', 'contract'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); onClose(); },
  });
  return (
    <Modal open title={`Record payment: ${invoice.number}`} onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Notice>Balance due: <strong>{money(invoice.outstanding)}</strong></Notice>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount" htmlFor="p-amt" error={over ? 'More than the balance due' : undefined}><Input id="p-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
          <Field label="Date received" htmlFor="p-date"><Input id="p-date" type="date" max={new Date().toISOString().slice(0, 10)} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></Field>
          <Field label="Method" htmlFor="p-method"><Select id="p-method" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</Select></Field>
          <Field label="Reference" htmlFor="p-ref" hint="UTR, cheque no., transaction id"><Input id="p-ref" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        </div>
        <Field label="Notes" htmlFor="p-notes"><Input id="p-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending} disabled={!(Number(amount) > 0) || over}>Record payment</Button></div>
      </form>
    </Modal>
  );
}

export function InvoicesListPage() {
  const can = useAuth((s) => s.can);
  const money = useMoney2();
  const locale = useLocale();
  const nav = useNavigate();
  const isOverdue = useIsOverdue();
  const [params] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [overdue, setOverdue] = useState(params.get('overdue') === 'true');
  const q = useDebounced(search);
  const summary = useQuery({ queryKey: ['invoices', 'summary'], queryFn: () => api.get<Summary>('/invoices/summary') });
  const { data, isLoading, error } = useQuery({ queryKey: ['invoices', page, q, status, type, overdue], queryFn: () => api.get<Page<InvoiceRow>>(`/invoices${qs({ page, pageSize: 15, search: q, status, type, overdue: overdue ? 'true' : '' })}`), placeholderData: (p) => p });
  return (
    <div>
      <PageHeader title="Invoices" description="Drafts are editable. Issuing assigns the invoice number and freezes it." actions={can('invoice:create') ? <Button onClick={() => nav('/invoices/new')}><Plus className="h-4 w-4" />New invoice</Button> : undefined} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Outstanding" value={summary.data ? money(summary.data.outstanding) : '—'} sub={summary.data ? `${summary.data.openCount} open invoices` : undefined} />
        <StatCard label="Overdue" value={summary.data ? money(summary.data.overdue) : '—'} tone={summary.data && Number(summary.data.overdue) > 0 ? 'warn' : undefined} sub={summary.data ? `${summary.data.overdueCount} invoices past due` : undefined} />
        <StatCard label="Collected this month" value={summary.data ? money(summary.data.collectedThisMonth) : '—'} tone="good" />
        <StatCard label="Drafts" value={summary.data?.drafts ?? '—'} sub="Not yet issued" />
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-surface-line px-5 py-4">
          <Input aria-label="Search invoices" placeholder="Search number or customer…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
          <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="max-w-[10rem]"><option value="">All statuses</option>{INVOICE_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
          <Select aria-label="Type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="max-w-[11rem]"><option value="">All types</option>{INVOICE_TYPES.map((t) => <option key={t} value={t}>{INVOICE_TYPE_LABELS[t]}</option>)}</Select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={overdue} onChange={(e) => { setOverdue(e.target.checked); setPage(1); }} />Overdue only</label>
        </div>
        <ErrorNote error={error} />
        {isLoading ? <div className="flex justify-center py-12"><Spinner /></div> : !data?.data.length ? <EmptyState title="No invoices" description="Create one from a contract milestone or from scratch." /> : (
          <>
            <Table>
              <thead><tr><Th>Number</Th><Th>Type</Th><Th>Customer</Th><Th>Due</Th><Th className="text-right">Total</Th><Th className="text-right">Balance</Th><Th>Status</Th></tr></thead>
              <tbody>{data.data.map((i) => (
                <tr key={i.id} className="hover:bg-surface-alt/50">
                  <Td><Link className="font-medium text-brand hover:underline" to={`/invoices/${i.id}`}>{i.number ?? 'Draft'}</Link></Td><Td>{INVOICE_TYPE_LABELS[i.type as keyof typeof INVOICE_TYPE_LABELS]}</Td><Td>{i.customer.name}</Td>
                  <Td className={isOverdue(i) ? 'font-medium text-red-700' : ''}>{dateUtc(i.dueDate, locale)}</Td><Td className="text-right tabular-nums">{money(i.total)}</Td>
                  <Td className="text-right tabular-nums">{['ISSUED', 'PARTIALLY_PAID'].includes(i.status) && i.type !== 'PROFORMA' ? money(i.outstanding) : '—'}</Td>
                  <Td><Badge tone={isOverdue(i) ? 'red' : INVOICE_TONE[i.status]}>{isOverdue(i) ? 'Overdue' : label(i.status)}</Badge></Td>
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

export function InvoiceDetailPage({ isNew }: { isNew?: boolean }) {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const org = useAuth((s) => s.session?.organization);
  const money = useMoney2();
  const locale = useLocale();
  const { data: opts } = useCommercialOptions();
  const isOverdue = useIsOverdue();
  const customers = useCustomerOptions();
  const inv = useQuery({ queryKey: ['invoice', id], queryFn: () => api.get<InvoiceRow>(`/invoices/${id}`), enabled: !isNew });
  const [customerId, setCustomerId] = useState(params.get('customerId') ?? '');
  const [type, setType] = useState<(typeof INVOICE_TYPES)[number]>('TAX');
  const [issueDate, setIssue] = useState('');
  const [dueDate, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DocItem[]>([]);
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState<{ kind: 'invoice' } | { kind: 'payment'; id: string } | null>(null);
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (inv.data) { const i = inv.data; setCustomerId(i.customer.id); setType(i.type as typeof type); setIssue(dateInput(i.issueDate)); setDue(dateInput(i.dueDate)); setNotes(i.notes ?? ''); setItems(i.items); }
  }, [inv.data]);
  const body = { type, customerId, issueDate: issueDate || null, dueDate: dueDate || null, notes: notes || null, quotationId: inv.data?.quotation?.id ?? null, contractId: inv.data?.contract?.id ?? null, items: toPayload(items) };
  const refresh = () => { ['invoice', 'invoices', 'payments', 'contract'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };
  const create = useMutation({ mutationFn: () => api.post<InvoiceRow>('/invoices', body), onSuccess: (r) => { refresh(); nav(`/invoices/${r.id}`, { replace: true }); } });
  const update = useMutation({ mutationFn: () => api.put<InvoiceRow>(`/invoices/${id}`, body), onSuccess: refresh });
  const issue = useMutation({ mutationFn: () => api.post<InvoiceRow>(`/invoices/${id}/issue`), onSuccess: refresh });
  const del = useMutation({ mutationFn: () => api.delete(`/invoices/${id}`), onSuccess: () => { refresh(); nav('/invoices'); } });
  const doVoid = useMutation({
    mutationFn: () => (voiding?.kind === 'payment' ? api.post(`/payments/${voiding.id}/void`, { reason }) : api.post(`/invoices/${id}/void`, { reason })),
    onSuccess: () => { setVoiding(null); setReason(''); refresh(); },
  });
  const pdf = useMutation({ mutationFn: async () => { const { invoicePdf } = await import('@/features/commercial/commercialPdf'); await invoicePdf(inv.data!, opts!, org?.logoUrl); } });
  const receipt = useMutation({ mutationFn: async (p: PaymentRow) => { const { receiptPdf } = await import('@/features/commercial/commercialPdf'); await receiptPdf(p, inv.data!, inv.data!.customer.name, opts!, org?.logoUrl); } });
  const preview = usePreview(items);

  if (!isNew && inv.isLoading) return <div className="flex justify-center py-16"><Spinner className="h-8 w-8" /></div>;
  if (!isNew && !inv.data) return <ErrorNote error={inv.error} />;
  const i = inv.data;
  const editable = isNew ? can('invoice:create') : i!.status === 'DRAFT' && can('invoice:edit');
  const problem = itemsProblem(items) ?? (!customerId ? 'Choose a customer.' : dueDate && issueDate && dueDate < issueDate ? 'The due date is before the issue date.' : null);
  const payable = i && ['ISSUED', 'PARTIALLY_PAID'].includes(i.status) && i.type !== 'PROFORMA';
  return (
    <div>
      <PageHeader title={isNew ? 'New invoice' : `${INVOICE_TYPE_LABELS[i!.type as keyof typeof INVOICE_TYPE_LABELS]} ${i!.number ?? '(draft)'}`} description={i ? i.customer.name : 'Draft until issued'}
        actions={i && <>
          <Badge tone={isOverdue(i) ? 'red' : INVOICE_TONE[i.status]}>{isOverdue(i) ? 'Overdue' : label(i.status)}</Badge>
          <Button variant="outline" onClick={() => pdf.mutate()} loading={pdf.isPending} disabled={!opts}><Download className="h-4 w-4" />PDF</Button>
        </>} />
      <ErrorNote error={create.error ?? update.error ?? issue.error ?? del.error ?? doVoid.error ?? pdf.error ?? receipt.error} />
      {i?.status === 'VOID' && <div className="mb-4"><Notice tone="warn">Void: {i.voidReason}</Notice></div>}
      {i?.type === 'PROFORMA' && i.status !== 'DRAFT' && <div className="mb-4"><Notice>A proforma invoice is not a demand for payment. Issue an advance or tax invoice to collect money.</Notice></div>}
      <div className={i ? 'grid gap-5 xl:grid-cols-[1fr_20rem]' : ''}>
        <Card>
          <CardBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2"><Field label="Customer" htmlFor="i-cust">
                <Select id="i-cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={!editable || !!i?.contract}>
                  <option value="">Select…</option>
                  {i && !customers.data?.some((c) => c.id === i.customer.id) && <option value={i.customer.id}>{i.customer.name}</option>}
                  {customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select></Field></div>
              <Field label="Type" htmlFor="i-type"><Select id="i-type" value={type} onChange={(e) => setType(e.target.value as typeof type)} disabled={!editable}>{INVOICE_TYPES.map((t) => <option key={t} value={t}>{INVOICE_TYPE_LABELS[t]}</option>)}</Select></Field>
              <Field label="Due date" htmlFor="i-due" hint={editable ? 'Blank = payment terms' : undefined}><Input id="i-due" type="date" value={dueDate} onChange={(e) => setDue(e.target.value)} disabled={!editable} /></Field>
            </div>
            <LineEditor items={items} onChange={setItems} readOnly={!editable} />
            {editable ? (preview && <TotalsBox t={preview} />) : i && <TotalsBox t={i} />}
            {i && !editable && i.taxSnapshot.breakdown && i.taxSnapshot.breakdown.length > 0 && <p className="text-xs text-ink-muted">Tax ({i.taxSnapshot.regime || 'tax'}): {i.taxSnapshot.breakdown.map((b) => `${b.percent}% on ${money(b.taxable)} = ${money(b.tax)}`).join('; ')}. {i.pricesIncludeTax ? 'Prices include tax.' : 'Prices exclude tax.'}</p>}
            <Field label="Notes" htmlFor="i-notes"><Textarea id="i-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editable} /></Field>
            {editable && (
              <div className="flex items-center justify-between border-t border-surface-line pt-4">
                <span className="text-xs text-amber-700">{problem}</span>
                <div className="flex gap-2">
                  {!isNew && can('invoice:delete') && <Button variant="ghost" onClick={() => { if (confirm('Delete this draft?')) del.mutate(); }}>Delete draft</Button>}
                  <Button variant={isNew ? 'primary' : 'outline'} onClick={() => (isNew ? create : update).mutate()} loading={create.isPending || update.isPending} disabled={!!problem}>{isNew ? 'Create draft' : 'Save draft'}</Button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
        {i && (
          <div className="space-y-4">
            <Card>
              <CardHeader title="Status" />
              <CardBody className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-ink-muted">Issued</span><span>{dateUtc(i.issueDate, locale)}</span></div>
                <div className="flex justify-between"><span className="text-ink-muted">Due</span><span>{dateUtc(i.dueDate, locale)}</span></div>
                {i.contract && <div className="flex justify-between"><span className="text-ink-muted">Contract</span><Link className="text-brand hover:underline" to={`/contracts/${i.contract.id}`}>{i.contract.number}</Link></div>}
                {i.quotation && <div className="flex justify-between"><span className="text-ink-muted">Quotation</span><Link className="text-brand hover:underline" to={`/quotations/${i.quotation.id}`}>{i.quotation.number}</Link></div>}
                {i.status !== 'DRAFT' && i.type !== 'PROFORMA' && <>
                  <div className="flex justify-between border-t border-surface-line pt-2"><span className="text-ink-muted">Paid</span><span className="tabular-nums">{money(i.amountPaid)}</span></div>
                  <div className="flex justify-between font-semibold"><span>Balance due</span><span className="tabular-nums">{money(i.outstanding)}</span></div>
                </>}
                <div className="space-y-2 pt-2">
                  {i.status === 'DRAFT' && can('invoice:approve') && <Button className="w-full" onClick={() => { if (confirm('Issue this invoice? It gets its number and can no longer be edited.')) issue.mutate(); }} loading={issue.isPending} disabled={!!problem || update.isPending}>Issue invoice</Button>}
                  {i.status === 'DRAFT' && !can('invoice:approve') && <p className="text-xs text-ink-muted">Someone with approval rights issues invoices.</p>}
                  {payable && can('payment:create') && <Button className="w-full" variant="accent" onClick={() => setPaying(true)}>Record payment</Button>}
                  {['ISSUED', 'PARTIALLY_PAID', 'PAID'].includes(i.status) && can('invoice:approve') && Number(i.amountPaid) === 0 && <Button className="w-full" variant="ghost" onClick={() => setVoiding({ kind: 'invoice' })}>Void invoice</Button>}
                </div>
              </CardBody>
            </Card>
            {!!i.payments?.length && (
              <Card>
                <CardHeader title="Payments" />
                <CardBody className="space-y-3 text-sm">
                  {i.payments.map((p) => (
                    <div key={p.id} className={p.voidedAt ? 'opacity-60' : ''}>
                      <div className="flex justify-between"><span className="font-medium">{p.receiptNumber}</span><span className={`tabular-nums ${p.voidedAt ? 'line-through' : ''}`}>{money(p.amount)}</span></div>
                      <div className="text-xs text-ink-muted">{label(p.method)}{p.reference ? ` · ${p.reference}` : ''} · {formatDateTime(p.paidAt, locale)}{p.voidedAt ? ` · void: ${p.voidReason}` : ''}</div>
                      <div className="mt-1 flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => receipt.mutate(p)} disabled={!opts}>Receipt</Button>
                        {!p.voidedAt && can('payment:edit') && <Button variant="ghost" size="sm" onClick={() => setVoiding({ kind: 'payment', id: p.id })}>Void</Button>}
                      </div>
                    </div>
                  ))}
                </CardBody>
              </Card>
            )}
          </div>
        )}
      </div>
      {paying && i && <PaymentModal invoice={i} onClose={() => setPaying(false)} />}
      {voiding && (
        <Modal open title={voiding.kind === 'payment' ? 'Void payment' : 'Void invoice'} onClose={() => setVoiding(null)}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); doVoid.mutate(); }}>
            <Notice tone="warn">{voiding.kind === 'payment' ? 'The payment stays on record as void and the balance is re-opened.' : 'A void invoice keeps its number and cannot be reopened.'}</Notice>
            <Field label="Reason" htmlFor="v-reason"><Input id="v-reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} /></Field>
            <ErrorNote error={doVoid.error} />
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setVoiding(null)}>Cancel</Button><Button type="submit" variant="danger" loading={doVoid.isPending} disabled={reason.trim().length < 3}>Void</Button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
