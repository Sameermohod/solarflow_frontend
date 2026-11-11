import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { TIME_ENTRY_STATUS_LABELS } from '@solarflow/shared';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { label, useLocale, type Page } from '@/lib/format';
import { Tabs } from '@/components/ui/extra';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { showDate } from './common';

interface Entry { id: string; workDate: string; hours: number; minutes: number; note: string | null; status: string; rejectionNote: string | null; project: { id: string; number: string; name: string }; task: { id: string; title: string } | null }
interface Pending { userId: string; name: string; own: boolean; totalHours: number; entries: Entry[] }
interface ReportRow { userId: string; name: string; approvedHours: number; submittedHours: number; openHours: number; rejectedHours: number; utilizationPct: number | null; projects: { projectId: string; number: string; name: string; hours: number }[] }

const TONE: Record<string, 'neutral' | 'green' | 'yellow' | 'red' | 'blue'> = { OPEN: 'neutral', SUBMITTED: 'yellow', APPROVED: 'green', REJECTED: 'red' };
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => ymd(new Date(new Date(`${s}T00:00:00Z`).getTime() + n * 86_400_000));
/** Monday of the week containing the given day (date-only strings, no timezone surprises). */
const weekStartOf = (s: string) => { const d = new Date(`${s}T00:00:00Z`); const off = (d.getUTCDay() + 6) % 7; return addDays(s, -off); };
const localToday = () => { const n = new Date(); return ymd(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()))); };

function AddEntry({ day, onDone }: { day: string; onDone: () => void }) {
  const [date, setDate] = useState(day); const [projectId, setProjectId] = useState(''); const [taskId, setTaskId] = useState(''); const [hours, setHours] = useState('8'); const [note, setNote] = useState('');
  const projects = useQuery({ queryKey: ['ts-projects'], queryFn: () => api.get<Page<{ id: string; number: string; name: string; status: string }>>(`/projects${qs({ pageSize: 100 })}`).then((r) => r.data.filter((p) => !['COMPLETED', 'CANCELLED'].includes(p.status))) });
  const tasks = useQuery({ queryKey: ['ts-tasks', projectId], enabled: !!projectId, queryFn: () => api.get<Page<{ id: string; title: string }>>(`/tasks${qs({ projectId, pageSize: 100, open: 'true' })}`).then((r) => r.data) });
  const add = useMutation({ mutationFn: () => api.post('/timesheets/entries', { projectId, taskId: taskId || null, workDate: date, hours: Number(hours), note: note || null }), onSuccess: () => { setNote(''); onDone(); } });
  return (
    <Card>
      <CardHeader title="Log time" description="Hours show effort on a project. They do not change anyone's pay: everyone is paid a monthly salary." />
      <CardBody>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Day"><Input type="date" max={localToday()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Project"><Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setTaskId(''); }}><option value="">Choose…</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.number} · {p.name}</option>)}</Select></Field>
          <Field label="Task (optional)"><Select value={taskId} onChange={(e) => setTaskId(e.target.value)} disabled={!projectId}><option value="">Whole project</option>{tasks.data?.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Select></Field>
          <Field label="Hours" hint="Steps of 0.25"><Input inputMode="decimal" className="w-24" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
          <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you do?" /></Field>
          <Button variant="accent" loading={add.isPending} disabled={!projectId || !(Number(hours) > 0) || !date} onClick={() => add.mutate()}>Add</Button>
        </div>
        <ErrorNote error={add.error} />
      </CardBody>
    </Card>
  );
}

