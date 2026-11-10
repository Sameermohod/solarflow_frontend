import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { PAYMENT_METHODS } from '@solarflow/shared';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { label, useLocale, type Page } from '@/lib/format';
import { formatDateTime } from '@/lib/utils';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { Notice, useDebounced } from '@/components/ui/extra';
import { useCommercialOptions, useMoney2, type InvoiceRow, type PaymentRow } from '@/features/commercial/api';
import { PaymentModal } from './InvoicesPage';

/** Pick an open invoice, then record a payment against it. */
function PickInvoiceModal({ onClose }: { onClose: () => void }) {
  const issued = useQuery({ queryKey: ['invoices', 'open', 'ISSUED'], queryFn: () => api.get<Page<InvoiceRow>>(`/invoices${qs({ status: 'ISSUED', pageSize: 100 })}`).then((r) => r.data) });
  const partial = useQuery({ queryKey: ['invoices', 'open', 'PARTIALLY_PAID'], queryFn: () => api.get<Page<InvoiceRow>>(`/invoices${qs({ status: 'PARTIALLY_PAID', pageSize: 100 })}`).then((r) => r.data) });
  const money = useMoney2();
  const [id, setId] = useState('');
  const open = [...(issued.data ?? []), ...(partial.data ?? [])].filter((i) => i.type !== 'PROFORMA');
  const chosen = open.find((i) => i.id === id);
  if (chosen) return <PaymentModal invoice={chosen} onClose={onClose} />;
  return (
    <Modal open title="Record payment" onClose={onClose}>
      <div className="space-y-4">
        {issued.isLoading || partial.isLoading ? <div className="flex justify-center py-6"><Spinner /></div> : !open.length ? <Notice>No invoice is waiting for payment. Issue an invoice first.</Notice> : (
          <Field label="Invoice" htmlFor="pk-inv"><Select id="pk-inv" value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Select an open invoice…</option>
            {open.map((i) => <option key={i.id} value={i.id}>{i.number}: {i.customer.name}, balance {money(i.outstanding)}</option>)}
          </Select></Field>
        )}
        <div className="flex justify-end"><Button variant="outline" onClick={onClose}>Cancel</Button></div>
      </div>
    </Modal>
  );
}

export function PaymentsPage() {
  const can = useAuth((s) => s.can);
  const org = useAuth((s) => s.session?.organization);
  const qc = useQueryClient();
  const money = useMoney2();
  const locale = useLocale();
  const { data: opts } = useCommercialOptions();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState('');
  const [showVoid, setShowVoid] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiding, setVoiding] = useState<PaymentRow | null>(null);
  const [reason, setReason] = useState('');
  const q = useDebounced(search);
  const { data, isLoading, error } = useQuery({ queryKey: ['payments', page, q, method, showVoid], queryFn: () => api.get<Page<PaymentRow>>(`/payments${qs({ page, pageSize: 15, search: q, method, includeVoid: showVoid ? 'true' : '' })}`), placeholderData: (p) => p });
  const doVoid = useMutation({ mutationFn: () => api.post(`/payments/${voiding!.id}/void`, { reason }), onSuccess: () => { setVoiding(null); setReason(''); ['payments', 'invoices', 'invoice', 'contract'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); } });
  const receipt = useMutation({
    mutationFn: async (p: PaymentRow) => {
      const inv = await api.get<InvoiceRow>(`/invoices/${p.invoice!.id}`);
      const { receiptPdf } = await import('@/features/commercial/commercialPdf');
      await receiptPdf(p, inv, p.invoice?.customer?.name ?? inv.customer.name, opts!, org?.logoUrl);
    },
  });
  return (
    <div>
      <PageHeader title="Payments" description="Money received against issued invoices. Payments are never deleted; mistakes are voided with a reason." actions={can('payment:create') ? <Button onClick={() => setRecording(true)}><Plus className="h-4 w-4" />Record payment</Button> : undefined} />
      <ErrorNote error={receipt.error} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-surface-line px-5 py-4">
          <Input aria-label="Search payments" placeholder="Receipt, invoice or reference…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
          <Select aria-label="Method" value={method} onChange={(e) => { setMethod(e.target.value); setPage(1); }} className="max-w-[10rem]"><option value="">All methods</option>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</Select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showVoid} onChange={(e) => { setShowVoid(e.target.checked); setPage(1); }} />Show voided</label>
        </div>
        <ErrorNote error={error} />
        {isLoading ? <div className="flex justify-center py-12"><Spinner /></div> : !data?.data.length ? <EmptyState title="No payments recorded" description="Payments appear here once recorded against an issued invoice." /> : (
          <>
            <Table>
              <thead><tr><Th>Receipt</Th><Th>Invoice</Th><Th>Customer</Th><Th>Method</Th><Th>Received</Th><Th className="text-right">Amount</Th><Th /></tr></thead>
              <tbody>{data.data.map((p) => (
                <tr key={p.id} className={p.voidedAt ? 'opacity-60' : ''}>
                  <Td className="font-medium">{p.receiptNumber} {p.voidedAt && <Badge tone="red">Void</Badge>}</Td>
                  <Td>{p.invoice ? <Link className="text-brand hover:underline" to={`/invoices/${p.invoice.id}`}>{p.invoice.number}</Link> : '—'}</Td><Td>{p.invoice?.customer?.name ?? '—'}</Td>
                  <Td>{label(p.method)}{p.reference ? ` · ${p.reference}` : ''}</Td><Td>{formatDateTime(p.paidAt, locale)}</Td><Td className={`text-right tabular-nums ${p.voidedAt ? 'line-through' : ''}`}>{money(p.amount)}</Td>
                  <Td className="whitespace-nowrap text-right">
                    <Button variant="ghost" size="sm" onClick={() => receipt.mutate(p)} disabled={!opts || receipt.isPending}>Receipt</Button>
                    {!p.voidedAt && can('payment:edit') && <Button variant="ghost" size="sm" onClick={() => setVoiding(p)}>Void</Button>}
                  </Td>
                </tr>
              ))}</tbody>
            </Table>
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      {recording && <PickInvoiceModal onClose={() => setRecording(false)} />}
      {voiding && (
        <Modal open title={`Void ${voiding.receiptNumber}`} onClose={() => setVoiding(null)}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); doVoid.mutate(); }}>
            <Notice tone="warn">The payment ({money(voiding.amount)}) stays on record as void and the invoice balance is re-opened.</Notice>
            <Field label="Reason" htmlFor="pv-reason"><Input id="pv-reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} /></Field>
            <ErrorNote error={doVoid.error} />
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setVoiding(null)}>Cancel</Button><Button type="submit" variant="danger" loading={doVoid.isPending} disabled={reason.trim().length < 3}>Void payment</Button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
