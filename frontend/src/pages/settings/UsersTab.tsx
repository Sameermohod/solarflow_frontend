import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { createUserSchema } from '@solarflow/shared';
import { z } from 'zod';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { formatDateTime } from '@/lib/utils';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, Pagination, Select, Spinner, Table, Td, Th } from '@/components/ui';

interface Role { id: string; key: string; name: string }
interface UserRow { id: string; email: string; firstName: string; lastName: string; phone: string | null; status: 'ACTIVE' | 'DISABLED'; lastLoginAt: string | null; roles: Role[] }
interface Page<T> { data: T[]; meta: { page: number; totalPages: number; total: number } }

function useRoles() {
  return useQuery({ queryKey: ['roles'], queryFn: () => api.get<{ data: Role[] }>('/roles'), staleTime: 60_000 });
}

function RolePicker({ value, onChange, roles, canGrantOwner }: { value: string[]; onChange: (v: string[]) => void; roles: Role[]; canGrantOwner: boolean }) {
  return (
    <fieldset className="grid gap-1.5 sm:grid-cols-2">
      <legend className="mb-1.5 text-sm font-medium">Roles</legend>
      {roles.filter((r) => canGrantOwner || r.key !== 'ORG_OWNER').map((r) => (
        <label key={r.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.includes(r.id)} onChange={(e) => onChange(e.target.checked ? [...value, r.id] : value.filter((x) => x !== r.id))} />{r.name}
        </label>
      ))}
    </fieldset>
  );
}

const createForm = createUserSchema.omit({ roleIds: true });
type CreateForm = z.infer<typeof createForm>;

function UserModal({ user, roles, onClose }: { user: UserRow | null; roles: Role[]; onClose: () => void }) {
  const qc = useQueryClient();
  const me = useAuth((s) => s.session);
  const isOwner = !!me?.roles.some((r) => r.key === 'ORG_OWNER');
  const [roleIds, setRoleIds] = useState<string[]>(user?.roles.map((r) => r.id) ?? []);
  const [status, setStatus] = useState<'ACTIVE' | 'DISABLED'>(user?.status ?? 'ACTIVE');
  const [roleErr, setRoleErr] = useState('');
  const { register, handleSubmit, formState: { errors } } = useForm<CreateForm>({
    resolver: zodResolver(createForm),
    defaultValues: user ? { email: user.email, firstName: user.firstName, lastName: user.lastName, phone: user.phone ?? '', password: 'Placeholder1!x' } : undefined,
  });
  const done = () => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['org'] }); onClose(); };
  const create = useMutation({ mutationFn: (v: CreateForm) => api.post('/users', { ...v, roleIds }), onSuccess: done });
  const update = useMutation({ mutationFn: (v: CreateForm) => api.patch(`/users/${user!.id}`, { firstName: v.firstName, lastName: v.lastName, phone: v.phone || null, status, roleIds }), onSuccess: done });
  const mut = user ? update : create;
  const submit = (v: CreateForm) => { if (!roleIds.length) return setRoleErr('Select at least one role'); setRoleErr(''); mut.mutate(v); };
  const editingSelf = user?.id === me?.user.id;

  return (
    <Modal open title={user ? 'Edit team member' : 'Add team member'} onClose={onClose}>
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="u-first" error={errors.firstName?.message}><Input id="u-first" {...register('firstName')} /></Field>
          <Field label="Last name" htmlFor="u-last" error={errors.lastName?.message}><Input id="u-last" {...register('lastName')} /></Field>
        </div>
        <Field label="Email" htmlFor="u-email" error={errors.email?.message}><Input id="u-email" type="email" disabled={!!user} {...register('email')} /></Field>
        <Field label="Phone" htmlFor="u-phone"><Input id="u-phone" {...register('phone')} /></Field>
        {!user && <Field label="Temporary password" htmlFor="u-pw" hint="Share it securely; the user can change it under My account" error={errors.password?.message}><Input id="u-pw" type="text" autoComplete="off" {...register('password')} /></Field>}
        <RolePicker value={roleIds} onChange={setRoleIds} roles={roles} canGrantOwner={isOwner} />
        {roleErr && <p role="alert" className="text-xs text-red-600">{roleErr}</p>}
        {user && !editingSelf && (
          <Field label="Status" htmlFor="u-status"><Select id="u-status" value={status} onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'DISABLED')}><option value="ACTIVE">Active</option><option value="DISABLED">Disabled (cannot sign in)</option></Select></Field>
        )}
        <ErrorNote error={mut.error} />
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={mut.isPending}>{user ? 'Save changes' : 'Add member'}</Button></div>
      </form>
    </Modal>
  );
}

