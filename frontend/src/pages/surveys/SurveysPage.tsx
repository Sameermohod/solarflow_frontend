import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { SURVEY_STATUSES } from '@solarflow/shared';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { dateOnly, label, personName, toLocalInput, useLocale, type Page } from '@/lib/format';
import { useCustomerOptions, useDirectory } from '@/lib/hooks';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { useDebounced } from '@/components/ui/extra';

export const SURVEY_TONE: Record<string, 'neutral' | 'blue' | 'green' | 'red' | 'yellow'> = { SCHEDULED: 'blue', IN_PROGRESS: 'yellow', COMPLETED: 'green', CANCELLED: 'red' };

interface Row {
  id: string; status: string; scheduledAt: string | null; createdAt: string;
  customer: { id: string; name: string; phone: string | null }; address: { line1: string; city: string | null } | null;
  engineer: { id: string; firstName: string; lastName: string } | null; _count: { attachments: number };
}

function NewSurveyModal({ presetCustomer, onClose }: { presetCustomer?: string; onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const customers = useCustomerOptions();
  const dir = useDirectory();
  const me = useAuth((s) => s.session?.user.id);
  const [customerId, setCustomerId] = useState(presetCustomer ?? '');
  const [addressId, setAddressId] = useState('');
  const [engineerId, setEngineerId] = useState(me ?? '');
  const [when, setWhen] = useState('');
  const detail = useQuery({ queryKey: ['customer', customerId], queryFn: () => api.get<{ addresses: { id: string; label: string; line1: string; city: string | null; isDefault: boolean }[] }>(`/customers/${customerId}`), enabled: !!customerId });
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/site-surveys', { customerId, addressId: addressId || detail.data?.addresses.find((a) => a.isDefault)?.id || null, engineerId: engineerId || null, scheduledAt: when ? new Date(when).toISOString() : null }),
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ['surveys'] }); onClose(); nav(`/surveys/${s.id}`); },
  });
  return (
    <Modal open title="Schedule site survey" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (customerId) create.mutate(); }}>
        <Field label="Customer" htmlFor="s-cust">
          <Select id="s-cust" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setAddressId(''); }} required>
            <option value="">Select a customer…</option>{customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        {customerId && <Field label="Site address" htmlFor="s-addr"><Select id="s-addr" value={addressId} onChange={(e) => setAddressId(e.target.value)}>
          <option value="">{detail.data?.addresses.find((a) => a.isDefault) ? 'Default address' : 'No address (add later)'}</option>
          {detail.data?.addresses.map((a) => <option key={a.id} value={a.id}>{a.label}: {a.line1}{a.city ? `, ${a.city}` : ''}</option>)}</Select></Field>}
        <Field label="Survey engineer" htmlFor="s-eng"><Select id="s-eng" value={engineerId} onChange={(e) => setEngineerId(e.target.value)}><option value="">Unassigned</option>{dir.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
        <Field label="Scheduled for" htmlFor="s-when"><Input id="s-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} min={toLocalInput(new Date().toISOString())} /></Field>
        <ErrorNote error={create.error} />
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={create.isPending} disabled={!customerId}>Create survey</Button></div>
      </form>
    </Modal>
  );
}

export function SurveysPage() {
  const can = useAuth((s) => s.can);
  const me = useAuth((s) => s.session?.user.id);
  const locale = useLocale();
  const dir = useDirectory();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [mine, setMine] = useState(false);
  const [creating, setCreating] = useState(params.has('new'));
  const q = useDebounced(search);
  const { data, isLoading, error } = useQuery({
    queryKey: ['surveys', page, q, status, mine],
    queryFn: () => api.get<Page<Row>>(`/site-surveys${qs({ page, pageSize: 15, search: q, status, engineerId: mine ? me : '', sort: 'scheduledAt', order: 'desc' })}`),
    placeholderData: (p) => p,
  });
  void dir;
  return (
    <>
      <PageHeader title="Site surveys" description="Collect roof, building and electrical data on site" actions={can('survey:create') ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Schedule survey</Button> : undefined} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-surface-line px-5 py-4">
          <Input aria-label="Search by customer" placeholder="Search by customer…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
          <Select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-44"><option value="">All statuses</option>{SURVEY_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(1); }} />Assigned to me</label>
        </div>
        <ErrorNote error={error} />
        {isLoading ? <div className="flex justify-center py-14"><Spinner className="h-7 w-7" /></div> : !data?.data.length ? <EmptyState title="No surveys found" description="Schedule a survey from here, from a customer, or when converting a lead." /> : (
          <>
            <Table>
              <thead><tr><Th>Customer</Th><Th>Site</Th><Th>Engineer</Th><Th>Scheduled</Th><Th>Status</Th><Th>Files</Th></tr></thead>
              <tbody>
                {data.data.map((s) => (
                  <tr key={s.id} className="hover:bg-surface-alt">
                    <Td><Link to={`/surveys/${s.id}`} className="font-medium hover:underline">{s.customer.name}</Link><p className="text-xs text-ink-muted">{s.customer.phone ?? ''}</p></Td>
                    <Td className="text-ink-muted">{s.address ? `${s.address.line1}${s.address.city ? `, ${s.address.city}` : ''}` : '—'}</Td>
                    <Td>{s.engineer ? personName(s.engineer) : '—'}</Td>
                    <Td>{dateOnly(s.scheduledAt, locale)}</Td>
                    <Td><Badge tone={SURVEY_TONE[s.status] ?? 'neutral'}>{label(s.status)}</Badge></Td>
                    <Td>{s._count.attachments}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      {creating && <NewSurveyModal presetCustomer={params.get('new') && params.get('new') !== '1' ? params.get('new')! : undefined} onClose={() => { setCreating(false); setParams({}); }} />}
    </>
  );
}
