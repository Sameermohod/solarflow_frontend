import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, Upload } from 'lucide-react';
import { PRIORITIES, PROJECT_STATUS_LABELS, PROJECT_TRANSITIONS, SEVERITIES, TASK_STATUSES, TASK_STATUS_LABELS } from '@solarflow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { fileSize, label, useLocale } from '@/lib/format';
import { Tabs } from '@/components/ui/extra';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { useCatalogue, useMoney2 } from '@/features/commercial/api';
import { AuthImage, countBadge, PRIORITY_TONE, PROJECT_TONE, TASK_TONE, UserSelect, dateInput, showDate, todayYmd, useNames } from './common';
import { ProgressBar } from './ProjectsPage';

interface Detail {
  id: string; number: string; name: string; status: string; siteAddress: string | null; capacityKw: string | null; managerId: string | null; startDate: string | null; targetDate: string | null; completedAt: string | null; notes: string | null; progress: number; expenseTotal: number;
  customer: { id: string; name: string; phone: string | null; email: string | null };
  milestones: { id: string; name: string; dueDate: string | null; weight: number; completedAt: string | null }[];
  tasks: { id: string; title: string; description: string | null; status: string; priority: string; assigneeId: string | null; dueDate: string | null; milestoneId: string | null }[];
  materials: { id: string; equipmentId: string; quantityPlanned: string; quantityIssued: string; quantityReturned: string; equipment: { id: string; name: string; manufacturer: string; modelNumber: string; unit: string; trackSerial: boolean } }[];
  expenses: { id: string; description: string; category: string | null; amount: string; incurredOn: string }[];
  issues: { id: string; title: string; description: string | null; severity: string; status: string; resolution: string | null; createdAt: string }[];
  photos: { id: string; fileName: string; caption: string | null; sizeBytes: number; createdAt: string }[];
}
type TabId = 'overview' | 'tasks' | 'materials' | 'expenses' | 'issues' | 'photos';

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const locale = useLocale();
  const money = useMoney2();
  const { name } = useNames();
  const [tab, setTab] = useState<TabId>('overview');
  const [modal, setModal] = useState<null | 'task' | 'edit' | 'plan' | { kind: 'issue' | 'return'; materialId: string } | { kind: 'resolve'; issueId: string }>(null);
  const { data: p, isLoading, error } = useQuery({ queryKey: ['project', id], queryFn: () => api.get<Detail>(`/projects/${id}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['project', id] }); qc.invalidateQueries({ queryKey: ['projects'] }); };
  const run = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh });
  const edit = can('project:edit');
  if (isLoading) return <div className="flex justify-center py-16"><Spinner className="h-8 w-8" /></div>;
  if (!p) return <ErrorNote error={error} />;
  const next = PROJECT_TRANSITIONS[p.status] ?? [];
  const open = p.tasks.filter((t) => t.status !== 'DONE').length;

  return (
    <div>
      <PageHeader title={`${p.number} · ${p.name}`} description={`${p.customer.name}${p.siteAddress ? ` · ${p.siteAddress}` : ''}`}
        actions={<>
          <Badge tone={PROJECT_TONE[p.status]}>{PROJECT_STATUS_LABELS[p.status as keyof typeof PROJECT_STATUS_LABELS]}</Badge>
          {edit && next.map((s) => <Button key={s} size="sm" variant={s === 'COMPLETED' ? 'accent' : 'outline'} loading={run.isPending} onClick={() => run.mutate(() => api.post(`/projects/${id}/status`, { status: s }))}>{s === 'COMPLETED' ? 'Mark completed' : `Move to ${PROJECT_STATUS_LABELS[s as keyof typeof PROJECT_STATUS_LABELS]}`}</Button>)}
        </>} />
      <ErrorNote error={run.error} />
      <div className="mb-4 flex flex-wrap items-center gap-4"><ProgressBar value={p.progress} /><span className="text-sm text-ink-muted">{open} open task{open === 1 ? '' : 's'}</span></div>
      <div className="mb-4"><Tabs tabs={[{ id: 'overview', label: 'Overview' }, { id: 'tasks', label: 'Tasks', badge: countBadge(open) }, { id: 'materials', label: 'Materials' }, { id: 'expenses', label: 'Expenses' }, { id: 'issues', label: 'Issues', badge: countBadge(p.issues.filter((i) => i.status === 'OPEN').length) }, { id: 'photos', label: 'Photos' }]} value={tab} onChange={setTab} /></div>

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Details" action={edit ? <Button size="sm" variant="outline" onClick={() => setModal('edit')}>Edit</Button> : undefined} />
            <CardBody className="space-y-1 text-sm">
              <p><span className="text-ink-muted">Customer: </span><Link className="text-brand hover:underline" to={`/customers/${p.customer.id}`}>{p.customer.name}</Link></p>
              <p><span className="text-ink-muted">Manager: </span>{name(p.managerId)}</p>
              <p><span className="text-ink-muted">Capacity: </span>{p.capacityKw ? `${Number(p.capacityKw)} kW` : '—'}</p>
              <p><span className="text-ink-muted">Start: </span>{showDate(p.startDate, locale)} <span className="text-ink-muted">· Target: </span>{showDate(p.targetDate, locale)}{p.completedAt ? <> <span className="text-ink-muted">· Completed: </span>{showDate(p.completedAt, locale)}</> : null}</p>
              {p.notes && <p className="whitespace-pre-wrap pt-2">{p.notes}</p>}
              <p className="pt-2"><Link className="text-brand hover:underline" to={`/documents?projectId=${p.id}`}>Documents for this project</Link></p>
            </CardBody>
          </Card>
          <Milestones p={p} edit={edit} onChange={refresh} />
        </div>
      )}

      {tab === 'tasks' && (
        <Card>
          <CardHeader title="Tasks" action={can('task:create') ? <Button size="sm" onClick={() => setModal('task')}>Add task</Button> : undefined} />
          {!p.tasks.length ? <EmptyState title="No tasks yet" description="Break the work into tasks and assign them to the team." /> : (
            <Table>
              <thead><tr><Th>Task</Th><Th>Assignee</Th><Th>Due</Th><Th>Priority</Th><Th>Status</Th><Th /></tr></thead>
              <tbody>{p.tasks.map((t) => (
                <tr key={t.id}>
                  <Td><p className="font-medium">{t.title}</p>{t.description && <p className="text-xs text-ink-muted">{t.description}</p>}</Td>
                  <Td>{name(t.assigneeId)}</Td><Td>{showDate(t.dueDate, locale)}</Td><Td><Badge tone={PRIORITY_TONE[t.priority]}>{label(t.priority)}</Badge></Td>
                  <Td>{can('task:edit') ? <Select aria-label={`Status of ${t.title}`} value={t.status} onChange={(e) => { const status = e.target.value; run.mutate(() => api.patch(`/tasks/${t.id}`, { status })); }} className="max-w-[10rem]">{TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}</Select> : <Badge tone={TASK_TONE[t.status]}>{label(t.status)}</Badge>}</Td>
                  <Td>{can('task:delete') && <Button size="icon" variant="ghost" aria-label={`Delete task ${t.title}`} onClick={() => run.mutate(() => api.delete(`/tasks/${t.id}`))}><Trash2 className="h-4 w-4" /></Button>}</Td>
                </tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === 'materials' && (
        <Card>
          <CardHeader title="Materials" description="Issuing takes stock out of inventory and records the movement against this project." action={edit ? <Button size="sm" variant="outline" onClick={() => setModal('plan')}>Plan an item</Button> : undefined} />
          {!p.materials.length ? <EmptyState title="No materials planned" description="Plan items here, or start the project from an accepted quotation to copy its items." /> : (
            <Table>
              <thead><tr><Th>Item</Th><Th className="text-right">Planned</Th><Th className="text-right">Issued</Th><Th className="text-right">Returned</Th><Th className="text-right">On site</Th><Th /></tr></thead>
              <tbody>{p.materials.map((m) => {
                const onSite = Number(m.quantityIssued) - Number(m.quantityReturned);
                return (
                  <tr key={m.id}>
                    <Td><p className="font-medium">{m.equipment.name}</p><p className="text-xs text-ink-muted">{m.equipment.manufacturer} {m.equipment.modelNumber}</p></Td>
                    <Td className="text-right tabular-nums">{Number(m.quantityPlanned)}</Td><Td className="text-right tabular-nums">{Number(m.quantityIssued)}</Td><Td className="text-right tabular-nums">{Number(m.quantityReturned)}</Td>
                    <Td className={`text-right tabular-nums ${onSite < Number(m.quantityPlanned) ? 'text-amber-700' : ''}`}>{onSite}</Td>
                    <Td className="space-x-1 text-right">
                      {edit && can('inventory:edit') && <Button size="sm" variant="outline" onClick={() => setModal({ kind: 'issue', materialId: m.id })}>Issue</Button>}
                      {edit && can('inventory:edit') && onSite > 0 && <Button size="sm" variant="ghost" onClick={() => setModal({ kind: 'return', materialId: m.id })}>Return</Button>}
                      {edit && Number(m.quantityIssued) === 0 && <Button size="icon" variant="ghost" aria-label={`Remove ${m.equipment.name}`} onClick={() => run.mutate(() => api.delete(`/projects/${id}/materials/${m.id}`))}><Trash2 className="h-4 w-4" /></Button>}
                    </Td>
                  </tr>
                );
              })}</tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === 'expenses' && <Expenses p={p} edit={edit} money={money} locale={locale} onChange={refresh} />}
      {tab === 'issues' && (
        <Issues p={p} edit={edit} locale={locale} onChange={refresh} onResolve={(issueId) => setModal({ kind: 'resolve', issueId })} />
      )}
      {tab === 'photos' && <Photos p={p} edit={edit} onChange={refresh} />}

      {modal === 'task' && <TaskModal p={p} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'edit' && <EditModal p={p} onClose={() => setModal(null)} onDone={refresh} />}
      {modal === 'plan' && <PlanModal projectId={id} onClose={() => setModal(null)} onDone={refresh} />}
      {typeof modal === 'object' && modal && (modal.kind === 'issue' || modal.kind === 'return') && <MoveModal p={p} materialId={modal.materialId} kind={modal.kind} onClose={() => setModal(null)} onDone={refresh} />}
      {typeof modal === 'object' && modal && modal.kind === 'resolve' && <ResolveModal projectId={id} issueId={modal.issueId} onClose={() => setModal(null)} onDone={refresh} />}
    </div>
  );
}

function Milestones({ p, edit, onChange }: { p: Detail; edit: boolean; onChange: () => void }) {
  const locale = useLocale();
  const [nm, setNm] = useState(''); const [due, setDue] = useState(''); const [w, setW] = useState('1');
  const run = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: onChange });
  return (
    <Card>
      <CardHeader title="Milestones" description="Progress is the weighted share of completed milestones." />
      <CardBody className="space-y-2">
        {p.milestones.map((m) => (
          <div key={m.id} className="flex items-center gap-3 text-sm">
            <input type="checkbox" aria-label={`${m.name} done`} checked={!!m.completedAt} disabled={!edit} onChange={(e) => { const completed = e.target.checked; run.mutate(() => api.patch(`/projects/${p.id}/milestones/${m.id}`, { completed })); }} />
            <span className={m.completedAt ? 'text-ink-muted line-through' : 'font-medium'}>{m.name}</span>
            <span className="text-xs text-ink-muted">weight {m.weight}{m.dueDate ? ` · due ${showDate(m.dueDate, locale)}` : ''}</span>
            {edit && <Button size="icon" variant="ghost" className="ml-auto" aria-label={`Delete milestone ${m.name}`} onClick={() => run.mutate(() => api.delete(`/projects/${p.id}/milestones/${m.id}`))}><Trash2 className="h-4 w-4" /></Button>}
          </div>
        ))}
        {!p.milestones.length && <p className="text-sm text-ink-muted">No milestones. Without them, progress is the share of tasks done.</p>}
        {edit && (
          <div className="flex flex-wrap items-end gap-2 border-t border-surface-line pt-3">
            <Field label="New milestone"><Input value={nm} onChange={(e) => setNm(e.target.value)} placeholder="e.g. Structure installed" /></Field>
            <Field label="Due"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            <Field label="Weight"><Input inputMode="numeric" className="w-20" value={w} onChange={(e) => setW(e.target.value)} /></Field>
            <Button disabled={nm.trim().length < 2} loading={run.isPending} onClick={() => run.mutate(async () => { await api.post(`/projects/${p.id}/milestones`, { name: nm, dueDate: due || null, weight: Math.max(1, Number(w) || 1) }); setNm(''); setDue(''); setW('1'); })}>Add</Button>
          </div>
        )}
        <ErrorNote error={run.error} />
      </CardBody>
    </Card>
  );
}

function Expenses({ p, edit, money, locale, onChange }: { p: Detail; edit: boolean; money: (v: string | number) => string; locale: string; onChange: () => void }) {
  const [f, setF] = useState({ description: '', category: '', amount: '', incurredOn: todayYmd() });
  const run = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: onChange });
  return (
    <Card>
      <CardHeader title="Expenses" description={`Total ${money(p.expenseTotal)}`} />
      {!p.expenses.length ? <EmptyState title="No expenses recorded" /> : (
        <Table>
          <thead><tr><Th>Date</Th><Th>Description</Th><Th>Category</Th><Th className="text-right">Amount</Th><Th /></tr></thead>
          <tbody>{p.expenses.map((e) => (
            <tr key={e.id}><Td>{showDate(e.incurredOn, locale)}</Td><Td>{e.description}</Td><Td>{e.category ?? '—'}</Td><Td className="text-right tabular-nums">{money(e.amount)}</Td>
              <Td>{edit && <Button size="icon" variant="ghost" aria-label={`Delete expense ${e.description}`} onClick={() => run.mutate(() => api.delete(`/projects/${p.id}/expenses/${e.id}`))}><Trash2 className="h-4 w-4" /></Button>}</Td></tr>
          ))}</tbody>
        </Table>
      )}
      {edit && (
        <div className="flex flex-wrap items-end gap-2 border-t border-surface-line p-4">
          <Field label="Description"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Category"><Input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="Transport, labour…" /></Field>
          <Field label="Amount"><Input inputMode="decimal" className="w-32" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Date"><Input type="date" value={f.incurredOn} onChange={(e) => setF({ ...f, incurredOn: e.target.value })} /></Field>
          <Button disabled={f.description.trim().length < 2 || !(Number(f.amount) > 0)} loading={run.isPending} onClick={() => run.mutate(async () => { await api.post(`/projects/${p.id}/expenses`, { description: f.description, category: f.category || null, amount: Number(f.amount), incurredOn: f.incurredOn }); setF({ ...f, description: '', amount: '' }); })}>Add expense</Button>
        </div>
      )}
      <ErrorNote error={run.error} />
    </Card>
  );
}

function Issues({ p, edit, locale, onChange, onResolve }: { p: Detail; edit: boolean; locale: string; onChange: () => void; onResolve: (id: string) => void }) {
  const [f, setF] = useState({ title: '', description: '', severity: 'MEDIUM' });
  const run = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: onChange });
  return (
    <Card>
      <CardHeader title="Issues" description="Open high-severity issues block completing the project." />
      {!p.issues.length ? <EmptyState title="No issues reported" /> : (
        <ul className="divide-y divide-surface-line">{p.issues.map((i) => (
          <li key={i.id} className="flex flex-wrap items-start gap-3 px-5 py-3 text-sm">
            <Badge tone={PRIORITY_TONE[i.severity]}>{label(i.severity)}</Badge>
            <div className="min-w-0 flex-1"><p className="font-medium">{i.title} <span className="text-xs font-normal text-ink-muted">{showDate(i.createdAt, locale)}</span></p>{i.description && <p className="text-ink-muted">{i.description}</p>}{i.resolution && <p className="text-green-700">Resolved: {i.resolution}</p>}</div>
            {edit && (i.status === 'OPEN' ? <Button size="sm" variant="outline" onClick={() => onResolve(i.id)}>Resolve</Button> : <Button size="sm" variant="ghost" onClick={() => run.mutate(() => api.patch(`/projects/${p.id}/issues/${i.id}`, { status: 'OPEN' }))}>Reopen</Button>)}
          </li>
        ))}</ul>
      )}
      {edit && (
        <div className="flex flex-wrap items-end gap-2 border-t border-surface-line p-4">
          <Field label="Issue"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Details"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Severity"><Select value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>{SEVERITIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></Field>
          <Button disabled={f.title.trim().length < 2} loading={run.isPending} onClick={() => run.mutate(async () => { await api.post(`/projects/${p.id}/issues`, { title: f.title, description: f.description || null, severity: f.severity }); setF({ title: '', description: '', severity: 'MEDIUM' }); })}>Report issue</Button>
        </div>
      )}
      <ErrorNote error={run.error} />
    </Card>
  );
}

function Photos({ p, edit, onChange }: { p: Detail; edit: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState('');
  const run = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: onChange });
  return (
    <Card>
      <CardHeader title="Progress photos" action={edit ? (
        <div className="flex items-center gap-2">
          <Input aria-label="Photo caption" placeholder="Caption (optional)" value={caption} onChange={(e) => setCaption(e.target.value)} className="w-48" />
          <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Photo file" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; run.mutate(async () => { const fd = new FormData(); fd.append('file', file); if (caption) fd.append('caption', caption); await api.post(`/projects/${p.id}/photos`, fd); setCaption(''); }); }} />
          <Button size="sm" loading={run.isPending} onClick={() => ref.current?.click()}><Upload className="h-3.5 w-3.5" />Upload photo</Button>
        </div>
      ) : undefined} />
      <ErrorNote error={run.error} />
      {!p.photos.length ? <EmptyState title="No photos yet" description="Upload site photos to document progress." /> : (
        <CardBody className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {p.photos.map((ph) => (
            <figure key={ph.id} className="overflow-hidden rounded-lg border border-surface-line">
              <AuthImage path={`/projects/${p.id}/photos/${ph.id}`} alt={ph.caption || ph.fileName} className="h-36 w-full object-cover" />
              <figcaption className="flex items-center justify-between gap-1 px-2 py-1 text-xs"><span className="truncate">{ph.caption || ph.fileName} <span className="text-ink-muted">{fileSize(ph.sizeBytes)}</span></span>
                {edit && <button type="button" className="text-red-600" aria-label={`Delete photo ${ph.fileName}`} onClick={() => run.mutate(() => api.delete(`/projects/${p.id}/photos/${ph.id}`))}><Trash2 className="h-3.5 w-3.5" /></button>}</figcaption>
            </figure>
          ))}
        </CardBody>
      )}
    </Card>
  );
}

function TaskModal({ p, onClose, onDone }: { p: Detail; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: '', description: '', milestoneId: '', priority: 'MEDIUM', assigneeId: '', dueDate: '' });
  const m = useMutation({ mutationFn: () => api.post(`/projects/${p.id}/tasks`, { title: f.title, description: f.description || null, milestoneId: f.milestoneId || null, priority: f.priority, assigneeId: f.assigneeId || null, dueDate: f.dueDate || null }), onSuccess: () => { onDone(); onClose(); } });
  return (
    <Modal open title="Add task" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Task"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Details"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Assignee"><UserSelect value={f.assigneeId} onChange={(v) => setF({ ...f, assigneeId: v })} /></Field>
          <Field label="Priority"><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{PRIORITIES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select></Field>
          <Field label="Due date"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
          <Field label="Milestone"><Select value={f.milestoneId} onChange={(e) => setF({ ...f, milestoneId: e.target.value })}><option value="">None</option>{p.milestones.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
        </div>
        <ErrorNote error={m.error} />
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={f.title.trim().length < 2} onClick={() => m.mutate()}>Add task</Button></div>
    </Modal>
  );
}

function EditModal({ p, onClose, onDone }: { p: Detail; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: p.name, siteAddress: p.siteAddress ?? '', capacityKw: p.capacityKw ? String(Number(p.capacityKw)) : '', managerId: p.managerId ?? '', startDate: dateInput(p.startDate), targetDate: dateInput(p.targetDate), notes: p.notes ?? '' });
  const m = useMutation({ mutationFn: () => api.patch(`/projects/${p.id}`, { name: f.name, siteAddress: f.siteAddress || null, capacityKw: f.capacityKw ? Number(f.capacityKw) : null, managerId: f.managerId || null, startDate: f.startDate || null, targetDate: f.targetDate || null, notes: f.notes || null }), onSuccess: () => { onDone(); onClose(); } });
  return (
    <Modal open wide title="Edit project" onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Manager"><UserSelect value={f.managerId} onChange={(v) => setF({ ...f, managerId: v })} label="None" /></Field>
        <Field label="Site address"><Input value={f.siteAddress} onChange={(e) => setF({ ...f, siteAddress: e.target.value })} /></Field>
        <Field label="Capacity (kW)"><Input inputMode="decimal" value={f.capacityKw} onChange={(e) => setF({ ...f, capacityKw: e.target.value })} /></Field>
        <Field label="Start date"><Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="Target completion"><Input type="date" value={f.targetDate} onChange={(e) => setF({ ...f, targetDate: e.target.value })} /></Field>
      </div>
      <div className="mt-3"><Field label="Notes"><Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
      <ErrorNote error={m.error} />
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={f.name.trim().length < 2} onClick={() => m.mutate()}>Save</Button></div>
    </Modal>
  );
}

function PlanModal({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: () => void }) {
  const cat = useCatalogue();
  const [eq, setEq] = useState(''); const [qty, setQty] = useState('');
  const m = useMutation({ mutationFn: () => api.put(`/projects/${projectId}/materials`, { equipmentId: eq, quantityPlanned: Number(qty) }), onSuccess: () => { onDone(); onClose(); } });
  return (
    <Modal open title="Plan an item" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Item"><Select value={eq} onChange={(e) => setEq(e.target.value)}><option value="">Choose…</option>{cat.data?.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.manufacturer} {c.modelNumber})</option>)}</Select></Field>
        <Field label="Planned quantity"><Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <ErrorNote error={m.error} />
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={!eq || !(Number(qty) >= 0) || qty === ''} onClick={() => m.mutate()}>Save</Button></div>
    </Modal>
  );
}

function MoveModal({ p, materialId, kind, onClose, onDone }: { p: Detail; materialId: string; kind: 'issue' | 'return'; onClose: () => void; onDone: () => void }) {
  const mat = p.materials.find((x) => x.id === materialId)!;
  const [qty, setQty] = useState(''); const [serials, setSerials] = useState('');
  const list = serials.split(/[\s,]+/).filter(Boolean);
  const m = useMutation({ mutationFn: () => api.post(`/projects/${p.id}/materials/${kind}`, { equipmentId: mat.equipmentId, quantity: Number(qty), ...(mat.equipment.trackSerial ? { serials: list } : {}) }), onSuccess: () => { onDone(); onClose(); } });
  return (
    <Modal open title={`${kind === 'issue' ? 'Issue' : 'Return'} ${mat.equipment.name}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-ink-muted">{kind === 'issue' ? 'Takes this quantity out of stock for the project.' : `Puts stock back. Up to ${Number(mat.quantityIssued) - Number(mat.quantityReturned)} can be returned.`}</p>
        <Field label="Quantity"><Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        {mat.equipment.trackSerial && <Field label="Serial numbers" hint={`Exactly ${qty || 'one per unit'}, separated by commas, spaces or new lines`}><Textarea rows={3} value={serials} onChange={(e) => setSerials(e.target.value)} /></Field>}
        <ErrorNote error={m.error} />
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="accent" loading={m.isPending} disabled={!(Number(qty) > 0)} onClick={() => m.mutate()}>{kind === 'issue' ? 'Issue stock' : 'Return stock'}</Button></div>
    </Modal>
  );
}

function ResolveModal({ projectId, issueId, onClose, onDone }: { projectId: string; issueId: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const m = useMutation({ mutationFn: () => api.patch(`/projects/${projectId}/issues/${issueId}`, { status: 'RESOLVED', resolution: text }), onSuccess: () => { onDone(); onClose(); } });
  return (
    <Modal open title="Resolve issue" onClose={onClose}>
      <Field label="How was it resolved?"><Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <ErrorNote error={m.error} />
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={text.trim().length < 2} onClick={() => m.mutate()}>Mark resolved</Button></div>
    </Modal>
  );
}
