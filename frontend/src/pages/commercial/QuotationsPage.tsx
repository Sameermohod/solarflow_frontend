import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Plus } from 'lucide-react';
import { QUOTATION_STATUSES, QUOTATION_STATUS_LABELS } from '@solarflow/shared';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { label, useLocale, type Page } from '@/lib/format';
import { useCustomerOptions } from '@/lib/hooks';
import { formatDateTime } from '@/lib/utils';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { Notice, useDebounced } from '@/components/ui/extra';
import { QUOTE_TONE, dateUtc, useCommercialOptions, useMoney2, type BomRow, type DocItem, type QuotationRow } from '@/features/commercial/api';
import { LineEditor, TotalsBox, itemsProblem, toPayload, usePreview } from '@/features/commercial/LineEditor';
import { ContractModal } from './ContractsPage';
import { ProposalModal } from '@/features/commercial/ProposalModal';

export function QuotationsListPage() {
  const can = useAuth((s) => s.can);
  const money = useMoney2();
  const locale = useLocale();
  const nav = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const q = useDebounced(search);
  const { data, isLoading, error } = useQuery({ queryKey: ['quotations', page, q, status], queryFn: () => api.get<Page<QuotationRow>>(`/quotations${qs({ page, pageSize: 15, search: q, status })}`), placeholderData: (p) => p });
  return (
    <div>
      <PageHeader title="Quotations" description="Priced offers with approval, revisions and branded PDFs." actions={<>{can('contract:view') && <Button variant="outline" onClick={() => nav('/contracts')}>Contracts</Button>}{can('quotation:create') && <Button onClick={() => nav('/quotations/new')}><Plus className="h-4 w-4" />New quotation</Button>}</>} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-surface-line px-5 py-4">
          <Input aria-label="Search quotations" placeholder="Search number, title or customer…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
          <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="max-w-[11rem]"><option value="">All statuses</option>{QUOTATION_STATUSES.map((s) => <option key={s} value={s}>{QUOTATION_STATUS_LABELS[s]}</option>)}</Select>
        </div>
        <ErrorNote error={error} />
        {isLoading ? <div className="flex justify-center py-12"><Spinner /></div> : !data?.data.length ? (
          <EmptyState title="No quotations" description="Create one from a BOM or from scratch." action={can('quotation:create') ? <Button onClick={() => nav('/quotations/new')}>New quotation</Button> : undefined} />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Number</Th><Th>Title</Th><Th>Customer</Th><Th className="text-right">Total</Th><Th>Valid until</Th><Th>Status</Th></tr></thead>
              <tbody>{data.data.map((r) => (
                <tr key={r.id} className="hover:bg-surface-alt/50">
                  <Td><Link className="font-medium text-brand hover:underline" to={`/quotations/${r.id}`}>{r.number}{r.revision > 1 ? ` R${r.revision}` : ''}</Link></Td>
                  <Td>{r.title}</Td><Td>{r.customer.name}</Td><Td className="text-right tabular-nums">{money(r.total)}</Td><Td>{dateUtc(r.validUntil, locale)}</Td>
                  <Td><Badge tone={QUOTE_TONE[r.status]}>{QUOTATION_STATUS_LABELS[r.status as keyof typeof QUOTATION_STATUS_LABELS]}</Badge></Td>
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

const dateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

/** Create (no id) or edit/view a quotation. */
export function QuotationDetailPage({ isNew }: { isNew?: boolean }) {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const org = useAuth((s) => s.session?.organization);
  const money = useMoney2();
  const locale = useLocale();
  const { data: opts } = useCommercialOptions();
  const customers = useCustomerOptions();
  const quote = useQuery({ queryKey: ['quotation', id], queryFn: () => api.get<QuotationRow>(`/quotations/${id}`), enabled: !isNew });
  const bomId = params.get('bomId');
  const fromBom = useQuery({ queryKey: ['bom', bomId], queryFn: () => api.get<BomRow>(`/boms/${bomId}`), enabled: !!isNew && !!bomId });

  const [customerId, setCustomerId] = useState(params.get('customerId') ?? '');
  const [title, setTitle] = useState('');
  const [validUntil, setValid] = useState('');
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DocItem[]>([]);
  const [designId, setDesignId] = useState<string | null>(null);
  const [linkedBom, setLinkedBom] = useState<string | null>(bomId);
  const [contracting, setContracting] = useState(false);
  const [rejecting, setRejecting] = useState<'REJECTED' | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (quote.data) {
      const q = quote.data;
      setCustomerId(q.customer.id); setTitle(q.title); setValid(dateInput(q.validUntil)); setTerms(q.terms ?? ''); setNotes(q.notes ?? ''); setItems(q.items); setDesignId(q.design?.id ?? null); setLinkedBom(q.bom?.id ?? null);
    }
  }, [quote.data]);
  useEffect(() => {
    if (isNew && fromBom.data) {
      setItems(fromBom.data.items); setDesignId(fromBom.data.design?.id ?? null); setLinkedBom(fromBom.data.id);
      if (fromBom.data.customer) setCustomerId((c) => c || fromBom.data!.customer!.id);
      setTitle((t) => t || `Solar system: ${fromBom.data!.name}`);
    }
  }, [isNew, fromBom.data]);
  // Default the terms from invoice settings once, when creating.
  const [termsSeeded, setTermsSeeded] = useState(false);
  useEffect(() => { if (isNew && opts && !termsSeeded) { setTerms((t) => t || (opts.invoiceSettings.termsAndConditions ?? '')); setTermsSeeded(true); } }, [isNew, opts, termsSeeded]);

  const body = { customerId, title: title.trim(), designId, bomId: linkedBom, validUntil: validUntil || null, terms: terms || null, notes: notes || null, items: toPayload(items) };
  const refresh = () => { qc.invalidateQueries({ queryKey: ['quotation', id] }); qc.invalidateQueries({ queryKey: ['quotations'] }); };
  const create = useMutation({ mutationFn: () => api.post<QuotationRow>('/quotations', body), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['quotations'] }); nav(`/quotations/${r.id}`, { replace: true }); } });
  const update = useMutation({ mutationFn: () => api.put<QuotationRow>(`/quotations/${id}`, body), onSuccess: refresh });
  const move = useMutation({ mutationFn: (v: { status: string; note?: string }) => api.post<QuotationRow>(`/quotations/${id}/status`, v), onSuccess: () => { setRejecting(null); setNote(''); refresh(); } });
  const revise = useMutation({ mutationFn: () => api.post<QuotationRow>(`/quotations/${id}/revise`), onSuccess: (r) => { refresh(); nav(`/quotations/${r.id}`); } });
  const del = useMutation({ mutationFn: () => api.delete(`/quotations/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['quotations'] }); nav('/quotations'); } });
  const pdf = useMutation({ mutationFn: async () => { const { quotationPdf } = await import('@/features/commercial/commercialPdf'); await quotationPdf(quote.data!, opts!, org?.logoUrl); } });
  const preview = usePreview(items);
  const [proposal, setProposal] = useState(false);

  if (!isNew && quote.isLoading) return <div className="flex justify-center py-16"><Spinner className="h-8 w-8" /></div>;
  if (!isNew && !quote.data) return <ErrorNote error={quote.error} />;
  const q = quote.data;
  const editable = isNew ? can('quotation:create') : q!.status === 'DRAFT' && can('quotation:edit');
  const problem = itemsProblem(items) ?? (!customerId ? 'Choose a customer.' : title.trim().length < 2 ? 'Add a title.' : null);
  const latestRev = !q || !q.revisions?.length || q.revisions[q.revisions.length - 1]!.id === q.id;
  const expiring = q?.validUntil && new Date(q.validUntil) < new Date(Date.now() + 3 * 86_400_000) && ['APPROVED', 'SENT'].includes(q.status);
  const stored = !isNew && !editable;

  return (
    <div>
      <PageHeader title={isNew ? 'New quotation' : `${q!.number}${q!.revision > 1 ? ` (revision ${q!.revision})` : ''}`} description={isNew ? 'Priced from your catalogue and tax settings.' : q!.title}
        actions={q && <>
          <Badge tone={QUOTE_TONE[q.status]}>{QUOTATION_STATUS_LABELS[q.status as keyof typeof QUOTATION_STATUS_LABELS]}</Badge>
          <Button variant="outline" onClick={() => pdf.mutate()} loading={pdf.isPending} disabled={!opts}><Download className="h-4 w-4" />PDF</Button>
          <Button variant="outline" onClick={() => setProposal(true)} disabled={!opts}><FileText className="h-4 w-4" />Proposal PDF</Button>
        </>} />
      {proposal && q && opts && <ProposalModal quote={q} options={opts} logoUrl={org?.logoUrl} onClose={() => setProposal(false)} />}
      <ErrorNote error={create.error ?? update.error ?? move.error ?? revise.error ?? del.error ?? pdf.error} />
      {expiring && <div className="mb-4"><Notice tone="warn">This quotation expires on {dateUtc(q!.validUntil, locale)}.</Notice></div>}
      {q?.status === 'EXPIRED' && <div className="mb-4"><Notice tone="warn">The validity date has passed. Create a revision to re-issue it.</Notice></div>}
      <div className={q ? 'grid gap-5 xl:grid-cols-[1fr_18rem]' : ''}>
        <Card>
          <CardBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Customer" htmlFor="q-cust">
                <Select id="q-cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={!editable}>
                  <option value="">Select…</option>
                  {q && !customers.data?.some((c) => c.id === q.customer.id) && <option value={q.customer.id}>{q.customer.name}</option>}
                  {customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Valid until" htmlFor="q-valid" hint="Leave blank for no expiry"><Input id="q-valid" type="date" value={validUntil} onChange={(e) => setValid(e.target.value)} disabled={!editable} /></Field>
              <div className="sm:col-span-2"><Field label="Title" htmlFor="q-title"><Input id="q-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!editable} /></Field></div>
            </div>
            <LineEditor items={items} onChange={setItems} readOnly={!editable} showCost={editable && !!opts?.canSeeCost} />
            {editable ? (preview && <TotalsBox t={preview} showMargin />) : q && <TotalsBox t={{ ...q, margin: opts?.canSeeCost && q.costTotal ? Number(q.subtotal) - Number(q.costTotal) : null }} showMargin />}
            {stored && q!.taxSnapshot.breakdown && q!.taxSnapshot.breakdown.length > 0 && (
              <p className="text-xs text-ink-muted">Tax ({q!.taxSnapshot.regime || 'tax'}): {q!.taxSnapshot.breakdown.map((b) => `${b.percent}% on ${money(b.taxable)} = ${money(b.tax)}`).join('; ')}. {q!.pricesIncludeTax ? 'Prices include tax.' : 'Prices exclude tax.'}</p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Terms and conditions" htmlFor="q-terms"><Textarea id="q-terms" rows={5} value={terms} onChange={(e) => setTerms(e.target.value)} disabled={!editable} /></Field>
              <Field label="Notes" htmlFor="q-notes" hint="Shown on the quotation"><Textarea id="q-notes" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editable} /></Field>
            </div>
            {editable && (
              <div className="flex items-center justify-between border-t border-surface-line pt-4">
                <span className="text-xs text-amber-700">{problem}</span>
                <div className="flex gap-2">
                  {!isNew && can('quotation:delete') && q!.revision === 1 && <Button variant="ghost" onClick={() => { if (confirm('Delete this draft?')) del.mutate(); }}>Delete</Button>}
                  <Button onClick={() => (isNew ? create : update).mutate()} loading={create.isPending || update.isPending} disabled={!!problem}>{isNew ? 'Create quotation' : 'Save changes'}</Button>
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {q && (
          <div className="space-y-4">
            <Card>
              <CardHeader title="Workflow" />
              <CardBody className="space-y-2">
                {q.status === 'DRAFT' && can('quotation:edit') && <Button className="w-full" onClick={() => move.mutate({ status: 'PENDING_APPROVAL' })} loading={move.isPending} disabled={!!problem}>Submit for approval</Button>}
                {q.status === 'PENDING_APPROVAL' && (can('quotation:approve') ? <>
                  <Button className="w-full" onClick={() => move.mutate({ status: 'APPROVED' })} loading={move.isPending}>Approve</Button>
                  <Button className="w-full" variant="outline" onClick={() => move.mutate({ status: 'DRAFT', note: 'Returned for changes' })}>Return to draft</Button>
                </> : <p className="text-sm text-ink-muted">Waiting for someone with approval rights.</p>)}
                {q.status === 'APPROVED' && can('quotation:edit') && <>
                  <Button className="w-full" onClick={() => move.mutate({ status: 'SENT' })} loading={move.isPending}>Mark as sent to customer</Button>
                  <Button className="w-full" variant="outline" onClick={() => move.mutate({ status: 'DRAFT', note: 'Reopened' })}>Return to draft</Button>
                </>}
                {q.status === 'SENT' && can('quotation:edit') && <>
                  <Button className="w-full" onClick={() => move.mutate({ status: 'ACCEPTED' })} loading={move.isPending}>Customer accepted</Button>
                  <Button className="w-full" variant="outline" onClick={() => setRejecting('REJECTED')}>Customer rejected</Button>
                </>}
                {q.status === 'ACCEPTED' && !q.contract && can('contract:create') && <Button className="w-full" variant="accent" onClick={() => setContracting(true)}>Create contract</Button>}
                {q.contract && <Link className="block text-sm text-brand hover:underline" to={`/contracts/${q.contract.id}`}>Contract {q.contract.number} ({label(q.contract.status)})</Link>}
                {q.status !== 'DRAFT' && !q.contract && latestRev && can('quotation:create') && <Button className="w-full" variant="outline" onClick={() => revise.mutate()} loading={revise.isPending}>Create revision</Button>}
                {q.status !== 'DRAFT' && !latestRev && <p className="text-sm text-ink-muted">A newer revision exists.</p>}
              </CardBody>
            </Card>
            {!!q.revisions && q.revisions.length > 1 && (
              <Card><CardHeader title="Revisions" /><CardBody className="space-y-1 text-sm">{q.revisions.map((r) => <div key={r.id}><Link className={r.id === q.id ? 'font-semibold' : 'text-brand hover:underline'} to={`/quotations/${r.id}`}>Revision {r.revision}</Link> <span className="text-ink-muted">({label(r.status)})</span></div>)}</CardBody></Card>
            )}
            <Card>
              <CardHeader title="History" />
              <CardBody className="space-y-2 text-sm">
                {q.events?.map((e) => <div key={e.id}><span className="font-medium">{label(e.toStatus)}</span>{e.note ? ` · ${e.note}` : ''}<div className="text-xs text-ink-muted">{formatDateTime(e.createdAt, locale)}</div></div>)}
                {q.bom && <div className="border-t border-surface-line pt-2 text-xs text-ink-muted">From BOM <Link className="text-brand hover:underline" to={`/bom/${q.bom.id}`}>{q.bom.number}</Link></div>}
                {q.design && <div className="text-xs text-ink-muted">Design: {q.design.name}</div>}
              </CardBody>
            </Card>
          </div>
        )}
      </div>
      {contracting && q && <ContractModal quotation={q} onClose={() => setContracting(false)} />}
      {rejecting && (
        <Modal open title="Record rejection" onClose={() => setRejecting(null)}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); move.mutate({ status: 'REJECTED', note: note || undefined }); }}>
            <Field label="Reason (optional)" htmlFor="rej"><Input id="rej" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button><Button type="submit" variant="danger" loading={move.isPending}>Mark rejected</Button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
