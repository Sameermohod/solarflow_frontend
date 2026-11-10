import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_LOSSES, DEFAULT_REPORT_INPUTS, LOSS_LABELS, MONTH_LABELS, buildReport, type LossStack } from '@solarflow/shared';
import { useAuth } from '@/store/auth';
import { Button, ErrorNote, Field, Input, Modal, Select } from '@/components/ui';
import { useProfiles } from '@/pages/calculator/CalcSettings';
import { useDesign } from './store';

interface Form {
  latitude: string; longitude: string; address: string; profileId: string; psh: string[];
  acKw: string; inverterName: string; inverterKw: string; structure: string; degradation: string; co2: string; tree: string; contact: string;
  losses: Record<keyof LossStack, string>;
}

const storeKey = (id: string) => `solarflow.report.${id}`;
const blank = (): Form => ({
  latitude: '', longitude: '', address: '', profileId: '', psh: Array(12).fill(''), acKw: '', inverterName: '', inverterKw: '', structure: '',
  degradation: String(DEFAULT_REPORT_INPUTS.degradationPctPerYear), co2: String(DEFAULT_REPORT_INPUTS.co2KgPerKwh), tree: String(DEFAULT_REPORT_INPUTS.kgCo2PerTreePerYear), contact: '',
  losses: Object.fromEntries(Object.entries(DEFAULT_LOSSES).map(([k, v]) => [k, String(v)])) as Form['losses'],
});
function load(id: string): Form {
  try { const raw = localStorage.getItem(storeKey(id)); if (raw) return { ...blank(), ...JSON.parse(raw) }; } catch { /* storage unavailable */ }
  return blank();
}

