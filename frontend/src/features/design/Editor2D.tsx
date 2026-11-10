import { useState, type ReactNode } from 'react';
import { Ban, Box, Grid3x3, Hand, LayoutGrid, Maximize, MousePointer2, PenTool, Ruler, Square, ZoomIn, ZoomOut } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { cn } from '@/lib/utils';
import { Canvas2D } from './Canvas2D';
import { DesignShell, SideTabs } from './DesignShell';
import { AppearancePanel, BuildingPanel, EquipmentPanel, LayoutPanel, ObstaclePalette, SelectionPanel, SummaryPanel } from './panels';
import { useDesign, type Tool } from './store';
import { useUnits } from './units';

interface ToolDef { id: Tool; label: string; icon: ReactNode; needsEdit?: boolean; mode?: 'section' | 'plan' }
const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select / move', icon: <MousePointer2 className="h-4 w-4" /> },
  { id: 'pan', label: 'Pan', icon: <Hand className="h-4 w-4" /> },
  { id: 'panel', label: 'Place panels', icon: <LayoutGrid className="h-4 w-4" />, needsEdit: true, mode: 'section' },
  { id: 'obstacle', label: 'Add obstacle', icon: <Box className="h-4 w-4" />, needsEdit: true, mode: 'section' },
  { id: 'zone', label: 'Restricted zone', icon: <Ban className="h-4 w-4" />, needsEdit: true, mode: 'section' },
  { id: 'draw-rect', label: 'Draw rectangular roof area', icon: <Square className="h-4 w-4" />, needsEdit: true, mode: 'plan' },
  { id: 'draw-poly', label: 'Draw custom roof area', icon: <PenTool className="h-4 w-4" />, needsEdit: true, mode: 'plan' },
];

function ToolPalette() {
  const tool = useDesign((s) => s.tool);
  const can = useAuth((s) => s.can)('design:edit');
  const setTool = useDesign((s) => s.setTool);
  const setView = useDesign((s) => s.setViewMode);
  return (
    <div role="toolbar" aria-label="Drawing tools" className="absolute left-3 top-14 z-10 flex flex-col gap-1 rounded-xl border border-surface-line bg-white p-1 shadow-card">
      {TOOLS.filter((t) => !t.needsEdit || can).map((t) => (
        <button key={t.id} aria-label={t.label} aria-pressed={tool === t.id} title={t.label}
          onClick={() => { setTool(t.id); if (t.mode) setView(t.mode); }}
          className={cn('flex h-9 w-9 items-center justify-center rounded-lg', tool === t.id ? 'bg-brand text-brand-fg' : 'text-ink-muted hover:bg-surface-alt')}>{t.icon}</button>
      ))}
    </div>
  );
}

function ViewBar() {
  const viewMode = useDesign((s) => s.viewMode);
  const setView = useDesign((s) => s.setViewMode);
  const sections = useDesign((s) => s.config?.roofSections ?? []);
  const active = useDesign((s) => s.activeSectionId);
  const setActive = useDesign((s) => s.setActiveSection);
  const showGrid = useDesign((s) => s.showGrid);
  const showDims = useDesign((s) => s.showDimensions);
  const toggle = useDesign((s) => s.toggle);
  const units = useDesign((s) => s.config?.units);
  const setUnits = useDesign((s) => s.setUnits);
  const can = useAuth((s) => s.can)('design:edit');
  const u = useUnits();
  const btn = 'flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium';
  return (
    <div className="absolute left-3 right-3 top-3 z-10 flex flex-wrap items-center gap-2">
      <div role="group" aria-label="View" className="flex rounded-lg border border-surface-line bg-white p-0.5 shadow-card">
        <button aria-pressed={viewMode === 'section'} onClick={() => setView('section')} className={cn(btn, viewMode === 'section' ? 'bg-brand text-brand-fg' : 'text-ink-muted')}>Roof section</button>
        <button aria-pressed={viewMode === 'plan'} onClick={() => setView('plan')} className={cn(btn, viewMode === 'plan' ? 'bg-brand text-brand-fg' : 'text-ink-muted')}>Building plan</button>
      </div>
      {viewMode === 'section' && (
        <select aria-label="Active roof section" value={active ?? ''} onChange={(e) => { setActive(e.target.value); useDesign.getState().setSelection(null); }} className="h-8 rounded-lg border border-surface-line bg-white px-2 text-xs shadow-card">
          {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <div className="ml-auto flex items-center gap-1 rounded-lg border border-surface-line bg-white p-0.5 shadow-card">
        <button aria-label="Zoom out" onClick={() => window.dispatchEvent(new CustomEvent('design:zoom', { detail: 1 / 1.3 }))} className={cn(btn, 'text-ink-muted hover:bg-surface-alt')}><ZoomOut className="h-4 w-4" /></button>
        <button aria-label="Zoom in" onClick={() => window.dispatchEvent(new CustomEvent('design:zoom', { detail: 1.3 }))} className={cn(btn, 'text-ink-muted hover:bg-surface-alt')}><ZoomIn className="h-4 w-4" /></button>
        <button aria-label="Fit to screen" onClick={() => window.dispatchEvent(new Event('design:fit'))} className={cn(btn, 'text-ink-muted hover:bg-surface-alt')}><Maximize className="h-4 w-4" />Fit</button>
        <button aria-label="Toggle grid" aria-pressed={showGrid} onClick={() => toggle('showGrid')} className={cn(btn, showGrid ? 'bg-surface-alt text-ink' : 'text-ink-muted')}><Grid3x3 className="h-4 w-4" /></button>
        <button aria-label="Toggle dimensions" aria-pressed={showDims} onClick={() => toggle('showDimensions')} className={cn(btn, showDims ? 'bg-surface-alt text-ink' : 'text-ink-muted')}><Ruler className="h-4 w-4" /></button>
        {can && <button aria-label={`Units: ${u.len}. Switch units`} onClick={() => setUnits(units === 'IMPERIAL' ? 'METRIC' : 'IMPERIAL')} className={cn(btn, 'text-ink-muted hover:bg-surface-alt')}>{u.len}</button>}
      </div>
    </div>
  );
}

type Tab = 'design' | 'layout' | 'summary';
function Side2D() {
  const [tab, setTab] = useState<Tab>('design');
  const sel = useDesign((s) => s.selection);
  return (
    <div>
      <SideTabs tabs={[{ id: 'design', label: 'Properties' }, { id: 'layout', label: 'Layout' }, { id: 'summary', label: 'Summary' }]} value={tab} onChange={setTab} />
      {tab === 'design' && <><SelectionPanel /><BuildingPanel /><ObstaclePalette /><EquipmentPanel />{!sel && <AppearanceHint />}</>}
      {tab === 'layout' && <LayoutPanel />}
      {tab === 'summary' && <SummaryPanel />}
    </div>
  );
}
function AppearanceHint() { return <div className="px-3 py-3"><AppearanceNote /></div>; }
function AppearanceNote() { return <p className="text-[11px] text-ink-muted">Colours and materials are set in the 3D designer. Roof and building changes here update the 3D model instantly: it is the same design.</p>; }

export function Editor2D({ designId }: { designId: string }) {
  return (
    <DesignShell designId={designId} mode="2d" sidePanel={<Side2D />}>
      <ViewBar />
      <ToolPalette />
      <Canvas2D />
    </DesignShell>
  );
}

export { AppearancePanel };
