import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownUp, Plus, Trash2 } from 'lucide-react';
import { EQUIPMENT_CATEGORIES, EQUIPMENT_CATEGORY_LABELS, MOVEMENT_TYPES, SERIAL_STATUSES } from '@solarflow/shared';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { formatDateTime } from '@/lib/utils';
import { label, n, useLocale, useMoney, type Page } from '@/lib/format';
import { useSuppliers } from '@/lib/hooks';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { StatCard, Tabs, useDebounced } from '@/components/ui/extra';

interface StockRow { id: string; name: string; manufacturer: string; modelNumber: string; category: (typeof EQUIPMENT_CATEGORIES)[number]; unit: string; reorderLevel: string; trackSerial: boolean; purchasePrice: string; quantityOnHand: string; lowStock: boolean }
interface Summary { items: number; stockValue: string; lowStockCount: number; openPurchaseOrders: number }

const useStockOptions = () => useQuery({ queryKey: ['stock-options'], queryFn: () => api.get<Page<StockRow>>(`/inventory${qs({ pageSize: 100 })}`).then((r) => r.data), staleTime: 15_000 });
const lines = (t: string) => t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

function MovementModal({ preset, onClose }: { preset?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const options = useStockOptions();
  const [equipmentId, setEq] = useState(preset ?? '');
  const [type, setType] = useState<(typeof MOVEMENT_TYPES)[number]>('RECEIPT');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [serials, setSerials] = useState('');
  const eq = options.data?.find((o) => o.id === equipmentId);
  const serialList = lines(serials);
  const save = useMutation({
    mutationFn: () => api.post('/inventory/movements', { equipmentId, type, quantity: Number(qty), unitCost: cost ? Number(cost) : null, reference: ref || null, note: note || null, serials: eq?.trackSerial && type !== 'ADJUSTMENT' ? serialList : undefined }),
    onSuccess: () => { ['inventory', 'stock-options', 'movements', 'serials', 'dashboard', 'notifications'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); onClose(); },
  });
  const signHint = type === 'ADJUSTMENT' ? 'Use a negative number to remove stock' : type === 'ISSUE' ? 'Units leaving stock' : 'Units added to stock';
  return (
    <Modal open title="Record stock movement" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Equipment" htmlFor="m-eq"><Select id="m-eq" value={equipmentId} onChange={(e) => setEq(e.target.value)} required><option value="">Select…</option>{options.data?.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.manufacturer} {o.modelNumber}), {n(o.quantityOnHand)} {o.unit} on hand</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Movement" htmlFor="m-type"><Select id="m-type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>{MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select></Field>
          <Field label={`Quantity${eq ? ` (${eq.unit})` : ''}`} htmlFor="m-qty" hint={signHint}><Input id="m-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} required /></Field>
          {type === 'RECEIPT' && <Field label="Unit cost" htmlFor="m-cost"><Input id="m-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>}
          <Field label="Reference" htmlFor="m-ref" hint="Job, project or PO"><Input id="m-ref" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        </div>
        {eq?.trackSerial && type !== 'ADJUSTMENT' && (
          <Field label={`Serial numbers (${serialList.length} entered, ${qty || 0} needed)`} htmlFor="m-sn" hint="One per line"><Textarea id="m-sn" value={serials} onChange={(e) => setSerials(e.target.value)} className="font-mono text-xs" /></Field>
        )}
        <Field label={type === 'ADJUSTMENT' ? 'Reason (required)' : 'Note'} htmlFor="m-note"><Input id="m-note" value={note} onChange={(e) => setNote(e.target.value)} required={type === 'ADJUSTMENT'} /></Field>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending} disabled={!equipmentId || !qty}>Record</Button></div>
      </form>
    </Modal>
  );
}

function StockTab() {
  const can = useAuth((s) => s.can);
  const money = useMoney();
  const [params] = useSearchParams();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [low, setLow] = useState(params.get('lowStock') === 'true');
  const [moving, setMoving] = useState<string | 'new' | null>(null);
  const q = useDebounced(search);
  const summary = useQuery({ queryKey: ['inventory', 'summary'], queryFn: () => api.get<Summary>('/inventory/summary') });
  const { data, isLoading, error } = useQuery({ queryKey: ['inventory', 'list', page, q, category, low], queryFn: () => api.get<Page<StockRow>>(`/inventory${qs({ page, pageSize: 15, search: q, category, lowStock: low ? 'true' : '' })}`), placeholderData: (p) => p });
  return (
    <>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Catalogue items" value={summary.data?.items ?? '—'} />
        <StatCard label="Low stock" value={summary.data?.lowStockCount ?? '—'} tone={summary.data?.lowStockCount ? 'warn' : undefined} sub="At or below reorder level" />
        <StatCard label="Stock value" value={summary.data ? money(summary.data.stockValue) : '—'} sub="At purchase price" />
        <StatCard label="Open purchase orders" value={summary.data?.openPurchaseOrders ?? '—'} />
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-surface-line px-5 py-4">
          <Input aria-label="Search stock" placeholder="Search equipment…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
          <Select aria-label="Filter by category" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="w-52"><option value="">All categories</option>{EQUIPMENT_CATEGORIES.map((c) => <option key={c} value={c}>{EQUIPMENT_CATEGORY_LABELS[c]}</option>)}</Select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={low} onChange={(e) => { setLow(e.target.checked); setPage(1); }} />Low stock only</label>
          {can('inventory:edit') && <Button className="ml-auto" onClick={() => setMoving('new')}><ArrowDownUp className="h-4 w-4" />Record movement</Button>}
        </div>
        <ErrorNote error={error} />
        {isLoading ? <div className="flex justify-center py-14"><Spinner className="h-7 w-7" /></div> : !data?.data.length ? <EmptyState title={low ? 'Nothing is running low' : 'No equipment to stock yet'} description={low ? undefined : 'Add products under Equipment first.'} /> : (
          <>
            <Table>
              <thead><tr><Th>Product</Th><Th>Category</Th><Th className="text-right">On hand</Th><Th className="text-right">Reorder at</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr></thead>
              <tbody>{data.data.map((r) => (
                <tr key={r.id}>
                  <Td><p className="font-medium">{r.name}</p><p className="text-xs text-ink-muted">{r.manufacturer} · {r.modelNumber}{r.trackSerial ? ' · serial tracked' : ''}</p></Td>
                  <Td>{EQUIPMENT_CATEGORY_LABELS[r.category]}</Td>
                  <Td className="text-right font-medium">{n(r.quantityOnHand)} {r.unit}</Td><Td className="text-right text-ink-muted">{n(r.reorderLevel) || '—'}</Td>
                  <Td>{r.lowStock ? <Badge tone="red">Low stock</Badge> : <Badge tone="green">OK</Badge>}</Td>
                  <Td className="text-right">{can('inventory:edit') && <Button size="sm" variant="outline" onClick={() => setMoving(r.id)}>Move stock</Button>}</Td>
                </tr>))}</tbody>
            </Table>
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      {moving && <MovementModal preset={moving === 'new' ? undefined : moving} onClose={() => setMoving(null)} />}
    </>
  );
}

interface Movement { id: string; type: string; quantity: string; balanceAfter: string; reference: string | null; note: string | null; createdAt: string; equipment: { id: string; name: string; unit: string } }
function MovementsTab() {
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['movements', page, type], queryFn: () => api.get<Page<Movement>>(`/inventory/movements${qs({ page, pageSize: 20, type })}`), placeholderData: (p) => p });
  return (
    <Card>
      <div className="border-b border-surface-line px-5 py-4"><Select aria-label="Movement type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="w-48"><option value="">All movements</option>{MOVEMENT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select></div>
      {isLoading ? <div className="flex justify-center py-12"><Spinner /></div> : !data?.data.length ? <EmptyState title="No stock movements yet" /> : (
        <><Table><thead><tr><Th>When</Th><Th>Product</Th><Th>Type</Th><Th className="text-right">Change</Th><Th className="text-right">Balance</Th><Th>Reference</Th></tr></thead>
          <tbody>{data.data.map((m) => (
            <tr key={m.id}><Td className="whitespace-nowrap text-ink-muted">{formatDateTime(m.createdAt, locale)}</Td><Td>{m.equipment.name}</Td><Td><Badge tone={Number(m.quantity) < 0 ? 'red' : 'green'}>{label(m.type)}</Badge></Td>
              <Td className="text-right font-medium">{Number(m.quantity) > 0 ? '+' : ''}{n(m.quantity)}</Td><Td className="text-right">{n(m.balanceAfter)} {m.equipment.unit}</Td><Td className="text-ink-muted">{m.reference ?? m.note ?? '—'}</Td></tr>))}</tbody></Table>
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={setPage} /></>
      )}
    </Card>
  );
}

/* ───────── Purchase orders ───────── */
interface PoItem { id: string; equipmentId: string; quantity: string; receivedQuantity: string; unitCost: string; taxPercent: string; equipment: { id: string; name: string; unit: string; trackSerial: boolean } }
interface Po { id: string; number: string; status: string; subtotal: string; taxTotal: string; total: string; notes: string | null; expectedDate: string | null; supplier: { id: string; name: string }; items: PoItem[]; _count?: { items: number } }
const PO_TONE: Record<string, 'neutral' | 'blue' | 'yellow' | 'green' | 'red'> = { DRAFT: 'neutral', ORDERED: 'blue', PARTIALLY_RECEIVED: 'yellow', RECEIVED: 'green', CANCELLED: 'red' };

function NewPoModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const suppliers = useSuppliers();
  const options = useStockOptions();
  const [supplierId, setSupplier] = useState('');
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState([{ equipmentId: '', quantity: '', unitCost: '' }]);
  const setRow = (i: number, p: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const create = useMutation({
    mutationFn: () => api.post<Po>('/inventory/purchase-orders', { supplierId, expectedDate: expected ? new Date(expected).toISOString() : null, notes: notes || null, items: rows.map((r) => ({ equipmentId: r.equipmentId, quantity: Number(r.quantity), unitCost: Number(r.unitCost) })) }),
    onSuccess: (po) => { qc.invalidateQueries({ queryKey: ['pos'] }); qc.invalidateQueries({ queryKey: ['inventory'] }); onCreated(po.id); onClose(); },
  });
  const valid = supplierId && rows.every((r) => r.equipmentId && Number(r.quantity) > 0 && r.unitCost !== '');
  return (
    <Modal open wide title="New purchase order" onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate(); }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Supplier" htmlFor="po-sup"><Select id="po-sup" value={supplierId} onChange={(e) => setSupplier(e.target.value)} required><option value="">Select…</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Expected delivery" htmlFor="po-exp"><Input id="po-exp" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></Field>
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[2fr_1fr_1fr_auto] items-center gap-2">
              <Select aria-label={`Item ${i + 1}`} value={r.equipmentId} onChange={(e) => setRow(i, { equipmentId: e.target.value, unitCost: r.unitCost || options.data?.find((o) => o.id === e.target.value)?.purchasePrice.replace(/\.0+$/, '') || '' })}><option value="">Select item…</option>{options.data?.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.modelNumber})</option>)}</Select>
              <Input aria-label={`Item ${i + 1} quantity`} inputMode="decimal" placeholder="Qty" value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} />
              <Input aria-label={`Item ${i + 1} unit cost`} inputMode="decimal" placeholder="Unit cost" value={r.unitCost} onChange={(e) => setRow(i, { unitCost: e.target.value })} />
              {rows.length > 1 && <button type="button" aria-label={`Remove item ${i + 1}`} onClick={() => setRows((x) => x.filter((_, k) => k !== i))} className="rounded p-2 text-ink-muted hover:bg-surface-alt"><Trash2 className="h-4 w-4" /></button>}
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setRows((r) => [...r, { equipmentId: '', quantity: '', unitCost: '' }])}><Plus className="h-4 w-4" />Add item</Button>
        </div>
        <Field label="Notes" htmlFor="po-notes"><Input id="po-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <p className="text-xs text-ink-muted">Tax is calculated from each product's tax rate in your Settings and stored on the order.</p>
        <ErrorNote error={create.error} />
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={create.isPending} disabled={!valid}>Create draft</Button></div>
      </form>
    </Modal>
  );
}

function PoModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const money = useMoney();
  const { data: po, isLoading } = useQuery({ queryKey: ['po', id], queryFn: () => api.get<Po>(`/inventory/purchase-orders/${id}`) });
  const [recv, setRecv] = useState<Record<string, { qty: string; serials: string }>>({});
  const refresh = () => ['po', 'pos', 'inventory', 'stock-options', 'movements', 'serials', 'notifications'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const act = useMutation({ mutationFn: (a: 'order' | 'cancel') => api.post(`/inventory/purchase-orders/${id}/${a}`), onSuccess: refresh });
  const receive = useMutation({
    mutationFn: () => api.post(`/inventory/purchase-orders/${id}/receive`, { items: Object.entries(recv).filter(([, v]) => Number(v.qty) > 0).map(([itemId, v]) => ({ itemId, quantity: Number(v.qty), serials: v.serials.trim() ? lines(v.serials) : undefined })) }),
    onSuccess: () => { setRecv({}); refresh(); },
  });
  if (isLoading || !po) return <Modal open wide title="Purchase order" onClose={onClose}><div className="flex justify-center py-10"><Spinner /></div></Modal>;
  const canReceive = (po.status === 'ORDERED' || po.status === 'PARTIALLY_RECEIVED') && can('inventory:edit');
  const anyQty = Object.values(recv).some((v) => Number(v.qty) > 0);
  return (
    <Modal open wide title={`${po.number} · ${po.supplier.name}`} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2"><Badge tone={PO_TONE[po.status]}>{label(po.status)}</Badge>
          <div className="ml-auto flex gap-2">
            {po.status === 'DRAFT' && can('inventory:approve') && <Button variant="accent" size="sm" loading={act.isPending} onClick={() => act.mutate('order')}>Place order</Button>}
            {(po.status === 'DRAFT' || po.status === 'ORDERED') && can('inventory:approve') && <Button variant="outline" size="sm" onClick={() => { if (window.confirm('Cancel this purchase order?')) act.mutate('cancel'); }}>Cancel order</Button>}
          </div></div>
        <ErrorNote error={act.error ?? receive.error} />
        <Table>
          <thead><tr><Th>Item</Th><Th className="text-right">Ordered</Th><Th className="text-right">Received</Th><Th className="text-right">Unit cost</Th><Th className="text-right">Tax</Th>{canReceive && <Th>Receive now</Th>}</tr></thead>
          <tbody>{po.items.map((it) => {
            const remaining = n(it.quantity) - n(it.receivedQuantity);
            const v = recv[it.id] ?? { qty: '', serials: '' };
            return (
              <tr key={it.id}><Td>{it.equipment.name}</Td><Td className="text-right">{n(it.quantity)}</Td><Td className="text-right">{n(it.receivedQuantity)}</Td><Td className="text-right">{money(it.unitCost)}</Td><Td className="text-right">{n(it.taxPercent)}%</Td>
                {canReceive && <Td>{remaining > 0 ? (
                  <div className="space-y-1"><Input aria-label={`Receive ${it.equipment.name}`} inputMode="decimal" placeholder={`up to ${remaining}`} value={v.qty} onChange={(e) => setRecv((r) => ({ ...r, [it.id]: { ...v, qty: e.target.value } }))} className="h-9 w-28" />
                    {it.equipment.trackSerial && <Textarea aria-label={`Serial numbers for ${it.equipment.name}`} placeholder="Serials, one per line" value={v.serials} onChange={(e) => setRecv((r) => ({ ...r, [it.id]: { ...v, serials: e.target.value } }))} className="min-h-[56px] w-44 font-mono text-xs" />}</div>
                ) : <Badge tone="green">Complete</Badge>}</Td>}</tr>);
          })}</tbody>
        </Table>
        <div className="ml-auto w-64 space-y-1 text-sm"><p className="flex justify-between"><span className="text-ink-muted">Subtotal</span>{money(po.subtotal)}</p><p className="flex justify-between"><span className="text-ink-muted">Tax</span>{money(po.taxTotal)}</p><p className="flex justify-between border-t border-surface-line pt-1 font-semibold"><span>Total</span>{money(po.total)}</p></div>
        {canReceive && <div className="flex justify-end"><Button variant="accent" loading={receive.isPending} disabled={!anyQty} onClick={() => receive.mutate()}>Receive goods into stock</Button></div>}
      </div>
    </Modal>
  );
}

