import { useEffect, useRef, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2, Upload } from 'lucide-react';
import { brandingSchema, hostnameSchema, invoiceSettingsSchema, organizationProfileSchema, regionalSettingsSchema } from '@solarflow/shared';
import { z } from 'zod';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { Badge, Button, Card, CardBody, CardHeader, ErrorNote, Field, Input, Select, Spinner, Textarea } from '@/components/ui';
import { BrandMark } from '@/components/layout/AppLayout';
import { useOrg, useOrgMutation, type OrgFull } from './useOrg';

function Saved({ show }: { show: boolean }) {
  return show ? <span role="status" className="text-sm text-accent">Saved</span> : null;
}
function Loading() { return <div className="flex justify-center py-16"><Spinner className="h-8 w-8" /></div>; }
const nn = (v: string | null | undefined) => v ?? '';

/* ---------------- Organization profile ---------------- */
type ProfileForm = z.input<typeof organizationProfileSchema>;
export function OrganizationTab() {
  const { data: org } = useOrg();
  const can = useAuth((s) => s.can('organization:edit'));
  const save = useOrgMutation((v: ProfileForm) => api.patch<OrgFull>('/organizations/current/profile', v));
  const { register, handleSubmit, reset, formState: { errors } } = useForm<ProfileForm>({ resolver: zodResolver(organizationProfileSchema) });
  useEffect(() => {
    if (org) reset({ name: org.name, legalName: nn(org.legalName), registrationNumber: nn(org.registrationNumber), taxId: nn(org.taxId), email: nn(org.email), phone: nn(org.phone), website: nn(org.website), address: { line1: nn(org.address?.line1), line2: nn(org.address?.line2), city: nn(org.address?.city), state: nn(org.address?.state), postalCode: nn(org.address?.postalCode), country: nn(org.address?.country) } });
  }, [org, reset]);
  if (!org) return <Loading />;
  const clean = (v: ProfileForm) => ({ ...v, legalName: v.legalName || null, registrationNumber: v.registrationNumber || null, taxId: v.taxId || null, email: v.email || null, phone: v.phone || null, website: v.website || null });
  return (
    <Card>
      <CardHeader title="Business profile" description="Appears on quotations, invoices and documents." />
      <form onSubmit={handleSubmit((v) => save.mutate(clean(v)))} noValidate>
        <fieldset disabled={!can} className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Display name" htmlFor="name" error={errors.name?.message}><Input id="name" {...register('name')} /></Field>
          <Field label="Legal name" htmlFor="legalName"><Input id="legalName" {...register('legalName')} /></Field>
          <Field label="Registration number" htmlFor="registrationNumber"><Input id="registrationNumber" {...register('registrationNumber')} /></Field>
          <Field label="Tax ID (e.g. GSTIN / VAT)" htmlFor="taxId"><Input id="taxId" {...register('taxId')} /></Field>
          <Field label="Email" htmlFor="email" error={errors.email?.message}><Input id="email" type="email" {...register('email')} /></Field>
          <Field label="Phone" htmlFor="phone"><Input id="phone" {...register('phone')} /></Field>
          <Field label="Website" htmlFor="website" error={errors.website?.message}><Input id="website" placeholder="https://" {...register('website')} /></Field>
          <div />
          <Field label="Address line 1" htmlFor="a1"><Input id="a1" {...register('address.line1')} /></Field>
          <Field label="Address line 2" htmlFor="a2"><Input id="a2" {...register('address.line2')} /></Field>
          <Field label="City" htmlFor="a3"><Input id="a3" {...register('address.city')} /></Field>
          <Field label="State / region" htmlFor="a4"><Input id="a4" {...register('address.state')} /></Field>
          <Field label="Postal code" htmlFor="a5"><Input id="a5" {...register('address.postalCode')} /></Field>
          <Field label="Country" htmlFor="a6"><Input id="a6" {...register('address.country')} /></Field>
        </fieldset>
        <div className="flex items-center gap-3 border-t border-surface-line px-5 py-3">
          {can && <Button type="submit" loading={save.isPending}>Save changes</Button>}<Saved show={save.isSuccess} />
          <ErrorNote error={save.error} />
        </div>
      </form>
    </Card>
  );
}

