import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { createCustomerSchema } from '@solarflow/shared';
import { z } from 'zod';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { label, type Page } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { useDebounced } from '@/components/ui/extra';

export interface CustomerRow {
  id: string; type: 'INDIVIDUAL' | 'BUSINESS'; name: string; contactPerson: string | null; email: string | null; phone: string | null; createdAt: string;
  addresses: { id: string; line1: string; city: string | null }[]; _count: { leads: number; surveys: number };
}

type Form = z.input<typeof createCustomerSchema>;

export function CustomerFormModal({ onClose, onCreated }: { onClose: () => void; onCreated?: (id: string) => void }) {
  const qc = useQueryClient();
  const { register, control, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: { type: 'INDIVIDUAL', addresses: [{ label: 'Installation site', line1: '', isDefault: true }] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'addresses' });
  const create = useMutation({
    mutationFn: (v: Form) => api.post<{ id: string }>('/customers', { ...v, addresses: (v.addresses ?? []).filter((a) => a.line1?.trim()) }),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ['customers'] }); qc.invalidateQueries({ queryKey: ['customer-options'] }); onCreated?.(c.id); onClose(); },
  });
  return (
    <Modal open wide title="New customer" onClose={onClose}>
      <form onSubmit={handleSubmit((v) => create.mutate(v))} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer type" htmlFor="c-type"><Select id="c-type" {...register('type')}><option value="INDIVIDUAL">Individual</option><option value="BUSINESS">Business</option></Select></Field>
          <Field label="Name / company" htmlFor="c-name" error={errors.name?.message}><Input id="c-name" {...register('name')} /></Field>
          <Field label="Contact person" htmlFor="c-contact"><Input id="c-contact" {...register('contactPerson')} /></Field>
          <Field label="Tax ID (GSTIN / VAT)" htmlFor="c-tax"><Input id="c-tax" {...register('taxId')} /></Field>
          <Field label="Email" htmlFor="c-email" error={errors.email?.message}><Input id="c-email" type="email" {...register('email')} /></Field>
          <Field label="Phone" htmlFor="c-phone"><Input id="c-phone" type="tel" {...register('phone')} /></Field>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Installation addresses</h3>
            <Button size="sm" variant="outline" onClick={() => append({ label: 'Installation site', line1: '', isDefault: false })}><Plus className="h-4 w-4" />Add address</Button></div>
          {fields.map((f, i) => (
            <div key={f.id} className="grid gap-2 rounded-lg border border-surface-line p-3 sm:grid-cols-6">
              <Input className="sm:col-span-2" aria-label={`Address ${i + 1} label`} placeholder="Label" {...register(`addresses.${i}.label`)} />
              <Input className="sm:col-span-4" aria-label={`Address ${i + 1} line 1`} placeholder="Address line 1" {...register(`addresses.${i}.line1`)} />
              <Input className="sm:col-span-2" aria-label={`Address ${i + 1} city`} placeholder="City" {...register(`addresses.${i}.city`)} />
              <Input className="sm:col-span-2" aria-label={`Address ${i + 1} state`} placeholder="State" {...register(`addresses.${i}.state`)} />
              <div className="flex items-center gap-2 sm:col-span-2"><Input aria-label={`Address ${i + 1} postal code`} placeholder="Postal code" {...register(`addresses.${i}.postalCode`)} />
                {fields.length > 1 && <button type="button" aria-label={`Remove address ${i + 1}`} onClick={() => remove(i)} className="rounded p-2 text-ink-muted hover:bg-surface-alt"><Trash2 className="h-4 w-4" /></button>}</div>
              {errors.addresses?.[i]?.line1 && <p role="alert" className="text-xs text-red-600 sm:col-span-6">{errors.addresses[i]!.line1!.message}</p>}
            </div>
          ))}
        </div>
        <Field label="Notes" htmlFor="c-notes"><Textarea id="c-notes" {...register('notes')} /></Field>
        <ErrorNote error={create.error} />
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={create.isPending}>Create customer</Button></div>
      </form>
    </Modal>
  );
}

export function CustomersPage() {
  const can = useAuth((s) => s.can);
  const nav = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useDebounced(search);
  const { data, isLoading, error } = useQuery({
    queryKey: ['customers', page, q, type],
    queryFn: () => api.get<Page<CustomerRow>>(`/customers${qs({ page, pageSize: 15, search: q, type })}`),
    placeholderData: (p) => p,
  });
  return (
    <>
      <PageHeader title="Customers" description="People and businesses you install for" actions={can('customer:create') ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New customer</Button> : undefined} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b border-surface-line px-5 py-4">
          <Input aria-label="Search customers" placeholder="Search name, email or phone…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
          <Select aria-label="Filter by type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="w-40"><option value="">All types</option><option value="INDIVIDUAL">Individual</option><option value="BUSINESS">Business</option></Select>
        </div>
        <ErrorNote error={error} />
        {isLoading ? <div className="flex justify-center py-14"><Spinner className="h-7 w-7" /></div> : !data?.data.length ? (
          <EmptyState title={q || type ? 'No customers match your filters' : 'No customers yet'} description={q || type ? undefined : 'Add your first customer, or convert a lead from the CRM.'} />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Customer</Th><Th>Contact</Th><Th>Location</Th><Th>Activity</Th></tr></thead>
              <tbody>
                {data.data.map((c) => (
                  <tr key={c.id} className="cursor-pointer hover:bg-surface-alt" onClick={() => nav(`/customers/${c.id}`)}>
                    <Td><Link to={`/customers/${c.id}`} className="font-medium text-ink hover:underline" onClick={(e) => e.stopPropagation()}>{c.name}</Link><div className="mt-0.5"><Badge tone={c.type === 'BUSINESS' ? 'blue' : 'neutral'}>{label(c.type)}</Badge></div></Td>
                    <Td><p>{c.phone ?? '—'}</p><p className="text-xs text-ink-muted">{c.email ?? ''}</p></Td>
                    <Td className="text-ink-muted">{c.addresses[0] ? `${c.addresses[0].line1}${c.addresses[0].city ? `, ${c.addresses[0].city}` : ''}` : '—'}</Td>
                    <Td className="text-xs text-ink-muted">{c._count.leads} lead(s) · {c._count.surveys} survey(s)</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      {creating && <CustomerFormModal onClose={() => setCreating(false)} onCreated={(id) => nav(`/customers/${id}`)} />}
    </>
  );
}
