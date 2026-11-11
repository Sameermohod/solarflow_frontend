import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { label, useLocale } from '@/lib/format';
import { Tabs } from '@/components/ui/extra';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';
import { useMoney2 } from '@/features/commercial/api';
import { PROJECT_TONE, showDate, todayYmd } from './common';

const curMonth = () => todayYmd().slice(0, 7);
const Month = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => <Field label="Month"><Input type="month" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} /></Field>;
const tile = (title: string, value: ReactNode, sub?: string, tone = '') => <Card key={title}><CardBody><p className="text-xs text-ink-muted">{title}</p><p className={`text-xl font-semibold tabular-nums ${tone}`}>{value}</p>{sub && <p className="text-xs text-ink-muted">{sub}</p>}</CardBody></Card>;

function Summary() {
  const money = useMoney2(); const [month, setMonth] = useState(curMonth());
  const q = useQuery({ queryKey: ['fin-summary', month], queryFn: () => api.get<Record<string, string>>(`/finance/summary${qs({ month })}`) });
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="max-w-xs"><Month value={month} onChange={setMonth} /></div>
      <ErrorNote error={q.error} />
      {q.isLoading ? <Spinner /> : d && <>
        <div className="grid gap-3 sm:grid-cols-3">
          {tile('Invoiced this month (before tax)', money(d.invoicedNet!))}{tile('Collected this month', money(d.collected!), 'Payments received, incl. tax')}{tile('Still to collect (all time)', money(d.outstandingNow!), 'Open invoices')}
          {tile('Project expenses', money(d.projectExpenses!))}{tile('Materials issued to projects', money(d.materialsIssued!), 'At current purchase prices')}{tile('Monthly salaries', money(d.salaries!), `${money(d.salariesAllocatedToProjects!)} charged to projects, ${money(d.salariesUnallocated!)} unallocated`)}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">{tile('Operating result', money(d.operatingResult!), 'Invoicing basis', Number(d.operatingResult) < 0 ? 'text-red-600' : 'text-green-700')}</div>
        <p className="text-xs text-ink-muted">{d.note}</p>
      </>}
    </div>
  );
}

