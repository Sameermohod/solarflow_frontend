import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MapPin, Pencil, Plus, Star, Trash2, Upload } from 'lucide-react';
import { addressSchema, customerSchema } from '@solarflow/shared';
import { z } from 'zod';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { dateOnly, fileSize, label, useLocale } from '@/lib/format';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Textarea } from '@/components/ui';
import { DownloadLink } from '@/components/ui/extra';

interface Address { id: string; label: string; line1: string; line2: string | null; city: string | null; state: string | null; postalCode: string | null; country: string | null; latitude: string | null; longitude: string | null; isDefault: boolean }
interface Detail {
  id: string; type: 'INDIVIDUAL' | 'BUSINESS'; name: string; contactPerson: string | null; email: string | null; phone: string | null; altPhone: string | null; taxId: string | null; notes: string | null;
  addresses: Address[]; customerNotes: { id: string; type: string; body: string; createdAt: string }[];
  documents: { id: string; fileName: string; mime: string; sizeBytes: number; createdAt: string }[];
  leads: { id: string; name: string; stage: string; createdAt: string }[];
  surveys: { id: string; status: string; scheduledAt: string | null; createdAt: string }[];
  calculations: { id: string; name: string; createdAt: string }[];
}

type CustForm = z.input<typeof customerSchema>;
type AddrForm = z.input<typeof addressSchema>;

