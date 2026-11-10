import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { RULE_BASIS_LABELS } from '@solarflow/shared';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { dateOnly, label, useLocale, type Page } from '@/lib/format';
import { Badge, Button, Card, CardBody, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { Notice, useDebounced } from '@/components/ui/extra';
import { useCatalogue, useCommercialOptions, type BomRow, type DocItem } from '@/features/commercial/api';
import { LineEditor, TotalsBox, itemsProblem, toPayload, usePreview } from '@/features/commercial/LineEditor';

interface DesignOption { id: string; name: string; latest: { version: number; validPanelCount: number; installedKwp: string } | null; customer?: { name: string } | null }
interface Rule { equipmentId: string; basis: 'PER_PANEL' | 'PER_KWP' | 'FIXED'; quantity: string }

function GenerateModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const designs = useQuery({ queryKey: ['design-options'], queryFn: () => api.get<Page<DesignOption>>(`/solar-designs${qs({ pageSize: 100 })}`).then((r) => r.data) });
  const catalogue = useCatalogue();
  const [designId, setDesignId] = useState('');
  const [name, setName] = useState('');
  const [rules, setRules] = useState<Rule[]>([]);
  const [result, setResult] = useState<{ id: string; warnings: { description: string; message: string }[] } | null>(null);
  const usable = designs.data?.filter((d) => d.latest) ?? [];
  const gen = useMutation({
    mutationFn: () => api.post<{ bom: { id: string }; warnings: { description: string; message: string }[] }>('/boms/generate', { designId, name: name || undefined, rules: rules.filter((r) => r.equipmentId && Number(r.quantity) > 0).map((r) => ({ ...r, quantity: Number(r.quantity) })) }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['boms'] }); if (r.warnings.length) setResult({ id: r.bom.id, warnings: r.warnings }); else nav(`/bom/${r.bom.id}`); },
  });
  return (
    <Modal open wide title="Generate BOM from a design" onClose={onClose}>
      {result ? (
        <div className="space-y-3">
          <Notice tone="warn">The BOM was created, but {result.warnings.length} line(s) need attention before they can be quoted:</Notice>
          <ul className="list-disc space-y-1 pl-5 text-sm">{result.warnings.map((w, i) => <li key={i}><strong>{w.description}</strong>: {w.message}</li>)}</ul>
          <div className="flex justify-end"><Button onClick={() => nav(`/bom/${result.id}`)}>Open BOM</Button></div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); gen.mutate(); }}>
          <p className="text-sm text-ink-muted">Lists the valid panels in the design's latest saved version, plus any catalogue equipment placed on the plan. Panel types and equipment linked to your catalogue come with your selling price and tax code. Add quantity rules below for items the design cannot know (structure, cable, protection).</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Design" htmlFor="g-design"><Select id="g-design" value={designId} onChange={(e) => setDesignId(e.target.value)} required>
              <option value="">Select a saved design…</option>
              {usable.map((d) => <option key={d.id} value={d.id}>{d.name}: v{d.latest!.version}, {d.latest!.validPanelCount} panels, {d.latest!.installedKwp} kWp</option>)}
            </Select></Field>
            <Field label="BOM name (optional)" htmlFor="g-name"><Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          </div>
          {designs.data && !usable.length && <Notice tone="warn">No design has a saved version yet. Open a design in the 2D designer and save it first.</Notice>}
          <div>
            <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Quantity rules (optional)</h3><Button variant="outline" size="sm" onClick={() => setRules([...rules, { equipmentId: '', basis: 'PER_PANEL', quantity: '1' }])}><Plus className="h-4 w-4" />Add rule</Button></div>
            {rules.map((r, k) => (
              <div key={k} className="mb-2 grid grid-cols-[1fr_8rem_6rem_2.5rem] gap-2">
                <Select aria-label={`Rule ${k + 1} item`} value={r.equipmentId} onChange={(e) => setRules(rules.map((x, i) => (i === k ? { ...x, equipmentId: e.target.value } : x)))}>
                  <option value="">Catalogue item…</option>{catalogue.data?.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.unit})</option>)}
                </Select>
                <Select aria-label={`Rule ${k + 1} basis`} value={r.basis} onChange={(e) => setRules(rules.map((x, i) => (i === k ? { ...x, basis: e.target.value as Rule['basis'] } : x)))}>
                  {(Object.keys(RULE_BASIS_LABELS) as Rule['basis'][]).map((b) => <option key={b} value={b}>{RULE_BASIS_LABELS[b]}</option>)}
                </Select>
                <Input aria-label={`Rule ${k + 1} quantity`} inputMode="decimal" value={r.quantity} onChange={(e) => setRules(rules.map((x, i) => (i === k ? { ...x, quantity: e.target.value } : x)))} />
                <Button variant="ghost" size="sm" aria-label={`Remove rule ${k + 1}`} onClick={() => setRules(rules.filter((_, i) => i !== k))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            {!!rules.length && <p className="text-xs text-ink-muted">Whole-unit items (nos) round up. Per-kWp and per-panel rules use the valid panels in the design.</p>}
          </div>
          <ErrorNote error={gen.error} />
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={gen.isPending} disabled={!designId}>Generate</Button></div>
        </form>
      )}
    </Modal>
  );
}

