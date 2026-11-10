import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, RotateCcw, RotateCw, Trash2, Wand2 } from 'lucide-react';
import { EQUIPMENT_KINDS, ISSUE_LABELS, OBSTACLE_LABELS, OBSTACLE_TYPES, ROOF_TYPES, ROOF_TYPE_LABELS, type Obstacle } from '@solarflow/shared';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { cn } from '@/lib/utils';
import { label, type Page } from '@/lib/format';
import { Button } from '@/components/ui';
import { useAnalysis } from './analysis';
import { Chip, ColorField, NumField, PanelSection, SelectField, TextField } from './fields';
import { useDesign } from './store';
import { useUnits } from './units';

/* ───────────── Building (shared geometry) ───────────── */
export function BuildingPanel() {
  const b = useDesign((s) => s.config?.building);
  const panels = useDesign((s) => s.config?.panels.length ?? 0);
  const update = useDesign((s) => s.updateBuilding);
  const u = useUnits();
  if (!b) return null;
  const k = (key: string) => `bld-${key}`;
  return (
    <PanelSection title="Building">
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Length" suffix={u.len} value={b.lengthM} min={1} max={500} step={0.5} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => update({ lengthM: v }, k('l'))} />
        <NumField label="Width" suffix={u.len} value={b.widthM} min={1} max={500} step={0.5} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => update({ widthM: v }, k('w'))} />
        <NumField label="Floors" value={b.floors} min={1} max={100} step={1} decimals={0} onChange={(v) => update({ floors: Math.round(v) }, k('f'))} />
        <NumField label="Floor height" suffix={u.len} value={b.floorHeightM} min={2} max={8} step={0.1} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => update({ floorHeightM: v }, k('fh'))} />
      </div>
      <SelectField label="Roof type" value={b.roofType} options={ROOF_TYPES.map((t) => ({ value: t, label: ROOF_TYPE_LABELS[t] }))}
        onChange={(t) => update({ roofType: t, roofAngleDeg: t === 'FLAT' ? 0 : b.roofAngleDeg || 25 })} />
      {b.roofType !== 'FLAT' && <NumField label="Roof angle" suffix="°" value={b.roofAngleDeg} min={0} max={60} step={1} decimals={1} onChange={(v) => update({ roofAngleDeg: v }, k('ra'))} />}
      {b.roofType === 'GABLE' && <SelectField label="Ridge runs along" value={b.ridgeAlong} options={[{ value: 'LENGTH', label: 'Length' }, { value: 'WIDTH', label: 'Width' }]} onChange={(v) => update({ ridgeAlong: v })} />}
      <NumField label="Building rotation (clockwise from north)" suffix="°" value={b.orientationDeg} min={-360} max={360} step={5} decimals={1} onChange={(v) => update({ orientationDeg: v }, k('o'))} />
      {panels > 0 && <p className="text-[11px] text-ink-muted">Changing the roof re-validates all {panels} panels. Any that no longer fit are flagged in red.</p>}
    </PanelSection>
  );
}

