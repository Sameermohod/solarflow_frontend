import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { ILLUSTRATIVE_IRRADIATION_TEMPLATE, MONTH_LABELS, EXPORT_MODES } from '@solarflow/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { label } from '@/lib/format';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNote, Field, Input, Modal, Select, Spinner } from '@/components/ui';
import { Notice } from '@/components/ui/extra';

export interface Slab { upToKwh: number | null; rate: number }
export interface TariffPlan { id: string; name: string; fixedChargePerMonth: string; slabs: Slab[]; taxPercent: string; exportMode: string; exportRate: string; annualEscalationPercent: string; isDefault: boolean }
export interface Profile { id: string; name: string; region: string | null; monthlyPeakSunHours: number[]; source: string | null; isDefault: boolean }

export const useTariffs = () => useQuery({ queryKey: ['tariffs'], queryFn: () => api.get<{ data: TariffPlan[] }>('/solar-calculator/tariffs').then((r) => r.data) });
export const useProfiles = () => useQuery({ queryKey: ['irradiation'], queryFn: () => api.get<{ data: Profile[] }>('/solar-calculator/irradiation').then((r) => r.data) });

/** Controlled slab editor reused by the tariff modal and the calculator's custom-tariff section. */
export function SlabEditor({ slabs, onChange, disabled }: { slabs: { upTo: string; rate: string }[]; onChange: (s: { upTo: string; rate: string }[]) => void; disabled?: boolean }) {
  const set = (i: number, patch: Partial<{ upTo: string; rate: string }>) => onChange(slabs.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-muted">Slabs apply per month. Leave the last slab's upper limit empty for "above".</p>
      {slabs.map((s, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          <Input aria-label={`Slab ${i + 1} up to kWh`} inputMode="decimal" placeholder={i === slabs.length - 1 ? 'Above (no limit)' : 'Up to kWh'} value={s.upTo} disabled={disabled} onChange={(e) => set(i, { upTo: e.target.value })} />
          <Input aria-label={`Slab ${i + 1} rate`} inputMode="decimal" placeholder="Rate per kWh" value={s.rate} disabled={disabled} onChange={(e) => set(i, { rate: e.target.value })} />
          {slabs.length > 1 && !disabled && <button type="button" aria-label={`Remove slab ${i + 1}`} onClick={() => onChange(slabs.filter((_, k) => k !== i))} className="rounded p-2 text-ink-muted hover:bg-surface-alt"><Trash2 className="h-4 w-4" /></button>}
        </div>
      ))}
      {!disabled && slabs.length < 12 && <Button size="sm" variant="outline" onClick={() => onChange([...slabs, { upTo: '', rate: '' }])}><Plus className="h-4 w-4" />Add slab</Button>}
    </div>
  );
}
export const toSlabRows = (slabs: Slab[]) => slabs.map((s) => ({ upTo: s.upToKwh === null ? '' : String(s.upToKwh), rate: String(s.rate) }));
export const fromSlabRows = (rows: { upTo: string; rate: string }[]): Slab[] => rows.map((r) => ({ upToKwh: r.upTo.trim() === '' ? null : Number(r.upTo), rate: Number(r.rate) }));

function TariffModal({ plan, onClose }: { plan: TariffPlan | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(plan?.name ?? '');
  const [fixed, setFixed] = useState(plan?.fixedChargePerMonth ?? '0');
  const [tax, setTax] = useState(plan?.taxPercent ?? '0');
  const [mode, setMode] = useState(plan?.exportMode ?? 'NET_METERING');
  const [exportRate, setExportRate] = useState(plan?.exportRate ?? '0');
  const [esc, setEsc] = useState(plan?.annualEscalationPercent ?? '3');
  const [isDefault, setDefault] = useState(plan?.isDefault ?? false);
  const [slabs, setSlabs] = useState(plan ? toSlabRows(plan.slabs) : [{ upTo: '', rate: '' }]);
  const save = useMutation({
    mutationFn: () => {
      const body = { name, fixedChargePerMonth: Number(fixed), slabs: fromSlabRows(slabs), taxPercent: Number(tax), exportMode: mode, exportRate: Number(exportRate), annualEscalationPercent: Number(esc), isDefault };
      return plan ? api.put(`/solar-calculator/tariffs/${plan.id}`, body) : api.post('/solar-calculator/tariffs', body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tariffs'] }); onClose(); },
  });
  return (
    <Modal open wide title={plan ? 'Edit tariff' : 'New tariff'} onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Notice>Enter the tariff from your customer's electricity bill or the utility's published schedule. Nothing here is pre-filled, because tariffs vary by utility, region and category.</Notice>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="t-name"><Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Residential LT-1" required /></Field>
          <Field label="Fixed charge per month" htmlFor="t-fixed"><Input id="t-fixed" inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} /></Field>
          <Field label="Tax / duty / surcharge (%)" htmlFor="t-tax" hint="Applied on fixed + energy charges"><Input id="t-tax" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} /></Field>
          <Field label="Annual tariff increase (%)" htmlFor="t-esc"><Input id="t-esc" inputMode="decimal" value={esc} onChange={(e) => setEsc(e.target.value)} /></Field>
          <Field label="Export treatment" htmlFor="t-mode"><Select id="t-mode" value={mode} onChange={(e) => setMode(e.target.value)}>{EXPORT_MODES.map((m) => <option key={m} value={m}>{label(m)}</option>)}</Select></Field>
          <Field label="Export rate per kWh" htmlFor="t-er" hint="Net billing credit, or payout for leftover net-metering credit"><Input id="t-er" inputMode="decimal" value={exportRate} onChange={(e) => setExportRate(e.target.value)} /></Field>
        </div>
        <SlabEditor slabs={slabs} onChange={setSlabs} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isDefault} onChange={(e) => setDefault(e.target.checked)} />Use as default tariff</label>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save tariff</Button></div>
      </form>
    </Modal>
  );
}

