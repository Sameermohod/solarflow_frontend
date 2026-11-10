import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import type { PermissionKey } from '@solarflow/shared';
import { useAuth } from '@/store/auth';

/** Route-level permission check. The API enforces permissions too; this just avoids dead-end screens. */
export function Guard({ perm, children }: { perm: PermissionKey; children: ReactNode }) {
  const can = useAuth((s) => s.can);
  return can(perm) ? <>{children}</> : <Navigate to="/dashboard" replace />;
}