function PurchaseOrdersTab() {
  const can = useAuth((s) => s.can);
  const money = useMoney();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['pos', page, status], queryFn: () => api.get<Page<Po>>(`/inventory/purchase-orders${qs({ page, pageSize: 15, status })}`), placeholderData: (p) => p });
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-surface-line px-5 py-4">
        <Select aria-label="PO status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-52"><option value="">All statuses</option>{Object.keys(PO_TONE).map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
        {can('inventory:create') && <Button className="ml-auto" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New purchase order</Button>}
      </div>
      <ErrorNote error={error} />
      {isLoading ? <div className="flex justify-center py-12"><Spinner /></div> : !data?.data.length ? <EmptyState title="No purchase orders" description="Create an order to buy stock from a supplier." /> : (
        <><Table><thead><tr><Th>Number</Th><Th>Supplier</Th><Th>Status</Th><Th className="text-right">Items</Th><Th className="text-right">Total</Th></tr></thead>
          <tbody>{data.data.map((p) => (
            <tr key={p.id} className="cursor-pointer hover:bg-surface-alt" onClick={() => setOpen(p.id)}><Td className="font-medium">{p.number}</Td><Td>{p.supplier.name}</Td><Td><Badge tone={PO_TONE[p.status]}>{label(p.status)}</Badge></Td><Td className="text-right">{p._count?.items}</Td><Td className="text-right">{money(p.total)}</Td></tr>))}</tbody></Table>
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={setPage} /></>
      )}
      {creating && <NewPoModal onClose={() => setCreating(false)} onCreated={setOpen} />}
      {open && <PoModal id={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

interface Serial { id: string; serial: string; status: string; equipment: { id: string; name: string }; createdAt: string }
function SerialsTab() {
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const q = useDebounced(search);
  const { data, isLoading } = useQuery({ queryKey: ['serials', page, q, status], queryFn: () => api.get<Page<Serial>>(`/inventory/serials${qs({ page, pageSize: 20, search: q, status })}`), placeholderData: (p) => p });
  const upd = useMutation({ mutationFn: (v: { id: string; status: string }) => api.patch(`/inventory/serials/${v.id}`, { status: v.status }), onSuccess: () => qc.invalidateQueries({ queryKey: ['serials'] }) });
  return (
    <Card>
      <div className="flex flex-wrap gap-2 border-b border-surface-line px-5 py-4">
        <Input aria-label="Search serial" placeholder="Search serial number…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
        <Select aria-label="Serial status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-44"><option value="">All statuses</option>{SERIAL_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
      </div>
      <ErrorNote error={upd.error} />
      {isLoading ? <div className="flex justify-center py-12"><Spinner /></div> : !data?.data.length ? <EmptyState title="No serial numbers" description="Mark a product as serial-tracked, then receive stock with serial numbers." /> : (
        <><Table><thead><tr><Th>Serial</Th><Th>Product</Th><Th>Status</Th></tr></thead>
          <tbody>{data.data.map((s) => (
            <tr key={s.id}><Td className="font-mono text-xs">{s.serial}</Td><Td>{s.equipment.name}</Td>
              <Td>{can('inventory:edit') ? <Select aria-label={`Status of ${s.serial}`} value={s.status} onChange={(e) => upd.mutate({ id: s.id, status: e.target.value })} className="h-9 w-40">{SERIAL_STATUSES.map((x) => <option key={x} value={x}>{label(x)}</option>)}</Select> : <Badge>{label(s.status)}</Badge>}</Td></tr>))}</tbody></Table>
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={setPage} /></>
      )}
    </Card>
  );
}

export function InventoryPage() {
  const [tab, setTab] = useState<'stock' | 'movements' | 'pos' | 'serials'>('stock');
  return (
    <>
      <PageHeader title="Inventory" description="Stock levels, movements, purchase orders and serial numbers" />
      <Tabs tabs={[{ id: 'stock', label: 'Stock' }, { id: 'movements', label: 'Movements' }, { id: 'pos', label: 'Purchase orders' }, { id: 'serials', label: 'Serial numbers' }]} value={tab} onChange={setTab} />
      {tab === 'stock' && <StockTab />}{tab === 'movements' && <MovementsTab />}{tab === 'pos' && <PurchaseOrdersTab />}{tab === 'serials' && <SerialsTab />}
    </>
  );
}