interface ProjRow { id: string; number: string; name: string; customer: string; status: string; budget: string | null; revenue: string; collected: string; materials: string; expenses: string; labour: string; cost: string; profit: string; marginPct: number | null; budgetUsedPct: number | null; overBudget: boolean; hasInvoices: boolean }
function Projects() {
  const money = useMoney2();
  const q = useQuery({ queryKey: ['fin-projects'], queryFn: () => api.get<{ data: ProjRow[]; totals: Record<string, string>; definitions: Record<string, string> }>('/finance/projects') });
  if (q.isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  const d = q.data;
  return (
    <Card>
      <CardHeader title="Project profitability" description="Revenue against materials, expenses and the share of monthly salaries worked on each project." />
      <ErrorNote error={q.error} />
      {!d?.data.length ? <EmptyState title="No projects yet" /> : (
        <>
          <Table>
            <thead><tr><Th>Project</Th><Th>Status</Th><Th className="text-right">Revenue</Th><Th className="text-right">Materials</Th><Th className="text-right">Expenses</Th><Th className="text-right">Labour</Th><Th className="text-right">Profit</Th><Th className="text-right">Margin</Th><Th>Budget</Th></tr></thead>
            <tbody>{d.data.map((p) => (
              <tr key={p.id}>
                <Td><Link className="font-medium text-brand hover:underline" to={`/projects/${p.id}`}>{p.number}</Link><span className="block text-xs text-ink-muted">{p.name} · {p.customer}</span></Td>
                <Td><Badge tone={PROJECT_TONE[p.status]}>{label(p.status)}</Badge></Td>
                <Td className="text-right tabular-nums">{p.hasInvoices ? money(p.revenue) : <span className="text-xs text-ink-muted">no invoice yet</span>}</Td><Td className="text-right tabular-nums">{money(p.materials)}</Td><Td className="text-right tabular-nums">{money(p.expenses)}</Td><Td className="text-right tabular-nums">{money(p.labour)}</Td>
                <Td className={`text-right tabular-nums font-medium ${Number(p.profit) < 0 ? 'text-red-600' : 'text-green-700'}`}>{money(p.profit)}</Td><Td className="text-right tabular-nums">{p.marginPct === null ? '—' : `${p.marginPct}%`}</Td>
                <Td>{p.budget ? <span className={p.overBudget ? 'font-medium text-red-600' : ''}>{money(p.budget)} · {p.budgetUsedPct}% used</span> : <span className="text-xs text-ink-muted">none set</span>}</Td>
              </tr>
            ))}
            <tr className="bg-surface-alt/60 font-medium"><Td>Total</Td><Td /><Td className="text-right tabular-nums">{money(d.totals.revenue!)}</Td><Td className="text-right tabular-nums">{money(d.totals.materials!)}</Td><Td className="text-right tabular-nums">{money(d.totals.expenses!)}</Td><Td className="text-right tabular-nums">{money(d.totals.labour!)}</Td><Td className="text-right tabular-nums">{money(d.totals.profit!)}</Td><Td /><Td /></tr></tbody>
          </Table>
          <ul className="space-y-1 border-t border-surface-line px-5 py-3 text-xs text-ink-muted">{Object.entries(d.definitions).map(([k, v]) => <li key={k}><strong className="capitalize text-ink">{k}:</strong> {v}</li>)}</ul>
        </>
      )}
    </Card>
  );
}

interface LabourEmp { userId: string; name: string; salary: string; approvedHours: number; allocated: string; unallocated: string; projects: { projectId: string; number: string; name: string; hours: number; cost: string }[] }
function Labour() {
  const money = useMoney2(); const [month, setMonth] = useState(curMonth()); const [perDay, setPerDay] = useState('8');
  const q = useQuery({ queryKey: ['fin-labour', month, perDay], queryFn: () => api.get<{ expectedHours: number; employees: LabourEmp[]; projects: { projectId: string; number: string; name: string; cost: string }[]; totals: Record<string, string>; note: string }>(`/finance/labour${qs({ month, hoursPerDay: perDay })}`) });
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3"><Month value={month} onChange={setMonth} /><Field label="Working hours per day"><Input inputMode="decimal" className="w-24" value={perDay} onChange={(e) => setPerDay(e.target.value)} /></Field></div>
      <ErrorNote error={q.error} />
      {q.isLoading ? <Spinner /> : d && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">{tile('Monthly salaries', money(d.totals.salaries!), `${d.employees.length} employee(s) with a salary`)}{tile('Charged to projects', money(d.totals.allocated!), 'By approved hours')}{tile('Not charged to a project', money(d.totals.unallocated!), 'Time not logged on projects', Number(d.totals.unallocated) > 0 ? 'text-amber-700' : '')}</div>
          <Card>
            <CardHeader title="By employee" description={`Expected ${d.expectedHours} h this month (weekdays × ${perDay} h)`} />
            {!d.employees.length ? <EmptyState title="No salaries set" description="Set monthly salaries on the Salaries tab." /> : (
              <Table>
                <thead><tr><Th>Employee</Th><Th className="text-right">Monthly salary</Th><Th className="text-right">Approved hours</Th><Th className="text-right">To projects</Th><Th className="text-right">Unallocated</Th><Th>Projects</Th></tr></thead>
                <tbody>{d.employees.map((e) => (
                  <tr key={e.userId}><Td className="font-medium">{e.name}</Td><Td className="text-right tabular-nums">{money(e.salary)}</Td><Td className="text-right tabular-nums">{e.approvedHours}</Td><Td className="text-right tabular-nums">{money(e.allocated)}</Td><Td className="text-right tabular-nums">{money(e.unallocated)}</Td>
                    <Td className="text-xs">{e.projects.length ? e.projects.map((p) => `${p.number}: ${p.hours} h = ${money(p.cost)}`).join(' · ') : '—'}</Td></tr>
                ))}</tbody>
              </Table>
            )}
          </Card>
          <p className="text-xs text-ink-muted">{d.note}</p>
        </>
      )}
    </div>
  );
}