export function UsersTab() {
  const qc = useQueryClient();
  const { can, session } = useAuth();
  const locale = session?.organization.locale;
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [confirmDel, setConfirmDel] = useState<UserRow | null>(null);
  const roles = useRoles();
  const { data, isLoading, error } = useQuery({
    queryKey: ['users', page, search, status],
    queryFn: () => api.get<Page<UserRow>>(`/users${qs({ page, pageSize: 15, search, status, sort: 'createdAt', order: 'desc' })}`),
    placeholderData: (p) => p,
  });
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/users/${id}`), onSuccess: () => { setConfirmDel(null); qc.invalidateQueries({ queryKey: ['users'] }); } });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-line px-5 py-4">
        <div className="flex flex-1 flex-wrap gap-2">
          <Input aria-label="Search team" placeholder="Search name or email…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="max-w-xs" />
          <Select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40"><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="DISABLED">Disabled</option></Select>
        </div>
        {can('user:create') && <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" />Add member</Button>}
      </div>
      <ErrorNote error={error ?? del.error} />
      {isLoading ? <div className="flex justify-center py-14"><Spinner className="h-7 w-7" /></div> : !data?.data.length ? <EmptyState title="No team members found" /> : (
        <>
          <Table>
            <thead><tr><Th>Name</Th><Th>Roles</Th><Th>Status</Th><Th>Last sign-in</Th><Th className="text-right">Actions</Th></tr></thead>
            <tbody>
              {data.data.map((u) => (
                <tr key={u.id}>
                  <Td><p className="font-medium">{u.firstName} {u.lastName}</p><p className="text-xs text-ink-muted">{u.email}</p></Td>
                  <Td><div className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r.id} tone={r.key === 'ORG_OWNER' ? 'yellow' : 'neutral'}>{r.name}</Badge>)}</div></Td>
                  <Td><Badge tone={u.status === 'ACTIVE' ? 'green' : 'red'}>{u.status === 'ACTIVE' ? 'Active' : 'Disabled'}</Badge></Td>
                  <Td className="text-ink-muted">{u.lastLoginAt ? formatDateTime(u.lastLoginAt, locale) : 'Never'}</Td>
                  <Td className="text-right">
                    {can('user:edit') && <Button size="icon" variant="ghost" aria-label={`Edit ${u.firstName} ${u.lastName}`} onClick={() => setEditing(u)}><Pencil className="h-4 w-4" /></Button>}
                    {can('user:delete') && u.id !== session?.user.id && <Button size="icon" variant="ghost" aria-label={`Delete ${u.firstName} ${u.lastName}`} onClick={() => setConfirmDel(u)}><Trash2 className="h-4 w-4 text-red-600" /></Button>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} onPage={setPage} />
        </>
      )}
      {editing && roles.data && <UserModal user={editing === 'new' ? null : editing} roles={roles.data.data} onClose={() => setEditing(null)} />}
      <Modal open={!!confirmDel} title="Delete team member?" onClose={() => setConfirmDel(null)}>
        <p className="text-sm text-ink-muted">{confirmDel?.firstName} {confirmDel?.lastName} will lose access immediately. Their past activity stays in the audit log.</p>
        <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirmDel(null)}>Cancel</Button><Button variant="danger" loading={del.isPending} onClick={() => confirmDel && del.mutate(confirmDel.id)}>Delete</Button></div>
      </Modal>
    </Card>
  );
}