export function BomListPage() {
  const can = useAuth((s) => s.can);
  const locale = useLocale();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [generating, setGenerating] = useState(false);
  const q = useDebounced(search);
  const { data, isLoading, error } = useQuery({ queryKey: ['boms', page, q], queryFn: () => api.get<Page<BomRow>>(`/boms${qs({ page, pageSize: 15, search: q })}`), placeholderData: (p) => p });
  return (
    <div>
      <PageHeader title="Bill of materials" description="Quantities taken from your saved designs, priced from your equipment catalogue." actions={can('bom:create') ? <Button onClick={() => setGenerating(true)}><Plus className="h-4 w-4" />Generate from design</Button> : undefined} />
      <Card>
        <div className="border-b border-surface-line px-5 py-4"><Input aria-label="Search BOMs" placeholder="Search by number or name…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" /></div>
        <ErrorNote error={error} />
        {isLoading ? <div className="flex justify-center py-12"><Spinner /></div> : !data?.data.length ? (
          <EmptyState title="No BOMs yet" description="Generate one from a saved design to start a quotation." action={can('bom:create') ? <Button onClick={() => setGenerating(true)}>Generate from design</Button> : undefined} />
        ) : (
          <>
            <Table>
              <thead><tr><Th>Number</Th><Th>Name</Th><Th>Customer</Th><Th>Design</Th><Th className="text-right">kWp</Th><Th className="text-right">Lines</Th><Th>Status</Th><Th>Updated</Th></tr></thead>
              <tbody>{data.data.map((b) => (
                <tr key={b.id} className="hover:bg-surface-alt/50">
                  <Td><Link className="font-medium text-brand hover:underline" to={`/bom/${b.id}`}>{b.number}</Link></Td>
                  <Td>{b.name}</Td><Td>{b.customer?.name ?? '—'}</Td>
                  <Td>{b.design ? `${b.design.name}${b.designVersion ? ` v${b.designVersion}` : ''}` : 'Manual'}</Td>
                  <Td className="text-right tabular-nums">{Number(b.kwp) || '—'}</Td><Td className="text-right">{b._count?.items ?? 0}</Td>
                  <Td><Badge tone={b.status === 'FINAL' ? 'green' : 'neutral'}>{label(b.status)}</Badge></Td><Td>{dateOnly(b.updatedAt, locale)}</Td>
                </tr>
              ))}</tbody>
            </Table>
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={setPage} />
          </>
        )}
      </Card>
      {generating && <GenerateModal onClose={() => setGenerating(false)} />}
    </div>
  );
}

