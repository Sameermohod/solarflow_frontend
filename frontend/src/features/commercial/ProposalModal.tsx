import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_LOSSES, DEFAULT_REPORT_INPUTS, emptyProposalProfile, proposalProfileIsEmpty, proposalSavings, type SavingsResult } from '@solarflow/shared';
import { api } from '@/lib/api';
import { Button, ErrorNote, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { useProfiles } from '@/pages/calculator/CalcSettings';
import { useCatalogue, type CommercialOptions, type QuotationRow } from './api';

interface Form {
  proposalNo: string; systemKw: string; structureType: string; inverterDetails: string; subsidy: string; projectAddress: string;
  lat: string; lon: string; includeMap: boolean; includeSavings: boolean; profileId: string; tariff: string; personalNote: string;
}
const storeKey = (id: string) => `solarflow.proposal.${id}`;

interface DesignInfo { version: { config: { meta?: { site?: { latitude: number; longitude: number; address?: string } } } }; summary?: { installedKwp?: number | string } }

/** Collects the proposal-specific inputs, then builds the PDF from the quotation plus the company's proposal profile. */
export function ProposalModal({ quote, options, logoUrl, onClose }: { quote: QuotationRow; options: CommercialOptions; logoUrl: string | null | undefined; onClose: () => void }) {
  const catalogue = useCatalogue();
  const profiles = useProfiles();
  const design = useQuery({ queryKey: ['design-site', quote.design?.id], enabled: !!quote.design?.id, queryFn: () => api.get<DesignInfo>(`/designs/${quote.design!.id}`) });
  const profile = options.proposalProfile ?? emptyProposalProfile();
  const empty = proposalProfileIsEmpty(profile);

  const panelKw = useMemo(() => {
    if (!catalogue.data) return null;
    const byId = new Map(catalogue.data.map((c) => [c.id, c]));
    const w = quote.items.reduce((s, it) => { const c = it.equipmentId ? byId.get(it.equipmentId) : undefined; return s + (c?.category === 'SOLAR_PANEL' && c.wattageW ? Number(c.wattageW) * Number(it.quantity) : 0); }, 0);
    return w > 0 ? w / 1000 : null;
  }, [catalogue.data, quote.items]);

  const [f, setF] = useState<Form>(() => {
    const base: Form = { proposalNo: `${quote.number}${quote.revision > 1 ? `/R${quote.revision}` : ''}`, systemKw: '', structureType: 'Standard', inverterDetails: 'String Inverter', subsidy: '0', projectAddress: '', lat: '', lon: '', includeMap: true, includeSavings: true, profileId: '', tariff: '', personalNote: '' };
    try { const raw = localStorage.getItem(storeKey(quote.id)); if (raw) return { ...base, ...JSON.parse(raw) }; } catch { /* ignore */ }
    return base;
  });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => { try { localStorage.setItem(storeKey(quote.id), JSON.stringify(f)); } catch { /* ignore */ } }, [f, quote.id]);

  // prefill from the design / catalogue once, only where the user has not typed anything
  useEffect(() => {
    const site = design.data?.version.config.meta?.site;
    const kwp = Number(design.data?.summary?.installedKwp);
    setF((x) => ({
      ...x,
      systemKw: x.systemKw || (panelKw ? String(Math.round(panelKw * 100) / 100) : kwp > 0 ? String(kwp) : ''),
      lat: x.lat || (site ? String(site.latitude) : ''), lon: x.lon || (site ? String(site.longitude) : ''),
      projectAddress: x.projectAddress || site?.address || '',
    }));
  }, [design.data, panelKw]);
  useEffect(() => { if (!f.profileId && profiles.data) { const d = profiles.data.find((p) => p.isDefault) ?? profiles.data[0]; if (d) setF((x) => ({ ...x, profileId: d.id })); } }, [profiles.data, f.profileId]);

  const kw = Number(f.systemKw); const subsidy = Number(f.subsidy || 0); const tariff = Number(f.tariff);
  const profileRow = profiles.data?.find((p) => p.id === f.profileId);
  const lat = f.lat.trim() === '' ? null : Number(f.lat); const lon = f.lon.trim() === '' ? null : Number(f.lon);
  const problems: string[] = [];
  if (!(kw > 0)) problems.push('Enter the system size in kW.');
  if (!(subsidy >= 0) || subsidy > Number(quote.total)) problems.push('Subsidy must be between 0 and the quotation total.');
  if ((lat === null) !== (lon === null) || (lat !== null && !(Math.abs(lat) <= 90 && Math.abs(lon!) <= 180))) problems.push('Latitude and longitude must both be valid, or both blank.');
  if (f.includeSavings) {
    if (!profileRow) problems.push('Choose an irradiation profile for the savings page (Calculator → Solar resource), or untick the savings page.');
    if (!(tariff > 0)) problems.push('Enter the electricity tariff per unit for the savings page, or untick it.');
  }

  const generate = async () => {
    setErr(null); setBusy(true); setNote('');
    try {
      let savings: SavingsResult | null = null;
      if (f.includeSavings && profileRow) {
        savings = proposalSavings({ kwp: kw, monthlyPeakSunHours: profileRow.monthlyPeakSunHours, losses: DEFAULT_LOSSES, tariffPerKwh: tariff, netCost: Number(quote.total) - subsidy, co2KgPerKwh: DEFAULT_REPORT_INPUTS.co2KgPerKwh, kgCo2PerTreePerYear: DEFAULT_REPORT_INPUTS.kgCo2PerTreePerYear });
      }
      const { fetchSatelliteImage, proposalPdf } = await import('./proposalPdf');
      let overview: string | null = null; let detail: string | null = null;
      if (f.includeMap && lat !== null && lon !== null) {
        [overview, detail] = await Promise.all([fetchSatelliteImage(lat, lon, 600_000), fetchSatelliteImage(lat, lon, 500)]);
        if (!overview && !detail) setNote('The satellite pictures could not be loaded, so the location page has no map.');
      }
      await proposalPdf({
        quote, options, profile, logoUrl, catalogue: catalogue.data ?? [],
        opts: { proposalNo: f.proposalNo.trim() || quote.number, systemKw: kw, structureType: f.structureType.trim() || 'Standard', inverterDetails: f.inverterDetails.trim() || 'String Inverter', subsidy, projectAddress: f.projectAddress.trim(), location: lat !== null && lon !== null ? { lat, lon } : null, mapOverview: overview, mapDetail: detail, savings, tariffPerKwh: f.includeSavings ? tariff : null, personalNote: f.personalNote },
      });
      onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  return (
    <Modal open wide title="Proposal PDF" onClose={onClose}>
      <p className="mb-3 text-sm text-ink-muted">
        Builds a customer proposal from this quotation (customer, price, items, tax, dates) and your company's <Link to="/settings/proposal" className="text-brand underline">proposal profile</Link> (welcome letter, about us, your highlight pages, scope, terms, client list, brand logos and contact page), which are attached automatically.
      </p>
      {empty && <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">Your proposal profile is empty, so only the cover, specification, commercial offer, bill of materials and contact pages will be generated. Fill it in under Settings → Proposal profile.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Proposal number"><Input value={f.proposalNo} onChange={(e) => set('proposalNo', e.target.value)} /></Field>
        <Field label="System size (kW)" hint={panelKw ? 'From the catalogue panel wattage × quantity' : 'Enter the DC capacity'}><Input inputMode="decimal" value={f.systemKw} onChange={(e) => set('systemKw', e.target.value)} /></Field>
        <Field label="Structure type"><Input value={f.structureType} onChange={(e) => set('structureType', e.target.value)} /></Field>
        <Field label="Inverter details"><Input value={f.inverterDetails} onChange={(e) => set('inverterDetails', e.target.value)} /></Field>
        <Field label={`Subsidy (${quote.currency})`} hint="Deducted to give the net effective cost; 0 = none"><Input inputMode="decimal" value={f.subsidy} onChange={(e) => set('subsidy', e.target.value)} /></Field>
        <Field label="Project address"><Input value={f.projectAddress} onChange={(e) => set('projectAddress', e.target.value)} /></Field>
        <Field label="Latitude" hint="From the design's Site map when set"><Input inputMode="decimal" value={f.lat} onChange={(e) => set('lat', e.target.value)} /></Field>
        <Field label="Longitude"><Input inputMode="decimal" value={f.lon} onChange={(e) => set('lon', e.target.value)} /></Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.includeMap} onChange={(e) => set('includeMap', e.target.checked)} />Include satellite pictures of the site (Esri imagery, needs internet)</label>
      <fieldset className="mt-3 rounded-lg border border-surface-line p-3">
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={f.includeSavings} onChange={(e) => set('includeSavings', e.target.checked)} />Include the savings and payback page</label>
        {f.includeSavings && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Irradiation profile" hint="Your own peak sun hours (Calculator → Solar resource)">
              <Select value={f.profileId} onChange={(e) => set('profileId', e.target.value)}>
                <option value="">Choose…</option>
                {profiles.data?.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isDefault ? ' (default)' : ''}</option>)}
              </Select>
            </Field>
            <Field label={`Tariff (${quote.currency} per unit)`} hint="Flat average rate the customer pays"><Input inputMode="decimal" value={f.tariff} onChange={(e) => set('tariff', e.target.value)} /></Field>
            <p className="text-xs text-ink-muted sm:col-span-2">Uses the standard loss assumptions of the yield report (shown on the page); first-year estimate, no degradation or tariff increase.</p>
          </div>
        )}
      </fieldset>
      <div className="mt-3"><Field label="Personal note (optional)" hint="Added under the welcome letter for this customer only"><Textarea rows={3} value={f.personalNote} onChange={(e) => set('personalNote', e.target.value)} /></Field></div>
      {problems.length > 0 && <ul className="mt-3 list-disc pl-5 text-xs text-amber-700">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {note && <p className="mt-2 text-xs text-amber-700">{note}</p>}
      <ErrorNote error={err} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="accent" loading={busy} disabled={problems.length > 0 || catalogue.isLoading} onClick={generate}>Generate proposal</Button>
      </div>
    </Modal>
  );
}
