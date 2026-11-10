import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACTIONS, RESOURCES } from '@solarflow/shared';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { Badge, Button, Card, CardHeader, ErrorNote, Input, Modal, Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';

interface RoleView { id: string; key: string; name: string; description: string | null; isSystem: boolean; userCount: number; permissions: string[] }

export function RolesTab() {
  const qc = useQueryClient();
  const { can, session } = useAuth();
  const isOwner = !!session?.roles.some((r) => r.key === 'ORG_OWNER');
  const { data } = useQuery({ queryKey: ['roles-full'], queryFn: () => api.get<{ data: RoleView[] }>('/roles') });
  const [selId, setSelId] = useState<string>();
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const roles = data?.data ?? [];
  const sel = roles.find((r) => r.id === selId) ?? roles[0];

  useEffect(() => { if (sel) setDraft(new Set(sel.permissions)); }, [sel?.id, sel?.permissions.join(',')]);  // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => { qc.invalidateQueries({ queryKey: ['roles-full'] }); qc.invalidateQueries({ queryKey: ['roles'] }); };
  const save = useMutation({ mutationFn: () => api.put(`/roles/${sel!.id}`, { permissions: [...draft] }), onSuccess: refresh });
  const create = useMutation({ mutationFn: () => api.post<RoleView>('/roles', { name: newName, permissions: [] }), onSuccess: (r) => { refresh(); setCreating(false); setNewName(''); setSelId(r.id); } });
  const del = useMutation({ mutationFn: () => api.delete(`/roles/${sel!.id}`), onSuccess: () => { setSelId(undefined); refresh(); } });

  if (!data) return <div className="flex justify-center py-16"><Spinner className="h-8 w-8" /></div>;
  const locked = !sel || sel.key === 'ORG_OWNER' || !can('role:edit') || (sel.key === 'ORG_ADMIN' && !isOwner);
  const mine = new Set(session?.permissions ?? []);
  const dirty = sel && (draft.size !== sel.permissions.length || sel.permissions.some((p) => !draft.has(p)));
  const toggle = (key: string) => setDraft((d) => { const n = new Set(d); n.has(key) ? n.delete(key) : n.add(key); return n; });

  return (
    <div className="grid gap-6 xl:grid-cols-[260px_1fr]">
      <Card>
        <CardHeader title="Roles" action={can('role:create') ? <Button size="sm" variant="outline" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New</Button> : undefined} />
        <ul>
          {roles.map((r) => (
            <li key={r.id}>
              <button onClick={() => setSelId(r.id)} className={cn('flex w-full items-center justify-between border-b border-surface-line px-4 py-2.5 text-left text-sm hover:bg-surface-alt', sel?.id === r.id && 'bg-surface-alt font-medium')}>
                <span>{r.name}</span><span className="text-xs text-ink-muted">{r.userCount}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {sel && (
        <Card>
          <CardHeader title={sel.name} description={sel.key === 'ORG_OWNER' ? 'The Owner role always has every permission and cannot be edited.' : 'Choose what this role can do. You can only grant permissions you hold yourself.'}
            action={<div className="flex items-center gap-2">{sel.isSystem && <Badge>System</Badge>}{!sel.isSystem && can('role:delete') && <Button size="sm" variant="ghost" aria-label="Delete role" onClick={() => del.mutate()}><Trash2 className="h-4 w-4 text-red-600" /></Button>}</div>} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr><th className="bg-surface-alt px-4 py-2 text-left text-xs font-semibold uppercase text-ink-muted">Resource</th>{ACTIONS.map((a) => <th key={a} className="bg-surface-alt px-2 py-2 text-center text-xs font-semibold uppercase text-ink-muted">{a}</th>)}</tr></thead>
              <tbody>
                {RESOURCES.map((res) => (
                  <tr key={res} className="border-t border-surface-line">
                    <td className="px-4 py-2 capitalize">{res.replace(/([A-Z])/g, ' $1')}</td>
                    {ACTIONS.map((a) => {
                      const key = `${res}:${a}`;
                      const cannotGrant = !isOwner && !mine.has(key) && !draft.has(key);
                      return <td key={a} className="px-2 py-2 text-center"><input type="checkbox" aria-label={`${sel.name} ${res} ${a}`} checked={draft.has(key)} disabled={locked || cannotGrant} onChange={() => toggle(key)} /></td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 border-t border-surface-line px-5 py-3">
            {!locked && <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>Save permissions</Button>}
            {save.isSuccess && !dirty && <span role="status" className="text-sm text-accent">Saved</span>}
            <ErrorNote error={save.error ?? del.error} />
          </div>
        </Card>
      )}
      <Modal open={creating} title="New custom role" onClose={() => setCreating(false)}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (newName.trim().length >= 2) create.mutate(); }}>
          <label className="block space-y-1.5 text-sm font-medium">Role name<Input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus /></label>
          <p className="text-xs text-ink-muted">You will choose its permissions next.</p>
          <ErrorNote error={create.error} />
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button><Button type="submit" loading={create.isPending}>Create role</Button></div>
        </form>
      </Modal>
    </div>
  );
}
