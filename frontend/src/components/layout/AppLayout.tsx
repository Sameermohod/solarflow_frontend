import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, LogOut, Menu, Search, Sun, X } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { CURRENT_PHASE, NAV, isLive } from '@/lib/nav';
import { cn, formatDateTime } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { Spinner } from '@/components/ui';

export function BrandMark({ name, logoUrl, onDark }: { name: string; logoUrl: string | null; onDark?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {logoUrl
        ? <img src={logoUrl} alt={`${name} logo`} className="h-8 w-8 rounded-md bg-white object-contain p-0.5" />
        : <span className="flex h-8 w-8 items-center justify-center rounded-md bg-sun text-ink"><Sun className="h-5 w-5" /></span>}
      <span className={cn('truncate text-sm font-semibold', onDark ? 'text-brand-fg' : 'text-ink')}>{name}</span>
    </div>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const can = useAuth((s) => s.canAny);
  const ref = useRef<HTMLDivElement>(null);
  const term = q.trim().toLowerCase();

  const pages = term.length < 1 ? [] : NAV.filter((n) => can(...n.perms) && n.label.toLowerCase().includes(term));
  const { data, isFetching } = useQuery({
    queryKey: ['search', term],
    queryFn: () => api.get<{ data: { type: string; id: string; title: string; subtitle?: string; href: string }[] }>(`/search${qs({ q: term })}`),
    enabled: term.length >= 2,
  });

  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const go = (href: string) => { setOpen(false); setQ(''); nav(href); };
  return (
    <div ref={ref} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-muted" />
      <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        placeholder="Search pages and people…" aria-label="Global search"
        className="h-9 w-full rounded-lg border border-surface-line bg-surface-alt pl-9 pr-3 text-sm focus:border-accent focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/30" />
      {open && term.length >= 1 && (
        <div className="absolute z-40 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-surface-line bg-white py-1 shadow-lg">
          {pages.map((p) => (
            <button key={p.key} onClick={() => go(p.path)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-alt">
              <p.icon className="h-4 w-4 text-ink-muted" /> {p.label}
            </button>
          ))}
          {data?.data.map((r) => (
            <button key={`${r.type}-${r.id}`} onClick={() => go(r.href)} className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-alt">
              <span className="font-medium">{r.title}</span> <span className="text-xs text-ink-muted">{r.type}{r.subtitle ? ` · ${r.subtitle}` : ''}</span>
            </button>
          ))}
          {isFetching && <div className="px-3 py-2"><Spinner className="h-4 w-4" /></div>}
          {!isFetching && pages.length === 0 && !data?.data.length && <p className="px-3 py-2 text-sm text-ink-muted">No results</p>}
        </div>
      )}
    </div>
  );
}

interface NotificationList { data: { id: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }[]; unread: number }

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const locale = useAuth((s) => s.session?.organization.locale);
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => api.get<NotificationList>('/notifications?pageSize=10'), refetchInterval: 60_000 });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: invalidate });
  const readOne = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: invalidate });

  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Notifications" className="relative rounded-lg p-2 text-ink-muted hover:bg-surface-alt">
        <Bell className="h-5 w-5" />
        {!!data?.unread && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">{data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-80 rounded-lg border border-surface-line bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-surface-line px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {!!data?.unread && <button onClick={() => readAll.mutate()} className="text-xs text-accent hover:underline">Mark all read</button>}
          </div>
          <div className="max-h-80 overflow-auto">
            {!data?.data.length && <p className="px-3 py-6 text-center text-sm text-ink-muted">You're all caught up.</p>}
            {data?.data.map((n) => (
              <button key={n.id} onClick={() => { if (!n.readAt) readOne.mutate(n.id); if (n.link) { setOpen(false); nav(n.link); } }}
                className={cn('block w-full border-b border-surface-line px-3 py-2.5 text-left last:border-0 hover:bg-surface-alt', !n.readAt && 'bg-sun-soft/50')}>
                <p className="text-sm font-medium">{n.title}</p>
                {n.body && <p className="text-xs text-ink-muted">{n.body}</p>}
                <p className="mt-0.5 text-[11px] text-ink-muted">{formatDateTime(n.createdAt, locale)}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { session, canAny, clear } = useAuth();
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  // The 2D/3D designers are full-bleed workspaces rather than padded page layouts.
  const workspace = /^\/designer-(2d|3d)\/[^/]+/.test(loc.pathname);
  if (!session) return null;

  const items = NAV.filter((n) => canAny(...n.perms));
  const logout = async () => {
    try { await api.post('/auth/logout'); } finally { qc.clear(); clear(); nav('/login'); }
  };

  const sidebar = (
    <nav className="flex h-full flex-col bg-brand text-brand-fg" aria-label="Main">
      <div className="flex h-14 items-center justify-between px-4"><BrandMark name={session.organization.name} logoUrl={session.organization.logoUrl} onDark />
        <button className="lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button></div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
        {items.map((n) => (
          <li key={n.key}>
            <NavLink to={n.path} className={({ isActive }) => cn('flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors', isActive ? 'bg-white/15 font-medium' : 'opacity-80 hover:bg-white/10 hover:opacity-100')}>
              <n.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">{n.label}</span>
              {!isLive(n) && <span className="rounded bg-white/15 px-1.5 text-[10px] uppercase tracking-wide">Soon</span>}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="border-t border-white/10 p-3 text-xs opacity-70">SolarFlow · Phase {CURRENT_PHASE}</div>
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 lg:block">{sidebar}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="w-64">{sidebar}</div>
          <button className="flex-1 bg-ink/40" aria-label="Close menu overlay" onClick={() => setMobileOpen(false)} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-surface-line bg-white px-4">
          <button className="rounded-lg p-2 hover:bg-surface-alt lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-4">{session.user.firstName} {session.user.lastName}</p>
              <p className="text-xs text-ink-muted">{session.roles.map((r) => r.name).join(', ')}</p>
            </div>
            <button onClick={logout} aria-label="Sign out" className="rounded-lg p-2 text-ink-muted hover:bg-surface-alt"><LogOut className="h-5 w-5" /></button>
          </div>
        </header>
        {workspace
          ? <main className="min-h-0 flex-1 overflow-hidden"><Outlet /></main>
          : <main className="flex-1 overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-7xl"><Outlet /></div></main>}
      </div>
    </div>
  );
}