/* ───────────── Selection properties ───────────── */
function SectionProps({ id }: { id: string }) {
  const s = useDesign((st) => st.config?.roofSections.find((x) => x.id === id));
  const count = useDesign((st) => st.config?.roofSections.length ?? 0);
  const update = useDesign((st) => st.updateSection);
  const del = useDesign((st) => st.deleteSection);
  const u = useUnits();
  if (!s) return null;
  const xs = s.polygon.map((p) => p.x);
  const ys = s.polygon.map((p) => p.y);
  const rectangular = s.polygon.length === 4 && new Set(xs).size === 2 && new Set(ys).size === 2;
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  return (
    <PanelSection title="Roof section" action={count > 1 ? <button aria-label="Delete roof section" onClick={() => { if (window.confirm(`Delete “${s.name}” and its panels?`)) del(id); }} className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button> : undefined}>
      <TextField label="Name" value={s.name} onChange={(v) => update(id, { name: v || s.name }, `sn-${id}`)} />
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Slope faces (azimuth)" suffix="°" value={s.azimuthDeg} min={0} max={360} step={5} decimals={1} onChange={(v) => update(id, { azimuthDeg: v }, `az-${id}`)} />
        <NumField label="Tilt" suffix="°" value={s.tiltDeg} min={0} max={75} step={1} decimals={1} onChange={(v) => update(id, { tiltDeg: v }, `ti-${id}`)} />
        <NumField label="Edge setback" suffix={u.len} value={s.setbackM} min={0} max={10} step={0.1} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => update(id, { setbackM: v }, `sb-${id}`)} />
        <NumField label="Base height" suffix={u.len} value={s.baseHeightM} min={0} max={500} step={0.5} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => update(id, { baseHeightM: v }, `bh-${id}`)} />
      </div>
      {rectangular && (
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Width (true length)" suffix={u.len} value={w} min={0.5} step={0.1} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay}
            onChange={(v) => update(id, { polygon: [{ x: 0, y: 0 }, { x: v, y: 0 }, { x: v, y: h }, { x: 0, y: h }] }, `rw-${id}`)} />
          <NumField label="Height (up-slope)" suffix={u.len} value={h} min={0.5} step={0.1} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay}
            onChange={(v) => update(id, { polygon: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: v }, { x: 0, y: v }] }, `rh-${id}`)} />
        </div>
      )}
      <p className="text-[11px] text-ink-muted">Drag the corner handles in the canvas to reshape this section. Dimensions are true (along the slope).</p>
    </PanelSection>
  );
}

function PanelProps({ ids }: { ids: string[] }) {
  const config = useDesign((s) => s.config)!;
  const update = useDesign((s) => s.updatePanels);
  const rotate = useDesign((s) => s.rotatePanels);
  const del = useDesign((s) => s.deletePanels);
  const u = useUnits();
  const analysis = useAnalysis();
  const panels = config.panels.filter((p) => ids.includes(p.id));
  const p = panels[0];
  if (!p) return null;
  const single = panels.length === 1;
  const issues = single ? analysis?.report.issues[p.id] ?? [] : [];
  return (
    <PanelSection title={single ? 'Panel' : `${panels.length} panels`} action={<button aria-label="Delete selected panels" onClick={() => del(ids)} className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>}>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" aria-label="Rotate 90° counter-clockwise" onClick={() => rotate(ids, 90)}><RotateCcw className="h-4 w-4" />90°</Button>
        <Button size="sm" variant="outline" aria-label="Rotate 90° clockwise" onClick={() => rotate(ids, -90)}><RotateCw className="h-4 w-4" />90°</Button>
        <Button size="sm" variant="outline" onClick={() => rotate(ids, 5)}>+5°</Button>
        <Button size="sm" variant="outline" onClick={() => rotate(ids, -5)}>−5°</Button>
      </div>
      <SelectField label="Orientation" value={p.orientation} options={[{ value: 'PORTRAIT', label: 'Portrait' }, { value: 'LANDSCAPE', label: 'Landscape' }]} onChange={(v) => update(ids, { orientation: v })} />
      <SelectField label="Panel type" value={p.typeId} options={config.panelTypes.map((t) => ({ value: t.id, label: `${t.wattage} W · ${t.name}` }))} onChange={(v) => update(ids, { typeId: v })} />
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Rotation" suffix="°" value={p.rotationDeg} min={-360} max={360} step={1} decimals={1} onChange={(v) => update(ids, { rotationDeg: v }, `rot-${ids.join()}`)} />
        <NumField label="Mounting tilt" suffix="°" value={p.tiltDeg} min={0} max={60} step={1} decimals={1} onChange={(v) => update(ids, { tiltDeg: v }, `tilt-${ids.join()}`)} />
        {single && <NumField label="Position u" suffix={u.len} value={p.x} step={0.05} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => update(ids, { x: v }, `px-${p.id}`)} />}
        {single && <NumField label="Position v" suffix={u.len} value={p.y} step={0.05} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => update(ids, { y: v }, `py-${p.id}`)} />}
      </div>
      {issues.length > 0 && <ul className="space-y-1">{issues.map((i, k) => <li key={k} className={cn('rounded px-2 py-1 text-xs', i.severity === 'error' ? 'bg-red-50 text-red-700' : 'bg-sun-soft text-yellow-800')}>{i.message}</li>)}</ul>}
      {single && issues.length === 0 && <Chip tone="green">Valid placement</Chip>}
    </PanelSection>
  );
}

