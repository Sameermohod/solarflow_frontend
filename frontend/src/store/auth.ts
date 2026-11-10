import { create } from 'zustand';
import type { PermissionKey } from '@solarflow/shared';
import { tokenStore } from '@/lib/api';
import { applyBranding } from '@/lib/branding';

export interface Organization {
  id: string; name: string; slug: string; logoUrl: string | null; primaryColor: string; accentColor: string;
  currency: string; country: string; locale: string; timezone: string; measurementSystem: 'METRIC' | 'IMPERIAL';
}
export interface SessionPayload {
  accessToken?: string;
  user: { id: string; email: string; firstName: string; lastName: string; phone: string | null };
  organization: Organization;
  roles: { id: string; key: string; name: string }[];
  permissions: string[];
  /** Product modules the platform has enabled for this company (permissions of the others are already removed). */
  enabledModules?: string[];
}

interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  session: SessionPayload | null;
  setSession: (s: SessionPayload) => void;
  clear: () => void;
  can: (p: PermissionKey) => boolean;
  canAny: (...p: PermissionKey[]) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  session: null,
  setSession: (s) => {
    if (s.accessToken) tokenStore.set(s.accessToken);
    applyBranding(s.organization);
    set({ status: 'authenticated', session: s });
  },
  clear: () => {
    tokenStore.set(null);
    applyBranding(null);
    set({ status: 'anonymous', session: null });
  },
  can: (p) => !!get().session?.permissions.includes(p),
  canAny: (...ps) => ps.some((p) => get().session?.permissions.includes(p)),
}));
