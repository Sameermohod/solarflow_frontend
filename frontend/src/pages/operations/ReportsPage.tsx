import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { label } from '@/lib/format';
import { Tabs } from '@/components/ui/extra';
import { Button, Card, CardBody, EmptyState, ErrorNote, Field, Input, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';
import { useCommercialOptions, useMoney2 } from '@/features/commercial/api';
import { downloadProtected, showDate } from './common';

type Kind = 'sales' | 'revenue' | 'receivables' | 'installations' | 'stock';
interface Section { heading: string; head: string[]; rows: (string | number)[][] }

/** Two-series monthly bar chart in plain SVG (no chart library). */
function Bars({ title, labels, a, b, aName, bName, format }: { title: string; labels: string[]; a: number[]; b?: number[]; aName: string; bName?: string; format: (n: number) => string }) {
  const max = Math.max(1, ...a, ...(b ?? []));
  const W = 640, H = 180, P = 28; const n = labels.length || 1; const bw = (W - P) / n;
  return (
    <figure>
      <figcaption className="mb-1 flex flex-wrap items-center gap-3 text-xs text-ink-muted"><span className="font-medium text-ink">{title}</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-accent" />{aName}</span>{bName && <span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-brand" />{bName}</span>}</figcaption>
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={title} className="max-h-56 w-full">
        <line x1={P} y1={H} x2={W} y2={H} stroke="currentColor" strokeOpacity={0.2} />
        <text x={0} y={10} fontSize={9} fill="currentColor" opacity={0.6}>{format(max)}</text>
        {labels.map((l, i) => {
          const x = P + i * bw; const ha = (a[i] ?? 0) / max * (H - 14); const hb = ((b?.[i]) ?? 0) / max * (H - 14); const w = b ? bw * 0.38 : bw * 0.6;
          return (
            <g key={l}>
              <rect x={x + bw * 0.08} y={H - ha} width={w} height={ha} className="fill-accent"><title>{`${l}: ${format(a[i] ?? 0)}`}</title></rect>
              {b && <rect x={x + bw * 0.08 + w + 1} y={H - hb} width={w} height={hb} className="fill-brand"><title>{`${l}: ${format(b[i] ?? 0)}`}</title></rect>}
              {(n <= 14 || i % 2 === 0) && <text x={x + bw / 2} y={H + 12} fontSize={9} textAnchor="middle" fill="currentColor" opacity={0.6}>{l.slice(2)}</text>}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
const tile = (title: string, value: ReactNode, sub?: string) => <Card key={title}><CardBody><p className="text-xs text-ink-muted">{title}</p><p className="text-xl font-semibold">{value}</p>{sub && <p className="text-xs text-ink-muted">{sub}</p>}</CardBody></Card>;

export function ReportsPage() {
  const can = useAuth((s) => s.can); const org = useAuth((s) => s.session?.organization); const money = useMoney2();
  const opts = useCommercialOptions();
  const [kind, setKind] = useState<Kind>('revenue');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const dated = kind !== 'receivables' && kind !== 'stock';
  const params = { from: dated ? from : '', to: dated ? to : '' };
  const q = useQuery({ queryKey: ['report', kind, params.from, params.to], queryFn: () => api.get<any>(`/reports/${kind}${qs(params)}`) });  // eslint-disable-line @typescript-eslint/no-explicit-any
  const d = q.data;
  const money0 = (n: number) => new Intl.NumberFormat(org?.locale ?? 'en-IN', { maximumFractionDigits: 0 }).format(n);

  const sections = useMemo<Section[]>(() => {
    if (!d) return [];
    if (kind === 'sales') return [
      { heading: 'Lead pipeline', head: ['Stage', 'Leads', 'Expected value'], rows: d.pipeline.map((p: any) => [label(p.stage), p.count, p.value]) }, // eslint-disable-line @typescript-eslint/no-explicit-any
      { heading: 'Quotations (latest revision of each)', head: ['Status', 'Count', 'Total'], rows: d.quotations.map((p: any) => [label(p.status), p.count, p.total]) }, // eslint-disable-line @typescript-eslint/no-explicit-any
    ];
    if (kind === 'revenue') return [
      { heading: 'By month', head: ['Month', 'Invoices', 'Invoiced', 'Tax', 'Payments', 'Collected'], rows: d.months.map((m: any) => [m.month, m.invoices, m.invoiced, m.tax, m.payments, m.collected]) }, // eslint-disable-line @typescript-eslint/no-explicit-any
      { heading: 'Top customers', head: ['Customer', 'Invoices', 'Invoiced'], rows: d.topCustomers.map((c: any) => [c.name, c.invoices, c.invoiced]) }, // eslint-disable-line @typescript-eslint/no-explicit-any
    ];
    if (kind === 'receivables') return [
      { heading: 'Aging', head: ['Bucket', 'Invoices', 'Outstanding'], rows: d.buckets.map((b: any) => [b.label, b.count, b.outstanding]) }, // eslint-disable-line @typescript-eslint/no-explicit-any
      { heading: 'Open invoices', head: ['Invoice', 'Customer', 'Due', 'Days overdue', 'Outstanding'], rows: d.invoices.map((i: any) => [i.number ?? '', i.customer, i.dueDate ? i.dueDate.slice(0, 10) : '', i.daysOverdue, i.outstanding]) }, // eslint-disable-line @typescript-eslint/no-explicit-any
    ];
    if (kind === 'installations') return [
      { heading: 'Projects by status', head: ['Status', 'Projects', 'Capacity (kW)'], rows: d.byStatus.map((s: any) => [label(s.status), s.count, s.capacityKw]) }, // eslint-disable-line @typescript-eslint/no-explicit-any
      { heading: 'Completed by month', head: ['Month', 'Completed', 'Capacity (kW)'], rows: d.completedByMonth.map((m: any) => [m.month, m.count, m.capacityKw]) }, // eslint-disable-line @typescript-eslint/no-explicit-any
    ];
    return [{ heading: 'Low stock', head: ['Item', 'Manufacturer', 'Model', 'On hand', 'Reorder level'], rows: d.lowStock.map((s: any) => [s.name, s.manufacturer, s.model, s.onHand, s.reorderLevel]) }]; // eslint-disable-line @typescript-eslint/no-explicit-any
  }, [d, kind]);

  const csv = useMutation({ mutationFn: () => downloadProtected(`/reports/${kind}${qs({ ...params, format: 'csv' })}`, `${kind}.csv`) });
  const pdf = useMutation({ mutationFn: async () => { const { reportPdf } = await import('@/features/operations/opsPdf'); await reportPdf(`${label(kind)} report`, dated ? `${(d?.range?.from ?? '').slice(0, 10)} to ${(d?.range?.to ?? '').slice(0, 10)}` : `as of ${new Date().toLocaleDateString(org?.locale)}`, sections, opts.data!, org?.logoUrl); } });

  return (
    <div>
      <PageHeader title="Reports" description="Business figures computed from your invoices, payments, quotations, projects and stock." />
      <div className="mb-4"><Tabs tabs={[{ id: 'revenue', label: 'Revenue' }, { id: 'sales', label: 'Sales pipeline' }, { id: 'receivables', label: 'Receivables' }, { id: 'installations', label: 'Installations' }, { id: 'stock', label: 'Low stock' }]} value={kind} onChange={setKind} /></div>
      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-surface-line px-5 py-4">
          {dated && <>
            <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            <p className="pb-2 text-xs text-ink-muted">Default: the last 12 months.</p>
          </>}
          <div className="ml-auto flex gap-2">
            {can('report:export') && <Button size="sm" variant="outline" loading={csv.isPending} onClick={() => csv.mutate()}><Download className="h-4 w-4" />CSV</Button>}
            {can('report:export') && <Button size="sm" variant="outline" loading={pdf.isPending} disabled={!d || !opts.data} onClick={() => pdf.mutate()}><FileText className="h-4 w-4" />PDF</Button>}
          </div>
        </div>
        <ErrorNote error={q.error ?? csv.error ?? pdf.error} />
        {q.isLoading ? <div className="flex justify-center py-12"><Spinner /></div> : !d ? null : (
          <CardBody className="space-y-6">
            {kind === 'revenue' && <>
              <div className="grid gap-3 sm:grid-cols-3">{tile('Invoiced (excl. proforma)', money(d.totals.invoiced))}{tile('Tax included in that', money(d.totals.tax))}{tile('Collected', money(d.totals.collected), 'Payments received, voided ones excluded')}</div>
              <Bars title="Invoiced and collected by month" labels={d.months.map((m: any) => m.month)} a={d.months.map((m: any) => Number(m.invoiced))} b={d.months.map((m: any) => Number(m.collected))} aName="Invoiced" bName="Collected" format={money0} />{/* eslint-disable-line @typescript-eslint/no-explicit-any */}
            </>}
            {kind === 'sales' && <>
              <div className="grid gap-3 sm:grid-cols-4">{tile('Leads created', d.leads.created)}{tile('Won', d.leads.won)}{tile('Lost', d.leads.lost)}{tile('Win rate', d.leads.conversionPct === null ? 'n/a' : `${d.leads.conversionPct}%`, 'Won ÷ (won + lost) in the range')}</div>
              <Bars title="Value of quotations accepted, by month" labels={d.acceptedByMonth.map((m: any) => m.month)} a={d.acceptedByMonth.map((m: any) => Number(m.total))} aName="Accepted" format={money0} />{/* eslint-disable-line @typescript-eslint/no-explicit-any */}
            </>}
            {kind === 'receivables' && <div className="grid gap-3 sm:grid-cols-3">{tile('Total outstanding', money(d.total), `As of ${showDate(d.asOf, org?.locale ?? 'en-IN')}`)}{tile('Overdue', money((d.buckets as { key: string; outstanding: string }[]).filter((b) => b.key !== 'notDue').reduce((s, b) => s + Number(b.outstanding), 0)))}{tile('Open invoices', d.invoices.length)}</div>}
            {kind === 'installations' && <>
              <div className="grid gap-3 sm:grid-cols-4">{tile('Completed', d.completed.count)}{tile('Average duration', d.completed.avgDurationDays === null ? 'n/a' : `${d.completed.avgDurationDays} days`, 'Start date to completion')}{tile('On time', d.completed.onTimePct === null ? 'n/a' : `${d.completed.onTimePct}%`, 'Finished by the target date')}{tile('Open tasks', d.tasks.open, `${d.tasks.overdue} overdue`)}</div>
              <Bars title="Capacity completed by month (kW)" labels={d.completedByMonth.map((m: any) => m.month)} a={d.completedByMonth.map((m: any) => m.capacityKw)} aName="kW" format={money0} />{/* eslint-disable-line @typescript-eslint/no-explicit-any */}
            </>}
            {sections.map((s) => (
              <div key={s.heading}>
                <h3 className="mb-2 text-sm font-semibold">{s.heading}</h3>
                {!s.rows.length ? <EmptyState title="Nothing to show" /> : <Table><thead><tr>{s.head.map((h) => <Th key={h}>{h}</Th>)}</tr></thead><tbody>{s.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <Td key={j} className={j > 0 && /^[-\d.]+$/.test(String(c)) ? 'text-right tabular-nums' : ''}>{c}</Td>)}</tr>)}</tbody></Table>}
              </div>
            ))}
            {kind === 'stock' && <p className="text-xs text-ink-muted">Items whose stock is at or below their reorder level. <Link className="text-brand hover:underline" to="/inventory">Open inventory</Link></p>}
          </CardBody>
        )}
      </Card>
    </div>
  );
}
