import { useEffect, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { loginSchema, registerSchema, type LoginInput } from '@solarflow/shared';
import { z } from 'zod';
import { api } from '@/lib/api';
import { applyBranding } from '@/lib/branding';
import { useAuth, type SessionPayload } from '@/store/auth';
import { BrandMark } from '@/components/layout/AppLayout';
import { Button, Card, CardBody, ErrorNote, Field, FullPageSpinner, Input, Select } from '@/components/ui';

interface PublicBranding { branding: { name: string; slug: string; primaryColor: string; accentColor: string; logoUrl: string | null } | null }

/** Shell that shows the tenant's brand when the request host maps to a verified custom domain / subdomain. */
function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const { data } = useQuery({ queryKey: ['public-branding'], queryFn: () => api.get<PublicBranding>('/public/branding'), staleTime: Infinity });
  const b = data?.branding;
  useEffect(() => { applyBranding(b ?? null); }, [b]);
  return (
    <div className="flex min-h-full items-center justify-center bg-surface-alt px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><BrandMark name={b?.name ?? 'SolarFlow'} logoUrl={b?.logoUrl ?? null} /></div>
        <Card><CardBody className="space-y-5">
          <div><h1 className="text-xl font-semibold">{title}</h1><p className="mt-1 text-sm text-ink-muted">{subtitle}</p></div>
          {children}
        </CardBody></Card>
      </div>
    </div>
  );
}

export function LoginPage() {
  const status = useAuth((s) => s.status);
  const setSession = useAuth((s) => s.setSession);
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/dashboard';
  const { register, handleSubmit, formState: { errors } } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });
  const login = useMutation({
    mutationFn: (v: LoginInput) => api.post<SessionPayload>('/auth/login', v),
    onSuccess: (s) => { setSession(s); nav(from, { replace: true }); },
  });
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authenticated') return <Navigate to="/dashboard" replace />;
  return (
    <AuthShell title="Sign in" subtitle="Welcome back. Enter your details to continue.">
      <form className="space-y-4" onSubmit={handleSubmit((v) => login.mutate(v))} noValidate>
        <Field label="Email" htmlFor="email" error={errors.email?.message}><Input id="email" type="email" autoComplete="email" {...register('email')} /></Field>
        <Field label="Password" htmlFor="password" error={errors.password?.message}><Input id="password" type="password" autoComplete="current-password" {...register('password')} /></Field>
        <ErrorNote error={login.error} />
        <Button type="submit" variant="accent" className="w-full" loading={login.isPending}>Sign in</Button>
      </form>
      <p className="text-center text-sm text-ink-muted">New solar business? <Link className="text-accent hover:underline" to="/register">Create a workspace</Link></p>
    </AuthShell>
  );
}

const form = registerSchema.extend({ confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });
type RegForm = z.input<typeof form>;

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export function RegisterPage() {
  const status = useAuth((s) => s.status);
  const setSession = useAuth((s) => s.setSession);
  const nav = useNavigate();
  const { register, handleSubmit, setValue, getFieldState, formState: { errors, dirtyFields } } = useForm<RegForm>({ resolver: zodResolver(form), defaultValues: { country: 'IN' } });
  const reg = useMutation({
    mutationFn: ({ confirm: _c, ...v }: RegForm) => api.post<SessionPayload>('/auth/register', v),
    onSuccess: (s) => { setSession(s); nav('/dashboard', { replace: true }); },
  });
  if (status === 'authenticated') return <Navigate to="/dashboard" replace />;
  void getFieldState;
  return (
    <AuthShell title="Create your workspace" subtitle="Start a 14-day trial. Your company data stays isolated in its own workspace.">
      <form className="space-y-4" onSubmit={handleSubmit((v) => reg.mutate(v))} noValidate>
        <Field label="Company name" htmlFor="organizationName" error={errors.organizationName?.message}>
          <Input id="organizationName" {...register('organizationName', { onChange: (e) => { if (!dirtyFields.organizationSlug) setValue('organizationSlug', slugify(e.target.value)); } })} />
        </Field>
        <Field label="Workspace address" htmlFor="organizationSlug" hint="Lowercase letters, numbers and hyphens" error={errors.organizationSlug?.message}>
          <Input id="organizationSlug" {...register('organizationSlug')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" htmlFor="firstName" error={errors.firstName?.message}><Input id="firstName" autoComplete="given-name" {...register('firstName')} /></Field>
          <Field label="Last name" htmlFor="lastName" error={errors.lastName?.message}><Input id="lastName" autoComplete="family-name" {...register('lastName')} /></Field>
        </div>
        <Field label="Work email" htmlFor="email" error={errors.email?.message}><Input id="email" type="email" autoComplete="email" {...register('email')} /></Field>
        <Field label="Country" htmlFor="country" hint="Sets starting currency and tax presets, all editable later">
          <Select id="country" {...register('country')}>
            <option value="IN">India (INR, GST)</option>
            <option value="US">United States (USD)</option>
            <option value="GB">United Kingdom</option>
            <option value="AU">Australia</option>
            <option value="AE">United Arab Emirates</option>
          </Select>
        </Field>
        <Field label="Password" htmlFor="password" hint="10+ characters with upper, lower case and a number" error={errors.password?.message}><Input id="password" type="password" autoComplete="new-password" {...register('password')} /></Field>
        <Field label="Confirm password" htmlFor="confirm" error={errors.confirm?.message}><Input id="confirm" type="password" autoComplete="new-password" {...register('confirm')} /></Field>
        <ErrorNote error={reg.error} />
        <Button type="submit" variant="accent" className="w-full" loading={reg.isPending}>Create workspace</Button>
      </form>
      <p className="text-center text-sm text-ink-muted">Already have an account? <Link className="text-accent hover:underline" to="/login">Sign in</Link></p>
    </AuthShell>
  );
}
