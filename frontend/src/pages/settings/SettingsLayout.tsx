import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { SETTINGS_TABS } from '@/lib/nav';
import { useAuth } from '@/store/auth';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui';

export function SettingsIndex() {
  const canAny = useAuth((s) => s.canAny);
  const first = SETTINGS_TABS.find((t) => t.perms.length === 0 || canAny(...t.perms));
  return <Navigate to={first?.path ?? 'account'} replace />;
}

export function SettingsLayout() {
  const canAny = useAuth((s) => s.canAny);
  const tabs = SETTINGS_TABS.filter((t) => t.perms.length === 0 || canAny(...t.perms));
  return (
    <>
      <PageHeader title="Settings" description="Workspace, branding, tax, team and security" />
      <div className="flex flex-col gap-6 lg:flex-row">
        <nav aria-label="Settings" className="flex shrink-0 gap-1 overflow-x-auto lg:w-56 lg:flex-col">
          {tabs.map((t) => (
            <NavLink key={t.path} to={t.path} className={({ isActive }) => cn('flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm', isActive ? 'bg-white font-medium shadow-card' : 'text-ink-muted hover:bg-white/70')}>
              <t.icon className="h-4 w-4" />{t.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 flex-1"><Outlet /></div>
      </div>
    </>
  );
}
