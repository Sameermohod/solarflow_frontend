import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, List, Plus } from 'lucide-react';
import { LEAD_SOURCES, LEAD_STAGES, LEAD_STAGE_LABELS, type LeadStageKey } from '@solarflow/shared';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { cn } from '@/lib/utils';
import { dateOnly, label, useLocale, useMoney, type Page } from '@/lib/format';
import { useDirectory } from '@/lib/hooks';
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Modal, PageHeader, Pagination, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { useDebounced } from '@/components/ui/extra';
import { LeadFormModal, LeadModal } from './LeadModal';

export interface LeadRow {
  id: string; name: string; companyName: string | null; phone: string | null; email: string | null; source: string; stage: LeadStageKey;
  expectedValue: string | null; expectedCapacityKw: string | null; nextFollowUpAt: string | null; customerId: string | null; updatedAt: string;
  assignedTo: { id: string; firstName: string; lastName: string } | null;
}
interface Board { stages: { stage: LeadStageKey; label: string; count: number; totalValue: string; leads: LeadRow[] }[] }

const STAGE_TONE: Record<LeadStageKey, string> = {
  NEW: 'border-t-slate-400', CONTACTED: 'border-t-blue-500', SITE_SURVEY: 'border-t-cyan-500', PROPOSAL: 'border-t-sun', NEGOTIATION: 'border-t-orange-500', WON: 'border-t-accent', LOST: 'border-t-red-500',
};

