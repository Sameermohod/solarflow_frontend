import { useRef, useState } from 'react';
import { Eye, EyeOff, Plus, RotateCcw } from 'lucide-react';
import { generateBuilding, pointInPolygon } from '@solarflow/shared';
import { useAuth } from '@/store/auth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui';
import { DesignShell, SideTabs } from './DesignShell';
import { useAnalysis } from './analysis';
import { PanelSection } from './fields';
import { AppearancePanel, BuildingPanel, EquipmentPanel, LayoutPanel, ObstaclePalette, SelectionPanel, SummaryPanel } from './panels';
import { Scene3D, type SceneApi, type SceneToggles, type ViewPreset } from './Scene3D';
import { useDesign } from './store';
import { useUnits } from './units';

const VIEWS: { id: ViewPreset; label: string }[] = [{ id: 'perspective', label: 'Perspective' }, { id: 'top', label: 'Top' }, { id: 'front', label: 'Front' }, { id: 'side', label: 'Side' }];
const TOGGLES: { id: keyof SceneToggles; label: string }[] = [
  { id: 'building', label: 'Building' }, { id: 'roof', label: 'Roof' }, { id: 'panels', label: 'Panels' }, { id: 'obstacles', label: 'Obstacles' }, { id: 'equipment', label: 'Equipment' }, { id: 'dimensions', label: 'Dimensions' },
];

function Hud({ view, setView, reset, toggles, setToggles }: { view: ViewPreset; setView: (v: ViewPreset) => void; reset: () => void; toggles: SceneToggles; setToggles: (t: SceneToggles) => void }) {
  const a = useAnalysis();
  const b = useDesign((s) => s.config?.building);
  const u = useUnits();
  if (!a || !b) return null;
  const h = generateBuilding(b).ridgeHeightM;
  return (
    <>
      <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Camera view" className="flex rounded-lg border border-surface-line bg-white p-0.5 shadow-card">
          {VIEWS.map((v) => <button key={v.id} aria-pressed={view === v.id} onClick={() => setView(v.id)} className={cn('h-8 rounded-md px-2.5 text-xs font-medium', view === v.id ? 'bg-brand text-brand-fg' : 'text-ink-muted')}>{v.label}</button>)}
        </div>
        <button aria-label="Reset camera" onClick={reset} className="flex h-9 items-center gap-1.5 rounded-lg border border-surface-line bg-white px-2.5 text-xs font-medium text-ink-muted shadow-card"><RotateCcw className="h-4 w-4" />Reset</button>
      </div>
      <div role="group" aria-label="Visibility" className="absolute left-3 top-14 z-10 flex flex-col gap-1 rounded-xl border border-surface-line bg-white p-1.5 shadow-card">
        {TOGGLES.map((t) => (
          <button key={t.id} aria-pressed={toggles[t.id]} onClick={() => setToggles({ ...toggles, [t.id]: !toggles[t.id] })} className={cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-xs', toggles[t.id] ? 'text-ink' : 'text-ink-muted line-through')}>
            {toggles[t.id] ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}{t.label}
          </button>
        ))}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-xl border border-surface-line bg-white/95 px-3 py-2 text-xs shadow-card" aria-live="polite">
        <p><span className="text-ink-muted">Panels </span><b>{a.summary.validPanelCount}</b>{a.summary.invalidPanelCount > 0 && <span className="text-red-600"> (+{a.summary.invalidPanelCount} invalid)</span>}</p>
        <p><span className="text-ink-muted">Capacity </span><b className="text-accent">{a.summary.installedKwp} kWp</b></p>
        <p><span className="text-ink-muted">Height to ridge </span><b>{u.fmt(h, 1)}</b></p>
        <p className="mt-1 text-[10px] text-ink-muted">Drag to orbit · right-drag to pan · scroll to zoom<br />Click a panel to select, drag it along the roof</p>
      </div>
    </>
  );
}

type Tab = 'building' | 'panels' | 'summary';
function Side3D() {
  const [tab, setTab] = useState<Tab>('building');
  const can = useAuth((s) => s.can)('design:edit');
  const active = useDesign((s) => s.activeSectionId);
  const sec = useDesign((s) => s.config?.roofSections.find((x) => x.id === s.activeSectionId));
  const addPanel = useDesign((s) => s.addPanel);
  const setSel = useDesign((s) => s.setSelection);
  const placeOne = () => {
    if (!active || !sec) return;
    const xs = sec.polygon.map((p) => p.x); const ys = sec.polygon.map((p) => p.y);
    const c = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    const at = pointInPolygon(c, sec.polygon) ? c : sec.polygon[0]!;
    const id = addPanel(active, at.x, at.y);
    if (id) setSel({ kind: 'panel', ids: [id] });
  };
  return (
    <div>
      <SideTabs tabs={[{ id: 'building', label: 'Building' }, { id: 'panels', label: 'Panels' }, { id: 'summary', label: 'Summary' }]} value={tab} onChange={setTab} />
      {tab === 'building' && <><SelectionPanel /><BuildingPanel /><AppearancePanel /><ObstaclePalette /><EquipmentPanel /></>}
      {tab === 'panels' && (
        <>
          <SelectionPanel />
          {can && <PanelSection title="Add panels"><Button size="sm" variant="outline" className="w-full" disabled={!active} onClick={placeOne}><Plus className="h-4 w-4" />Add a panel to “{sec?.name ?? 'roof'}”</Button><p className="text-[11px] text-ink-muted">Then drag it along the roof, or fine-tune its position, rotation and tilt above.</p></PanelSection>}
          <LayoutPanel />
        </>
      )}
      {tab === 'summary' && <SummaryPanel />}
    </div>
  );
}

export function Editor3D({ designId }: { designId: string }) {
  const [view, setView] = useState<ViewPreset>('perspective');
  const [nonce, setNonce] = useState(0);
  const [toggles, setToggles] = useState<SceneToggles>({ building: true, roof: true, panels: true, dimensions: false, equipment: true, obstacles: true });
  const apiRef = useRef<SceneApi | null>(null);
  return (
    <DesignShell designId={designId} mode="3d" sidePanel={<Side3D />} screenshot3d={() => apiRef.current?.capture() ?? null}>
      <Scene3D view={view} viewNonce={nonce} toggles={toggles} apiRef={apiRef} />
      <Hud view={view} setView={(v) => { setView(v); setNonce((n) => n + 1); }} reset={() => { setView('perspective'); setNonce((n) => n + 1); }} toggles={toggles} setToggles={setToggles} />
    </DesignShell>
  );
}