/** Collects the site/energy assumptions and generates the multi-page yield and shading report PDF. */
export function ReportModal({ designId, customer, screenshot3d, onClose }: { designId: string; customer: string | null; screenshot3d?: () => string | null; onClose: () => void }) {
  const [f, setF] = useState<Form>(() => {
    const saved = load(designId);
    const site = useDesign.getState().config?.meta.site;
    return site ? { ...saved, latitude: saved.latitude || String(site.latitude), longitude: saved.longitude || String(site.longitude), address: saved.address || site.address || '' } : saved;
  });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const profiles = useProfiles();
  const org = useAuth((s) => s.session?.organization);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => { try { localStorage.setItem(storeKey(designId), JSON.stringify(f)); } catch { /* ignore */ } }, [f, designId]);
  const pickProfile = (id: string) => {
    const p = profiles.data?.find((x) => x.id === id);
    setF((x) => ({ ...x, profileId: id, psh: p ? p.monthlyPeakSunHours.map(String) : x.psh }));
  };

  const parsed = useMemo(() => {
    const n = (s: string) => (s.trim() === '' ? NaN : Number(s));
    const psh = f.psh.map(n);
    const lat = n(f.latitude);
    const problems: string[] = [];
    if (!(lat >= -90 && lat <= 90)) problems.push('Enter the site latitude (−90 to 90).');
    if (psh.some((x) => !(x > 0 && x < 12))) problems.push('Choose an irradiation profile or enter 12 monthly peak sun hours (0–12).');
    const losses = Object.fromEntries(Object.entries(f.losses).map(([k, v]) => [k, n(v)])) as unknown as LossStack;
    if (Object.values(losses).some((x) => !(x >= 0 && x < 60))) problems.push('Losses must be between 0 and 60 %.');
    return { psh, lat, losses, problems };
  }, [f]);

  const generate = async () => {
    setErr(null); setBusy(true);
    try {
      const st = useDesign.getState();
      const config = st.config!;
      const n = (s: string, d: number) => (s.trim() === '' || Number.isNaN(Number(s)) ? d : Number(s));
      const kwpGuess = config.panels.reduce((a, p) => a + (config.panelTypes.find((t) => t.id === p.typeId)?.wattage ?? 0), 0) / 1000;
      const report = buildReport(config, {
        latitudeDeg: parsed.lat, longitudeDeg: f.longitude.trim() === '' ? undefined : Number(f.longitude), monthlyPeakSunHours: parsed.psh, losses: parsed.losses,
        directShare: DEFAULT_REPORT_INPUTS.directShare, acCapacityKw: n(f.acKw, 0) || kwpGuess / 1.1, inverterName: f.inverterName, inverterKw: n(f.inverterKw, 0), structureName: f.structure,
        degradationPctPerYear: n(f.degradation, 0.5), co2KgPerKwh: n(f.co2, 0.82), kgCo2PerTreePerYear: n(f.tree, 21),
      });
      const { exportReportPdf } = await import('./reportPdf');
      await exportReportPdf(config, report, {
        company: org?.name ?? 'SolarFlow', designName: st.name, customer, address: f.address.trim() || undefined, latitudeDeg: parsed.lat,
        longitudeDeg: f.longitude.trim() === '' ? undefined : Number(f.longitude), version: st.baseVersion, screenshot3d: screenshot3d?.() ?? null, contact: f.contact.trim() || undefined,
        degradationPct: n(f.degradation, 0.5),
      });
      onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <Modal open wide title="Yield and shading report (PDF)" onClose={onClose}>
      <p className="mb-4 text-sm text-ink-muted">
        Generates a multi-page report from this design: system metrics, monthly production, field segments, shadow analysis (21 Jun / 21 Dec), solar-access map, losses and CO₂.
        Energy is an estimate from the sun-hours and losses below; shading covers roof obstacles only. {screenshot3d ? 'The current 3D view is included.' : 'Open the 3D view first to include a 3D image.'}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Site latitude (°)" hint="Needed for sun position, e.g. 21.14"><Input inputMode="decimal" value={f.latitude} onChange={(e) => set('latitude', e.target.value)} /></Field>
        <Field label="Site longitude (°, optional)"><Input inputMode="decimal" value={f.longitude} onChange={(e) => set('longitude', e.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label="Site address (shown on the cover)"><Input value={f.address} onChange={(e) => set('address', e.target.value)} /></Field></div>
        <div className="sm:col-span-2">
          <Field label="Irradiation profile" hint="Your own plane-of-array peak sun hours (Calculator → Solar resource)">
            <Select value={f.profileId} onChange={(e) => pickProfile(e.target.value)}>
              <option value="">Custom values below</option>
              {profiles.data?.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isDefault ? ' (default)' : ''}</option>)}
            </Select>
          </Field>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-6 gap-2 sm:grid-cols-12">
        {MONTH_LABELS.map((m, i) => (
          <label key={m} className="text-[11px] text-ink-muted">{m}
            <Input aria-label={`Peak sun hours ${m}`} inputMode="decimal" className="px-1.5 text-xs" value={f.psh[i]} onChange={(e) => { const v = [...f.psh]; v[i] = e.target.value; setF((x) => ({ ...x, profileId: '', psh: v })); }} />
          </label>
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Field label="AC capacity (kW)" hint="Blank = kWp ÷ 1.1"><Input inputMode="decimal" value={f.acKw} onChange={(e) => set('acKw', e.target.value)} /></Field>
        <Field label="Inverter model"><Input value={f.inverterName} onChange={(e) => set('inverterName', e.target.value)} /></Field>
        <Field label="Inverter rating (kW)"><Input inputMode="decimal" value={f.inverterKw} onChange={(e) => set('inverterKw', e.target.value)} /></Field>
        <Field label="Structure"><Input value={f.structure} onChange={(e) => set('structure', e.target.value)} /></Field>
        <Field label="Degradation (%/yr)"><Input inputMode="decimal" value={f.degradation} onChange={(e) => set('degradation', e.target.value)} /></Field>
        <Field label="Grid CO₂ (kg/kWh)"><Input inputMode="decimal" value={f.co2} onChange={(e) => set('co2', e.target.value)} /></Field>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-medium">Loss assumptions (%)</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          {(Object.keys(LOSS_LABELS) as (keyof LossStack)[]).map((k) => (
            <label key={k} className="text-[11px] text-ink-muted">{LOSS_LABELS[k]}
              <Input inputMode="decimal" className="text-xs" value={f.losses[k]} onChange={(e) => set('losses', { ...f.losses, [k]: e.target.value })} />
            </label>
          ))}
        </div>
      </details>
      <div className="mt-3"><Field label="Contact line for the last page"><Input value={f.contact} onChange={(e) => set('contact', e.target.value)} placeholder="email · phone · website" /></Field></div>
      {parsed.problems.length > 0 && <ul className="mt-3 list-disc pl-5 text-xs text-amber-700">{parsed.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <ErrorNote error={err} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="accent" loading={busy} disabled={parsed.problems.length > 0} onClick={generate}>Generate PDF</Button>
      </div>
    </Modal>
  );
}
