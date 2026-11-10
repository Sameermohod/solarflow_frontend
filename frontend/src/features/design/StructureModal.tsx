import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_SHEET_NOTES, STRUCTURE_PRESETS, buildStructure, renderStructureSvg, type StructureSheetMeta, type StructureSpec } from '@solarflow/shared';
import { useAuth } from '@/store/auth';
import { Button, ErrorNote, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { useDesign } from './store';
import { downloadBlob } from './exporters';

type F = Record<string, string>;
const SECTIONS = ['column', 'rafter', 'purlin', 'horizontal', 'walkway1', 'walkway2'] as const;
const SECTION_LABEL: Record<(typeof SECTIONS)[number], string> = { column: 'Column', rafter: 'Rafter', purlin: 'Purlin', horizontal: 'Horizontal support', walkway1: 'Walkway channel 1', walkway2: 'Walkway channel 2' };

const s = (v: number | null) => (v === null ? '' : String(v));
const toForm = (p: StructureSpec): F => ({
  title: p.title, panelLengthMm: s(p.panelLengthMm), panelWidthMm: s(p.panelWidthMm), panelThicknessMm: s(p.panelThicknessMm),
  panelsAlongSlope: s(p.panelsAlongSlope), panelsAcross: s(p.panelsAcross), panelGapMm: s(p.panelGapMm), tiltDeg: s(p.tiltDeg), frames: s(p.frames),
  frameSpacingsMm: p.frameSpacingsMm ? p.frameSpacingsMm.join(', ') : '', backColumnMm: s(p.backColumnMm), frontColumnMm: s(p.frontColumnMm), columnSpanMm: s(p.columnSpanMm),
  rafterLengthMm: s(p.rafterLengthMm), rafterBackOverhangMm: s(p.rafterBackOverhangMm), purlinSpacingMm: s(p.purlinSpacingMm), purlinPieces: p.purlinPieces ? p.purlinPieces.join(', ') : '',
  purlinOverhangMm: s(p.purlinOverhangMm), horizontalSupportHeightMm: s(p.horizontalSupportHeightMm), walkway: p.walkway ? '1' : '', walkwayLength1Mm: s(p.walkwayLength1Mm), walkwayLength2Mm: s(p.walkwayLength2Mm),
  ...Object.fromEntries(SECTIONS.flatMap((k) => [[`${k}_profile`, p[k].profile], [`${k}_material`, p[k].material]])),
  basePlateMm: s(p.basePlateMm), basePlateThicknessMm: s(p.basePlateThicknessMm), basePlateMaterial: p.basePlateMaterial,
  stiffenersPerBase: s(p.stiffenersPerBase), stiffenerLengthMm: s(p.stiffenerLengthMm), stiffenerWidthMm: s(p.stiffenerWidthMm), stiffenerThicknessMm: s(p.stiffenerThicknessMm), stiffenerMaterial: p.stiffenerMaterial,
});
const toSpec = (f: F): StructureSpec => {
  const n = (k: string) => (f[k]!.trim() === '' ? NaN : Number(f[k]));
  const o = (k: string) => (f[k]!.trim() === '' ? null : Number(f[k]));
  const list = (k: string) => (f[k]!.trim() === '' ? null : f[k]!.split(/[,\s]+/).filter(Boolean).map(Number));
  const sec = (k: string) => ({ profile: f[`${k}_profile`]!.trim(), material: f[`${k}_material`]!.trim() });
  return {
    title: f.title!.trim() || 'SOLAR STRUCTURE', panelLengthMm: n('panelLengthMm'), panelWidthMm: n('panelWidthMm'), panelThicknessMm: n('panelThicknessMm'),
    panelsAlongSlope: n('panelsAlongSlope'), panelsAcross: n('panelsAcross'), panelGapMm: n('panelGapMm'), tiltDeg: n('tiltDeg'), frames: n('frames'),
    frameSpacingsMm: list('frameSpacingsMm'), backColumnMm: n('backColumnMm'), frontColumnMm: o('frontColumnMm'), columnSpanMm: o('columnSpanMm'),
    rafterLengthMm: o('rafterLengthMm'), rafterBackOverhangMm: o('rafterBackOverhangMm'), purlinSpacingMm: o('purlinSpacingMm'), purlinPieces: list('purlinPieces'),
    purlinOverhangMm: n('purlinOverhangMm'), horizontalSupportHeightMm: o('horizontalSupportHeightMm'), walkway: f.walkway === '1', walkwayLength1Mm: o('walkwayLength1Mm'), walkwayLength2Mm: o('walkwayLength2Mm'),
    column: sec('column'), rafter: sec('rafter'), purlin: sec('purlin'), horizontal: sec('horizontal'), walkway1: sec('walkway1'), walkway2: sec('walkway2'),
    basePlateMm: n('basePlateMm'), basePlateThicknessMm: n('basePlateThicknessMm'), basePlateMaterial: f.basePlateMaterial!.trim(),
    stiffenersPerBase: n('stiffenersPerBase'), stiffenerLengthMm: n('stiffenerLengthMm'), stiffenerWidthMm: n('stiffenerWidthMm'), stiffenerThicknessMm: n('stiffenerThicknessMm'), stiffenerMaterial: f.stiffenerMaterial!.trim(),
  };
};

interface Meta { drawingNo: string; description: string; drawnBy: string; checkedBy: string; approvedBy: string; revNo: string; revDate: string; project: string; notes: string }
const storeKey = (id: string) => `solarflow.structure.${id}`;

/** Fabrication drawing of the mounting structure: choose a starting preset, edit every dimension, preview, download PDF/SVG. */
export function StructureModal({ designId, designName, onClose }: { designId: string; designName: string; onClose: () => void }) {
  const session = useAuth((st) => st.session);
  const org = session?.organization;
  const user = session?.user;
  const today = new Date().toLocaleDateString('en-GB');
  const [presetId, setPresetId] = useState(STRUCTURE_PRESETS[0]!.id);
  const [form, setForm] = useState<F>(() => toForm(STRUCTURE_PRESETS[0]!.spec));
  const [meta, setMeta] = useState<Meta>({ drawingNo: '', description: '', drawnBy: user ? `${user.firstName} ${user.lastName}`.toUpperCase() : '', checkedBy: '', approvedBy: '', revNo: '-', revDate: today, project: designName, notes: DEFAULT_SHEET_NOTES.join('\n') });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const config = useDesign((st) => st.config);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey(designId));
      if (raw) { const x = JSON.parse(raw); if (x.form) setForm((f) => ({ ...f, ...x.form })); if (x.meta) setMeta((m) => ({ ...m, ...x.meta })); if (x.presetId) setPresetId(x.presetId); }
    } catch { /* storage unavailable */ }
  }, [designId]);
  useEffect(() => { try { localStorage.setItem(storeKey(designId), JSON.stringify({ form, meta, presetId })); } catch { /* ignore */ } }, [form, meta, presetId, designId]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const built = useMemo(() => buildStructure(toSpec(form)), [form]);
  const sheetMeta: StructureSheetMeta = {
    company: org?.name ?? 'SolarFlow', project: meta.project, drawingNo: meta.drawingNo, description: meta.description, drawnBy: meta.drawnBy, checkedBy: meta.checkedBy,
    approvedBy: meta.approvedBy, date: today, revNo: meta.revNo, revDate: meta.revDate, notes: meta.notes.split('\n').map((x) => x.trim()).filter(Boolean),
  };
  const svg = useMemo(() => (built.ok ? renderStructureSvg(built, sheetMeta) : ''), [built, meta, org?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const preset = STRUCTURE_PRESETS.find((p) => p.id === presetId)!;
  const base = `${designName.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'design'}-structure`;

  const designInfo = useMemo(() => {
    if (!config || !built.ok) return null;
    const total = config.panels.length;
    if (!total) return null;
    const per = built.geometry.panelCount;
    return { total, per, tables: Math.ceil(total / per) };
  }, [config, built]);

  const fromDesign = () => {
    if (!config || !config.panelTypes.length) return;
    const counts = new Map<string, number>();
    for (const p of config.panels) counts.set(p.typeId, (counts.get(p.typeId) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const t = config.panelTypes.find((x) => x.id === top) ?? config.panelTypes[0]!;
    setForm((f) => ({ ...f, panelLengthMm: String(Math.round(t.lengthM * 1000)), panelWidthMm: String(Math.round(t.widthM * 1000)) }));
  };

  const download = async (kind: 'pdf' | 'svg') => {
    if (!built.ok) return;
    setErr(null); setBusy(true);
    try {
      if (kind === 'svg') downloadBlob(`${base}.svg`, new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      else { const { exportStructurePdf } = await import('./structurePdf'); await exportStructurePdf(svg, `${base}.pdf`); }
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };

  const num = (k: string, label: string, hint?: string, ph?: string) => (
    <Field label={label} hint={hint}><Input inputMode="decimal" value={form[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)} /></Field>
  );

  return (
    <Modal open wide title="Mounting structure drawing" onClose={onClose}>
      <p className="mb-3 text-sm text-ink-muted">
        Generates an A3 fabrication drawing (isometric, side and front views, details, parts list and title block) from the dimensions below. Leave an optional field blank and it is calculated by a stated rule and starred in the parts list.
        This is a drafting aid, not a structural design: the sections, spans, connections and foundations must be verified by a qualified engineer or your fabricator.
      </p>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1 text-sm">
          <Field label="Start from" hint={preset.note}>
            <Select value={presetId} onChange={(e) => { const p = STRUCTURE_PRESETS.find((x) => x.id === e.target.value)!; setPresetId(p.id); setForm(toForm(p.spec)); }}>
              {STRUCTURE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </Select>
          </Field>
          <Field label="Heading on the sheet"><Input value={form.title} onChange={(e) => set('title', e.target.value)} /></Field>

          <fieldset className="rounded-lg border border-surface-line p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Panels (mm)</legend>
            <div className="grid grid-cols-3 gap-2">
              {num('panelLengthMm', 'Length')}{num('panelWidthMm', 'Width')}{num('panelThicknessMm', 'Thickness')}
              {num('panelsAlongSlope', 'Rows on slope', '1–6')}{num('panelsAcross', 'Across')}{num('panelGapMm', 'Gap')}
            </div>
            {config && config.panelTypes.length > 0 && <Button size="sm" variant="outline" className="mt-2" onClick={fromDesign}>Use the panel size from this design</Button>}
            {designInfo && <p className="mt-2 text-xs text-ink-muted">This design has {designInfo.total} panels; one table here carries {designInfo.per}, so you need {designInfo.tables} table{designInfo.tables > 1 ? 's' : ''} of this kind (the last one may be partly filled).</p>}
          </fieldset>

          <fieldset className="rounded-lg border border-surface-line p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Frame geometry (mm)</legend>
            <div className="grid grid-cols-3 gap-2">
              {num('tiltDeg', 'Tilt (°)')}{num('frames', 'Frames')}{num('backColumnMm', 'Back column')}
              {num('frontColumnMm', 'Front column', 'Blank = from tilt')}{num('columnSpanMm', 'Column span', 'Blank = auto')}{num('horizontalSupportHeightMm', 'Support height', 'Blank = ½ column')}
              {num('rafterLengthMm', 'Rafter length', 'Blank = auto')}{num('rafterBackOverhangMm', 'Rafter behind back column', 'Blank = centred')}{num('purlinSpacingMm', 'Purlin spacing', 'Blank = 60 % of panel')}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Frame spacings" hint="Blank = equal. Comma separated."><Input value={form.frameSpacingsMm} placeholder="2289, 2310" onChange={(e) => set('frameSpacingsMm', e.target.value)} /></Field>
              <Field label="Purlin lengths" hint="Blank = one piece. Comma separated."><Input value={form.purlinPieces} placeholder="2500, 3655" onChange={(e) => set('purlinPieces', e.target.value)} /></Field>
              {num('purlinOverhangMm', 'Purlin overhang each end', 'Used when one piece')}
            </div>
            <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={form.walkway === '1'} onChange={(e) => set('walkway', e.target.checked ? '1' : '')} />Walkway channels on the horizontal supports</label>
            {form.walkway === '1' && <div className="mt-2 grid grid-cols-2 gap-2">{num('walkwayLength1Mm', 'Channel 1 length', 'Blank = span + 20')}{num('walkwayLength2Mm', 'Channel 2 length', 'Blank = span + 40')}</div>}
          </fieldset>

          <fieldset className="rounded-lg border border-surface-line p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Sections and material</legend>
            <div className="space-y-2">
              {SECTIONS.filter((k) => form.walkway === '1' || !k.startsWith('walkway')).map((k) => (
                <div key={k} className="grid grid-cols-[7rem_1fr_7rem] items-center gap-2">
                  <span className="text-xs text-ink-muted">{SECTION_LABEL[k]}</span>
                  <Input aria-label={`${SECTION_LABEL[k]} profile`} value={form[`${k}_profile`]} onChange={(e) => set(`${k}_profile`, e.target.value)} />
                  <Input aria-label={`${SECTION_LABEL[k]} material`} value={form[`${k}_material`]} onChange={(e) => set(`${k}_material`, e.target.value)} />
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-muted">Profile names carry their dimensions (e.g. C-LIP 100X48X15X2); the last number is the thickness.</p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {num('basePlateMm', 'Base plate')}{num('basePlateThicknessMm', 'Plate thk')}{num('stiffenersPerBase', 'Stiffeners / plate')}<Field label="Plate material"><Input value={form.basePlateMaterial} onChange={(e) => set('basePlateMaterial', e.target.value)} /></Field>
              {num('stiffenerLengthMm', 'Stiff. length')}{num('stiffenerWidthMm', 'Stiff. width')}{num('stiffenerThicknessMm', 'Stiff. thk')}<Field label="Stiff. material"><Input value={form.stiffenerMaterial} onChange={(e) => set('stiffenerMaterial', e.target.value)} /></Field>
            </div>
          </fieldset>

          <fieldset className="rounded-lg border border-surface-line p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Title block</legend>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Project"><Input value={meta.project} onChange={(e) => setMeta({ ...meta, project: e.target.value })} /></Field>
              <Field label="Drawing no."><Input value={meta.drawingNo} onChange={(e) => setMeta({ ...meta, drawingNo: e.target.value })} /></Field>
              <Field label="Description"><Input value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} /></Field>
              <Field label="Drawn by"><Input value={meta.drawnBy} onChange={(e) => setMeta({ ...meta, drawnBy: e.target.value })} /></Field>
              <Field label="Checked by"><Input value={meta.checkedBy} onChange={(e) => setMeta({ ...meta, checkedBy: e.target.value })} /></Field>
              <Field label="Approved by"><Input value={meta.approvedBy} onChange={(e) => setMeta({ ...meta, approvedBy: e.target.value })} /></Field>
              <Field label="Revision no."><Input value={meta.revNo} onChange={(e) => setMeta({ ...meta, revNo: e.target.value })} /></Field>
              <Field label="Revision date"><Input value={meta.revDate} onChange={(e) => setMeta({ ...meta, revDate: e.target.value })} /></Field>
            </div>
            <Field label="Notes (one per line)"><Textarea rows={4} value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} /></Field>
            <p className="mt-1 text-xs text-ink-muted">The company name comes from your organization. Keep the engineering note unless an engineer has verified the design.</p>
          </fieldset>
        </div>

        <div className="min-w-0">
          {built.ok ? (
            <>
              <div className="overflow-hidden rounded-lg border border-surface-line bg-white [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
              {built.warnings.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-amber-700">{built.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
            </>
          ) : (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <p className="font-medium">The drawing cannot be generated yet:</p>
              <ul className="mt-1 list-disc pl-5">{built.problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          )}
        </div>
      </div>
      <ErrorNote error={err} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Close</Button>
        <Button variant="outline" disabled={!built.ok} loading={busy} onClick={() => download('svg')}>Download SVG</Button>
        <Button variant="accent" disabled={!built.ok} loading={busy} onClick={() => download('pdf')}>Download PDF (A3)</Button>
      </div>
    </Modal>
  );
}