function LeadCard({ lead, onOpen, onMove, canEdit }: { lead: LeadRow; onOpen: () => void; onMove: (s: LeadStageKey) => void; canEdit: boolean }) {
  const money = useMoney();
  const overdue = lead.nextFollowUpAt && new Date(lead.nextFollowUpAt) <= new Date() && lead.stage !== 'WON' && lead.stage !== 'LOST';
  return (
    <div draggable={canEdit} onDragStart={(e) => e.dataTransfer.setData('text/lead', lead.id)}
      className={cn('rounded-lg border border-surface-line bg-white p-3 shadow-card', canEdit && 'cursor-grab active:cursor-grabbing')}>
      <button onClick={onOpen} className="block w-full text-left">
        <p className="text-sm font-medium text-ink">{lead.name}</p>
        {lead.companyName && <p className="text-xs text-ink-muted">{lead.companyName}</p>}
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
        {lead.expectedValue && <span className="font-medium text-ink">{money(lead.expectedValue, { compact: true })}</span>}
        {lead.expectedCapacityKw && <span>{Number(lead.expectedCapacityKw)} kW</span>}
        <Badge>{label(lead.source)}</Badge>
        {overdue && <Badge tone="red">Follow-up due</Badge>}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-ink-muted">{lead.assignedTo ? `${lead.assignedTo.firstName} ${lead.assignedTo.lastName}` : 'Unassigned'}</span>
        {canEdit && (
          <select aria-label={`Move ${lead.name} to stage`} value={lead.stage} onChange={(e) => onMove(e.target.value as LeadStageKey)} className="rounded border border-surface-line bg-white px-1 py-0.5 text-xs">
            {LEAD_STAGES.map((s) => <option key={s} value={s}>{LEAD_STAGE_LABELS[s]}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

export function CrmPage() {
  const can = useAuth((s) => s.can);
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const locale = useLocale();
  const money = useMoney();
  const dir = useDirectory();
  const [view, setView] = useState<'board' | 'list'>('board');
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueOnly, setDueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [lostFor, setLostFor] = useState<{ id: string; name: string } | null>(null);
  const [reason, setReason] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null);
  const q = useDebounced(search);
  const openId = params.get('lead');
  const filters = { search: q, source, assignedToId: assignee, followUpDue: dueOnly ? 'true' : '' };

  const board = useQuery({ queryKey: ['leads-board', filters], queryFn: () => api.get<Board>(`/leads/board${qs(filters)}`), enabled: view === 'board', placeholderData: (p) => p });
  const list = useQuery({ queryKey: ['leads-list', filters, page], queryFn: () => api.get<Page<LeadRow>>(`/leads${qs({ ...filters, page, pageSize: 20 })}`), enabled: view === 'list', placeholderData: (p) => p });

  const refresh = () => { qc.invalidateQueries({ queryKey: ['leads-board'] }); qc.invalidateQueries({ queryKey: ['leads-list'] }); qc.invalidateQueries({ queryKey: ['lead'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); };
  const stage = useMutation({
    mutationFn: (v: { id: string; stage: LeadStageKey; lostReason?: string }) => api.post(`/leads/${v.id}/stage`, { stage: v.stage, lostReason: v.lostReason }),
    onSuccess: () => { setLostFor(null); setReason(''); refresh(); },
  });
  const move = (lead: { id: string; name: string }, s: LeadStageKey) => (s === 'LOST' ? setLostFor({ id: lead.id, name: lead.name }) : stage.mutate({ id: lead.id, stage: s }));
  const canEdit = can('lead:edit');

  return (
    <>
      <PageHeader title="CRM" description="Track leads from first contact to a won project"
        actions={<>
          <div className="flex overflow-hidden rounded-lg border border-surface-line bg-white" role="group" aria-label="View">
            <button aria-pressed={view === 'board'} onClick={() => setView('board')} className={cn('flex items-center gap-1.5 px-3 py-2 text-sm', view === 'board' ? 'bg-brand text-brand-fg' : 'text-ink-muted')}><LayoutGrid className="h-4 w-4" />Board</button>
            <button aria-pressed={view === 'list'} onClick={() => setView('list')} className={cn('flex items-center gap-1.5 px-3 py-2 text-sm', view === 'list' ? 'bg-brand text-brand-fg' : 'text-ink-muted')}><List className="h-4 w-4" />List</button>
          </div>
          {can('lead:create') && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New lead</Button>}
        </>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input aria-label="Search leads" placeholder="Search leads…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
        <Select aria-label="Filter by source" value={source} onChange={(e) => { setSource(e.target.value); setPage(1); }} className="w-40"><option value="">All sources</option>{LEAD_SOURCES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</Select>
        <Select aria-label="Filter by assignee" value={assignee} onChange={(e) => { setAssignee(e.target.value); setPage(1); }} className="w-48"><option value="">All assignees</option>{dir.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dueOnly} onChange={(e) => { setDueOnly(e.target.checked); setPage(1); }} />Follow-up due</label>
      </div>
      <ErrorNote error={stage.error ?? board.error ?? list.error} />

      {view === 'board' && (board.isLoading ? <div className="flex justify-center py-20"><Spinner className="h-8 w-8" /></div> : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {board.data?.stages.map((col) => (
            <section key={col.stage} aria-label={`${col.label} column`}
              onDragOver={(e) => { if (canEdit) { e.preventDefault(); setDragOver(col.stage); } }} onDragLeave={() => setDragOver(null)}
              onDrop={(e) => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData('text/lead'); const lead = board.data?.stages.flatMap((s) => s.leads).find((l) => l.id === id); if (lead && lead.stage !== col.stage) move(lead, col.stage); }}
              className={cn('w-72 shrink-0 rounded-xl border border-t-4 border-surface-line bg-surface-alt p-2', STAGE_TONE[col.stage], dragOver === col.stage && 'ring-2 ring-accent')}>
              <header className="mb-2 flex items-center justify-between px-1"><h2 className="text-sm font-semibold">{col.label} <span className="font-normal text-ink-muted">({col.count})</span></h2>
                {Number(col.totalValue) > 0 && <span className="text-xs text-ink-muted">{money(col.totalValue, { compact: true })}</span>}</header>
              <div className="space-y-2">
                {col.leads.map((l) => <LeadCard key={l.id} lead={l} canEdit={canEdit} onOpen={() => setParams({ lead: l.id })} onMove={(s) => move(l, s)} />)}
                {col.leads.length === 0 && <p className="px-1 py-4 text-center text-xs text-ink-muted">No leads</p>}
                {col.count > col.leads.length && <p className="px-1 text-center text-xs text-ink-muted">Showing {col.leads.length} of {col.count}. Use the list view for all.</p>}
              </div>
            </section>
          ))}
        </div>
      ))}

      {view === 'list' && (
        <Card>
          {list.isLoading ? <div className="flex justify-center py-14"><Spinner className="h-7 w-7" /></div> : !list.data?.data.length ? <EmptyState title="No leads found" description="Create a lead or adjust your filters." /> : (
            <>
              <Table>
                <thead><tr><Th>Lead</Th><Th>Stage</Th><Th>Source</Th><Th>Value</Th><Th>Assigned to</Th><Th>Next follow-up</Th></tr></thead>
                <tbody>
                  {list.data.data.map((l) => (
                    <tr key={l.id} className="cursor-pointer hover:bg-surface-alt" onClick={() => setParams({ lead: l.id })}>
                      <Td><p className="font-medium">{l.name}</p><p className="text-xs text-ink-muted">{l.companyName ?? l.phone ?? ''}</p></Td>
                      <Td><Badge tone={l.stage === 'WON' ? 'green' : l.stage === 'LOST' ? 'red' : 'blue'}>{LEAD_STAGE_LABELS[l.stage]}</Badge></Td>
                      <Td>{label(l.source)}</Td><Td>{l.expectedValue ? money(l.expectedValue) : '—'}</Td>
                      <Td>{l.assignedTo ? `${l.assignedTo.firstName} ${l.assignedTo.lastName}` : '—'}</Td><Td>{dateOnly(l.nextFollowUpAt, locale)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Pagination page={list.data.meta.page} totalPages={list.data.meta.totalPages} total={list.data.meta.total} onPage={setPage} />
            </>
          )}
        </Card>
      )}

      {creating && <LeadFormModal onClose={() => setCreating(false)} onSaved={(id) => { refresh(); setParams({ lead: id }); }} />}
      {openId && <LeadModal id={openId} onClose={() => { setParams({}); refresh(); }} onConverted={(cid) => nav(`/customers/${cid}`)} />}
      <Modal open={!!lostFor} title={`Mark “${lostFor?.name ?? ''}” as lost`} onClose={() => setLostFor(null)}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (lostFor && reason.trim()) stage.mutate({ id: lostFor.id, stage: 'LOST', lostReason: reason.trim() }); }}>
          <label className="block space-y-1.5 text-sm font-medium">Why was it lost?<Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. price, chose a competitor, not ready" autoFocus /></label>
          <ErrorNote error={stage.error} />
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setLostFor(null)}>Cancel</Button><Button type="submit" variant="danger" disabled={!reason.trim()} loading={stage.isPending}>Mark as lost</Button></div>
        </form>
      </Modal>
    </>
  );
}