export function BomDetailPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const { data: opts } = useCommercialOptions();
  const bom = useQuery({ queryKey: ['bom', id], queryFn: () => api.get<BomRow>(`/boms/${id}`) });
  const [items, setItems] = useState<DocItem[]>([]);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => { if (bom.data) { setItems(bom.data.items); setName(bom.data.name); setNotes(bom.data.notes ?? ''); } }, [bom.data]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['bom', id] }); qc.invalidateQueries({ queryKey: ['boms'] }); };
  const save = useMutation({ mutationFn: () => api.put(`/boms/${id}`, { name, notes: notes || null, customerId: bom.data?.customer?.id ?? null, status: 'DRAFT', items: toPayload(items) }), onSuccess: refresh });
  const setStatus = useMutation({ mutationFn: (status: 'DRAFT' | 'FINAL') => api.post(`/boms/${id}/status`, { status }), onSuccess: refresh });
  const del = useMutation({ mutationFn: () => api.delete(`/boms/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ['boms'] }); nav('/bom'); } });
  const preview = usePreview(items);
  if (bom.isLoading) return <div className="flex justify-center py-16"><Spinner className="h-8 w-8" /></div>;
  if (!bom.data) return <ErrorNote error={bom.error} />;
  const b = bom.data;
  const editable = b.status === 'DRAFT' && can('bom:edit');
  const problem = itemsProblem(items);
  const unpriced = items.filter((i) => !(Number(i.unitPrice) > 0)).length;
  return (
    <div>
      <PageHeader title={`${b.number}: ${b.name}`} description={b.design ? `From design "${b.design.name}" v${b.designVersion}: ${b.panelCount} panels, ${Number(b.kwp)} kWp` : 'Manual BOM'}
        actions={<>
          <Badge tone={b.status === 'FINAL' ? 'green' : 'neutral'}>{label(b.status)}</Badge>
          {can('quotation:create') && <Button variant="accent" onClick={() => nav(`/quotations/new?bomId=${b.id}`)}>Create quotation</Button>}
        </>} />
      <ErrorNote error={save.error ?? setStatus.error ?? del.error} />
      {unpriced > 0 && <div className="mb-4"><Notice tone="warn">{unpriced} line(s) have no price. Link the item to your catalogue or enter a price before quoting.</Notice></div>}
      <Card>
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="b-name"><Input id="b-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} /></Field>
            <Field label="Customer"><Input value={b.customer?.name ?? '—'} disabled /></Field>
            <div className="sm:col-span-2"><Field label="Notes" htmlFor="b-notes"><Textarea id="b-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editable} /></Field></div>
          </div>
          <LineEditor items={items} onChange={setItems} readOnly={!editable} showCost={!!opts?.canSeeCost} />
          {preview && <TotalsBox t={preview} showMargin />}
          <p className="text-xs text-ink-muted">Quantities come from a preliminary design and the rules you entered. Confirm against the site survey before ordering. Totals here are a preview; tax is applied from your tax settings.</p>
          <div className="flex flex-wrap justify-between gap-2 border-t border-surface-line pt-4">
            <div>{can('bom:delete') && <Button variant="ghost" onClick={() => { if (confirm('Delete this BOM?')) del.mutate(); }} loading={del.isPending}><Trash2 className="h-4 w-4" />Delete</Button>}</div>
            <div className="flex gap-2">
              {can('bom:edit') && b.status === 'FINAL' && <Button variant="outline" onClick={() => setStatus.mutate('DRAFT')} loading={setStatus.isPending}>Reopen as draft</Button>}
              {editable && <Button variant="outline" onClick={() => save.mutate()} loading={save.isPending} disabled={!!problem}>Save changes</Button>}
              {editable && <Button onClick={async () => { await save.mutateAsync(); setStatus.mutate('FINAL'); }} disabled={!!problem || setStatus.isPending}>Save and mark final</Button>}
            </div>
          </div>
          {problem && editable && <p className="text-xs text-amber-700">{problem}</p>}
        </CardBody>
      </Card>
    </div>
  );
}
