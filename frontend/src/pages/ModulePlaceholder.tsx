import { CheckCircle2, Lock } from 'lucide-react';
import { Link, Navigate } from 'react-router-dom';
import { Badge, Card, CardBody, PageHeader } from '@/components/ui';
import { useAuth } from '@/store/auth';
import type { NavItem } from '@/lib/nav';

/** Honest stand-in for modules scheduled for later phases: no fake data, no dead buttons. */
export function ModulePlaceholder({ item }: { item: NavItem }) {
  const canAny = useAuth((s) => s.canAny);
  if (!canAny(...item.perms)) return <Navigate to="/dashboard" replace />;
  return (
    <>
      <PageHeader title={item.label} description={item.summary} actions={<Badge tone="yellow">Scheduled · Phase {item.phase}</Badge>} />
      <Card>
        <CardBody className="space-y-4">
          <div className="flex items-start gap-3">
            <Lock className="mt-0.5 h-5 w-5 text-ink-muted" />
            <p className="text-sm text-ink-muted">This module is not built yet. It ships in Phase {item.phase} of the roadmap, and nothing here is mocked in the meantime.</p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {item.planned.map((p) => (
              <li key={p} className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-accent" />{p}</li>
            ))}
          </ul>
          <p className="text-sm">Meanwhile, you can set up your <Link to="/settings/branding" className="text-accent hover:underline">branding</Link>, <Link to="/settings/regional" className="text-accent hover:underline">tax configuration</Link> and <Link to="/settings/users" className="text-accent hover:underline">team</Link>.</p>
        </CardBody>
      </Card>
    </>
  );
}