function EditCustomerModal({ c, onClose }: { c: Detail; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<CustForm>({
    resolver: zodResolver(customerSchema),
    defaultValues: { type: c.type, name: c.name, contactPerson: c.contactPerson ?? '', email: c.email ?? '', phone: c.phone ?? '', altPhone: c.altPhone ?? '', taxId: c.taxId ?? '', notes: c.notes ?? '' },
  });
  const save = useMutation({ mutationFn: (v: CustForm) => api.patch(`/customers/${c.id}`, v), onSuccess: () => { qc.invalidateQueries({ queryKey: ['customer', c.id] }); qc.invalidateQueries({ queryKey: ['customers'] }); onClose(); } });
  return (
    <Modal open title="Edit customer" onClose={onClose}>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="e-type"><Select id="e-type" {...register('type')}><option value="INDIVIDUAL">Individual</option><option value="BUSINESS">Business</option></Select></Field>
          <Field label="Name / company" htmlFor="e-name" error={errors.name?.message}><Input id="e-name" {...register('name')} /></Field>
          <Field label="Contact person" htmlFor="e-cp"><Input id="e-cp" {...register('contactPerson')} /></Field>
          <Field label="Tax ID" htmlFor="e-tax"><Input id="e-tax" {...register('taxId')} /></Field>
          <Field label="Email" htmlFor="e-email" error={errors.email?.message}><Input id="e-email" type="email" {...register('email')} /></Field>
          <Field label="Phone" htmlFor="e-phone"><Input id="e-phone" {...register('phone')} /></Field>
          <Field label="Alternate phone" htmlFor="e-alt"><Input id="e-alt" {...register('altPhone')} /></Field>
        </div>
        <Field label="Notes" htmlFor="e-notes"><Textarea id="e-notes" {...register('notes')} /></Field>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save</Button></div>
      </form>
    </Modal>
  );
}

function AddressModal({ customerId, address, onClose }: { customerId: string; address: Address | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<AddrForm>({
    resolver: zodResolver(addressSchema),
    defaultValues: address ? { label: address.label, line1: address.line1, line2: address.line2 ?? '', city: address.city ?? '', state: address.state ?? '', postalCode: address.postalCode ?? '', country: address.country ?? '', latitude: address.latitude ?? '', longitude: address.longitude ?? '', isDefault: address.isDefault } : { label: 'Installation site', isDefault: false },
  });
  const save = useMutation({
    mutationFn: (v: AddrForm) => (address ? api.patch(`/customers/${customerId}/addresses/${address.id}`, v) : api.post(`/customers/${customerId}/addresses`, v)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customer', customerId] }); qc.invalidateQueries({ queryKey: ['customer-options'] }); onClose(); },
  });
  return (
    <Modal open title={address ? 'Edit address' : 'Add address'} onClose={onClose}>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
        <Field label="Label" htmlFor="a-label"><Input id="a-label" {...register('label')} /></Field>
        <Field label="Address line 1" htmlFor="a-l1" error={errors.line1?.message}><Input id="a-l1" {...register('line1')} /></Field>
        <Field label="Address line 2" htmlFor="a-l2"><Input id="a-l2" {...register('line2')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="City" htmlFor="a-city"><Input id="a-city" {...register('city')} /></Field>
          <Field label="State" htmlFor="a-state"><Input id="a-state" {...register('state')} /></Field>
          <Field label="Postal code" htmlFor="a-pc"><Input id="a-pc" {...register('postalCode')} /></Field>
          <Field label="Country" htmlFor="a-country"><Input id="a-country" {...register('country')} /></Field>
          <Field label="Latitude" htmlFor="a-lat" error={errors.latitude?.message}><Input id="a-lat" inputMode="decimal" {...register('latitude')} /></Field>
          <Field label="Longitude" htmlFor="a-lng" error={errors.longitude?.message}><Input id="a-lng" inputMode="decimal" {...register('longitude')} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register('isDefault')} />Default address</label>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save</Button></div>
      </form>
    </Modal>
  );
}

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const locale = useLocale();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [addr, setAddr] = useState<Address | 'new' | null>(null);
  const [note, setNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data: c, isLoading, error } = useQuery({ queryKey: ['customer', id], queryFn: () => api.get<Detail>(`/customers/${id}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['customer', id] });
  const addNote = useMutation({ mutationFn: () => api.post(`/customers/${id}/notes`, { body: note }), onSuccess: () => { setNote(''); refresh(); } });
  const delAddr = useMutation({ mutationFn: (aid: string) => api.delete(`/customers/${id}/addresses/${aid}`), onSuccess: refresh });
  const upload = useMutation({ mutationFn: (f: File) => { const fd = new FormData(); fd.append('file', f); return api.upload(`/customers/${id}/documents`, fd); }, onSuccess: refresh });
  const delDoc = useMutation({ mutationFn: (did: string) => api.delete(`/customers/${id}/documents/${did}`), onSuccess: refresh });
  const del = useMutation({ mutationFn: () => api.delete(`/customers/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['customers'] }); nav('/customers'); } });

  if (isLoading) return <div className="flex justify-center py-20"><Spinner className="h-8 w-8" /></div>;
  if (error || !c) return <EmptyState title="Customer not found" action={<Link className="text-sm text-accent hover:underline" to="/customers">Back to customers</Link>} />;
  const edit = can('customer:edit');

  return (
    <>
      <Link to="/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" />Customers</Link>
      <PageHeader title={c.name} description={`${label(c.type)}${c.contactPerson ? ` · ${c.contactPerson}` : ''}`}
        actions={<>
          {can('survey:create') && <Link to={`/surveys?new=${c.id}`}><Button variant="outline">Schedule survey</Button></Link>}
          {can('calculator:view') && <Link to={`/calculator?customerId=${c.id}`}><Button variant="outline">Solar calculator</Button></Link>}
          {edit && <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Edit</Button>}
          {can('customer:delete') && <Button variant="ghost" aria-label="Delete customer" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4 text-red-600" /></Button>}
        </>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Installation addresses" action={edit ? <Button size="sm" variant="outline" onClick={() => setAddr('new')}><Plus className="h-4 w-4" />Add</Button> : undefined} />
            <ul className="divide-y divide-surface-line">
              {c.addresses.length === 0 && <li><EmptyState title="No addresses yet" /></li>}
              {c.addresses.map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                  <MapPin className="mt-0.5 h-4 w-4 text-ink-muted" />
                  <div className="flex-1">
                    <p className="font-medium">{a.label} {a.isDefault && <Badge tone="green"><Star className="mr-1 h-3 w-3" />Default</Badge>}</p>
                    <p className="text-ink-muted">{[a.line1, a.line2, a.city, a.state, a.postalCode, a.country].filter(Boolean).join(', ')}</p>
                  </div>
                  {edit && <><Button size="icon" variant="ghost" aria-label={`Edit ${a.label}`} onClick={() => setAddr(a)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label={`Delete ${a.label}`} onClick={() => delAddr.mutate(a.id)}><Trash2 className="h-4 w-4 text-red-600" /></Button></>}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Notes & communication history" />
            <CardBody className="space-y-4">
              {edit && (
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(); }}>
                  <Input aria-label="Add a note" placeholder="Add a note about a call, visit or message…" value={note} onChange={(e) => setNote(e.target.value)} />
                  <Button type="submit" loading={addNote.isPending} disabled={!note.trim()}>Add</Button>
                </form>
              )}
              <ErrorNote error={addNote.error} />
              <ul className="space-y-3">
                {c.customerNotes.length === 0 && <li className="text-sm text-ink-muted">No notes yet.</li>}
                {c.customerNotes.map((n) => (
                  <li key={n.id} className="border-l-2 border-surface-line pl-3 text-sm"><p className="whitespace-pre-wrap">{n.body}</p><p className="mt-0.5 text-xs text-ink-muted">{label(n.type)} · {dateOnly(n.createdAt, locale)}</p></li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Documents" description="PDF, images, DOCX or XLSX up to 10 MB"
              action={edit ? <><input ref={fileRef} type="file" className="hidden" aria-label="Upload document" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
                <Button size="sm" variant="outline" loading={upload.isPending} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" />Upload</Button></> : undefined} />
            <ErrorNote error={upload.error ?? delDoc.error} />
            <ul className="divide-y divide-surface-line">
              {c.documents.length === 0 && <li><EmptyState title="No documents" /></li>}
              {c.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div><DownloadLink path={`/customers/${id}/documents/${d.id}`} fileName={d.fileName} /><p className="text-xs text-ink-muted">{fileSize(d.sizeBytes)} · {dateOnly(d.createdAt, locale)}</p></div>
                  {edit && <Button size="icon" variant="ghost" aria-label={`Delete ${d.fileName}`} onClick={() => delDoc.mutate(d.id)}><Trash2 className="h-4 w-4 text-red-600" /></Button>}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Contact" />
            <CardBody className="space-y-1.5 text-sm">
              <p><span className="text-ink-muted">Phone: </span>{c.phone ?? '—'}</p>
              <p><span className="text-ink-muted">Alt. phone: </span>{c.altPhone ?? '—'}</p>
              <p><span className="text-ink-muted">Email: </span>{c.email ?? '—'}</p>
              <p><span className="text-ink-muted">Tax ID: </span>{c.taxId ?? '—'}</p>
              {c.notes && <p className="whitespace-pre-wrap border-t border-surface-line pt-2 text-ink-muted">{c.notes}</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Related" />
            <CardBody className="space-y-4 text-sm">
              <div><p className="mb-1 font-medium">Leads</p>{c.leads.length ? c.leads.map((l) => <Link key={l.id} to={`/crm?lead=${l.id}`} className="block text-accent hover:underline">{l.name} <span className="text-ink-muted">({label(l.stage)})</span></Link>) : <p className="text-ink-muted">None</p>}</div>
              <div><p className="mb-1 font-medium">Site surveys</p>{c.surveys.length ? c.surveys.map((s) => <Link key={s.id} to={`/surveys/${s.id}`} className="block text-accent hover:underline">{label(s.status)} · {dateOnly(s.scheduledAt ?? s.createdAt, locale)}</Link>) : <p className="text-ink-muted">None</p>}</div>
              <div><p className="mb-1 font-medium">Saved calculations</p>{c.calculations.length ? c.calculations.map((k) => <Link key={k.id} to={`/calculator?load=${k.id}`} className="block text-accent hover:underline">{k.name}</Link>) : <p className="text-ink-muted">None</p>}</div>
            </CardBody>
          </Card>
        </div>
      </div>
      {editing && <EditCustomerModal c={c} onClose={() => setEditing(false)} />}
      {addr && <AddressModal customerId={id} address={addr === 'new' ? null : addr} onClose={() => setAddr(null)} />}
      <Modal open={confirmDelete} title="Delete customer?" onClose={() => setConfirmDelete(false)}>
        <p className="text-sm text-ink-muted">{c.name} will be removed from your customer list. Linked leads, surveys and calculations are kept.</p>
        <ErrorNote error={del.error} />
        <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}>Delete</Button></div>
      </Modal>
    </>
  );
}
