import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { designConfigSchema, type DesignConfig, type DesignSummary } from '@solarflow/shared';
import { api, ApiError } from '@/lib/api';
import { useDesign } from './store';

export interface DesignRecord {
  id: string; name: string; status: 'DRAFT' | 'APPROVED'; latestVersion: number; approvedVersion: number | null; approvedAt: string | null; updatedAt: string; createdAt: string;
  customerId: string | null; surveyId: string | null; calculationId: string | null;
  customer: { id: string; name: string } | null;
}
export interface DesignDetail extends DesignRecord {
  version: { version: number; label: string | null; config: unknown; createdAt: string };
  summary: DesignSummary;
}
export interface VersionRow { version: number; label: string | null; panelCount: number; validPanelCount: number; installedKwp: string; roofAreaM2: string; issueCount: number; createdAt: string }

export const designKey = (id: string) => ['design', id] as const;

let pendingClear: ReturnType<typeof setTimeout> | null = null;

/** Load a design into the editor store once per design id (and when the id changes). */
export function useDesignLoader(id: string) {
  // gcTime 0: never serve a cached (stale) copy when an editor is opened again.
  const q = useQuery({ queryKey: designKey(id), queryFn: () => api.get<DesignDetail>(`/solar-designs/${id}`), staleTime: 0, gcTime: 0, refetchOnMount: 'always' });
  const loaded = useDesign((s) => s.designId);
  // An editor mounting (including React StrictMode's simulated remount in dev) cancels a clear scheduled by one that just unmounted.
  useEffect(() => { if (pendingClear) { clearTimeout(pendingClear); pendingClear = null; } }, []);
  useEffect(() => {
    if (!q.data || q.isFetching) return;
    const cur = useDesign.getState();
    // Switching 2D <-> 3D keeps the live document (including unsaved edits and undo history).
    if (cur.designId === q.data.id && cur.config) return;
    const parsed = designConfigSchema.safeParse(q.data.version.config);
    if (!parsed.success) return;
    cur.load({ designId: q.data.id, name: q.data.name, version: q.data.latestVersion, config: parsed.data });
  }, [q.data, q.isFetching]);
  useEffect(() => () => {
    const s = useDesign.getState();
    if (s.keepOnUnmount) { useDesign.setState({ keepOnUnmount: false }); return; }
    // Deferred so a remount right after (StrictMode, or a 2D/3D switch) keeps the live document.
    pendingClear = setTimeout(() => { pendingClear = null; useDesign.setState({ designId: null, config: null, past: [], future: [], selection: null }); }, 60);
  }, [id]);
  return { ...q, ready: loaded === id };
}

export function useSaveDesign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (label?: string) => {
      const s = useDesign.getState();
      if (!s.designId || !s.config) throw new Error('Nothing to save');
      return api.post<{ version: VersionRow }>(`/solar-designs/${s.designId}/versions`, { config: s.config, baseVersion: s.baseVersion, label: label || null });
    },
    onSuccess: (r) => {
      useDesign.getState().markSaved(r.version.version);
      const id = useDesign.getState().designId!;
      qc.invalidateQueries({ queryKey: ['design-versions', id] });
      qc.invalidateQueries({ queryKey: ['designs'] });
      qc.setQueryData<DesignDetail | undefined>(designKey(id), (d) => (d ? { ...d, latestVersion: r.version.version } : d));
    },
  });
}

export const isConflict = (e: unknown) => e instanceof ApiError && e.status === 409;

export const useVersions = (id: string, enabled = true) =>
  useQuery({ queryKey: ['design-versions', id], queryFn: () => api.get<{ data: VersionRow[] }>(`/solar-designs/${id}/versions`).then((r) => r.data), enabled });

export async function fetchVersionConfig(id: string, v: number): Promise<DesignConfig> {
  const r = await api.get<{ config: unknown }>(`/solar-designs/${id}/versions/${v}`);
  return designConfigSchema.parse(r.config);
}