function ObstacleProps({ id }: { id: string }) {
  const o = useDesign((s) => s.config?.obstacles.find((x) => x.id === id));
  const update = useDesign((s) => s.updateObstacle);
  const del = useDesign((s) => s.deleteObstacle);
  const u = useUnits();
  if (!o) return null;
  const f = (patch: Partial<Obstacle>, k: string) => update(id, patch, `ob-${id}-${k}`);
  return (
    <PanelSection title="Obstacle" action={<button aria-label="Delete obstacle" onClick={() => del(id)} className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>}>
      <SelectField label="Type" value={o.type} options={OBSTACLE_TYPES.map((t) => ({ value: t, label: OBSTACLE_LABELS[t] }))} onChange={(v) => update(id, { type: v })} />
      <SelectField label="Shape" value={o.shape} options={[{ value: 'RECT', label: 'Rectangle' }, { value: 'CIRCLE', label: 'Circle' }]} onChange={(v) => update(id, { shape: v })} />
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Centre u" suffix={u.len} value={o.x} step={0.05} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => f({ x: v }, 'x')} />
        <NumField label="Centre v" suffix={u.len} value={o.y} step={0.05} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => f({ y: v }, 'y')} />
        {o.shape === 'RECT' ? <>
          <NumField label="Width" suffix={u.len} value={o.w} min={0.05} step={0.05} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => f({ w: v }, 'w')} />
          <NumField label="Depth" suffix={u.len} value={o.h} min={0.05} step={0.05} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => f({ h: v }, 'h')} />
        </> : <NumField label="Radius" suffix={u.len} value={o.r} min={0.05} step={0.05} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => f({ r: v }, 'r')} />}
        <NumField label="Height above roof" suffix={u.len} value={o.heightM} min={0} step={0.1} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => f({ heightM: v }, 'ht')} />
        <NumField label="Panel clearance" suffix={u.len} value={o.clearanceM} min={0} step={0.05} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => f({ clearanceM: v }, 'cl')} />
      </div>
    </PanelSection>
  );
}

function ZoneProps({ id }: { id: string }) {
  const z = useDesign((s) => s.config?.zones.find((x) => x.id === id));
  const update = useDesign((s) => s.updateZone);
  const del = useDesign((s) => s.deleteZone);
  if (!z) return null;
  return (
    <PanelSection title="Restricted zone" action={<button aria-label="Delete zone" onClick={() => del(id)} className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>}>
      <TextField label="Name" value={z.name} onChange={(v) => update(id, { name: v || z.name }, `zn-${id}`)} />
      <p className="text-[11px] text-ink-muted">No panels are allowed inside this area (e.g. walkways, fire-service access). Drag the handles to reshape it.</p>
    </PanelSection>
  );
}

function EquipmentProps({ id }: { id: string }) {
  const e = useDesign((s) => s.config?.equipment.find((x) => x.id === id));
  const update = useDesign((s) => s.updateEquipment);
  const del = useDesign((s) => s.deleteEquipment);
  const u = useUnits();
  if (!e) return null;
  const f = (patch: object, k: string) => update(id, patch, `eq-${id}-${k}`);
  return (
    <PanelSection title="Equipment" action={<button aria-label="Delete equipment" onClick={() => del(id)} className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>}>
      <TextField label="Label" value={e.label} onChange={(v) => f({ label: v }, 'l')} />
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Plan x" suffix={u.len} value={e.x} step={0.1} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => f({ x: v }, 'x')} />
        <NumField label="Plan y" suffix={u.len} value={e.y} step={0.1} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => f({ y: v }, 'y')} />
        <NumField label="Width" suffix={u.len} value={e.widthM} min={0.1} step={0.1} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => f({ widthM: v }, 'w')} />
        <NumField label="Depth" suffix={u.len} value={e.depthM} min={0.1} step={0.1} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => f({ depthM: v }, 'd')} />
        <NumField label="Height" suffix={u.len} value={e.heightM} min={0.1} step={0.1} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => f({ heightM: v }, 'h')} />
      </div>
    </PanelSection>
  );
}

