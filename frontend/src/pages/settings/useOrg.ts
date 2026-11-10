import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ProposalProfile } from '@solarflow/shared';
import { useAuth, type Organization } from '@/store/auth';

export interface TaxRate { code: string; label: string; rate: number; active: boolean }
export interface OrgFull extends Organization {
  legalName: string | null; registrationNumber: string | null; taxId: string | null; email: string | null; phone: string | null; website: string | null;
  address: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string } | null;
  taxConfig: { regime: string; pricesIncludeTax: boolean; rates: TaxRate[] };
  invoiceSettings: { prefix: string; paymentTermsDays: number; termsAndConditions: string; footerNote: string; bankDetails: string; showLogo: boolean; showSignatureBlock: boolean; accentColor?: string };
  proposalProfile?: ProposalProfile;
  customDomain: string | null; customDomainVerified: boolean;
  customDomainVerification: { recordType: string; host: string; value: string } | null;
  subscription: { plan: string; status: string; maxUsers: number; maxProjects: number; maxStorageMb: number; currentPeriodEnd: string | null; usage: { users: number } } | null;
}

export const useOrg = () => useQuery({ queryKey: ['org'], queryFn: () => api.get<OrgFull>('/organizations/current') });

/** Mutation against /organizations/current/* that refreshes both the org cache and the themed session. */
export function useOrgMutation<T>(call: (v: T) => Promise<OrgFull>) {
  const qc = useQueryClient();
  const { session, setSession } = useAuth();
  return useMutation({
    mutationFn: call,
    onSuccess: (org) => {
      qc.setQueryData(['org'], org);
      if (session) setSession({ ...session, organization: { ...session.organization, ...pickBranding(org) } });
    },
  });
}

const pickBranding = (o: OrgFull): Organization => ({
  id: o.id, name: o.name, slug: o.slug, logoUrl: o.logoUrl, primaryColor: o.primaryColor, accentColor: o.accentColor,
  currency: o.currency, country: o.country, locale: o.locale, timezone: o.timezone, measurementSystem: o.measurementSystem,
});
