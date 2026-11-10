import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router-dom';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { formatDateTime } from '@/lib/utils';
import { useMoney } from '@/lib/format';
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorNote, Input, PageHeader, Spinner } from '@/components/ui';

interface Summary {
  range: { from: string; to: string };
  usage: { users: number; activeUsers: number; maxUsers: number | null; plan: string | null; status: string | null; trialEndsAt: string | null };
  usersByRole: { role: string; count: number }[];
  activityByDay: { day: string; count: number }[];
  recentActivity: { id: string; action: string; entity: string; userId: string | null; createdAt: string }[];
  unreadNotifications: number;
  business: { customers: number | null; leads: number | null; wonLeads: number | null; openPipelineValue: number | null; pipelineByStage: { stage: string; count: number }[] | null; followUpsDue: number | null; openSurveys: number | null; lowStockItems: number | null };
  pendingMetrics: { key: string; label: string; phase: number }[];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card><CardBody>
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>}
    </CardBody></Card>
  );
}

export function DashboardPage() {
  const locale = useAuth((s) => s.session?.organization.locale);
  const org = useAuth((s) => s.session?.organization.name);
  const money = useMoney();
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(iso(new Date()));
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard', from, to],
    // `to` is end-of-day so today's activity is included
    queryFn: () => api.get<Summary>(`/dashboard/summary${qs({ from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` })}`),
    enabled: !!from && !!to && from <= to,
  });

  return (
    <>
      <PageHeader title="Dashboard" description={`Organization overview for ${org ?? ''}`}
        actions={<div className="flex items-center gap-2 text-sm">
          <Input type="date" aria-label="From date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40" />
          <span className="text-ink-muted">to</span>
          <Input type="date" aria-label="To date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
        </div>} />
      <ErrorNote error={error} />
      {isLoading && <div className="flex justify-center py-20"><Spinner className="h-8 w-8" /></div>}
      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Team members" value={`${data.usage.users}${data.usage.maxUsers ? ` / ${data.usage.maxUsers}` : ''}`} sub="Seats used on your plan" />
            <Stat label="Active users" value={String(data.usage.activeUsers)} />
            <Stat label="Plan" value={data.usage.plan ?? '—'} sub={data.usage.status === 'TRIALING' && data.usage.trialEndsAt ? `Trial ends ${new Date(data.usage.trialEndsAt).toLocaleDateString(locale)}` : data.usage.status ?? undefined} />
            <Stat label="Unread notifications" value={String(data.unreadNotifications)} />
          </div>

          {data.business && Object.values(data.business).some((v) => v !== null) && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {data.business.customers !== null && <Link to="/customers"><Stat label="Customers" value={String(data.business.customers)} /></Link>}
              {data.business.leads !== null && <Link to="/crm"><Stat label="Leads" value={String(data.business.leads)} sub={`${data.business.wonLeads ?? 0} won`} /></Link>}
              {data.business.openPipelineValue !== null && <Link to="/crm"><Stat label="Open pipeline value" value={money(data.business.openPipelineValue, { compact: true })} sub="Expected value of open leads" /></Link>}
              {data.business.followUpsDue !== null && <Link to="/crm"><Stat label="Follow-ups due" value={String(data.business.followUpsDue)} sub={data.business.followUpsDue ? "Needs attention" : "All caught up"} /></Link>}
              {data.business.openSurveys !== null && <Link to="/surveys"><Stat label="Open site surveys" value={String(data.business.openSurveys)} sub="Scheduled or in progress" /></Link>}
              {data.business.lowStockItems !== null && <Link to="/inventory?lowStock=true"><Stat label="Low-stock items" value={String(data.business.lowStockItems)} sub={data.business.lowStockItems ? "At or below reorder level" : "Stock levels healthy"} /></Link>}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Workspace activity" description="Audited actions per day in the selected range" />
              <CardBody>
                {data.activityByDay.length === 0 ? <EmptyState title="No activity in this range" /> : (
                  <div className="h-64" role="img" aria-label="Bar chart of audited actions per day">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.activityByDay} margin={{ left: -16, right: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e3e8ee" vertical={false} />
                        <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#5b6b7c' }} tickFormatter={(d: string) => d.slice(5)} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#5b6b7c' }} />
                        <Tooltip cursor={{ fill: 'rgba(15,42,67,0.05)' }} />
                        <Bar dataKey="count" name="Actions" fill="rgb(var(--accent))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Team by role" />
              <CardBody className="space-y-2">
                {data.usersByRole.map((r) => (
                  <div key={r.role} className="flex items-center justify-between text-sm"><span>{r.role}</span><Badge>{r.count}</Badge></div>
                ))}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Business metrics" description="These switch on automatically as their modules are delivered. Nothing is estimated or mocked." />
            <CardBody className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {data.pendingMetrics.map((m) => (
                <div key={m.key} className="rounded-lg border border-dashed border-surface-line bg-surface-alt p-4">
                  <p className="text-sm text-ink-muted">{m.label}</p>
                  <p className="mt-1 text-lg font-semibold text-ink-muted">—</p>
                  <p className="text-xs text-ink-muted">Available in Phase {m.phase}</p>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Recent activity" action={<Link to="/settings/audit" className="text-sm text-accent hover:underline">View audit log</Link>} />
            <ul className="divide-y divide-surface-line">
              {data.recentActivity.map((a) => (
                <li key={a.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span><span className="font-medium">{a.action}</span> <span className="text-ink-muted">· {a.entity}</span></span>
                  <span className="text-xs text-ink-muted">{formatDateTime(a.createdAt, locale)}</span>
                </li>
              ))}
              {data.recentActivity.length === 0 && <li><EmptyState title="Nothing yet" /></li>}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