export function TariffsTab() {
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const { data, isLoading } = useTariffs();
  const [editing, setEditing] = useState<TariffPlan | 'new' | null>(null);
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/solar-calculator/tariffs/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['tariffs'] }) });
  return (
    <Card>
      <CardHeader title="Tariff plans" description="Used by the calculator and ROI simulator to price bills before and after solar." action={can('calculator:create') ? <Button size="sm" onClick={() => setEditing('new')}><Plus className="h-4 w-4" />New tariff</Button> : undefined} />
      <ErrorNote error={del.error} />
      {isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : !data?.length ? <EmptyState title="No tariffs yet" description="Add your customers' usual electricity tariff to get bill-based calculations." /> : (
        <ul className="divide-y divide-surface-line">
          {data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <div><p className="font-medium">{t.name} {t.isDefault && <Badge tone="green">Default</Badge>}</p>
                <p className="text-xs text-ink-muted">{t.slabs.length} slab(s) · fixed {Number(t.fixedChargePerMonth)} · tax {Number(t.taxPercent)}% · {label(t.exportMode)} · +{Number(t.annualEscalationPercent)}%/yr</p></div>
              <div className="flex gap-1">
                {can('calculator:edit') && <Button size="icon" variant="ghost" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}><Pencil className="h-4 w-4" /></Button>}
                {can('calculator:delete') && <Button size="icon" variant="ghost" aria-label={`Delete ${t.name}`} onClick={() => { if (window.confirm(`Delete tariff “${t.name}”?`)) del.mutate(t.id); }}><Trash2 className="h-4 w-4 text-red-600" /></Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <TariffModal plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function ProfileModal({ profile, onClose }: { profile: Profile | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(profile?.name ?? '');
  const [region, setRegion] = useState(profile?.region ?? '');
  const [source, setSource] = useState(profile?.source ?? '');
  const [isDefault, setDefault] = useState(profile?.isDefault ?? false);
  const [vals, setVals] = useState<string[]>((profile?.monthlyPeakSunHours ?? Array(12).fill('')).map(String));
  const save = useMutation({
    mutationFn: () => {
      const body = { name, region, source, isDefault, monthlyPeakSunHours: vals.map(Number) };
      return profile ? api.put(`/solar-calculator/irradiation/${profile.id}`, body) : api.post('/solar-calculator/irradiation', body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['irradiation'] }); onClose(); },
  });
  const useTemplate = () => { const t = ILLUSTRATIVE_IRRADIATION_TEMPLATE; setName((n) => n || t.name); setRegion(t.region); setSource(t.source); setVals(t.monthlyPeakSunHours.map(String)); };
  return (
    <Modal open wide title={profile ? 'Edit solar resource profile' : 'New solar resource profile'} onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Notice tone="warn">Peak sun hours (kWh/m²/day) drive every generation estimate. Use data for the actual site from PVGIS, NASA POWER or measurements. The template below is only an illustrative placeholder.</Notice>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="p-name"><Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pune" required /></Field>
          <Field label="Region" htmlFor="p-region"><Input id="p-region" value={region} onChange={(e) => setRegion(e.target.value)} /></Field>
        </div>
        <Field label="Data source" htmlFor="p-src"><Input id="p-src" value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. PVGIS, 2005–2020 average" /></Field>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {MONTH_LABELS.map((m, i) => (
            <label key={m} className="text-xs text-ink-muted">{m}<Input aria-label={`${m} peak sun hours`} inputMode="decimal" value={vals[i]} onChange={(e) => setVals((v) => v.map((x, k) => (k === i ? e.target.value : x)))} className="mt-1" /></label>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isDefault} onChange={(e) => setDefault(e.target.checked)} />Use as default profile</label>
          <Button variant="outline" size="sm" onClick={useTemplate}>Fill with illustrative template</Button>
        </div>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={save.isPending}>Save profile</Button></div>
      </form>
    </Modal>
  );
}

export function SolarResourceTab() {
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const { data, isLoading } = useProfiles();
  const [editing, setEditing] = useState<Profile | 'new' | null>(null);
  const del = useMutation({ mutationFn: (id: string) => api.delete(`/solar-calculator/irradiation/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['irradiation'] }) });
  return (
    <Card>
      <CardHeader title="Solar resource profiles" description="Monthly peak sun hours for the regions you install in." action={can('calculator:create') ? <Button size="sm" onClick={() => setEditing('new')}><Plus className="h-4 w-4" />New profile</Button> : undefined} />
      <ErrorNote error={del.error} />
      {isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : !data?.length ? <EmptyState title="No profiles yet" description="Add a profile for your region, or enter annual peak sun hours directly in the calculator." /> : (
        <ul className="divide-y divide-surface-line">
          {data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <div><p className="font-medium">{p.name} {p.isDefault && <Badge tone="green">Default</Badge>}</p>
                <p className="text-xs text-ink-muted">{p.region ?? 'No region'} · average {(p.monthlyPeakSunHours.reduce((a, b) => a + b, 0) / 12).toFixed(2)} h/day · {p.source ?? 'source not recorded'}</p></div>
              <div className="flex gap-1">
                {can('calculator:edit') && <Button size="icon" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}><Pencil className="h-4 w-4" /></Button>}
                {can('calculator:delete') && <Button size="icon" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => { if (window.confirm(`Delete profile “${p.name}”?`)) del.mutate(p.id); }}><Trash2 className="h-4 w-4 text-red-600" /></Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <ProfileModal profile={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}
