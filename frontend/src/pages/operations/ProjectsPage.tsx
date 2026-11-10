import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, PRIORITIES, TASK_STATUSES, TASK_STATUS_LABELS } from '@solarflow/shared';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { label, useLocale, type Page } from '@/lib/format';
import { useCustomerOptions } from '@/lib/hooks';
import { useDebounced, Tabs } from '@/components/ui/extra';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { PRIORITY_TONE, PROJECT_TONE, TASK_TONE, UserSelect, showDate, useNames } from './common';

export interface ProjectRow { id: string; number: string; name: string; status: string; customer: { id: string; name: string }; progress: number; taskCount: number; openTasks: number; startDate: string | null; targetDate: string | null; capacityKw: string | null; managerId: string | null }
export interface TaskRow { id: string; title: string; status: string; priority: string; dueDate: string | null; assigneeId: string | null; projectId: string; project: { id: string; number: string; name: string } }

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2" title={`${value}%`}>
      <div className="h-2 w-24 overflow-hidden rounded-full bg-surface-alt" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-accent" style={{ width: `${value}%` }} /></div>
      <span className="text-xs tabular-nums text-ink-muted">{value}%</span>
    </div>
  );
}

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const customers = useCustomerOptions();
  const [f, setF] = useState({ name: '', customerId: '', quotationId: '', siteAddress: '', capacityKw: '', managerId: '', startDate: '', targetDate: '', notes: '' });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const quotes = useQuery({ queryKey: ['accepted-quotes', f.customerId], enabled: !!f.customerId && can('quotation:view'), queryFn: () => api.get<Page<{ id: string; number: string; revision: number; title: string; customerId?: string; customer: { id: string } }>>(`/quotations${qs({ status: 'ACCEPTED', pageSize: 100 })}`).then((r) => r.data.filter((q) => q.customer.id === f.customerId)) });
  const create = useMutation({
    mutationFn: () => api.post<{ id: string }>('/projects', { name: f.name, customerId: f.customerId, quotationId: f.quotationId || null, siteAddress: f.siteAddress || null, capacityKw: f.capacityKw ? Number(f.capacityKw) : null, managerId: f.managerId || null, startDate: f.startDate || null, targetDate: f.targetDate || null, notes: f.notes || null }),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ['projects'] }); nav(`/projects/${p.id}`); },
  });
  return (
    <Modal open wide title="New project" onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Project name"><Input value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Customer"><Select value={f.customerId} onChange={(e) => { set('customerId', e.target.value); set('quotationId', ''); }}><option value="">Choose…</option>{customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        {can('quotation:view') && <Field label="From accepted quotation (optional)" hint="Copies its catalogue items as planned materials"><Select value={f.quotationId} onChange={(e) => set('quotationId', e.target.value)} disabled={!f.customerId}><option value="">None</option>{quotes.data?.map((q) => <option key={q.id} value={q.id}>{q.number}{q.revision > 1 ? ` R${q.revision}` : ''} · {q.title}</option>)}</Select></Field>}
        <Field label="Capacity (kW)"><Input inputMode="decimal" value={f.capacityKw} onChange={(e) => set('capacityKw', e.target.value)} /></Field>
        <Field label="Project manager"><UserSelect value={f.managerId} onChange={(v) => set('managerId', v)} label="None" /></Field>
        <Field label="Site address"><Input value={f.siteAddress} onChange={(e) => set('siteAddress', e.target.value)} /></Field>
        <Field label="Start date"><Input type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
        <Field label="Target completion"><Input type="date" value={f.targetDate} onChange={(e) => set('targetDate', e.target.value)} /></Field>
      </div>
      <div className="mt-3"><Field label="Notes"><Textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field></div>
      <ErrorNote error={create.error} />
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="accent" loading={create.isPending} disabled={f.name.trim().length < 2 || !f.customerId} onClick={() => create.mutate()}>Create project</Button></div>
    </Modal>
  );
}

