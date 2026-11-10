import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Box, CheckCircle2, ChevronDown, Download, History, MapPin, Redo2, Save, Undo2, Square } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { cn, formatDateTime } from '@/lib/utils';
import { Badge, Button, ErrorNote, Input, Modal, Spinner } from '@/components/ui';
import { useLocale } from '@/lib/format';
import { designKey, fetchVersionConfig, isConflict, useDesignLoader, useSaveDesign, useVersions, type DesignDetail } from './api';
import { useAnalysis } from './analysis';
import { exportPdf, exportPng, exportSvg } from './exporters';
import { ReportModal } from './ReportModal';
import { StructureModal } from './StructureModal';
import { SiteMapModal } from './SiteMapModal';
import { useDesign } from './store';

function VersionsModal({ designId, onClose }: { designId: string; onClose: () => void }) {
  const { data, isLoading } = useVersions(designId);
  const locale = useLocale();
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const approvedVersion = qc.getQueryData<DesignDetail>(designKey(designId))?.approvedVersion;
  const restore = useMutation({
    mutationFn: (v: number) => api.post<{ version: { version: number } }>(`/solar-designs/${designId}/versions/${v}/restore`),
    onSuccess: async (r) => {
      const config = await fetchVersionConfig(designId, r.version.version);
      useDesign.getState().replaceConfig(config, r.version.version);
      qc.invalidateQueries({ queryKey: ['design-versions', designId] });
      qc.invalidateQueries({ queryKey: designKey(designId) });
      onClose();
    },
  });
  const dirty = useDesign((s) => !!s.config && JSON.stringify(s.config) !== s.savedJson);
  return (
    <Modal open wide title="Design versions" onClose={onClose}>
      <p className="mb-3 text-sm text-ink-muted">Every save creates a new version; older versions are never changed. Restoring copies an old version forward as the newest.</p>
      {dirty && <p className="mb-3 rounded bg-sun-soft px-3 py-2 text-sm text-yellow-900">You have unsaved changes. Restoring replaces them.</p>}
      <ErrorNote error={restore.error} />
      {isLoading ? <div className="flex justify-center py-8"><Spinner /></div> : (
        <ul className="divide-y divide-surface-line text-sm">
          {data?.map((v, i) => (
            <li key={v.version} className="flex items-center justify-between gap-3 py-2.5">
              <div>
                <p className="font-medium">v{v.version} {v.label && <span className="font-normal text-ink-muted">· {v.label}</span>} {i === 0 && <Badge tone="blue">Latest</Badge>} {approvedVersion === v.version && <Badge tone="green">Approved</Badge>}</p>
                <p className="text-xs text-ink-muted">{v.validPanelCount} valid panels · {Number(v.installedKwp)} kWp{v.issueCount ? ` · ${v.issueCount} with errors` : ''} · {formatDateTime(v.createdAt, locale)}</p>
              </div>
              {i > 0 && can('design:edit') && <Button size="sm" variant="outline" loading={restore.isPending && restore.variables === v.version} onClick={() => { if (!dirty || window.confirm('Discard your unsaved changes and restore this version?')) restore.mutate(v.version); }}>Restore</Button>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function ExportMenu({ mode, onScreenshot3d, screenshot3d, designId, customer }: { mode: '2d' | '3d'; onScreenshot3d?: () => string | null; screenshot3d?: () => string | null; designId: string; customer: string | null }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState(false);
  const [structure, setStructure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const can = useAuth((s) => s.can);
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  if (!can('design:export')) return null;
  const run = async (fn: () => Promise<void> | void) => {
    setBusy(true); setErr(''); setOpen(false);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : 'Export failed'); } finally { setBusy(false); }
  };
  const s = () => useDesign.getState();
  const cfg = () => s().config!;
  const item = 'block w-full px-3 py-2 text-left text-sm hover:bg-surface-alt';
  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)} loading={busy} aria-haspopup="menu" aria-expanded={open}><Download className="h-4 w-4" />Export<ChevronDown className="h-3.5 w-3.5" /></Button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-1 w-64 overflow-hidden rounded-lg border border-surface-line bg-white py-1 shadow-lg">
          <button role="menuitem" className={item} onClick={() => run(() => exportPng(cfg(), s().name))}>PNG: building plan</button>
          <button role="menuitem" className={item} onClick={() => run(() => exportPng(cfg(), s().name, s().activeSectionId ?? undefined))}>PNG: selected roof section</button>
          <button role="menuitem" className={item} onClick={() => run(() => exportSvg(cfg(), s().name, s().activeSectionId ?? undefined))}>SVG: selected roof section</button>
          <button role="menuitem" className={item} onClick={() => run(() => exportSvg(cfg(), s().name))}>SVG: building plan</button>
          <button role="menuitem" className={item} onClick={() => run(() => exportPdf(cfg(), { name: s().name, version: s().baseVersion, screenshot3d: (screenshot3d ?? onScreenshot3d)?.() ?? null }))}>PDF: design and panel placement report</button>
          <button role="menuitem" className={item} onClick={() => { setOpen(false); setReport(true); }}>PDF: yield and shading report…</button>
          <button role="menuitem" className={item} onClick={() => { setOpen(false); setStructure(true); }}>PDF: mounting structure drawing…</button>
          {mode === '3d' && onScreenshot3d && <button role="menuitem" className={item} onClick={() => run(async () => { const d = onScreenshot3d(); if (!d) throw new Error('3D view not ready'); const { downloadDataUrl } = await import('./exporters'); await downloadDataUrl(`${s().name.replace(/\W+/g, '-')}-3d.png`, d); })}>PNG: 3D screenshot</button>}
        </div>
      )}
      {report && <ReportModal designId={designId} customer={customer} screenshot3d={screenshot3d ?? onScreenshot3d} onClose={() => setReport(false)} />}
      {structure && <StructureModal designId={designId} designName={useDesign.getState().name} onClose={() => setStructure(false)} />}
      {err && <p role="alert" className="absolute right-0 top-full z-50 mt-1 w-64 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}
    </div>
  );
}

export interface ShellProps { designId: string; mode: '2d' | '3d'; children: ReactNode; sidePanel: ReactNode; screenshot3d?: () => string | null; toolbar?: ReactNode }

/** Full-height workspace chrome shared by the 2D and 3D editors: they edit the SAME document in the same store. */
export function DesignShell({ designId, mode, children, sidePanel, screenshot3d, toolbar }: ShellProps) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const can = useAuth((s) => s.can);
  const { data, isError, error, ready } = useDesignLoader(designId);
  const name = useDesign((s) => s.name);
  const baseVersion = useDesign((s) => s.baseVersion);
  const canUndo = useDesign((s) => s.past.length > 0);
  const canRedo = useDesign((s) => s.future.length > 0);
  const config = useDesign((s) => s.config);
  const savedJson = useDesign((s) => s.savedJson);
  const dirty = useMemo(() => !!config && JSON.stringify(config) !== savedJson, [config, savedJson]);
  const analysis = useAnalysis();
  const save = useSaveDesign();
  const [versions, setVersions] = useState(false);
  const [siteMap, setSiteMap] = useState(false);
  const [label, setLabel] = useState('');
  const [askLabel, setAskLabel] = useState(false);
  const [approveErr, setApproveErr] = useState('');
  const approve = useMutation({
    mutationFn: () => api.post(`/solar-designs/${designId}/approve`, { version: baseVersion }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: designKey(designId) }); qc.invalidateQueries({ queryKey: ['designs'] }); setApproveErr(''); },
    onError: (e) => setApproveErr(e instanceof Error ? e.message : 'Could not approve'),
  });
  const [approved, setApproved] = useState<{ status: string; approvedVersion: number | null }>({ status: 'DRAFT', approvedVersion: null });
  useEffect(() => { if (data) setApproved({ status: data.status, approvedVersion: data.approvedVersion }); }, [data]);
  useEffect(() => { const d = qc.getQueryData<DesignDetail>(designKey(designId)); if (d) setApproved({ status: d.status, approvedVersion: d.approvedVersion }); }, [approve.isSuccess, designId, qc]);

  const doSave = (lbl?: string) => save.mutate(lbl, { onSuccess: () => { setAskLabel(false); setLabel(''); } });
  const reloadLatest = async () => {
    const fresh = await api.get<DesignDetail>(`/solar-designs/${designId}`);
    const cfg = await fetchVersionConfig(designId, fresh.latestVersion);
    useDesign.getState().replaceConfig(cfg, fresh.latestVersion);
    save.reset();
  };

  // Keyboard shortcuts (ignored while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
      const st = useDesign.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (can('design:edit') && dirty) doSave(); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? st.redo() : st.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); st.redo(); return; }
      const sel = st.selection;
      if (!sel || !can('design:edit')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.kind === 'panel') { e.preventDefault(); st.deletePanels(sel.ids); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.kind === 'obstacle') { e.preventDefault(); st.deleteObstacle(sel.ids[0]!); }
      else if ((e.key === 'r' || e.key === 'R') && sel.kind === 'panel') st.rotatePanels(sel.ids, e.shiftKey ? -90 : 90);
      else if (sel.kind === 'panel' && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const d = e.shiftKey ? 0.5 : st.snapStep;
        st.nudgePanels(sel.ids, e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0);
      } else if (e.key === 'Escape') st.setSelection(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  if (isError) return <div className="p-10 text-center text-sm text-ink-muted">{error instanceof Error ? error.message : 'Could not load this design.'} <Link className="text-accent hover:underline" to={`/designer-${mode}`}>Back to designs</Link></div>;
  if (!ready || !config) return <div className="flex h-full items-center justify-center"><Spinner className="h-8 w-8" /></div>;
  const edit = can('design:edit');
  const errorCount = analysis?.summary.invalidPanelCount ?? 0;
  const other = mode === '2d' ? '3d' : '2d';

  const leave = (to: string) => { if (!dirty || window.confirm('You have unsaved changes. Leave without saving?')) nav(to); };
  // 2D <-> 3D is the same document: carry unsaved edits across instead of asking to discard them.
  const switchTo = (to: string) => { useDesign.setState({ keepOnUnmount: true }); nav(to); };
  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-surface-line bg-white px-3 py-2">
        <button onClick={() => leave(`/designer-${mode}`)} className="rounded p-1.5 text-ink-muted hover:bg-surface-alt" aria-label="Back to designs"><ArrowLeft className="h-4 w-4" /></button>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold leading-4">{name}</h1>
          <p className="text-[11px] text-ink-muted">v{baseVersion}{dirty ? ' · unsaved changes' : ' · saved'}{approved.status === 'APPROVED' ? ` · approved v${approved.approvedVersion}` : ''}</p>
        </div>
        {dirty && <span className="h-2 w-2 rounded-full bg-sun" title="Unsaved changes" />}
        <div className="mx-2 hidden h-6 w-px bg-surface-line sm:block" />
        <Button size="icon" variant="ghost" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => useDesign.getState().undo()}><Undo2 className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={() => useDesign.getState().redo()}><Redo2 className="h-4 w-4" /></Button>
        {toolbar}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {errorCount > 0 && <Badge tone="red">{errorCount} panel{errorCount === 1 ? '' : 's'} need attention</Badge>}
          {edit && <Button size="sm" variant="ghost" onClick={() => setSiteMap(true)} title="Find the site on a map and size the building from its outline"><MapPin className="h-4 w-4" />Site map</Button>}
          <Button size="sm" variant="ghost" onClick={() => setVersions(true)}><History className="h-4 w-4" />Versions</Button>
          <ExportMenu mode={mode} onScreenshot3d={screenshot3d} screenshot3d={screenshot3d} designId={designId} customer={data?.customer?.name ?? null} />
          <Button size="sm" variant="outline" onClick={() => switchTo(`/designer-${other}/${designId}`)}>{other === '3d' ? <Box className="h-4 w-4" /> : <Square className="h-4 w-4" />}Open in {other.toUpperCase()}</Button>
          {can('design:approve') && approved.approvedVersion !== baseVersion && <Button size="sm" variant="outline" disabled={dirty} title={dirty ? 'Save before approving' : 'Approve this version for quoting'} loading={approve.isPending} onClick={() => approve.mutate()}><CheckCircle2 className="h-4 w-4" />Approve</Button>}
          {edit && <Button size="sm" variant="accent" loading={save.isPending} disabled={!dirty} onClick={() => doSave()} onContextMenu={(e) => { e.preventDefault(); setAskLabel(true); }} title="Save new version (Ctrl+S). Right-click to add a label."><Save className="h-4 w-4" />Save</Button>}
        </div>
      </header>
      {(approveErr || (save.error && !isConflict(save.error))) && <div className="px-3 pt-2"><ErrorNote error={approveErr ? new Error(approveErr) : save.error} /></div>}
      {isConflict(save.error) && (
        <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-yellow-200 bg-sun-soft px-3 py-2 text-sm text-yellow-900">
          {(save.error as Error).message}
          <Button size="sm" variant="outline" onClick={reloadLatest}>Reload latest (discard my changes)</Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 bg-slate-100">{children}</div>
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-surface-line bg-white lg:block" aria-label="Design panels">{sidePanel}</aside>
      </div>
      {siteMap && <SiteMapModal onClose={() => setSiteMap(false)} />}
      {versions && <VersionsModal designId={designId} onClose={() => setVersions(false)} />}
      <Modal open={askLabel} title="Save version" onClose={() => setAskLabel(false)}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); doSave(label.trim() || undefined); }}>
          <label className="block space-y-1.5 text-sm font-medium">Label (optional)<Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Option B: more panels on the east slope" autoFocus /></label>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setAskLabel(false)}>Cancel</Button><Button type="submit" variant="accent" loading={save.isPending}>Save version</Button></div>
        </form>
      </Modal>
    </div>
  );
}

export function SideTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="sticky top-0 z-10 flex border-b border-surface-line bg-white">
      {tabs.map((t) => <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} className={cn('flex-1 border-b-2 px-2 py-2.5 text-xs font-medium', value === t.id ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>{t.label}</button>)}
    </div>
  );
}
