import { useMemo } from 'react';
import { useLocale } from '@/lib/format';
import { EmptyState } from '@/components/ui';
import { useNames } from './common';

interface Item { id: string; label: string; kind: 'project' | 'milestone' | 'task'; start: Date; end: Date; done?: boolean; status?: string; who?: string }
export interface TimelineProject {
  startDate: string | null; targetDate: string | null; completedAt: string | null;
  milestones: { id: string; name: string; dueDate: string | null; completedAt: string | null }[];
  tasks: { id: string; title: string; status: string; startDate: string | null; dueDate: string | null; createdAt: string; completedAt: string | null; assigneeId: string | null }[];
}

const DAY = 86_400_000;
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const COLORS: Record<string, string> = { TODO: '#94a3b8', IN_PROGRESS: '#3b82f6', BLOCKED: '#ef4444', DONE: '#16a34a' };

/** Gantt-style chart: the project span, milestone markers and one bar per task, with a line for today. Pure SVG. */
export function ProjectTimeline({ p }: { p: TimelineProject }) {
  const locale = useLocale(); const { name } = useNames();
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (p.startDate || p.targetDate) { const s = day((p.startDate ?? p.targetDate)!); const e = day((p.targetDate ?? p.startDate)!); out.push({ id: 'project', label: 'Project', kind: 'project', start: s, end: e < s ? s : e, done: !!p.completedAt }); }
    for (const m of p.milestones) if (m.dueDate) out.push({ id: m.id, label: m.name, kind: 'milestone', start: day(m.dueDate), end: day(m.dueDate), done: !!m.completedAt });
    for (const t of p.tasks) {
      const s = day(t.startDate ?? t.createdAt); const e = day(t.dueDate ?? t.completedAt ?? t.startDate ?? t.createdAt);
      out.push({ id: t.id, label: t.title, kind: 'task', start: s, end: e < s ? s : e, status: t.status, who: t.assigneeId ? name(t.assigneeId) : undefined });
    }
    return out;
  }, [p, name]);
  if (!items.length) return <EmptyState title="Nothing to chart yet" description="Set the project's start and target dates, add milestones with due dates, or give tasks start and due dates." />;

  const now = new Date(); const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const min = new Date(Math.min(...items.map((i) => i.start.getTime()), today.getTime()) - 3 * DAY);
  const max = new Date(Math.max(...items.map((i) => i.end.getTime()), today.getTime()) + 3 * DAY);
  const span = Math.max(14, Math.round((max.getTime() - min.getTime()) / DAY));
  const L = 190, W = 1000, R = 12, rowH = 26, top = 30;
  const x = (d: Date) => L + ((d.getTime() - min.getTime()) / DAY / span) * (W - L - R);
  const H = top + items.length * rowH + 8;
  const ticks: Date[] = []; const step = span > 120 ? 30 : span > 50 ? 14 : 7;
  for (let i = 0; i <= span; i += step) ticks.push(new Date(min.getTime() + i * DAY));
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Project timeline" className="min-w-[760px] w-full text-ink">
        {ticks.map((t) => (
          <g key={t.getTime()}><line x1={x(t)} y1={top - 6} x2={x(t)} y2={H - 4} stroke="currentColor" strokeOpacity={0.08} /><text x={x(t) + 2} y={top - 10} fontSize={10} fill="currentColor" opacity={0.6}>{t.toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })}</text></g>
        ))}
        {items.map((it, i) => {
          const y = top + i * rowH; const x1 = x(it.start); const x2 = Math.max(x(it.end) + (it.kind === 'milestone' ? 0 : (W - L - R) / span), x1 + 4);
          return (
            <g key={it.id}>
              <text x={6} y={y + 15} fontSize={11} fill="currentColor" fontWeight={it.kind === 'project' ? 700 : 400}>{it.label.length > 28 ? `${it.label.slice(0, 27)}…` : it.label}</text>
              {it.kind === 'milestone'
                ? <polygon points={`${x1},${y + 4} ${x1 + 8},${y + 12} ${x1},${y + 20} ${x1 - 8},${y + 12}`} fill={it.done ? '#16a34a' : '#f59e0b'}><title>{`${it.label}: ${it.start.toLocaleDateString(locale, { dateStyle: 'medium', timeZone: 'UTC' })}${it.done ? ' (done)' : ''}`}</title></polygon>
                : <rect x={x1} y={y + 5} width={x2 - x1} height={14} rx={3} fill={it.kind === 'project' ? (it.done ? '#16a34a' : '#0f2a43') : COLORS[it.status ?? 'TODO']} opacity={it.kind === 'project' ? 0.85 : 1}><title>{`${it.label}${it.who ? ` · ${it.who}` : ''}: ${it.start.toLocaleDateString(locale, { dateStyle: 'medium', timeZone: 'UTC' })} to ${it.end.toLocaleDateString(locale, { dateStyle: 'medium', timeZone: 'UTC' })}`}</title></rect>}
            </g>
          );
        })}
        <line x1={x(today)} y1={top - 6} x2={x(today)} y2={H - 4} stroke="#dc2626" strokeWidth={1.5} strokeDasharray="4 3" />
        <text x={x(today) + 3} y={H - 10} fontSize={10} fill="#dc2626">today</text>
      </svg>
      <p className="mt-2 flex flex-wrap gap-3 text-xs text-ink-muted">
        {[['To do', COLORS.TODO], ['In progress', COLORS.IN_PROGRESS], ['Blocked', COLORS.BLOCKED], ['Done', COLORS.DONE]].map(([l, c]) => <span key={l}><i className="mr-1 inline-block h-2 w-3 rounded-sm" style={{ background: c }} />{l}</span>)}
        <span><i className="mr-1 inline-block h-2 w-2 rotate-45 bg-amber-500" />Milestone</span><span>Tasks without a start date begin on the day they were created.</span>
      </p>
    </div>
  );
}