export function SelectionPanel() {
  const sel = useDesign((s) => s.selection);
  const active = useDesign((s) => s.activeSectionId);
  if (!sel) return active ? <SectionProps id={active} /> : null;
  if (sel.kind === 'panel') return <PanelProps ids={sel.ids} />;
  if (sel.kind === 'obstacle') return <ObstacleProps id={sel.ids[0]!} />;
  if (sel.kind === 'zone') return <ZoneProps id={sel.ids[0]!} />;
  if (sel.kind === 'equipment') return <EquipmentProps id={sel.ids[0]!} />;
  return <SectionProps id={sel.ids[0]!} />;
}

/* ───────────── Layout, panel types, auto-arrange ───────────── */
interface CatalogPanel { id: string; name: string; manufacturer: string; modelNumber: string; wattageW: string | null; lengthMm: string | null; widthMm: string | null }

export function LayoutPanel() {
  const c = useDesign((s) => s.config);
  const active = useDesign((s) => s.activeSectionId);
  const placing = useDesign((s) => s.placingTypeId);
  const { updateLayout, autoArrange, clearPanels, addPanelType, updatePanelType, deletePanelType, setPlacingType, setTool } = useDesign.getState();
  const can = useAuth((s) => s.can);
  const u = useUnits();
  const [msg, setMsg] = useState<string | null>(null);
  const [useTarget, setUseTarget] = useState(false);
  const catalog = useQuery({
    queryKey: ['catalog-panels'], enabled: can('equipment:view'), staleTime: 60_000,
    queryFn: () => api.get<Page<CatalogPanel>>(`/equipment${qs({ category: 'SOLAR_PANEL', pageSize: 100, active: 'true' })}`).then((r) => r.data.filter((p) => p.wattageW && p.lengthMm && p.widthMm)),
  });
  if (!c) return null;
  const secs = c.roofSections;
  const run = (ids: string[]) => {
    let placed = 0;
    let capacity = 0;
    const target = useTarget ? c.meta.targetPanels : undefined;
    ids.forEach((id, i) => {
      const remaining = target === undefined ? undefined : Math.max(0, target - placed);
      const r = autoArrange(id, { typeId: placing ?? undefined, maxPanels: remaining });
      if (r) { placed += r.placed; capacity += r.capacity; }
      if (i === 0 && ids.length > 1) void 0;
    });
    setMsg(`Placed ${placed} panel${placed === 1 ? '' : 's'}${capacity > placed ? ` (roof can hold ${capacity})` : ''}. Drag panels to fine-tune.`);
  };
  const type = c.panelTypes.find((t) => t.id === placing) ?? c.panelTypes[0]!;
  return (
    <>
      <PanelSection title="Panel types">
        <p className="text-[11px] text-ink-muted">Drag a type onto the roof, click it then click the roof, or use auto-arrange.</p>
        <ul className="space-y-1.5">
          {c.panelTypes.map((t) => (
            <li key={t.id}>
              <button draggable onDragStart={(e) => { e.dataTransfer.setData('application/x-solarflow-panel', t.id); setPlacingType(t.id); }} onClick={() => { setPlacingType(t.id); setTool('panel'); }}
                className={cn('flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs', placing === t.id ? 'border-accent bg-accent/5' : 'border-surface-line hover:bg-surface-alt')}>
                <span className="h-7 w-4 shrink-0 rounded-sm border border-blue-900 bg-blue-200" />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{t.wattage} W · {t.name}</span><span className="text-ink-muted">{u.fmt(t.widthM)} × {u.fmt(t.lengthM)}</span></span>
              </button>
            </li>
          ))}
        </ul>
        <details className="rounded-md border border-surface-line">
          <summary className="cursor-pointer px-2 py-1.5 text-xs font-medium">Edit “{type.name.slice(0, 22)}”</summary>
          <div className="space-y-2 border-t border-surface-line p-2">
            <TextField label="Name" value={type.name} maxLength={100} onChange={(v) => updatePanelType(type.id, { name: v || type.name }, `ptn-${type.id}`)} />
            <div className="grid grid-cols-3 gap-2">
              <NumField label="Width" suffix={u.len} value={type.widthM} min={0.3} max={3} step={0.01} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => updatePanelType(type.id, { widthM: v }, `ptw-${type.id}`)} />
              <NumField label="Length" suffix={u.len} value={type.lengthM} min={0.3} max={4} step={0.01} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => updatePanelType(type.id, { lengthM: v }, `ptl-${type.id}`)} />
              <NumField label="Watts" value={type.wattage} min={50} max={1000} step={5} decimals={0} onChange={(v) => updatePanelType(type.id, { wattage: v }, `ptp-${type.id}`)} />
            </div>
            <Button size="sm" variant="outline" onClick={() => { if (!deletePanelType(type.id)) setMsg('Keep at least one type, and remove its panels before deleting it.'); }}>Delete this type</Button>
          </div>
        </details>
        {can('equipment:view') && (
          <SelectField label="Add from your equipment catalogue" value="" options={[{ value: '', label: catalog.isLoading ? 'Loading…' : catalog.data?.length ? 'Choose a panel…' : 'No panels with dimensions' }, ...(catalog.data ?? []).map((p) => ({ value: p.id, label: `${p.manufacturer} ${p.modelNumber} (${Number(p.wattageW)} W)` }))]}
            onChange={(id) => { const p = catalog.data?.find((x) => x.id === id); if (!p) return; const nid = addPanelType({ name: `${p.manufacturer} ${p.modelNumber}`, widthM: Number(p.widthMm) / 1000, lengthM: Number(p.lengthMm) / 1000, wattage: Number(p.wattageW), equipmentId: p.id }); setPlacingType(nid); }} />
        )}
        <Button size="sm" variant="outline" onClick={() => { const id = addPanelType({ name: 'Custom module', widthM: 1.0, lengthM: 1.7, wattage: 400 }); setPlacingType(id); }}><Plus className="h-4 w-4" />Custom size</Button>
      </PanelSection>

      <PanelSection title="Spacing and mounting">
        <SelectField label="Orientation" value={c.layout.orientation} options={[{ value: 'AUTO', label: 'Auto (best fit)' }, { value: 'PORTRAIT', label: 'Portrait' }, { value: 'LANDSCAPE', label: 'Landscape' }]} onChange={(v) => updateLayout({ orientation: v })} />
        <div className="grid grid-cols-2 gap-2">
          <NumField label="Gap between panels" suffix={u.len} value={c.layout.gapXM} min={0} max={2} step={0.01} decimals={3} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => updateLayout({ gapXM: v }, 'gx')} />
          <NumField label="Gap between rows" suffix={u.len} value={c.layout.gapYM} min={0} max={2} step={0.01} decimals={3} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay} onChange={(v) => updateLayout({ gapYM: v }, 'gy')} />
          <NumField label="Mounting tilt" suffix="°" value={c.layout.mountTiltDeg} min={0} max={60} step={1} decimals={1} onChange={(v) => updateLayout({ mountTiltDeg: v }, 'mt')} />
          <NumField label="Design sun elevation" suffix="°" value={c.layout.designSunElevationDeg} min={5} max={80} step={1} decimals={0} onChange={(v) => updateLayout({ designSunElevationDeg: v }, 'se')} />
        </div>
        {c.layout.mountTiltDeg > 0 && <p className="text-[11px] text-ink-muted">Tilted rows are spaced so a row does not shade the next when the sun is {c.layout.designSunElevationDeg}° high (an assumption: adjust for your latitude).</p>}
        <NumField label="Edge setback (all sections)" suffix={u.len} value={secs[0]?.setbackM ?? 0.5} min={0} max={10} step={0.1} toDisplay={u.toDisplay} fromDisplay={u.fromDisplay}
          onChange={(v) => useDesign.getState().commit((cfg) => ({ ...cfg, roofSections: cfg.roofSections.map((s) => ({ ...s, setbackM: v })) }), 'setback-all')} />
      </PanelSection>

      <PanelSection title="Automatic placement">
        {c.meta.targetPanels !== undefined && (
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={useTarget} onChange={(e) => setUseTarget(e.target.checked)} />Stop at calculator target ({c.meta.targetPanels} panels)</label>
        )}
        <Button size="sm" className="w-full" onClick={() => active && run([active])} disabled={!active}><Wand2 className="h-4 w-4" />Fill selected section</Button>
        {secs.length > 1 && <Button size="sm" variant="outline" className="w-full" onClick={() => run(secs.map((s) => s.id))}>Fill all sections</Button>}
        <Button size="sm" variant="ghost" className="w-full" onClick={() => { if (window.confirm(active ? 'Remove all panels from the selected section?' : 'Remove all panels?')) clearPanels(active ?? undefined); }}>Clear panels{active ? ' in this section' : ''}</Button>
        {msg && <p role="status" className="text-xs text-accent">{msg}</p>}
        <p className="text-[11px] text-ink-muted">Panels are placed only where they respect setbacks, obstacles and restricted zones. Replaces existing panels in the section.</p>
      </PanelSection>
    </>
  );
}