function MyTime() {
  const qc = useQueryClient(); const locale = useLocale();
  const [week, setWeek] = useState(weekStartOf(localToday()));
  const end = addDays(week, 6);
  const q = useQuery({ queryKey: ['ts-entries', week], queryFn: () => api.get<{ data: Entry[]; totalHours: number }>(`/timesheets/entries${qs({ from: week, to: end })}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['ts-entries'] }); qc.invalidateQueries({ queryKey: ['ts-pending'] }); };
  const run = useMutation({ mutationFn: (fn: () => Promise<unknown>) => fn(), onSuccess: refresh });
  const [editing, setEditing] = useState<Entry | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const byDay = useMemo(() => new Map(days.map((d) => [d, (q.data?.data ?? []).filter((e) => e.workDate.slice(0, 10) === d)])), [q.data, week]); // eslint-disable-line react-hooks/exhaustive-deps
  const submittable = (q.data?.data ?? []).filter((e) => e.status === 'OPEN' || e.status === 'REJECTED');
  const th = localToday();
  return (
    <div className="space-y-4">
      <AddEntry day={th} onDone={refresh} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-surface-line px-5 py-3">
          <Button size="sm" variant="outline" onClick={() => setWeek(addDays(week, -7))}>Previous week</Button>
          <Button size="sm" variant="outline" onClick={() => setWeek(weekStartOf(th))}>This week</Button>
          <Button size="sm" variant="outline" onClick={() => setWeek(addDays(week, 7))}>Next week</Button>
          <span className="text-sm font-medium">{showDate(week, locale)} – {showDate(end, locale)}</span>
          <span className="ml-auto text-sm">Total <strong>{q.data?.totalHours ?? 0} h</strong></span>
          <Button size="sm" variant="accent" loading={run.isPending} disabled={!submittable.length} onClick={() => run.mutate(() => api.post('/timesheets/submit', { from: week, to: end }))}>Submit week for approval{submittable.length ? ` (${submittable.length})` : ''}</Button>
        </div>
        <ErrorNote error={q.error ?? run.error} />
        {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
          <ul className="divide-y divide-surface-line">
            {days.map((d) => {
              const rows = byDay.get(d) ?? [];
              const total = rows.reduce((s, r) => s + r.hours, 0);
              return (
                <li key={d} className="px-5 py-2 text-sm">
                  <div className="flex items-center justify-between"><span className={`font-medium ${d === th ? 'text-accent' : ''}`}>{new Date(`${d}T00:00:00Z`).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })}</span><span className="text-ink-muted">{total ? `${total} h` : '—'}</span></div>
                  {rows.map((e) => (
                    <div key={e.id} className="mt-1 flex flex-wrap items-center gap-3 rounded-lg bg-surface-alt/60 px-3 py-1.5">
                      <Link className="text-brand hover:underline" to={`/projects/${e.project.id}`}>{e.project.number}</Link>
                      <span className="min-w-0 flex-1 truncate">{e.task?.title ?? e.project.name}{e.note ? <span className="text-ink-muted"> · {e.note}</span> : null}</span>
                      <span className="tabular-nums">{e.hours} h</span>
                      <Badge tone={TONE[e.status]}>{TIME_ENTRY_STATUS_LABELS[e.status as keyof typeof TIME_ENTRY_STATUS_LABELS]}</Badge>
                      {e.rejectionNote && <span className="w-full text-xs text-red-600">Rejected: {e.rejectionNote}</span>}
                      {(e.status === 'OPEN' || e.status === 'REJECTED') && <>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>Edit</Button>
                        <Button size="icon" variant="ghost" aria-label={`Delete entry on ${e.project.number}`} onClick={() => run.mutate(() => api.delete(`/timesheets/entries/${e.id}`))}><Trash2 className="h-4 w-4" /></Button>
                      </>}
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {editing && <EditEntry entry={editing} onClose={() => setEditing(null)} onDone={refresh} />}
    </div>
  );
}

function EditEntry({ entry, onClose, onDone }: { entry: Entry; onClose: () => void; onDone: () => void }) {
  const [hours, setHours] = useState(String(entry.hours)); const [note, setNote] = useState(entry.note ?? '');
  const m = useMutation({ mutationFn: () => api.patch(`/timesheets/entries/${entry.id}`, { hours: Number(hours), note: note || null }), onSuccess: () => { onDone(); onClose(); } });
  return (
    <Modal open title="Edit time entry" onClose={onClose}>
      <p className="mb-3 text-sm text-ink-muted">{entry.project.number} · {showDate(entry.workDate, 'en-IN')}{entry.status === 'REJECTED' ? ' · saving returns it to "not submitted"' : ''}</p>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Hours"><Input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} /></Field><Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
      <ErrorNote error={m.error} />
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={!(Number(hours) > 0)} onClick={() => m.mutate()}>Save</Button></div>
    </Modal>
  );
}

function Approvals() {
  const qc = useQueryClient(); const locale = useLocale();
  const q = useQuery({ queryKey: ['ts-pending'], queryFn: () => api.get<{ data: Pending[] }>('/timesheets/pending') });
  const [sel, setSel] = useState<Set<string>>(new Set()); const [rejecting, setRejecting] = useState(false); const [reason, setReason] = useState('');
  const decide = useMutation({
    mutationFn: (v: { decision: 'APPROVED' | 'REJECTED'; note?: string }) => api.post<{ updated: number; skipped: number }>('/timesheets/decide', { ids: [...sel], ...v }),
    onSuccess: () => { setSel(new Set()); setRejecting(false); setReason(''); qc.invalidateQueries({ queryKey: ['ts-pending'] }); qc.invalidateQueries({ queryKey: ['ts-entries'] }); },
  });
  const toggle = (ids: string[], on: boolean) => setSel((s) => { const n = new Set(s); ids.forEach((i) => (on ? n.add(i) : n.delete(i))); return n; });
  if (q.isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  const groups = q.data?.data ?? [];
  return (
    <Card>
      <CardHeader title="Waiting for approval" description="You cannot approve your own time." action={<div className="flex gap-2"><Button size="sm" variant="accent" disabled={!sel.size} loading={decide.isPending} onClick={() => decide.mutate({ decision: 'APPROVED' })}>Approve selected ({sel.size})</Button><Button size="sm" variant="outline" disabled={!sel.size} onClick={() => setRejecting(true)}>Reject selected</Button></div>} />
      <ErrorNote error={q.error ?? decide.error} />
      {!groups.length ? <EmptyState title="Nothing waiting" description="Submitted timesheets appear here." /> : groups.map((g) => {
        const ids = g.entries.map((e) => e.id); const all = !g.own && ids.every((i) => sel.has(i));
        return (
          <div key={g.userId} className="border-t border-surface-line px-5 py-3 text-sm">
            <label className="flex items-center gap-2 font-medium"><input type="checkbox" disabled={g.own} checked={all} onChange={(e) => { const on = e.target.checked; toggle(ids, on); }} />{g.name}<span className="font-normal text-ink-muted">· {g.totalHours} h{g.own ? ' · your own time' : ''}</span></label>
            <ul className="mt-1 space-y-1 pl-6">{g.entries.map((e) => (
              <li key={e.id} className="flex items-center gap-3"><input type="checkbox" aria-label={`Select ${g.name} ${e.workDate.slice(0, 10)}`} disabled={g.own} checked={sel.has(e.id)} onChange={(ev) => { const on = ev.target.checked; toggle([e.id], on); }} /><span className="w-28">{showDate(e.workDate, locale)}</span><span>{e.project.number}</span><span className="flex-1 truncate text-ink-muted">{e.task?.title ?? e.project.name}{e.note ? ` · ${e.note}` : ''}</span><span className="tabular-nums">{e.hours} h</span></li>
            ))}</ul>
          </div>
        );
      })}
      {rejecting && (
        <Modal open title="Reject selected time" onClose={() => setRejecting(false)}>
          <Field label="Why?"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setRejecting(false)}>Cancel</Button><Button loading={decide.isPending} disabled={reason.trim().length < 2} onClick={() => decide.mutate({ decision: 'REJECTED', note: reason })}>Reject</Button></div>
        </Modal>
      )}
    </Card>
  );
}

function Report() {
  const n = localToday();
  const [from, setFrom] = useState(addDays(n, -29)); const [to, setTo] = useState(n); const [perDay, setPerDay] = useState('8');
  const q = useQuery({ queryKey: ['ts-report', from, to, perDay], queryFn: () => api.get<{ expectedHours: number; employees: ReportRow[] }>(`/timesheets/report${qs({ from, to, hoursPerDay: perDay })}`) });
  const csv = () => {
    const rows = [['Employee', 'Approved h', 'Waiting h', 'Not submitted h', 'Rejected h', 'Utilization %', 'Projects'], ...(q.data?.employees ?? []).map((e) => [e.name, e.approvedHours, e.submittedHours, e.openHours, e.rejectedHours, e.utilizationPct ?? '', e.projects.map((p) => `${p.number} ${p.hours}h`).join('; ')])];
    const text = rows.map((r) => r.map((c) => { const s = String(c); const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; }).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([`﻿${text}`], { type: 'text/csv' })); a.download = `hours-${from}-${to}.csv`; a.click();
  };
  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3 border-b border-surface-line px-5 py-4">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Working hours per day" hint="Weekdays only; holidays are not known"><Input inputMode="decimal" className="w-24" value={perDay} onChange={(e) => setPerDay(e.target.value)} /></Field>
        <Button size="sm" variant="outline" className="ml-auto" onClick={csv} disabled={!q.data}>CSV</Button>
      </div>
      <ErrorNote error={q.error} />
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : !q.data?.employees.length ? <EmptyState title="No team members" /> : (
        <Table>
          <thead><tr><Th>Employee</Th><Th className="text-right">Approved</Th><Th className="text-right">Waiting</Th><Th className="text-right">Not submitted</Th><Th className="text-right">Rejected</Th><Th className="text-right">Utilization</Th><Th>Projects (approved + waiting)</Th></tr></thead>
          <tbody>{q.data.employees.map((e) => (
            <tr key={e.userId}><Td className="font-medium">{e.name}</Td><Td className="text-right tabular-nums">{e.approvedHours}</Td><Td className="text-right tabular-nums">{e.submittedHours}</Td><Td className="text-right tabular-nums">{e.openHours}</Td><Td className="text-right tabular-nums">{e.rejectedHours}</Td>
              <Td className="text-right tabular-nums">{e.utilizationPct === null ? '—' : `${e.utilizationPct}%`}</Td><Td className="text-xs">{e.projects.length ? e.projects.map((p) => `${p.number} ${p.hours} h`).join(' · ') : '—'}</Td></tr>
          ))}</tbody>
        </Table>
      )}
      <p className="border-t border-surface-line px-5 py-3 text-xs text-ink-muted">Expected hours in this period: {q.data?.expectedHours ?? 0} per person (weekdays × {perDay} h). Utilization = approved + waiting hours ÷ expected hours. Pay is a monthly salary and does not depend on these hours.</p>
    </Card>
  );
}

export function TimesheetsPage() {
  const can = useAuth((s) => s.can);
  const [tab, setTab] = useState<'mine' | 'approvals' | 'report'>('mine');
  const tabs = [{ id: 'mine' as const, label: 'My time' }, ...(can('timesheet:approve') ? [{ id: 'approvals' as const, label: 'Approvals' }] : []), ...(can('timesheet:export') ? [{ id: 'report' as const, label: 'Team hours' }] : [])];
  void label;
  return (
    <div>
      <PageHeader title="Timesheets" description="Log your time on projects, submit it weekly, and managers approve it. Hours measure effort; pay is a monthly salary." />
      {tabs.length > 1 && <div className="mb-4"><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>}
      {tab === 'mine' && <MyTime />}{tab === 'approvals' && <Approvals />}{tab === 'report' && <Report />}
    </div>
  );
}