function ProjectsList() {
  const locale = useLocale();
  const { name } = useNames();
  const [page, setPage] = useState(1); const [search, setSearch] = useState(''); const [status, setStatus] = useState('');
  const q = useDebounced(search);
  const { data, isLoading, error } = useQuery({ queryKey: ['projects', page, q, status], queryFn: () => api.get<Page<ProjectRow>>(`/projects${qs({ page, pageSize: 15, search: q, status })}`), placeholderData: (p) => p });
  return (
    <Card>
      <div className="flex flex-wrap gap-2 border-b border-surface-line px-5 py-4">
        <Input aria-label="Search projects" placeholder="Search number, name or customer…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="max-w-[11rem]"><option value="">All statuses</option>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>)}</Select>
      </div>
      <ErrorNote error={error} />
      {isLoading ? <div className="flex justify-center py-12"><Spinner /></div> : !data?.data.length ? <EmptyState title="No projects yet" description="Start one from an accepted quotation or from scratch." /> : (
        <>
          <Table>
            <thead><tr><Th>Number</Th><Th>Project</Th><Th>Customer</Th><Th>Manager</Th><Th>Progress</Th><Th>Open tasks</Th><Th>Target</Th><Th>Status</Th></tr></thead>
            <tbody>{data.data.map((p) => (
              <tr key={p.id} className="hover:bg-surface-alt/50">
                <Td><Link className="font-medium text-brand hover:underline" to={`/projects/${p.id}`}>{p.number}</Link></Td>
                <Td>{p.name}{p.capacityKw ? <span className="ml-1 text-xs text-ink-muted">{Number(p.capacityKw)} kW</span> : null}</Td>
                <Td>{p.customer.name}</Td><Td>{name(p.managerId)}</Td><Td><ProgressBar value={p.progress} /></Td><Td>{p.openTasks}</Td><Td>{showDate(p.targetDate, locale)}</Td>
                <Td><Badge tone={PROJECT_TONE[p.status]}>{PROJECT_STATUS_LABELS[p.status as keyof typeof PROJECT_STATUS_LABELS]}</Badge></Td>
              </tr>
            ))}</tbody>
          </Table>
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

function MyTasks() {
  const qc = useQueryClient();
  const locale = useLocale();
  const can = useAuth((s) => s.can);
  const [scope, setScope] = useState<'me' | 'all'>('me');
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({ queryKey: ['tasks', scope, page], queryFn: () => api.get<Page<TaskRow>>(`/tasks${qs({ page, pageSize: 20, open: 'true', assignee: scope === 'me' ? 'me' : '' })}`), placeholderData: (p) => p });
  const upd = useMutation({ mutationFn: (v: { id: string; status: string }) => api.patch(`/tasks/${v.id}`, { status: v.status }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['projects'] }); } });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card>
      <div className="flex gap-2 border-b border-surface-line px-5 py-4">
        <Select aria-label="Whose tasks" value={scope} onChange={(e) => { setScope(e.target.value as 'me' | 'all'); setPage(1); }} className="max-w-[12rem]"><option value="me">My open tasks</option><option value="all">All open tasks</option></Select>
      </div>
      <ErrorNote error={error ?? upd.error} />
      {isLoading ? <div className="flex justify-center py-12"><Spinner /></div> : !data?.data.length ? <EmptyState title="No open tasks" description={scope === 'me' ? 'Nothing is assigned to you.' : 'Every task is done.'} /> : (
        <>
          <Table>
            <thead><tr><Th>Task</Th><Th>Project</Th><Th>Due</Th><Th>Priority</Th><Th>Status</Th></tr></thead>
            <tbody>{data.data.map((t) => (
              <tr key={t.id}>
                <Td className="font-medium">{t.title}</Td><Td><Link className="text-brand hover:underline" to={`/projects/${t.project.id}`}>{t.project.number}</Link></Td>
                <Td><span className={t.dueDate && t.dueDate.slice(0, 10) < today ? 'font-medium text-red-600' : ''}>{showDate(t.dueDate, locale)}</span></Td>
                <Td><Badge tone={PRIORITY_TONE[t.priority]}>{label(t.priority)}</Badge></Td>
                <Td>{can('task:edit') ? <Select aria-label={`Status of ${t.title}`} value={t.status} onChange={(e) => upd.mutate({ id: t.id, status: e.target.value })} className="max-w-[10rem]">{TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}</Select> : <Badge tone={TASK_TONE[t.status]}>{TASK_STATUS_LABELS[t.status as keyof typeof TASK_STATUS_LABELS]}</Badge>}</Td>
              </tr>
            ))}</tbody>
          </Table>
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

export function ProjectsPage() {
  const can = useAuth((s) => s.can);
  const [tab, setTab] = useState<'projects' | 'tasks'>('projects');
  const [creating, setCreating] = useState(false);
  void PRIORITIES;
  return (
    <div>
      <PageHeader title="Projects" description="Installation projects from approval to handover, with tasks, materials, expenses and photos." actions={can('project:create') ? <Button onClick={() => setCreating(true)}>New project</Button> : undefined} />
      <div className="mb-4"><Tabs tabs={[{ id: 'projects', label: 'Projects' }, ...(can('task:view') ? [{ id: 'tasks' as const, label: 'Tasks' }] : [])]} value={tab} onChange={setTab} /></div>
      {tab === 'projects' ? <ProjectsList /> : <MyTasks />}
      {creating && <NewProjectModal onClose={() => setCreating(false)} />}
    </div>
  );
}
