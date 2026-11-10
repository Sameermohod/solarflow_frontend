import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { DOCUMENT_STATUSES, DOCUMENT_STATUS_LABELS, PLACEHOLDERS } from '@solarflow/shared';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { label, type Page } from '@/lib/format';
import { useCustomerOptions } from '@/lib/hooks';
import { useDebounced, Tabs } from '@/components/ui/extra';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { DOC_TONE } from './common';

interface Tpl { id: string; name: string; category: string; jurisdiction: string | null; version: number; status: string; updatedAt: string }
interface DocRow { id: string; number: string; title: string; status: string; version: number; templateId: string | null; updatedAt: string; customer: { id: string; name: string } | null; project: { id: string; number: string } | null }
interface Pack { id: string; name: string; jurisdiction: string; description: string | null; isActive: boolean; items: { title: string; templateId: string; required: boolean }[] }

const useTemplates = (status?: string) => useQuery({ queryKey: ['doc-templates', status ?? ''], queryFn: () => api.get<Page<Tpl>>(`/documents/templates${qs({ pageSize: 100, status })}`).then((r) => r.data) });

function NewDocumentModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const nav = useNavigate(); const qc = useQueryClient(); const can = useAuth((s) => s.can);
  const templates = useTemplates('ACTIVE'); const customers = useCustomerOptions();
  const projects = useQuery({ queryKey: ['projects-pick'], enabled: can('project:view'), queryFn: () => api.get<Page<{ id: string; number: string; name: string }>>(`/projects${qs({ pageSize: 100 })}`).then((r) => r.data) });
  const [f, setF] = useState({ title: '', templateId: '', customerId: '', projectId, content: '' });
  const m = useMutation({
    mutationFn: () => api.post<{ id: string; missing: string[] }>('/documents', { title: f.title, templateId: f.templateId || null, customerId: f.customerId || null, projectId: f.projectId || null, content: f.templateId ? undefined : f.content }),
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: ['documents'] }); nav(`/documents/${d.id}`); },
  });
  return (
    <Modal open wide title="New document" onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Template" hint="Only active templates are listed"><Select value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })}><option value="">Write it myself</option>{templates.data?.map((t) => <option key={t.id} value={t.id}>{t.name}{t.jurisdiction ? ` (${t.jurisdiction})` : ''}</option>)}</Select></Field>
        <Field label="Customer (fills customer details)"><Select value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}><option value="">None</option>{customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Project (fills project details)"><Select value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value })}><option value="">None</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}</Select></Field>
      </div>
      {!f.templateId && <div className="mt-3"><Field label="Content"><Textarea rows={8} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} /></Field></div>}
      <ErrorNote error={m.error} />
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="accent" loading={m.isPending} disabled={f.title.trim().length < 2 || (!f.templateId && !f.content.trim())} onClick={() => m.mutate()}>Create</Button></div>
    </Modal>
  );
}

function DocumentsList({ projectId }: { projectId: string }) {
  const can = useAuth((s) => s.can);
  const [page, setPage] = useState(1); const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [adding, setAdding] = useState(false);
  const q = useDebounced(search);
  const { data, isLoading, error } = useQuery({ queryKey: ['documents', page, q, status, projectId], queryFn: () => api.get<Page<DocRow>>(`/documents${qs({ page, pageSize: 15, search: q, status, projectId })}`), placeholderData: (p) => p });
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b border-surface-line px-5 py-4">
        <Input aria-label="Search documents" placeholder="Search number or title…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="max-w-[12rem]"><option value="">All statuses</option>{DOCUMENT_STATUSES.map((s) => <option key={s} value={s}>{DOCUMENT_STATUS_LABELS[s]}</option>)}</Select>
        {projectId && <span className="text-xs text-ink-muted">Filtered to one project. <Link className="text-brand hover:underline" to="/documents">Show all</Link></span>}
        {can('document:create') && <Button size="sm" className="ml-auto" onClick={() => setAdding(true)}>New document</Button>}
      </div>
      <ErrorNote error={error} />
      {isLoading ? <div className="flex justify-center py-12"><Spinner /></div> : !data?.data.length ? <EmptyState title="No documents" description="Create one from a template: customer and project details fill in automatically." /> : (
        <>
          <Table>
            <thead><tr><Th>Number</Th><Th>Title</Th><Th>Customer</Th><Th>Project</Th><Th>Version</Th><Th>Status</Th></tr></thead>
            <tbody>{data.data.map((d) => (
              <tr key={d.id} className="hover:bg-surface-alt/50"><Td><Link className="font-medium text-brand hover:underline" to={`/documents/${d.id}`}>{d.number}</Link></Td><Td>{d.title}</Td><Td>{d.customer?.name ?? '—'}</Td><Td>{d.project?.number ?? '—'}</Td><Td>{d.version}</Td><Td><Badge tone={DOC_TONE[d.status]}>{DOCUMENT_STATUS_LABELS[d.status as keyof typeof DOCUMENT_STATUS_LABELS]}</Badge></Td></tr>
            ))}</tbody>
          </Table>
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={setPage} />
        </>
      )}
      {adding && <NewDocumentModal projectId={projectId} onClose={() => setAdding(false)} />}
    </Card>
  );
}

