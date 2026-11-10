import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { changePasswordSchema } from '@solarflow/shared';
import { z } from 'zod';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { Button, Card, CardBody, CardHeader, ErrorNote, Field, Input } from '@/components/ui';

const schema = changePasswordSchema.extend({ confirm: z.string() }).refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });
type F = z.infer<typeof schema>;

export function AccountTab() {
  const { session, clear } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors } } = useForm<F>({ resolver: zodResolver(schema) });
  const change = useMutation({
    mutationFn: ({ currentPassword, newPassword }: F) => api.post('/auth/change-password', { currentPassword, newPassword }),
    // the server revokes every session, so sign in again
    onSuccess: () => { qc.clear(); clear(); nav('/login'); },
  });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="My account" />
        <CardBody className="grid gap-1 text-sm">
          <p><span className="text-ink-muted">Name: </span>{session?.user.firstName} {session?.user.lastName}</p>
          <p><span className="text-ink-muted">Email: </span>{session?.user.email}</p>
          <p><span className="text-ink-muted">Roles: </span>{session?.roles.map((r) => r.name).join(', ')}</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Change password" description="You'll be signed out everywhere and asked to sign in again." />
        <form onSubmit={handleSubmit((v) => change.mutate(v))} noValidate className="space-y-4 p-5">
          <Field label="Current password" htmlFor="cp" error={errors.currentPassword?.message}><Input id="cp" type="password" autoComplete="current-password" {...register('currentPassword')} /></Field>
          <Field label="New password" htmlFor="np" error={errors.newPassword?.message}><Input id="np" type="password" autoComplete="new-password" {...register('newPassword')} /></Field>
          <Field label="Confirm new password" htmlFor="cf" error={errors.confirm?.message}><Input id="cf" type="password" autoComplete="new-password" {...register('confirm')} /></Field>
          <ErrorNote error={change.error} />
          <Button type="submit" loading={change.isPending}>Update password</Button>
        </form>
      </Card>
    </div>
  );
}
