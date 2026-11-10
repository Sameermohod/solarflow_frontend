import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, ShieldCheck } from 'lucide-react';
import { ALL_MODULE_KEYS, MODULES, dependentsOf, resolveModules } from '@solarflow/shared';
import { platformApi, platformToken } from '@/lib/platformApi';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorNote, Field, Input, Modal, Pagination, Spinner, Table, Td, Th } from '@/components/ui';
import { useDebounced } from '@/components/ui/extra';

interface PlatformOrg {
  id: string; name: string; slug: string; email: string | null; country: string; createdAt: string; enabledModules: string[]; userCount: number;
  subscription: { plan: string; status: string; maxUsers: number; currentPeriodEnd: string | null } | null;
}
interface Page<T> { data: T[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }
interface Admin { id: string; email: string; name: string }

const label = (k: string) => MODULES.find((m) => m.key === k)?.label ?? k;

/** /platform/login: the super admin's own sign-in, separate from company logins. */
export function PlatformLoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => platformApi.post<{ token: string; admin: Admin }>('/auth/login', { email, password }),
    onSuccess: (r) => { platformToken.set(r.token); nav('/platform', { replace: true }); },
  });
  if (platformToken.get()) return <Navigate to="/platform" replace />;
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-alt px-4">
      <form className="w-full max-w-sm space-y-4 rounded-xl border border-surface-line bg-white p-6 shadow-card" onSubmit={(e) => { e.preventDefault(); login.mutate(); }}>
        <div className="flex items-center gap-2"><ShieldCheck className="h-6 w-6 text-brand" /><h1 className="text-lg font-semibold">Platform administration</h1></div>
        <p className="text-sm text-ink-muted">Sign in as the platform super admin. Company users sign in on the normal login page.</p>
        <Field label="Email"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <ErrorNote error={login.error} />
        <Button type="submit" className="w-full" loading={login.isPending} disabled={!email || !password}>Sign in</Button>
      </form>
    </div>
  );
}