function TemplateModal({ id, onClose }: { id: string | 'new'; onClose: () => void }) {
  const qc = useQueryClient(); const can = useAuth((s) => s.can);
  const cur = useQuery({ queryKey: ['doc-template', id], enabled: id !== 'new', queryFn: () => api.get<Tpl & { body: string }>(`/documents/templates/${id}`) });
  const [f, setF] = useState<{ name: string; category: string; jurisdiction: string; body: string; status: string } | null>(id === 'new' ? { name: '', category: 'GENERAL', jurisdiction: '', body: '', status: 'DRAFT' } : null);
  const form = f ?? (cur.data ? { name: cur.data.name, category: cur.data.category, jurisdiction: cur.data.jurisdiction ?? '', body: cur.data.body, status: cur.data.status } : null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const m = useMutation({
    mutationFn: () => (id === 'new' ? api.post('/documents/templates', { ...form, jurisdiction: form!.jurisdiction || null }) : api.patch(`/documents/templates/${id}`, { ...form, jurisdiction: form!.jurisdiction || null })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['doc-templates'] }); onClose(); },
  });
  if (!form) return <Modal open title="Template" onClose={onClose}><Spinner /></Modal>;
  const set = (k: keyof typeof form, v: string) => setF({ ...form, [k]: v });
  const insert = (key: string) => { const t = ta.current; const s = t?.selectionStart ?? form.body.length; const e = t?.selectionEnd ?? s; set('body', `${form.body.slice(0, s)}{{${key}}}${form.body.slice(e)}`); };
  return (
    <Modal open wide title={id === 'new' ? 'New template' : 'Edit template'} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name"><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Category"><Input value={form.category} onChange={(e) => set('category', e.target.value.toUpperCase())} /></Field>
        <Field label="Jurisdiction (optional)" hint="e.g. a state, utility or country"><Input value={form.jurisdiction} onChange={(e) => set('jurisdiction', e.target.value)} /></Field>
      </div>
      <div className="mt-3">
        <Field label="Text" hint="Insert placeholders where details should be filled automatically"><Textarea ref={ta} rows={12} value={form.body} onChange={(e) => set('body', e.target.value)} /></Field>
        <div className="mt-2 flex flex-wrap gap-1">{PLACEHOLDERS.map(([k, l]) => <button key={k} type="button" title={l} className="rounded bg-surface-alt px-2 py-0.5 text-[11px] hover:bg-surface-line" onClick={() => insert(k)}>{k}</button>)}</div>
      </div>
      <div className="mt-3 max-w-xs"><Field label="Status" hint={can('document:approve') ? 'Only active templates can be used for new documents' : 'Activating needs approval rights'}><Select value={form.status} onChange={(e) => set('status', e.target.value)}><option value="DRAFT">Draft</option>{can('document:approve') && <option value="ACTIVE">Active</option>}<option value="ARCHIVED">Archived</option></Select></Field></div>
      <ErrorNote error={m.error} />
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={form.name.trim().length < 2 || !form.body.trim()} onClick={() => m.mutate()}>Save template</Button></div>
    </Modal>
  );
}