/* ───────────── Summary ───────────── */
export function SummaryPanel() {
  const a = useAnalysis();
  const setSel = useDesign((s) => s.setSelection);
  const setActive = useDesign((s) => s.setActiveSection);
  const panels = useDesign((s) => s.config?.panels);
  const targetKwp = useDesign((s) => s.config?.meta.targetKwp);
  const u = useUnits();
  if (!a) return null;
  const s = a.summary;
  const bad = Object.entries(a.report.issues).filter(([, l]) => l.some((i) => i.severity === 'error'));
  return (
    <>
      <PanelSection title="Summary">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <div><dt className="text-[11px] text-ink-muted">Valid panels</dt><dd className="text-lg font-semibold">{s.validPanelCount}</dd></div>
          <div><dt className="text-[11px] text-ink-muted">Installed capacity</dt><dd className="text-lg font-semibold text-accent">{s.installedKwp} kWp</dd></div>
          <div><dt className="text-[11px] text-ink-muted">Panel area</dt><dd>{u.fmtArea(s.panelAreaM2)}</dd></div>
          <div><dt className="text-[11px] text-ink-muted">Roof coverage</dt><dd>{s.coveragePercent}%</dd></div>
          <div><dt className="text-[11px] text-ink-muted">Min. spacing</dt><dd>{s.minSpacingM === null ? '—' : u.fmt(s.minSpacingM, 3)}</dd></div>
          <div><dt className="text-[11px] text-ink-muted">Roof area</dt><dd>{u.fmtArea(s.roofAreaM2)}</dd></div>
        </dl>
        {s.targetPanels !== null && (
          <p className={cn('rounded px-2 py-1.5 text-xs', s.targetDeltaPanels! >= 0 ? 'bg-green-50 text-green-800' : 'bg-sun-soft text-yellow-900')}>
            Calculator recommends {s.targetPanels} panels{targetKwp ? ` (${targetKwp} kWp)` : ''}. {s.targetDeltaPanels === 0 ? 'Layout matches.' : s.targetDeltaPanels! > 0 ? `Layout has ${s.targetDeltaPanels} more.` : `Layout is ${-s.targetDeltaPanels!} short.`}
          </p>
        )}
        {s.invalidPanelCount > 0 && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">{s.invalidPanelCount} panel{s.invalidPanelCount === 1 ? '' : 's'} with errors are excluded from the capacity.</p>}
      </PanelSection>
      <PanelSection title="By roof section">
        <ul className="space-y-1.5 text-xs">
          {s.bySection.map((x) => (
            <li key={x.id}><button className="flex w-full items-center justify-between rounded px-1.5 py-1 text-left hover:bg-surface-alt" onClick={() => { setActive(x.id); setSel({ kind: 'section', ids: [x.id] }); }}>
              <span><span className="font-medium">{x.name}</span><span className="block text-ink-muted">faces {x.azimuthDeg}° · tilt {x.tiltDeg}°</span></span><span className="text-right">{x.panels} panels<span className="block text-ink-muted">{x.kwp} kWp</span></span></button></li>
          ))}
        </ul>
      </PanelSection>
      {bad.length > 0 && (
        <PanelSection title={`Needs attention (${bad.length})`}>
          <ul className="max-h-60 space-y-1 overflow-y-auto text-xs">
            {bad.slice(0, 100).map(([id, list]) => {
              const p = panels?.find((x) => x.id === id);
              return (
                <li key={id}><button className="w-full rounded bg-red-50 px-2 py-1 text-left text-red-700 hover:bg-red-100" onClick={() => { if (p) { setActive(p.sectionId); setSel({ kind: 'panel', ids: [id] }); } }}>
                  {list.filter((i) => i.severity === 'error').map((i) => ISSUE_LABELS[i.type]).join(', ')}</button></li>
              );
            })}
          </ul>
        </PanelSection>
      )}
    </>
  );
}

/* ───────────── Appearance, obstacles, equipment (3D-oriented) ───────────── */
export function AppearancePanel() {
  const a = useDesign((s) => s.config?.appearance);
  const update = useDesign((s) => s.updateAppearance);
  if (!a) return null;
  return (
    <PanelSection title="Colours and materials">
      <ColorField label="Panel colour" value={a.panelColor} onChange={(v) => update({ panelColor: v }, 'pc')} />
      <ColorField label="Panel frame" value={a.panelFrameColor} onChange={(v) => update({ panelFrameColor: v }, 'pf')} />
      <ColorField label="Roof" value={a.roofColor} onChange={(v) => update({ roofColor: v }, 'rc')} />
      <ColorField label="Walls" value={a.wallColor} onChange={(v) => update({ wallColor: v }, 'wc')} />
      <SelectField label="Panel finish" value={a.panelMaterial} options={[{ value: 'GLOSSY', label: 'Glossy glass' }, { value: 'MATTE', label: 'Matte' }]} onChange={(v) => update({ panelMaterial: v })} />
    </PanelSection>
  );
}

export function ObstaclePalette() {
  const type = useDesign((s) => s.obstacleType);
  const setType = useDesign((s) => s.setObstacleType);
  const active = useDesign((s) => s.activeSectionId);
  const add = useDesign((s) => s.addObstacle);
  const setSel = useDesign((s) => s.setSelection);
  const sec = useDesign((s) => s.config?.roofSections.find((x) => x.id === s.activeSectionId));
  const obstacles = useDesign((s) => s.config?.obstacles ?? []);
  return (
    <PanelSection title="Obstacles">
      <div className="flex gap-2">
        <div className="flex-1"><SelectField label="Type" value={type} options={OBSTACLE_TYPES.map((t) => ({ value: t, label: OBSTACLE_LABELS[t] }))} onChange={setType} /></div>
        <Button size="sm" className="self-end" disabled={!active || !sec} onClick={() => { if (!active || !sec) return; const xs = sec.polygon.map((p) => p.x); const ys = sec.polygon.map((p) => p.y); const id = add(active, (Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2); if (id) setSel({ kind: 'obstacle', ids: [id] }); }}><Plus className="h-4 w-4" />Add</Button>
      </div>
      <ul className="space-y-1 text-xs">{obstacles.map((o) => <li key={o.id}><button className="w-full rounded px-1.5 py-1 text-left hover:bg-surface-alt" onClick={() => { useDesign.getState().setActiveSection(o.sectionId); setSel({ kind: 'obstacle', ids: [o.id] }); }}>{OBSTACLE_LABELS[o.type]} <span className="text-ink-muted">· {label(o.shape)}</span></button></li>)}</ul>
    </PanelSection>
  );
}

export function EquipmentPanel() {
  const items = useDesign((s) => s.config?.equipment ?? []);
  const add = useDesign((s) => s.addEquipment);
  const setSel = useDesign((s) => s.setSelection);
  return (
    <PanelSection title="Inverter and equipment">
      <div className="flex flex-wrap gap-1.5">{EQUIPMENT_KINDS.map((k) => <Button key={k} size="sm" variant="outline" onClick={() => setSel({ kind: 'equipment', ids: [add(k)] })}><Plus className="h-3.5 w-3.5" />{label(k)}</Button>)}</div>
      <ul className="space-y-1 text-xs">{items.map((e) => <li key={e.id}><button className="w-full rounded px-1.5 py-1 text-left hover:bg-surface-alt" onClick={() => setSel({ kind: 'equipment', ids: [e.id] })}>{e.label || label(e.kind)}</button></li>)}</ul>
      <p className="text-[11px] text-ink-muted">Shown beside the building in 3D and on the plan. Positions are illustrative, not an electrical layout.</p>
    </PanelSection>
  );
}