/* ---------------- Branding ---------------- */
type BrandForm = z.infer<typeof brandingSchema>;
export function BrandingTab() {
  const { data: org } = useOrg();
  const can = useAuth((s) => s.can('organization:edit'));
  const fileRef = useRef<HTMLInputElement>(null);
  const save = useOrgMutation((v: BrandForm) => api.patch<OrgFull>('/organizations/current/branding', v));
  const upload = useOrgMutation((f: File) => { const fd = new FormData(); fd.append('logo', f); return api.upload<OrgFull>('/organizations/current/logo', fd); });
  const remove = useOrgMutation(() => api.delete<OrgFull>('/organizations/current/logo') as Promise<OrgFull>);
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<BrandForm>({ resolver: zodResolver(brandingSchema) });
  useEffect(() => { if (org) reset({ primaryColor: org.primaryColor, accentColor: org.accentColor }); }, [org, reset]);
  if (!org) return <Loading />;
  const w = watch();
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Logo" description="PNG, JPEG or WebP, up to 2 MB. Shown in the app, on the login page and on documents." />
        <CardBody className="flex flex-wrap items-center gap-5">
          <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-surface-line bg-surface-alt">
            {org.logoUrl ? <img src={org.logoUrl} alt="Current logo" className="max-h-16 max-w-16 object-contain" /> : <span className="text-xs text-ink-muted">No logo</span>}
          </div>
          {can && (
            <div className="space-y-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label="Logo file"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => fileRef.current?.click()} loading={upload.isPending}><Upload className="h-4 w-4" />Upload logo</Button>
                {org.logoUrl && <Button variant="ghost" onClick={() => remove.mutate(undefined)} loading={remove.isPending}>Remove</Button>}
              </div>
              <ErrorNote error={upload.error ?? remove.error} />
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Brand colours" description="Applied across the app for your whole team." />
        <form onSubmit={handleSubmit((v) => save.mutate(v))}>
          <fieldset disabled={!can} className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Primary (sidebar, buttons)" error={errors.primaryColor?.message}>
              <div className="flex gap-2"><input type="color" aria-label="Primary colour picker" className="h-10 w-12 cursor-pointer rounded border border-surface-line" value={w.primaryColor ?? '#0f2a43'} onChange={(e) => reset({ ...w, primaryColor: e.target.value })} /><Input aria-label="Primary colour" {...register('primaryColor')} /></div>
            </Field>
            <Field label="Accent (highlights, actions)" error={errors.accentColor?.message}>
              <div className="flex gap-2"><input type="color" aria-label="Accent colour picker" className="h-10 w-12 cursor-pointer rounded border border-surface-line" value={w.accentColor ?? '#16a34a'} onChange={(e) => reset({ ...w, accentColor: e.target.value })} /><Input aria-label="Accent colour" {...register('accentColor')} /></div>
            </Field>
            <div className="sm:col-span-2 overflow-hidden rounded-lg border border-surface-line">
              <div className="flex items-center justify-between px-4 py-3" style={{ background: w.primaryColor }}><BrandMark name={org.name} logoUrl={org.logoUrl} onDark /><span className="rounded px-2 py-1 text-xs font-medium text-white" style={{ background: w.accentColor }}>Accent</span></div>
              <p className="bg-white px-4 py-2 text-xs text-ink-muted">Preview</p>
            </div>
          </fieldset>
          {can && <div className="flex items-center gap-3 border-t border-surface-line px-5 py-3"><Button type="submit" loading={save.isPending}>Save colours</Button><Saved show={save.isSuccess} /><ErrorNote error={save.error} /></div>}
        </form>
      </Card>
    </div>
  );
}

/* ---------------- Regional & tax ---------------- */
type RegionalForm = z.input<typeof regionalSettingsSchema>;
export function RegionalTab() {
  const { data: org } = useOrg();
  const can = useAuth((s) => s.can('organization:edit'));
  const save = useOrgMutation((v: RegionalForm) => api.patch<OrgFull>('/organizations/current/regional', v));
  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<RegionalForm>({ resolver: zodResolver(regionalSettingsSchema) });
  const { fields, append, remove } = useFieldArray({ control, name: 'taxConfig.rates' });
  useEffect(() => { if (org) reset({ country: org.country, currency: org.currency, timezone: org.timezone, locale: org.locale, measurementSystem: org.measurementSystem, taxConfig: org.taxConfig }); }, [org, reset]);
  if (!org) return <Loading />;
  return (
    <Card>
      <CardHeader title="Regional settings and tax rules" description="Tax rates are fully configurable and are snapshotted onto invoices when issued. Starting values are examples only, so confirm them with your accountant." />
      <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
        <fieldset disabled={!can} className="space-y-5 p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Country (ISO code)" error={errors.country?.message}><Input {...register('country')} maxLength={2} /></Field>
            <Field label="Currency (ISO code)" error={errors.currency?.message}><Input {...register('currency')} maxLength={3} /></Field>
            <Field label="Locale" error={errors.locale?.message}><Input {...register('locale')} /></Field>
            <Field label="Time zone" error={errors.timezone?.message}><Input {...register('timezone')} /></Field>
            <Field label="Measurement system"><Select {...register('measurementSystem')}><option value="METRIC">Metric (m)</option><option value="IMPERIAL">Imperial (ft)</option></Select></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Tax regime name" error={errors.taxConfig?.regime?.message}><Input {...register('taxConfig.regime')} /></Field>
            <label className="flex items-center gap-2 pt-7 text-sm"><input type="checkbox" {...register('taxConfig.pricesIncludeTax')} /> Prices include tax</label>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Tax rates</h3>
              {can && <Button size="sm" variant="outline" onClick={() => append({ code: '', label: '', rate: 0, active: true })}><Plus className="h-4 w-4" />Add rate</Button>}</div>
            <div className="space-y-2">
              {fields.length === 0 && <p className="text-sm text-ink-muted">No tax rates configured.</p>}
              {fields.map((f, i) => (
                <div key={f.id} className="grid grid-cols-[1fr_1.5fr_90px_auto_auto] items-center gap-2">
                  <Input aria-label={`Rate ${i + 1} code`} placeholder="Code" {...register(`taxConfig.rates.${i}.code`)} />
                  <Input aria-label={`Rate ${i + 1} label`} placeholder="Label" {...register(`taxConfig.rates.${i}.label`)} />
                  <Input aria-label={`Rate ${i + 1} percent`} type="number" step="0.01" min="0" max="100" {...register(`taxConfig.rates.${i}.rate`, { valueAsNumber: true })} />
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" {...register(`taxConfig.rates.${i}.active`)} />Active</label>
                  {can && <button type="button" aria-label={`Remove rate ${i + 1}`} onClick={() => remove(i)} className="rounded p-2 text-ink-muted hover:bg-surface-alt"><Trash2 className="h-4 w-4" /></button>}
                </div>
              ))}
            </div>
          </div>
        </fieldset>
        {can && <div className="flex items-center gap-3 border-t border-surface-line px-5 py-3"><Button type="submit" loading={save.isPending}>Save</Button><Saved show={save.isSuccess} /><ErrorNote error={save.error} /></div>}
      </form>
    </Card>
  );
}

/* ---------------- Invoice branding ---------------- */
type InvForm = z.input<typeof invoiceSettingsSchema>;
export function InvoiceTab() {
  const { data: org } = useOrg();
  const can = useAuth((s) => s.can('organization:edit'));
  const save = useOrgMutation((v: InvForm) => api.patch<OrgFull>('/organizations/current/invoice-settings', v));
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<InvForm>({ resolver: zodResolver(invoiceSettingsSchema) });
  useEffect(() => { if (org) reset(org.invoiceSettings); }, [org, reset]);
  if (!org) return <Loading />;
  const w = watch();
  const accent = w.accentColor || org.accentColor;
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Invoice defaults and branding" />
        <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
          <fieldset disabled={!can} className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Invoice number prefix" error={errors.prefix?.message}><Input {...register('prefix')} /></Field>
              <Field label="Payment terms (days)" error={errors.paymentTermsDays?.message}><Input type="number" {...register('paymentTermsDays', { valueAsNumber: true })} /></Field>
              <Field label="Invoice accent colour" error={errors.accentColor?.message} hint="Leave blank to use brand accent"><Input placeholder="#16a34a" {...register('accentColor', { setValueAs: (v) => v || undefined })} /></Field>
            </div>
            <Field label="Bank / payment details"><Textarea {...register('bankDetails')} /></Field>
            <Field label="Terms and conditions"><Textarea {...register('termsAndConditions')} /></Field>
            <Field label="Footer note"><Input {...register('footerNote')} /></Field>
            <div className="flex gap-6 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" {...register('showLogo')} />Show logo</label>
              <label className="flex items-center gap-2"><input type="checkbox" {...register('showSignatureBlock')} />Signature block</label>
            </div>
          </fieldset>
          {can && <div className="flex items-center gap-3 border-t border-surface-line px-5 py-3"><Button type="submit" loading={save.isPending}>Save</Button><Saved show={save.isSuccess} /><ErrorNote error={save.error} /></div>}
        </form>
      </Card>
      <Card>
        <CardHeader title="Preview" description="Layout sample with placeholder amounts. Real invoices arrive in Phase 4." />
        <CardBody>
          <div className="rounded-lg border border-surface-line p-5 text-sm">
            <div className="flex items-start justify-between border-b-2 pb-3" style={{ borderColor: accent }}>
              {w.showLogo !== false ? <BrandMark name={org.name} logoUrl={org.logoUrl} /> : <span className="font-semibold">{org.name}</span>}
              <div className="text-right"><p className="text-lg font-semibold" style={{ color: accent }}>TAX INVOICE</p><p className="text-xs text-ink-muted">{w.prefix || 'INV'}-0001</p></div>
            </div>
            <p className="mt-3 text-xs text-ink-muted">Payment due within {w.paymentTermsDays ?? 0} days</p>
            {w.bankDetails && <p className="mt-3 whitespace-pre-wrap text-xs"><span className="font-semibold">Bank details: </span>{w.bankDetails}</p>}
            {w.termsAndConditions && <p className="mt-3 whitespace-pre-wrap text-xs text-ink-muted">{w.termsAndConditions}</p>}
            {w.showSignatureBlock !== false && <div className="mt-8 w-40 border-t border-ink pt-1 text-xs">Authorised signatory</div>}
            {w.footerNote && <p className="mt-4 border-t border-surface-line pt-2 text-center text-xs text-ink-muted">{w.footerNote}</p>}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/* ---------------- Custom domain ---------------- */
export function DomainTab() {
  const { data: org } = useOrg();
  const can = useAuth((s) => s.can('organization:edit'));
  const [domain, setDomain] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const setD = useOrgMutation((d: string | null) => api.put<OrgFull>('/organizations/current/domain', { domain: d }));
  const verify = useOrgMutation(() => api.post<OrgFull>('/organizations/current/domain/verify'));
  useEffect(() => { if (org) setDomain(org.customDomain ?? ''); }, [org]);
  if (!org) return <Loading />;
  const submit = () => {
    const r = hostnameSchema.safeParse(domain);
    if (!r.success) return setLocal(r.error.issues[0]?.message ?? 'Invalid domain');
    setLocal(null);
    setD.mutate(r.data);
  };
  return (
    <Card>
      <CardHeader title="Custom domain" description="Serve the login page under your own address with your branding." action={org.customDomain ? <Badge tone={org.customDomainVerified ? 'green' : 'yellow'}>{org.customDomainVerified ? 'Verified' : 'Pending verification'}</Badge> : undefined} />
      <CardBody className="space-y-5">
        <Field label="Domain" error={local ?? undefined} hint="e.g. app.yoursolar.com"><Input value={domain} disabled={!can} onChange={(e) => setDomain(e.target.value)} placeholder="app.yoursolar.com" /></Field>
        {can && <div className="flex gap-2"><Button onClick={submit} loading={setD.isPending}>Save domain</Button>{org.customDomain && <Button variant="ghost" onClick={() => setD.mutate(null)}>Disconnect</Button>}</div>}
        <ErrorNote error={setD.error ?? verify.error} />
        {org.customDomainVerification && (
          <div className="space-y-3 rounded-lg bg-surface-alt p-4 text-sm">
            <p className="font-medium">Prove you own this domain</p>
            <p className="text-ink-muted">Add this DNS record at your domain provider, then click Verify. Propagation can take a while.</p>
            <dl className="grid gap-1 font-mono text-xs sm:grid-cols-[80px_1fr]">
              <dt className="text-ink-muted">Type</dt><dd>{org.customDomainVerification.recordType}</dd>
              <dt className="text-ink-muted">Host</dt><dd className="break-all">{org.customDomainVerification.host}</dd>
              <dt className="text-ink-muted">Value</dt><dd className="break-all">{org.customDomainVerification.value}</dd>
            </dl>
            {can && <Button variant="accent" onClick={() => verify.mutate(undefined)} loading={verify.isPending}>Verify DNS record</Button>}
          </div>
        )}
        <p className="text-xs text-ink-muted">Serving the app on the domain also requires pointing it (CNAME / reverse proxy) at your SolarFlow deployment with a TLS certificate; verification here only confirms ownership. See the README, "Custom domains".</p>
      </CardBody>
    </Card>
  );
}