function Templates() {
  const can = useAuth((s) => s.can); const qc = useQueryClient();
  const list = useTemplates(); const [edit, setEdit] = useState<string | null>(null);
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/documents/templates/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['doc-templates'] }) });
  return (
    <Card>
      <CardHeader title="Templates" description="Text with placeholders such as {{customer.name}}. New documents fill them in from your records." action={can('document:create') ? <Button size="sm" onClick={() => setEdit('new')}>New template</Button> : undefined} />
      <ErrorNote error={del.error} />
      {list.isLoading ? <div className="flex justify-center py-12"><Spinner /></div> : !list.data?.length ? <EmptyState title="No templates yet" description="Write your letters, applications and certificates once and reuse them." /> : (
        <Table>
          <thead><tr><Th>Name</Th><Th>Category</Th><Th>Jurisdiction</Th><Th>Version</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>{list.data.map((t) => (
            <tr key={t.id}><Td><button type="button" className="font-medium text-brand hover:underline" onClick={() => setEdit(t.id)}>{t.name}</button></Td><Td>{label(t.category)}</Td><Td>{t.jurisdiction ?? '—'}</Td><Td>{t.version}</Td><Td><Badge tone={t.status === 'ACTIVE' ? 'green' : t.status === 'ARCHIVED' ? 'neutral' : 'yellow'}>{label(t.status)}</Badge></Td>
              <Td>{can('document:delete') && <Button size="icon" variant="ghost" aria-label={`Archive ${t.name}`} onClick={() => del.mutate(t.id)}><Trash2 className="h-4 w-4" /></Button>}</Td></tr>
          ))}</tbody>
        </Table>
      )}
      {edit && <TemplateModal id={edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function PackModal({ pack, onClose }: { pack: Pack | null; onClose: () => void }) {
  const qc = useQueryClient(); const templates = useTemplates();
  const [f, setF] = useState({ name: pack?.name ?? '', jurisdiction: pack?.jurisdiction ?? '', description: pack?.description ?? '', isActive: pack?.isActive ?? true, items: pack?.items ?? [{ title: '', templateId: '', required: true }] });
  const m = useMutation({
    mutationFn: () => (pack ? api.put(`/documents/packs/${pack.id}`, f) : api.post('/documents/packs', f)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['packs'] }); onClose(); },
  });
  const setItem = (i: number, patch: Partial<Pack['items'][number]>) => setF({ ...f, items: f.items.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  return (
    <Modal open wide title={pack ? 'Edit regulatory pack' : 'New regulatory pack'} onClose={onClose}>
      <p className="mb-3 text-sm text-ink-muted">A pack lists the documents a jurisdiction or utility requires. Each item is made from one of your templates. SolarFlow does not ship regulatory wording: you write the templates to match your authority's current rules.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Pack name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Jurisdiction"><Input value={f.jurisdiction} onChange={(e) => setF({ ...f, jurisdiction: e.target.value })} placeholder="State, country or utility" /></Field>
      </div>
      <div className="mt-3 space-y-2">
        {f.items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-2">
            <Input aria-label={`Document ${i + 1} title`} placeholder="Document title" value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} />
            <Select aria-label={`Template for document ${i + 1}`} value={it.templateId} onChange={(e) => setItem(i, { templateId: e.target.value })}><option value="">Template…</option>{templates.data?.filter((t) => t.status !== 'ARCHIVED').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={it.required} onChange={(e) => setItem(i, { required: e.target.checked })} />Required</label>
            <Button size="icon" variant="ghost" aria-label={`Remove document ${i + 1}`} onClick={() => setF({ ...f, items: f.items.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => setF({ ...f, items: [...f.items, { title: '', templateId: '', required: true }] })}>Add document</Button>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />Active</label>
      <ErrorNote error={m.error} />
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={f.name.trim().length < 2 || f.jurisdiction.trim().length < 2 || !f.items.length || f.items.some((i) => i.title.trim().length < 2 || !i.templateId)} onClick={() => m.mutate()}>Save pack</Button></div>
    </Modal>
  );
}

function ApplyPackModal({ pack, onClose }: { pack: Pack; onClose: () => void }) {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: ['projects-pick'], queryFn: () => api.get<Page<{ id: string; number: string; name: string }>>(`/projects${qs({ pageSize: 100 })}`).then((r) => r.data) });
  const [pid, setPid] = useState('');
  const check = useQuery({ queryKey: ['pack-check', pack.id, pid], enabled: !!pid, queryFn: () => api.get<{ items: { title: string; required: boolean; document: { id: string; number: string; status: string } | null }[] }>(`/documents/packs/${pack.id}/checklist?projectId=${pid}`) });
  const m = useMutation({ mutationFn: () => api.post<{ created: { id: string; title: string; missing: string[] }[]; skipped: string[] }>(`/documents/packs/${pack.id}/apply`, { projectId: pid }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents'] }); qc.invalidateQueries({ queryKey: ['pack-check', pack.id, pid] }); } });
  return (
    <Modal open wide title={`Apply "${pack.name}" to a project`} onClose={onClose}>
      <Field label="Project"><Select value={pid} onChange={(e) => setPid(e.target.value)}><option value="">Choose…</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}</Select></Field>
      {check.data && (
        <ul className="mt-3 divide-y divide-surface-line rounded-lg border border-surface-line text-sm">
          {check.data.items.map((i) => <li key={i.title} className="flex items-center justify-between px-3 py-2"><span>{i.title}{i.required ? '' : <span className="ml-1 text-xs text-ink-muted">(optional)</span>}</span>{i.document ? <Link className="text-brand hover:underline" to={`/documents/${i.document.id}`}><Badge tone={DOC_TONE[i.document.status]}>{label(i.document.status)}</Badge> {i.document.number}</Link> : <span className="text-xs text-amber-700">Not created</span>}</li>)}
        </ul>
      )}
      {m.data && <p role="status" className="mt-3 rounded bg-green-50 px-3 py-2 text-sm text-green-800">{m.data.created.length} draft document(s) created{m.data.skipped.length ? `, ${m.data.skipped.length} already existed` : ''}.{m.data.created.some((c) => c.missing.length) ? ' Some documents have values still to fill in: open them to complete.' : ''}</p>}
      <ErrorNote error={m.error} />
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Close</Button><Button variant="accent" loading={m.isPending} disabled={!pid} onClick={() => m.mutate()}>Create missing documents</Button></div>
    </Modal>
  );
}

function Packs() {
  const can = useAuth((s) => s.can); const qc = useQueryClient();
  const list = useQuery({ queryKey: ['packs'], queryFn: () => api.get<{ data: Pack[] }>('/documents/packs/all').then((r) => r.data) });
  const [edit, setEdit] = useState<Pack | 'new' | null>(null); const [apply, setApply] = useState<Pack | null>(null);
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/documents/packs/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['packs'] }) });
  return (
    <Card>
      <CardHeader title="Regulatory packs" description="The set of documents a jurisdiction or utility needs, made from your templates." action={can('document:create') ? <Button size="sm" onClick={() => setEdit('new')}>New pack</Button> : undefined} />
      <ErrorNote error={del.error} />
      {list.isLoading ? <div className="flex justify-center py-12"><Spinner /></div> : !list.data?.length ? <EmptyState title="No packs configured" description="Create templates first, then group them into a pack for each jurisdiction." /> : (
        <ul className="divide-y divide-surface-line">{list.data.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
            <div className="min-w-0 flex-1"><p className="font-medium">{p.name} <span className="font-normal text-ink-muted">· {p.jurisdiction}</span> {!p.isActive && <Badge>Inactive</Badge>}</p><p className="text-xs text-ink-muted">{p.items.length} document(s): {p.items.map((i) => i.title).join(', ')}</p></div>
            {can('document:create') && p.isActive && <Button size="sm" variant="outline" onClick={() => setApply(p)}>Apply to project</Button>}
            {can('document:edit') && <Button size="sm" variant="ghost" onClick={() => setEdit(p)}>Edit</Button>}
            {can('document:delete') && <Button size="icon" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => del.mutate(p.id)}><Trash2 className="h-4 w-4" /></Button>}
          </li>
        ))}</ul>
      )}
      {edit && <PackModal pack={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {apply && <ApplyPackModal pack={apply} onClose={() => setApply(null)} />}
    </Card>
  );
}

export function DocumentsPage() {
  const [sp] = useSearchParams();
  const [tab, setTab] = useState<'documents' | 'templates' | 'packs'>('documents');
  return (
    <div>
      <PageHeader title="Documents" description="Template-driven documents with versions and approval, and regulatory packs per jurisdiction." />
      <div className="mb-4"><Tabs tabs={[{ id: 'documents', label: 'Documents' }, { id: 'templates', label: 'Templates' }, { id: 'packs', label: 'Regulatory packs' }]} value={tab} onChange={setTab} /></div>
      {tab === 'documents' && <DocumentsList projectId={sp.get('projectId') ?? ''} />}{tab === 'templates' && <Templates />}{tab === 'packs' && <Packs />}
    </div>
  );
}