function ModulesModal({ org, onClose }: { org: PlatformOrg; onClose: () => void }) {
  const qc = useQueryClient();
  const [sel, setSel] = useState<string[]>(org.enabledModules);
  const [hint, setHint] = useState('');
  const save = useMutation({
    mutationFn: () => platformApi.put<PlatformOrg>(`/organizations/${org.id}/modules`, { modules: sel }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['platform-orgs'] }); onClose(); },
  });
  const toggle = (key: string, on: boolean) => {
    if (on) {
      const next = resolveModules([...sel, key]);
      const added = next.filter((k) => !sel.includes(k) && k !== key);
      setHint(added.length ? `${label(key)} also needs ${added.map(label).join(', ')}, so ${added.length === 1 ? 'it was' : 'they were'} switched on.` : '');
      setSel(next);
    } else {
      const off = [key, ...dependentsOf(key)];
      const extra = off.filter((k) => k !== key && sel.includes(k));
      setHint(extra.length ? `${extra.map(label).join(', ')} depend${extra.length === 1 ? 's' : ''} on ${label(key)}, so ${extra.length === 1 ? 'it was' : 'they were'} switched off too.` : '');
      setSel(sel.filter((k) => !off.includes(k)));
    }
  };
  const changed = JSON.stringify([...sel].sort()) !== JSON.stringify([...org.enabledModules].sort());
  const removed = org.enabledModules.filter((k) => !sel.includes(k));
  return (
    <Modal open wide title={`Modules for ${org.name}`} onClose={onClose}>
      <p className="mb-3 text-sm text-ink-muted">
        The company can use only the modules ticked here. Dashboard, settings, team, roles and the audit log are always available. Changes apply immediately, including to people who are signed in.
      </p>
      <div className="mb-3 flex gap-2">
        <Button size="sm" variant="outline" onClick={() => { setSel([...ALL_MODULE_KEYS]); setHint(''); }}>Enable all</Button>
        <Button size="sm" variant="outline" onClick={() => { setSel([]); setHint(''); }}>Core only</Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {MODULES.map((m) => (
          <label key={m.key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-surface-line p-3 text-sm hover:bg-surface-alt">
            <input type="checkbox" className="mt-1" checked={sel.includes(m.key)} onChange={(e) => toggle(m.key, e.target.checked)} />
            <span>
              <span className="block font-medium">{m.label}</span>
              <span className="block text-xs text-ink-muted">{m.description}</span>
              {m.requires.length > 0 && <span className="block text-[11px] text-ink-muted">Needs: {m.requires.map(label).join(', ')}</span>}
            </span>
          </label>
        ))}
      </div>
      {hint && <p role="status" className="mt-3 rounded bg-sky-50 px-3 py-2 text-xs text-sky-800">{hint}</p>}
      {removed.length > 0 && <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">Turning off {removed.map(label).join(', ')} hides it from every user of this company straight away. Their data is kept and returns if you switch it back on.</p>}
      <ErrorNote error={save.error} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="accent" loading={save.isPending} disabled={!changed} onClick={() => save.mutate()}>Save modules</Button>
      </div>
    </Modal>
  );
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const m = useMutation({ mutationFn: () => platformApi.post('/auth/change-password', { currentPassword: cur, newPassword: next }), onSuccess: onClose });
  return (
    <Modal open title="Change password" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Current password"><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
        <Field label="New password" hint="At least 12 characters, with letters and a number"><Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        <ErrorNote error={m.error} />
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={m.isPending} disabled={!cur || next.length < 12} onClick={() => m.mutate()}>Change password</Button></div>
    </Modal>
  );
}

/** /platform: every company with its enabled modules. */
export function PlatformConsolePage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<PlatformOrg | null>(null);
  const [pw, setPw] = useState(false);
  const q = useDebounced(search, 300);
  const signedIn = !!platformToken.get();
  const me = useQuery({ queryKey: ['platform-me'], queryFn: () => platformApi.get<Admin>('/auth/me'), enabled: signedIn, retry: false });
  const orgs = useQuery({ queryKey: ['platform-orgs', q, page], queryFn: () => platformApi.get<Page<PlatformOrg>>(`/organizations?page=${page}&pageSize=15${q ? `&search=${encodeURIComponent(q)}` : ''}`), enabled: signedIn, retry: false });
  useEffect(() => { setPage(1); }, [q]);
  useEffect(() => {
    const out = () => { qc.clear(); nav('/platform/login', { replace: true }); };
    window.addEventListener('sf:platform-logout', out);
    return () => window.removeEventListener('sf:platform-logout', out);
  }, [nav, qc]);
  if (!signedIn) return <Navigate to="/platform/login" replace />;
  const signOut = () => { platformToken.clear(); qc.clear(); nav('/platform/login', { replace: true }); };
  const total = ALL_MODULE_KEYS.length;

  return (
    <div className="min-h-screen bg-surface-alt">
      <header className="flex flex-wrap items-center gap-3 border-b border-surface-line bg-white px-6 py-3">
        <ShieldCheck className="h-5 w-5 text-brand" /><h1 className="text-base font-semibold">Platform administration</h1>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-ink-muted">{me.data?.email}</span>
          <Button size="sm" variant="ghost" onClick={() => setPw(true)}>Change password</Button>
          <Button size="sm" variant="outline" onClick={signOut}><LogOut className="h-4 w-4" />Sign out</Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-6">
        <Card>
          <CardHeader title="Companies" description="Choose which modules each company can use." action={<Input aria-label="Search companies" className="w-64" placeholder="Search name, address or email" value={search} onChange={(e) => setSearch(e.target.value)} />} />
          <CardBody className="p-0">
            {orgs.isLoading ? <div className="flex justify-center py-12"><Spinner className="h-8 w-8" /></div> : orgs.error ? <div className="p-5"><ErrorNote error={orgs.error} /></div> : !orgs.data?.data.length ? <EmptyState title="No companies found" description="Companies appear here once they sign up." /> : (
              <Table>
                <thead><tr><Th>Company</Th><Th>Workspace</Th><Th>Users</Th><Th>Plan</Th><Th>Modules</Th><Th /></tr></thead>
                <tbody>
                  {orgs.data.data.map((o) => (
                    <tr key={o.id} className="border-t border-surface-line">
                      <Td><p className="font-medium">{o.name}</p><p className="text-xs text-ink-muted">{o.email ?? ''}</p></Td>
                      <Td>{o.slug}</Td>
                      <Td>{o.userCount}</Td>
                      <Td>{o.subscription ? <Badge tone={o.subscription.status === 'CANCELLED' ? 'red' : 'neutral'}>{o.subscription.plan} · {o.subscription.status}</Badge> : '-'}</Td>
                      <Td><Badge tone={o.enabledModules.length === total ? 'green' : 'yellow'}>{o.enabledModules.length} of {total}</Badge></Td>
                      <Td className="text-right"><Button size="sm" variant="outline" onClick={() => setEditing(o)}>Manage modules</Button></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
          {orgs.data && orgs.data.meta.totalPages > 1 && <div className="border-t border-surface-line p-3"><Pagination page={orgs.data.meta.page} totalPages={orgs.data.meta.totalPages} total={orgs.data.meta.total} onPage={setPage} /></div>}
        </Card>
        <p className="mt-3 text-xs text-ink-muted">New companies start with every module (or the list in DEFAULT_ENABLED_MODULES). Changes are written to the company's audit log.</p>
      </main>
      {editing && <ModulesModal org={editing} onClose={() => setEditing(null)} />}
      {pw && <PasswordModal onClose={() => setPw(false)} />}
    </div>
  );
}
