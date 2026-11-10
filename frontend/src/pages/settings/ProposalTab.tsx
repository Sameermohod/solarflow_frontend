import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Upload } from 'lucide-react';
import { proposalProfileSchema, type ProposalProfile } from '@solarflow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { Button, Card, CardBody, CardHeader, ErrorNote, Field, Input, Spinner, Textarea } from '@/components/ui';
import { fileToDataUrl } from '@/lib/imageData';
import { useOrg, useOrgMutation, type OrgFull } from './useOrg';

const lineText = (a: string[]) => a.join('\n');
const toLines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

function ImagePick({ label, hint, value, onChange, maxDim = 1000, logo, disabled }: { label: string; hint?: string; value: string | null; onChange: (v: string | null) => void; maxDim?: number; logo?: boolean; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  return (
    <div>
      <p className="mb-1 text-sm font-medium">{label}</p>
      <div className="flex items-center gap-3">
        <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded border border-surface-line bg-surface-alt text-[10px] text-ink-muted">
          {value ? <img src={value} alt={label} className="max-h-full max-w-full object-contain" /> : 'No image'}
        </div>
        {!disabled && (
          <div className="flex flex-col items-start gap-1">
            <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" aria-label={`${label} file`} className="hidden"
              onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { setErr(''); onChange(await fileToDataUrl(f, { maxDim, logo })); } catch (x) { setErr(x instanceof Error ? x.message : 'Could not use that image'); } }} />
            <Button size="sm" variant="outline" onClick={() => ref.current?.click()}><Upload className="h-3.5 w-3.5" />{value ? 'Replace' : 'Upload'}</Button>
            {value && <button type="button" className="text-xs text-red-600" onClick={() => onChange(null)}>Remove</button>}
          </div>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
      {err && <p role="alert" className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  );
}

/** Settings → Proposal profile: the company content attached automatically to every quotation's proposal PDF. */
export function ProposalTab() {
  const { data: org } = useOrg();
  const can = useAuth((s) => s.can('organization:edit'));
  const save = useOrgMutation((v: ProposalProfile) => api.patch<OrgFull>('/organizations/current/proposal-profile', v));
  const [p, setP] = useState<ProposalProfile | null>(null);
  const [problem, setProblem] = useState('');
  useEffect(() => { if (org) setP(proposalProfileSchema.parse(org.proposalProfile ?? {})); }, [org]);
  if (!org || !p) return <div className="flex justify-center py-16"><Spinner className="h-8 w-8" /></div>;
  const set = <K extends keyof ProposalProfile>(k: K, v: ProposalProfile[K]) => { setP({ ...p, [k]: v }); setProblem(''); };
  const dis = !can;
  const submit = () => {
    const r = proposalProfileSchema.safeParse(p);
    if (!r.success) { setProblem(r.error.issues[0]?.message ?? 'Check the fields'); return; }
    save.mutate(r.data);
  };
  const w = p.warranty;
  const setW = (k: keyof ProposalProfile['warranty'], v: string) => set('warranty', { ...w, [k]: v.trim() === '' ? null : Math.max(0, Math.round(Number(v))) });

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">
        Write this once. It is attached automatically to the proposal PDF of every quotation: cover, welcome letter, about us, your extra pages, scope, terms, client list and contact page.
        Your company name, logo, address, phone, email, website, brand colours and bank details come from the Organization, Branding and Invoice tabs. Customer, price, bill of materials and dates come from the quotation itself.
      </p>

      <Card>
        <CardHeader title="Pictures" description="Resized in your browser; keep the total small (about 3.5 MB)." />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          <ImagePick label="Cover photo" hint="Shown on the first page (landscape works best)." value={p.coverImage} onChange={(v) => set('coverImage', v)} disabled={dis} />
          <ImagePick label="Welcome-page photo" value={p.welcomeImage} onChange={(v) => set('welcomeImage', v)} disabled={dis} />
          <ImagePick label="Closing-page photo" value={p.closingImage} onChange={(v) => set('closingImage', v)} disabled={dis} />
          <ImagePick label="Director photo" value={p.directorPhoto} onChange={(v) => set('directorPhoto', v)} maxDim={500} disabled={dis} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Letters and about us" />
        <CardBody className="space-y-4">
          <Field label="Welcome letter" hint="Use {{customer}} where the customer's name should appear. Blank = page skipped."><Textarea rows={7} value={p.welcomeLetter} disabled={dis} onChange={(e) => set('welcomeLetter', e.target.value)} /></Field>
          <Field label="About us" hint="Blank = page skipped."><Textarea rows={6} value={p.aboutUs} disabled={dis} onChange={(e) => set('aboutUs', e.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Director / owner name"><Input value={p.directorName} disabled={dis} onChange={(e) => set('directorName', e.target.value)} /></Field>
            <Field label="Designation"><Input value={p.directorTitle} disabled={dis} onChange={(e) => set('directorTitle', e.target.value)} /></Field>
          </div>
          <Field label="Message from the director"><Textarea rows={4} value={p.directorMessage} disabled={dis} onChange={(e) => set('directorMessage', e.target.value)} /></Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Highlight pages" description="Anything you want every proposal to show: certifications, why choose us, case studies, service promise. Up to 6 pages."
          action={can && p.highlights.length < 6 ? <Button size="sm" variant="outline" onClick={() => set('highlights', [...p.highlights, { title: '', body: '', image: null }])}><Plus className="h-3.5 w-3.5" />Add page</Button> : undefined} />
        <CardBody className="space-y-4">
          {p.highlights.length === 0 && <p className="text-sm text-ink-muted">No highlight pages yet.</p>}
          {p.highlights.map((h, i) => (
            <div key={i} className="space-y-3 rounded-lg border border-surface-line p-3">
              <div className="flex items-end gap-2">
                <div className="flex-1"><Field label={`Page ${i + 1} title`}><Input value={h.title} disabled={dis} onChange={(e) => set('highlights', p.highlights.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))} /></Field></div>
                {can && <Button size="icon" variant="ghost" aria-label={`Remove highlight page ${i + 1}`} onClick={() => set('highlights', p.highlights.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></Button>}
              </div>
              <Field label="Text" hint="Start a line with - for a bullet."><Textarea rows={5} value={h.body} disabled={dis} onChange={(e) => set('highlights', p.highlights.map((x, k) => (k === i ? { ...x, body: e.target.value } : x)))} /></Field>
              <ImagePick label="Picture (optional)" value={h.image} onChange={(v) => set('highlights', p.highlights.map((x, k) => (k === i ? { ...x, image: v } : x)))} disabled={dis} />
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Scope, timeline and terms" description="One item per line. A blank list skips that section." />
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Our scope of work"><Textarea rows={7} value={lineText(p.ourScope)} disabled={dis} onChange={(e) => set('ourScope', toLines(e.target.value))} /></Field>
            <Field label="Customer scope"><Textarea rows={7} value={lineText(p.customerScope)} disabled={dis} onChange={(e) => set('customerScope', toLines(e.target.value))} /></Field>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between"><p className="text-sm font-medium">Project timeline (up to 6 steps)</p>
              {can && p.timeline.length < 6 && <Button size="sm" variant="outline" onClick={() => set('timeline', [...p.timeline, { label: '', days: 0 }])}><Plus className="h-3.5 w-3.5" />Add step</Button>}</div>
            {p.timeline.map((t, i) => (
              <div key={i} className="mb-2 grid grid-cols-[1fr_6rem_2.5rem] items-center gap-2">
                <Input aria-label={`Step ${i + 1} name`} placeholder="e.g. Finalization of design and drawings" value={t.label} disabled={dis} onChange={(e) => set('timeline', p.timeline.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} />
                <Input aria-label={`Step ${i + 1} days`} inputMode="numeric" placeholder="days" value={String(t.days)} disabled={dis} onChange={(e) => set('timeline', p.timeline.map((x, k) => (k === i ? { ...x, days: Math.max(0, Math.round(Number(e.target.value) || 0)) } : x)))} />
                {can && <Button size="icon" variant="ghost" aria-label={`Remove step ${i + 1}`} onClick={() => set('timeline', p.timeline.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            ))}
          </div>
          <Field label="Terms and conditions"><Textarea rows={8} value={lineText(p.terms)} disabled={dis} onChange={(e) => set('terms', toLines(e.target.value))} /></Field>
          <Field label="Default payment terms" hint="e.g. 10 % advance with confirmed purchase order."><Textarea rows={3} value={lineText(p.paymentTerms)} disabled={dis} onChange={(e) => set('paymentTerms', toLines(e.target.value))} /></Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Bill of materials extras" description="Shown on the bill-of-materials page next to the items from the quotation." />
        <CardBody className="space-y-4">
          <Field label="Balance of system" hint="e.g. Net and solar meter: Genus / Secure"><Textarea rows={6} value={lineText(p.balanceOfSystem)} disabled={dis} onChange={(e) => set('balanceOfSystem', toLines(e.target.value))} /></Field>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Panel warranty (years)"><Input inputMode="numeric" value={w.panelYears ?? ''} disabled={dis} onChange={(e) => setW('panelYears', e.target.value)} /></Field>
            <Field label="Panel performance (years)"><Input inputMode="numeric" value={w.performanceYears ?? ''} disabled={dis} onChange={(e) => setW('performanceYears', e.target.value)} /></Field>
            <Field label="Inverter warranty (years)"><Input inputMode="numeric" value={w.inverterYears ?? ''} disabled={dis} onChange={(e) => setW('inverterYears', e.target.value)} /></Field>
            <Field label="Maintenance (years)"><Input inputMode="numeric" value={w.maintenanceYears ?? ''} disabled={dis} onChange={(e) => setW('maintenanceYears', e.target.value)} /></Field>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between"><p className="text-sm font-medium">Brand logos (up to 8)</p>
              {can && p.brandLogos.length < 8 && <Button size="sm" variant="outline" onClick={() => set('brandLogos', [...p.brandLogos, { name: '', image: null }])}><Plus className="h-3.5 w-3.5" />Add brand</Button>}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              {p.brandLogos.map((b, i) => (
                <div key={i} className="space-y-2 rounded-lg border border-surface-line p-3">
                  <div className="flex items-center gap-2">
                    <Input aria-label={`Brand ${i + 1} name`} placeholder="Brand name" value={b.name} disabled={dis} onChange={(e) => set('brandLogos', p.brandLogos.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
                    {can && <Button size="icon" variant="ghost" aria-label={`Remove brand ${i + 1}`} onClick={() => set('brandLogos', p.brandLogos.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></Button>}
                  </div>
                  <ImagePick label="Logo" value={b.image} logo maxDim={400} onChange={(v) => set('brandLogos', p.brandLogos.map((x, k) => (k === i ? { ...x, image: v } : x)))} disabled={dis} />
                </div>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Client list" description="Major projects you want to show. Blank = page skipped."
          action={can && p.clients.length < 40 ? <Button size="sm" variant="outline" onClick={() => set('clients', [...p.clients, { name: '', kw: null }])}><Plus className="h-3.5 w-3.5" />Add client</Button> : undefined} />
        <CardBody className="space-y-2">
          {p.clients.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_7rem_2.5rem] items-center gap-2">
              <Input aria-label={`Client ${i + 1} name`} placeholder="Client / project name" value={c.name} disabled={dis} onChange={(e) => set('clients', p.clients.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
              <Input aria-label={`Client ${i + 1} kW`} inputMode="decimal" placeholder="kW" value={c.kw ?? ''} disabled={dis} onChange={(e) => set('clients', p.clients.map((x, k) => (k === i ? { ...x, kw: e.target.value.trim() === '' ? null : Number(e.target.value) } : x)))} />
              {can && <Button size="icon" variant="ghost" aria-label={`Remove client ${i + 1}`} onClick={() => set('clients', p.clients.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          ))}
          <Field label="Line under the list" hint="e.g. And 3000+ happy clients."><Input value={p.clientsFootnote} disabled={dis} onChange={(e) => set('clientsFootnote', e.target.value)} /></Field>
        </CardBody>
      </Card>

      {problem && <p role="alert" className="text-sm text-red-600">{problem}</p>}
      {can && (
        <div className="sticky bottom-0 flex items-center gap-3 rounded-lg border border-surface-line bg-white px-5 py-3 shadow-card">
          <Button onClick={submit} loading={save.isPending}>Save proposal profile</Button>
          {save.isSuccess && <span role="status" className="text-sm text-accent">Saved</span>}
          <ErrorNote error={save.error} />
        </div>
      )}
    </div>
  );
}