interface SalRow { userId: string; name: string; email: string; monthlySalary: string | null; effectiveFrom: string | null; upcoming: { monthlySalary: string; effectiveFrom: string }[]; changes: number }
function Salaries() {
  const money = useMoney2(); const locale = useLocale(); const can = useAuth((s) => s.can); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['fin-salaries'], queryFn: () => api.get<{ data: SalRow[]; monthlyTotal: string }>('/finance/salaries') });
  const [edit, setEdit] = useState<SalRow | null>(null); const [hist, setHist] = useState<SalRow | null>(null);
  return (
    <Card>
      <CardHeader title="Monthly salaries" description={`Everyone is paid a fixed monthly salary. Total per month: ${q.data ? money(q.data.monthlyTotal) : '…'}. Visible only to people with payroll access.`} />
      <ErrorNote error={q.error} />
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <Table>
          <thead><tr><Th>Employee</Th><Th className="text-right">Monthly salary</Th><Th>Since</Th><Th>Upcoming change</Th><Th /></tr></thead>
          <tbody>{q.data?.data.map((r) => (
            <tr key={r.userId}><Td><p className="font-medium">{r.name}</p><p className="text-xs text-ink-muted">{r.email}</p></Td><Td className="text-right tabular-nums">{r.monthlySalary ? money(r.monthlySalary) : <span className="text-xs text-amber-700">not set</span>}</Td><Td>{showDate(r.effectiveFrom, locale)}</Td>
              <Td className="text-xs">{r.upcoming.map((u) => `${money(u.monthlySalary)} from ${showDate(u.effectiveFrom, locale)}`).join(', ') || '—'}</Td>
              <Td className="space-x-1 text-right">{can('payroll:edit') && <Button size="sm" variant="outline" onClick={() => setEdit(r)}>Set salary</Button>}{r.changes > 0 && <Button size="sm" variant="ghost" onClick={() => setHist(r)}>History</Button>}</Td></tr>
          ))}</tbody>
        </Table>
      )}
      {edit && <SalaryModal row={edit} onClose={() => setEdit(null)} onDone={() => { qc.invalidateQueries({ queryKey: ['fin-salaries'] }); qc.invalidateQueries({ queryKey: ['fin-labour'] }); qc.invalidateQueries({ queryKey: ['fin-summary'] }); qc.invalidateQueries({ queryKey: ['fin-projects'] }); }} />}
      {hist && <HistoryModal row={hist} onClose={() => setHist(null)} />}
    </Card>
  );
}
function SalaryModal({ row, onClose, onDone }: { row: SalRow; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(row.monthlySalary ?? ''); const [from, setFrom] = useState(todayYmd().slice(0, 8) + '01'); const [note, setNote] = useState('');
  const m = useMutation({ mutationFn: () => api.put(`/finance/salaries/${row.userId}`, { monthlySalary: Number(amount), effectiveFrom: from, note: note || null }), onSuccess: () => { onDone(); onClose(); } });
  return (
    <Modal open title={`Monthly salary: ${row.name}`} onClose={onClose}>
      <p className="mb-3 text-sm text-ink-muted">A fixed amount per month. Earlier amounts are kept as history. A month uses the salary in force on its last day.</p>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Monthly salary"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field><Field label="Effective from"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field></div>
      <div className="mt-3"><Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Annual increment" /></Field></div>
      <ErrorNote error={m.error} />
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="accent" loading={m.isPending} disabled={!(Number(amount) > 0) || !from} onClick={() => m.mutate()}>Save salary</Button></div>
    </Modal>
  );
}
function HistoryModal({ row, onClose }: { row: SalRow; onClose: () => void }) {
  const money = useMoney2(); const locale = useLocale();
  const q = useQuery({ queryKey: ['fin-salary-history', row.userId], queryFn: () => api.get<{ data: { id: string; monthlySalary: string; effectiveFrom: string; note: string | null }[] }>(`/finance/salaries/${row.userId}/history`) });
  return (
    <Modal open title={`Salary history: ${row.name}`} onClose={onClose}>
      {q.isLoading ? <Spinner /> : <ul className="divide-y divide-surface-line text-sm">{q.data?.data.map((h) => <li key={h.id} className="flex justify-between py-2"><span>From {showDate(h.effectiveFrom, locale)}{h.note ? <span className="text-ink-muted"> · {h.note}</span> : null}</span><span className="tabular-nums">{money(h.monthlySalary)}</span></li>)}</ul>}
      <div className="mt-4 flex justify-end"><Button onClick={onClose}>Close</Button></div>
    </Modal>
  );
}

export function FinancePage() {
  const can = useAuth((s) => s.can);
  const [tab, setTab] = useState<'summary' | 'projects' | 'labour' | 'salaries'>('summary');
  return (
    <div>
      <PageHeader title="Finance tracker" description="Monthly salaries, what each project costs, and profit. Everyone is paid a monthly salary; timesheet hours only decide how it is shared between projects." />
      <div className="mb-4"><Tabs tabs={[{ id: 'summary', label: 'Month summary' }, { id: 'projects', label: 'Project profit' }, { id: 'labour', label: 'Labour cost' }, { id: 'salaries', label: 'Salaries' }]} value={tab} onChange={setTab} /></div>
      {tab === 'summary' && <Summary />}{tab === 'projects' && <Projects />}{tab === 'labour' && <Labour />}{tab === 'salaries' && can('payroll:view') && <Salaries />}
    </div>
  );
}
