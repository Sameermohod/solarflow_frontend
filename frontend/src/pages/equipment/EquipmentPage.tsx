import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image as ImageIcon, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { EQUIPMENT_CATEGORIES, EQUIPMENT_CATEGORY_LABELS, equipmentSchema, supplierSchema } from '@solarflow/shared';
import { z } from 'zod';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { fileSize, n, useMoney, type Page } from '@/lib/format';
import { useSuppliers, type Supplier } from '@/lib/hooks';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { AuthImage, DownloadLink, Tabs, useDebounced } from '@/components/ui/extra';
import { useOrg } from '../settings/useOrg';

interface Row {
  id: string; name: string; manufacturer: string; modelNumber: string; category: (typeof EQUIPMENT_CATEGORIES)[number]; unit: string; wattageW: string | null; sellingPrice: string; purchasePrice: string; isActive: boolean;
  supplier: { id: string; name: string } | null; inventory: { quantityOnHand: string } | null; files: { id: string }[];
}
interface Detail extends Row {
  description: string | null; voltageV: string | null; lengthMm: string | null; widthMm: string | null; thicknessMm: string | null; efficiencyPct: string | null; warrantyYears: number | null;
  taxRateCode: string | null; hsnCode: string | null; trackSerial: boolean; reorderLevel: string; supplierId: string | null;
  specifications: { id: string; name: string; value: string; unit: string | null }[];
  files: { id: string; kind: 'IMAGE' | 'DATASHEET'; fileName: string; mime: string; sizeBytes: number }[];
}
type Form = z.input<typeof equipmentSchema>;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

function EquipmentModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const org = useOrg();
  const suppliers = useSuppliers();
  const can = useAuth((st) => st.can);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileKind, setFileKind] = useState<'IMAGE' | 'DATASHEET'>('IMAGE');
  const detail = useQuery({ queryKey: ['equipment', id], queryFn: () => api.get<Detail>(`/equipment/${id}`), enabled: !!id });
  const d = detail.data;
  const { register, control, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(equipmentSchema),
    values: d ? {
      name: d.name, manufacturer: d.manufacturer, modelNumber: d.modelNumber, category: d.category, unit: d.unit, description: s(d.description), wattageW: s(d.wattageW), voltageV: s(d.voltageV), lengthMm: s(d.lengthMm), widthMm: s(d.widthMm), thicknessMm: s(d.thicknessMm),
      efficiencyPct: s(d.efficiencyPct), warrantyYears: s(d.warrantyYears), purchasePrice: Number(d.purchasePrice), sellingPrice: Number(d.sellingPrice), taxRateCode: s(d.taxRateCode), hsnCode: s(d.hsnCode), supplierId: s(d.supplierId),
      trackSerial: d.trackSerial, reorderLevel: Number(d.reorderLevel), isActive: d.isActive, specifications: d.specifications.map((x) => ({ name: x.name, value: x.value, unit: s(x.unit) })),
    } : { name: '', manufacturer: '', modelNumber: '', category: 'SOLAR_PANEL', unit: 'nos', purchasePrice: 0, sellingPrice: 0, reorderLevel: 0, isActive: true, trackSerial: false, specifications: [] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'specifications' });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['equipment'] }); qc.invalidateQueries({ queryKey: ['inventory'] }); };
  const save = useMutation({
    mutationFn: (v: Form) => (id ? api.patch(`/equipment/${id}`, v) : api.post<{ id: string }>('/equipment', v)),
    onSuccess: () => { refresh(); onClose(); },
  });
  const upload = useMutation({ mutationFn: (f: File) => { const fd = new FormData(); fd.append('kind', fileKind); fd.append('file', f); return api.upload(`/equipment/${id}/files`, fd); }, onSuccess: () => { qc.invalidateQueries({ queryKey: ['equipment', id] }); refresh(); } });
  const delFile = useMutation({ mutationFn: (fid: string) => api.delete(`/equipment/${id}/files/${fid}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['equipment', id] }); refresh(); } });
  const rates = org.data?.taxConfig.rates.filter((r) => r.active) ?? [];
  const isNew = !id;
  const editable = isNew ? can('equipment:create') : can('equipment:edit');

  return (
    <Modal open wide title={isNew ? 'New equipment' : (d?.name ?? 'Equipment')} onClose={onClose}>
      {!isNew && detail.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-5" noValidate>
          <fieldset disabled={!editable} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Product name" htmlFor="q-name" error={errors.name?.message}><Input id="q-name" {...register('name')} /></Field>
              <Field label="Manufacturer" htmlFor="q-man" error={errors.manufacturer?.message}><Input id="q-man" {...register('manufacturer')} /></Field>
              <Field label="Model number" htmlFor="q-mod" error={errors.modelNumber?.message}><Input id="q-mod" {...register('modelNumber')} /></Field>
              <Field label="Category" htmlFor="q-cat"><Select id="q-cat" {...register('category')}>{EQUIPMENT_CATEGORIES.map((c) => <option key={c} value={c}>{EQUIPMENT_CATEGORY_LABELS[c]}</option>)}</Select></Field>
              <Field label="Unit" htmlFor="q-unit"><Input id="q-unit" {...register('unit')} /></Field>
              <Field label="Supplier" htmlFor="q-sup"><Select id="q-sup" {...register('supplierId')}><option value="">None</option>{suppliers.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
              <Field label="Wattage (W)" htmlFor="q-w" error={errors.wattageW?.message}><Input id="q-w" inputMode="decimal" {...register('wattageW')} /></Field>
              <Field label="Voltage (V)" htmlFor="q-v"><Input id="q-v" inputMode="decimal" {...register('voltageV')} /></Field>
              <Field label="Efficiency (%)" htmlFor="q-eff"><Input id="q-eff" inputMode="decimal" {...register('efficiencyPct')} /></Field>
              <Field label="Length (mm)" htmlFor="q-l"><Input id="q-l" inputMode="decimal" {...register('lengthMm')} /></Field>
              <Field label="Width (mm)" htmlFor="q-wd"><Input id="q-wd" inputMode="decimal" {...register('widthMm')} /></Field>
              <Field label="Thickness (mm)" htmlFor="q-t"><Input id="q-t" inputMode="decimal" {...register('thicknessMm')} /></Field>
              <Field label="Warranty (years)" htmlFor="q-wy"><Input id="q-wy" inputMode="numeric" {...register('warrantyYears')} /></Field>
              <Field label="Purchase price" htmlFor="q-pp" error={errors.purchasePrice?.message}><Input id="q-pp" inputMode="decimal" {...register('purchasePrice')} /></Field>
              <Field label="Selling price" htmlFor="q-sp" error={errors.sellingPrice?.message}><Input id="q-sp" inputMode="decimal" {...register('sellingPrice')} /></Field>
              <Field label="Tax rate" htmlFor="q-tax" hint="From Settings → Regional & tax"><Select id="q-tax" {...register('taxRateCode')}><option value="">No tax</option>{rates.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}</Select></Field>
              <Field label="HSN / SAC code" htmlFor="q-hsn"><Input id="q-hsn" {...register('hsnCode')} /></Field>
              <Field label="Reorder level" htmlFor="q-ro" hint="Low-stock alert at or below"><Input id="q-ro" inputMode="decimal" {...register('reorderLevel')} /></Field>
            </div>
            <div className="flex gap-6 text-sm"><label className="flex items-center gap-2"><input type="checkbox" {...register('trackSerial')} />Track serial numbers</label><label className="flex items-center gap-2"><input type="checkbox" {...register('isActive')} />Active</label></div>
            <Field label="Description" htmlFor="q-desc"><Textarea id="q-desc" {...register('description')} /></Field>
            <div>
              <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Technical specifications</h3>{editable && <Button size="sm" variant="outline" onClick={() => append({ name: '', value: '', unit: '' })}><Plus className="h-4 w-4" />Add</Button>}</div>
              <div className="space-y-2">
                {fields.map((f, i) => (
                  <div key={f.id} className="grid grid-cols-[1.2fr_1.5fr_80px_auto] gap-2">
                    <Input aria-label={`Spec ${i + 1} name`} placeholder="e.g. Cell type" {...register(`specifications.${i}.name`)} /><Input aria-label={`Spec ${i + 1} value`} placeholder="Value" {...register(`specifications.${i}.value`)} /><Input aria-label={`Spec ${i + 1} unit`} placeholder="Unit" {...register(`specifications.${i}.unit`)} />
                    <button type="button" aria-label={`Remove spec ${i + 1}`} onClick={() => remove(i)} className="rounded p-2 text-ink-muted hover:bg-surface-alt"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
                {errors.specifications && <p role="alert" className="text-xs text-red-600">Each specification needs a name and a value.</p>}
              </div>
            </div>
          </fieldset>
          <ErrorNote error={save.error} />
          {editable && <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>{isNew ? 'Create equipment' : 'Save changes'}</Button></div>}
        </form>
      )}
      {!isNew && d && (
        <div className="mt-6 border-t border-surface-line pt-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Images and datasheets</h3>
            {can('equipment:edit') && <div className="flex items-center gap-2">
              <input ref={fileRef} type="file" className="hidden" aria-label="Upload equipment file" accept={fileKind === 'IMAGE' ? 'image/png,image/jpeg,image/webp' : '.pdf,.docx,.xlsx,.png,.jpg'} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
              <Select aria-label="File type" value={fileKind} onChange={(e) => setFileKind(e.target.value as typeof fileKind)} className="h-9 w-36"><option value="IMAGE">Image</option><option value="DATASHEET">Datasheet</option></Select>
              <Button size="sm" variant="outline" loading={upload.isPending} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" />Upload</Button></div>}
          </div>
          <ErrorNote error={upload.error ?? delFile.error} />
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {d.files.map((f) => (
              <li key={f.id} className="overflow-hidden rounded-lg border border-surface-line text-xs">
                {f.kind === 'IMAGE' ? <AuthImage path={`/equipment/${id}/files/${f.id}`} alt={f.fileName} className="h-24 w-full" /> : <div className="flex h-24 items-center justify-center bg-surface-alt text-ink-muted">Datasheet</div>}
                <div className="flex items-center justify-between gap-1 p-2"><div className="min-w-0"><DownloadLink path={`/equipment/${id}/files/${f.id}`} fileName={f.fileName}>Download</DownloadLink><p className="truncate text-ink-muted">{fileSize(f.sizeBytes)}</p></div>
                  {can('equipment:edit') && <button aria-label={`Delete ${f.fileName}`} onClick={() => delFile.mutate(f.id)} className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>}</div>
              </li>
            ))}
            {d.files.length === 0 && <li className="col-span-full text-sm text-ink-muted">No files yet.</li>}
          </ul>
        </div>
      )}
    </Modal>
  );
}

type SupForm = z.input<typeof supplierSchema>;
function SupplierModal({ sup, onClose }: { sup: Supplier | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<SupForm>({ resolver: zodResolver(supplierSchema), defaultValues: sup ? { name: sup.name, contactPerson: s(sup.contactPerson), email: s(sup.email), phone: s(sup.phone), address: s(sup.address), taxId: s(sup.taxId), paymentTerms: s(sup.paymentTerms), notes: s(sup.notes) } : {} });
  const save = useMutation({ mutationFn: (v: SupForm) => (sup ? api.patch(`/equipment/suppliers/${sup.id}`, v) : api.post('/equipment/suppliers', v)), onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); onClose(); } });
  return (
    <Modal open title={sup ? 'Edit supplier' : 'New supplier'} onClose={onClose}>
      <form onSubmit={handleSubmit((v) => save.mutate(v))} className="space-y-3" noValidate>
        <Field label="Supplier name" htmlFor="su-n" error={errors.name?.message}><Input id="su-n" {...register('name')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact person" htmlFor="su-c"><Input id="su-c" {...register('contactPerson')} /></Field><Field label="Phone" htmlFor="su-p"><Input id="su-p" {...register('phone')} /></Field>
          <Field label="Email" htmlFor="su-e" error={errors.email?.message}><Input id="su-e" type="email" {...register('email')} /></Field><Field label="Tax ID" htmlFor="su-t"><Input id="su-t" {...register('taxId')} /></Field>
        </div>
        <Field label="Address" htmlFor="su-a"><Input id="su-a" {...register('address')} /></Field>
        <Field label="Payment terms" htmlFor="su-pt"><Input id="su-pt" {...register('paymentTerms')} /></Field>
        <Field label="Notes" htmlFor="su-no"><Textarea id="su-no" {...register('notes')} /></Field>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save</Button></div>
      </form>
    </Modal>
  );
}

function SuppliersTab() {
  const qc = useQueryClient();
  const can = useAuth((st) => st.can);
  const { data, isLoading, error } = useSuppliers();
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/equipment/suppliers/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }) });
  return (
    <Card>
      <div className="flex justify-end border-b border-surface-line px-5 py-3">{can('inventory:create') && <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" />New supplier</Button>}</div>
      <ErrorNote error={error ?? del.error} />
      {isLoading ? <div className="flex justify-center py-12"><Spinner /></div> : !data?.length ? <EmptyState title="No suppliers yet" /> : (
        <Table><thead><tr><Th>Supplier</Th><Th>Contact</Th><Th>Terms</Th><Th>Products / POs</Th><Th className="text-right">Actions</Th></tr></thead>
          <tbody>{data.map((x) => (
            <tr key={x.id}><Td className="font-medium">{x.name}</Td><Td><p>{x.contactPerson ?? '—'}</p><p className="text-xs text-ink-muted">{x.email ?? x.phone ?? ''}</p></Td><Td>{x.paymentTerms ?? '—'}</Td><Td>{x._count?.equipment ?? 0} / {x._count?.purchaseOrders ?? 0}</Td>
              <Td className="text-right">{can('inventory:edit') && <Button size="icon" variant="ghost" aria-label={`Edit ${x.name}`} onClick={() => setEditing(x)}><Pencil className="h-4 w-4" /></Button>}
                {can('inventory:delete') && <Button size="icon" variant="ghost" aria-label={`Delete ${x.name}`} onClick={() => { if (window.confirm(`Delete supplier “${x.name}”?`)) del.mutate(x.id); }}><Trash2 className="h-4 w-4 text-red-600" /></Button>}</Td></tr>))}</tbody></Table>
      )}
      {editing && <SupplierModal sup={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

export function EquipmentPage() {
  const can = useAuth((st) => st.can);
  const money = useMoney();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'catalogue' | 'suppliers'>('catalogue');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [open, setOpen] = useState<string | 'new' | null>(params.get('id'));
  const q = useDebounced(search);
  const { data, isLoading, error } = useQuery({ queryKey: ['equipment', 'list', page, q, category], queryFn: () => api.get<Page<Row>>(`/equipment${qs({ page, pageSize: 15, search: q, category })}`), placeholderData: (p) => p, enabled: tab === 'catalogue' });
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/equipment/${id}`) });
  const qc = useQueryClient();
  return (
    <>
      <PageHeader title="Equipment" description="Catalogue of panels, inverters, batteries and accessories"
        actions={tab === 'catalogue' && can('equipment:create') ? <Button onClick={() => setOpen('new')}><Plus className="h-4 w-4" />New equipment</Button> : undefined} />
      <Tabs tabs={[{ id: 'catalogue', label: 'Catalogue' }, ...(can('inventory:view') ? [{ id: 'suppliers' as const, label: 'Suppliers' }] : [])]} value={tab} onChange={setTab} />
      {tab === 'suppliers' ? <SuppliersTab /> : (
        <Card>
          <div className="flex flex-wrap gap-2 border-b border-surface-line px-5 py-4">
            <Input aria-label="Search equipment" placeholder="Search name, manufacturer or model…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
            <Select aria-label="Filter by category" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="w-52"><option value="">All categories</option>{EQUIPMENT_CATEGORIES.map((c) => <option key={c} value={c}>{EQUIPMENT_CATEGORY_LABELS[c]}</option>)}</Select>
          </div>
          <ErrorNote error={error ?? del.error} />
          {isLoading ? <div className="flex justify-center py-14"><Spinner className="h-7 w-7" /></div> : !data?.data.length ? <EmptyState title="No equipment found" description={q || category ? 'Try different filters.' : 'Add the panels, inverters and accessories you sell.'} /> : (
            <>
              <Table>
                <thead><tr><Th></Th><Th>Product</Th><Th>Category</Th><Th>Supplier</Th><Th>Cost</Th><Th>Price</Th><Th>Stock</Th><Th className="text-right">Actions</Th></tr></thead>
                <tbody>{data.data.map((e) => (
                  <tr key={e.id} className="hover:bg-surface-alt">
                    <Td className="w-14">{e.files[0] ? <AuthImage path={`/equipment/${e.id}/files/${e.files[0].id}`} alt="" className="h-10 w-10 rounded" /> : <span className="flex h-10 w-10 items-center justify-center rounded bg-surface-alt text-ink-muted"><ImageIcon className="h-4 w-4" /></span>}</Td>
                    <Td><button className="text-left font-medium hover:underline" onClick={() => setOpen(e.id)}>{e.name}</button><p className="text-xs text-ink-muted">{e.manufacturer} · {e.modelNumber}{e.wattageW ? ` · ${n(e.wattageW)} W` : ''}</p></Td>
                    <Td>{EQUIPMENT_CATEGORY_LABELS[e.category]}{!e.isActive && <> <Badge tone="red">Inactive</Badge></>}</Td>
                    <Td>{e.supplier?.name ?? '—'}</Td><Td>{money(e.purchasePrice)}</Td><Td>{money(e.sellingPrice)}</Td><Td>{n(e.inventory?.quantityOnHand)} {e.unit}</Td>
                    <Td className="text-right">{can('equipment:delete') && <Button size="icon" variant="ghost" aria-label={`Delete ${e.name}`} onClick={() => { if (window.confirm(`Delete “${e.name}”?`)) del.mutate(e.id, { onSuccess: () => qc.invalidateQueries({ queryKey: ['equipment'] }) }); }}><Trash2 className="h-4 w-4 text-red-600" /></Button>}</Td>
                  </tr>))}</tbody>
              </Table>
              <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={setPage} />
            </>
          )}
        </Card>
      )}
      {open && <EquipmentModal id={open === 'new' ? null : open} onClose={() => { setOpen(null); if (params.has('id')) setParams({}); }} />}
    </>
  );
}
