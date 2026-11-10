import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Arrow, Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import {
  bbox, convexDistance, generateBuilding, insetPolygon, localToPlan, panelCorners, panelSize, pointInPolygon, snap, OBSTACLE_LABELS, type DesignConfig, type Panel, type Vec2,
} from '@solarflow/shared';
import { useAnalysis } from './analysis';
import { useDesign, type Tool } from './store';
import { useUnits } from './units';
import { useAuth } from '@/store/auth';

type KEvt = Konva.KonvaEventObject<MouseEvent | WheelEvent | DragEvent>;
const MIN_SCALE = 4;
const MAX_SCALE = 600;
const colors = { roofFill: '#f8fafc', roofStroke: '#0f2a43', panelOk: '#bfdbfe', panelOkStroke: '#1e3a8a', panelBad: '#fecaca', panelBadStroke: '#dc2626', warn: '#f59e0b', select: '#16a34a' };

interface View { scale: number; ox: number; oy: number }

function contentBounds(c: DesignConfig, plan: boolean, sectionId: string | null) {
  const pts: Vec2[] = [];
  if (plan) {
    pts.push(...generateBuilding(c.building).footprint);
    for (const s of c.roofSections) pts.push(...s.polygon.map((p) => localToPlan(s, p.x, p.y)));
    for (const e of c.equipment) pts.push({ x: e.x - e.widthM, y: e.y - e.depthM }, { x: e.x + e.widthM, y: e.y + e.depthM });
  } else {
    const s = c.roofSections.find((x) => x.id === sectionId) ?? c.roofSections[0];
    if (s) pts.push(...s.polygon);
    for (const o of c.obstacles.filter((x) => x.sectionId === s?.id)) { const r = o.shape === 'CIRCLE' ? o.r : Math.max(o.w, o.h) / 2; pts.push({ x: o.x - r, y: o.y - r }, { x: o.x + r, y: o.y + r }); }
  }
  return pts.length ? bbox(pts) : { minX: 0, minY: 0, maxX: 10, maxY: 10, width: 10, height: 10 };
}

function azimuthName(a: number) {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round((((a % 360) + 360) % 360) / 45) % 8]!;
}

export function Canvas2D() {
  const config = useDesign((s) => s.config)!;
  const viewMode = useDesign((s) => s.viewMode);
  const activeId = useDesign((s) => s.activeSectionId);
  const selection = useDesign((s) => s.selection);
  const tool = useDesign((s) => s.tool);
  const showGrid = useDesign((s) => s.showGrid);
  const showDims = useDesign((s) => s.showDimensions);
  const snapStep = useDesign((s) => s.snapStep);
  const placing = useDesign((s) => s.placingTypeId);
  const can = useAuth((s) => s.can);
  const u = useUnits();
  const analysis = useAnalysis();
  const st = useDesign;
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ scale: 30, ox: 400, oy: 300 });
  const [draft, setDraft] = useState<Vec2[]>([]);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const [marquee, setMarquee] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const [rectDraft, setRectDraft] = useState<{ a: Vec2; b: Vec2 } | null>(null);
  const panRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const spaceRef = useRef(false);
  const didMarquee = useRef(false);
  const edit = can('design:edit');
  const plan = viewMode === 'plan';
  const section = config.roofSections.find((s) => s.id === activeId) ?? config.roofSections[0]!;
  const report = analysis!.report;
  const types = useMemo(() => new Map(config.panelTypes.map((t) => [t.id, t])), [config.panelTypes]);
  const selectedIds = useMemo(() => new Set(selection?.kind === 'panel' ? selection.ids : []), [selection]);

  // world ⇄ stage. Section frame: v up (stage y flipped). Plan frame: y down.
  const toStage = useCallback((p: Vec2) => ({ x: view.ox + p.x * view.scale, y: plan ? view.oy + p.y * view.scale : view.oy - p.y * view.scale }), [view, plan]);
  const toWorld = useCallback((p: Vec2) => ({ x: (p.x - view.ox) / view.scale, y: plan ? (p.y - view.oy) / view.scale : (view.oy - p.y) / view.scale }), [view, plan]);
  const pointer = (): Vec2 | null => { const p = stageRef.current?.getPointerPosition(); return p ? { x: p.x, y: p.y } : null; };
  const worldPointer = () => { const p = pointer(); return p ? toWorld(p) : null; };
  const snapped = (p: Vec2): Vec2 => ({ x: snap(p.x, snapStep), y: snap(p.y, snapStep) });

  // resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const b = contentBounds(config, plan, section.id);
    const pad = 70;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min((size.w - pad * 2) / Math.max(b.width, 0.5), (size.h - pad * 2) / Math.max(b.height, 0.5))));
    const cx = b.minX + b.width / 2;
    const cy = b.minY + b.height / 2;
    setView({ scale, ox: size.w / 2 - cx * scale, oy: plan ? size.h / 2 - cy * scale : size.h / 2 + cy * scale });
  }, [config, plan, section.id, size.w, size.h]);
  // Re-fit when the user switches section / view, not on every edit.
  const fitKey = `${plan}-${section.id}-${size.w > 0}`;
  useEffect(() => { fit(); }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { (window as unknown as { __fitDesign?: () => void }).__fitDesign = fit; }, [fit]);
  useEffect(() => { const h = () => fit(); window.addEventListener('design:fit', h); return () => window.removeEventListener('design:fit', h); }, [fit]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT') { spaceRef.current = true; } if (e.key === 'Enter' && draft.length >= 3) finishDraft(); if (e.key === 'Escape') { setDraft([]); setRectDraft(null); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') spaceRef.current = false; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });

  const zoomAt = (p: Vec2, factor: number) => setView((v) => { const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor)); const k = s / v.scale; return { scale: s, ox: p.x - (p.x - v.ox) * k, oy: p.y - (p.y - v.oy) * k }; });
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent<number>).detail; zoomAt({ x: size.w / 2, y: size.h / 2 }, d); };
    window.addEventListener('design:zoom', h);
    return () => window.removeEventListener('design:zoom', h);
  }, [size.w, size.h]);

  const finishDraft = () => {
    const pts = draft;
    setDraft([]);
    if (pts.length < 3) return;
    if (tool === 'zone' && !plan) { const id = st.getState().addZone(section.id, pts); st.getState().setSelection({ kind: 'zone', ids: [id] }); st.getState().setTool('select'); }
    else if (tool === 'draw-poly' && plan) { st.getState().addSection(pts); st.getState().setTool('select'); st.getState().setViewMode('section'); }
  };

  /* ───── stage events ───── */
  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const p = pointer();
    if (p) zoomAt(p, e.evt.deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const p = pointer();
    if (!p) return;
    const isPan = tool === 'pan' || e.evt.button === 1 || e.evt.button === 2 || spaceRef.current;
    if (isPan) { panRef.current = { x: p.x, y: p.y, ox: view.ox, oy: view.oy }; return; }
    const w = toWorld(p);
    const onEmpty = e.target === e.target.getStage() || e.target.name() === 'roof-bg';
    if (tool === 'select' && onEmpty) { setMarquee({ a: w, b: w }); if (!e.evt.shiftKey) st.getState().setSelection(null); }
    if (tool === 'draw-rect' && plan) setRectDraft({ a: snapped(w), b: snapped(w) });
  };
  const onMouseMove = () => {
    const p = pointer();
    if (!p) return;
    if (panRef.current) { const r = panRef.current; setView((v) => ({ ...v, ox: r.ox + (p.x - r.x), oy: r.oy + (p.y - r.y) })); return; }
    const w = toWorld(p);
    setHover(w);
    if (marquee) setMarquee({ a: marquee.a, b: w });
    if (rectDraft) setRectDraft({ a: rectDraft.a, b: snapped(w) });
  };
  const onMouseUp = () => {
    panRef.current = null;
    if (marquee && !plan) {
      const x0 = Math.min(marquee.a.x, marquee.b.x), x1 = Math.max(marquee.a.x, marquee.b.x), y0 = Math.min(marquee.a.y, marquee.b.y), y1 = Math.max(marquee.a.y, marquee.b.y);
      if (x1 - x0 > 0.05 || y1 - y0 > 0.05) {
        didMarquee.current = true;
        setTimeout(() => { didMarquee.current = false; }, 0);
        const ids = config.panels.filter((p) => p.sectionId === section.id && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1).map((p) => p.id);
        st.getState().setSelection(ids.length ? { kind: 'panel', ids } : null);
      }
    }
    setMarquee(null);
    if (rectDraft) {
      const { a, b } = rectDraft;
      setRectDraft(null);
      if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) { st.getState().addSection([{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }]); st.getState().setTool('select'); st.getState().setViewMode('section'); }
    }
  };
  const onStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return;
    const w = worldPointer();
    if (!w || !edit) return;
    const sp = snapped(w);
    if (tool === 'panel' && !plan) {
      if (!pointInPolygon(w, section.polygon)) return;
      const id = st.getState().addPanel(section.id, sp.x, sp.y, placing ?? undefined);
      if (id) st.getState().setSelection({ kind: 'panel', ids: [id] });
    } else if (tool === 'obstacle' && !plan) {
      if (!pointInPolygon(w, section.polygon)) return;
      const id = st.getState().addObstacle(section.id, sp.x, sp.y);
      if (id) { st.getState().setSelection({ kind: 'obstacle', ids: [id] }); st.getState().setTool('select'); }
    } else if ((tool === 'zone' && !plan) || (tool === 'draw-poly' && plan)) setDraft((d) => [...d, sp]);
  };
  const onStageDblClick = () => { if (draft.length >= 3) { setDraft((d) => d.slice(0, -1)); setTimeout(finishDraft, 0); } };

  /* ───── drag & drop from the panel palette ───── */
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const typeId = e.dataTransfer.getData('application/x-solarflow-panel');
    if (!typeId || plan || !edit) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const w = toWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    if (!pointInPolygon(w, section.polygon)) return;
    const sp = snapped(w);
    const id = st.getState().addPanel(section.id, sp.x, sp.y, typeId);
    if (id) st.getState().setSelection({ kind: 'panel', ids: [id] });
  };

  /* ───── grid (screen space, crisp) ───── */
  const gridLines = useMemo(() => {
    if (!showGrid) return [];
    const step = view.scale < 12 ? 10 : view.scale < 40 ? 5 : view.scale < 120 ? 1 : 0.5;
    const a = toWorld({ x: 0, y: 0 });
    const b = toWorld({ x: size.w, y: size.h });
    const x0 = Math.floor(Math.min(a.x, b.x) / step) * step, x1 = Math.max(a.x, b.x);
    const y0 = Math.floor(Math.min(a.y, b.y) / step) * step, y1 = Math.max(a.y, b.y);
    const lines: { pts: number[]; major: boolean }[] = [];
    for (let x = x0; x <= x1; x += step) { const s = toStage({ x, y: 0 }).x; lines.push({ pts: [s, 0, s, size.h], major: Math.abs(x % (step * 5)) < 1e-9 }); }
    for (let y = y0; y <= y1; y += step) { const s = toStage({ x: 0, y }).y; lines.push({ pts: [0, s, size.w, s], major: Math.abs(y % (step * 5)) < 1e-9 }); }
    return lines.slice(0, 400);
  }, [showGrid, view, size, toWorld, toStage]);

  /* ───── panel rendering helpers ───── */
  const panelColor = (p: Panel) => { const bad = report.errorIds.has(p.id); const warn = !bad && (report.issues[p.id]?.length ?? 0) > 0; return { fill: bad ? colors.panelBad : colors.panelOk, stroke: bad ? colors.panelBadStroke : warn ? colors.warn : colors.panelOkStroke }; };

  const sectionPanels = config.panels.filter((p) => p.sectionId === section.id);
  const setback = useMemo(() => insetPolygon(section.polygon, section.setbackM), [section.polygon, section.setbackM]);
  const flatPts = (poly: Vec2[]) => poly.flatMap((p) => [p.x, p.y]);
  const cursor = tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';

  const dragPanel = (p: Panel) => ({
    draggable: edit && tool === 'select' && !plan,
    onDragStart: () => { st.getState().beginTransient(); if (!selectedIds.has(p.id)) st.getState().setSelection({ kind: 'panel', ids: [p.id] }); },
    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => { const nx = snap(e.target.x(), snapStep); const ny = snap(e.target.y(), snapStep); e.target.position({ x: nx, y: ny }); st.getState().transient((c) => ({ ...c, panels: c.panels.map((q) => (q.id === p.id ? { ...q, x: nx, y: ny } : q)) })); },
  });

  // gaps from the selected panel to its nearest neighbours (spacing display)
  const gaps = useMemo(() => {
    if (plan || selectedIds.size !== 1) return [];
    const id = [...selectedIds][0]!;
    const p = config.panels.find((x) => x.id === id);
    const t = p && types.get(p.typeId);
    if (!p || !t) return [];
    const mine = panelCorners(p, t);
    const out: { a: Vec2; b: Vec2; d: number }[] = [];
    for (const q of sectionPanels) {
      if (q.id === id) continue;
      const qt = types.get(q.typeId);
      if (!qt) continue;
      const d = convexDistance(mine, panelCorners(q, qt));
      if (d > 0 && d < 1.2) out.push({ a: { x: p.x, y: p.y }, b: { x: q.x, y: q.y }, d });
    }
    return out.sort((x, y) => x.d - y.d).slice(0, 4);
  }, [plan, selectedIds, config.panels, sectionPanels, types]);

  // Dev/test hook: lets browser tests convert model coordinates to screen coordinates.
  if (import.meta.env.DEV) (window as unknown as { __canvas2d?: unknown }).__canvas2d = { view, plan, flipY: !plan, rect: () => containerRef.current?.getBoundingClientRect() };

  const planGeo = useMemo(() => (plan ? generateBuilding(config.building) : null), [plan, config.building]);
  const northArrow = { x: size.w - 40, y: size.h - 70 };

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden" style={{ cursor }} onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-solarflow-panel')) e.preventDefault(); }} onDrop={onDrop} onContextMenu={(e) => e.preventDefault()} data-testid="design-canvas-2d">
      <Stage ref={stageRef} width={size.w} height={size.h} onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={() => { panRef.current = null; setHover(null); }} onClick={onStageClick} onDblClick={onStageDblClick}>
        {/* background grid */}
        <Layer listening={false}>{gridLines.map((l, i) => <Line key={i} points={l.pts} stroke={l.major ? '#cbd5e1' : '#e2e8f0'} strokeWidth={1} />)}</Layer>

        {/* geometry, in metres */}
        <Layer x={view.ox} y={view.oy} scaleX={view.scale} scaleY={plan ? view.scale : -view.scale}>
          {!plan && (
            <>
              <Line name="roof-bg" points={flatPts(section.polygon)} closed fill={colors.roofFill} stroke={selection?.kind === 'section' ? colors.select : colors.roofStroke} strokeWidth={selection?.kind === 'section' ? 3 : 2} strokeScaleEnabled={false}
                onClick={(e) => { if (tool === 'select' && !didMarquee.current) { e.cancelBubble = true; st.getState().setSelection({ kind: 'section', ids: [section.id] }); } }} />
              {setback && section.setbackM > 0 && <Line points={flatPts(setback)} closed stroke="#f59e0b" dash={[6, 4]} strokeWidth={1.2} strokeScaleEnabled={false} listening={false} />}
              {config.zones.filter((z) => z.sectionId === section.id).map((z) => (
                <Line key={z.id} points={flatPts(z.polygon)} closed fill="rgba(254,202,202,0.55)" stroke="#dc2626" dash={[6, 4]} strokeWidth={selection?.ids[0] === z.id ? 3 : 1.5} strokeScaleEnabled={false}
                  onClick={(e) => { if (tool === 'select') { e.cancelBubble = true; st.getState().setSelection({ kind: 'zone', ids: [z.id] }); } }} />
              ))}
              {config.obstacles.filter((o) => o.sectionId === section.id).map((o) => {
                const sel = selection?.kind === 'obstacle' && selection.ids[0] === o.id;
                const common = {
                  x: o.x, y: o.y, draggable: edit && tool === 'select',
                  onDragStart: () => { st.getState().beginTransient(); st.getState().setSelection({ kind: 'obstacle', ids: [o.id] }); },
                  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => { const nx = snap(e.target.x(), snapStep); const ny = snap(e.target.y(), snapStep); e.target.position({ x: nx, y: ny }); st.getState().transient((c) => ({ ...c, obstacles: c.obstacles.map((q) => (q.id === o.id ? { ...q, x: nx, y: ny } : q)) })); },
                  onClick: (e: Konva.KonvaEventObject<MouseEvent>) => { if (tool === 'select') { e.cancelBubble = true; st.getState().setSelection({ kind: 'obstacle', ids: [o.id] }); } },
                };
                return (
                  <Group key={o.id}>
                    {o.shape === 'CIRCLE'
                      ? <Circle x={o.x} y={o.y} radius={o.r + o.clearanceM} stroke="#b45309" dash={[4, 4]} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
                      : <Rect x={o.x} y={o.y} offsetX={(o.w + o.clearanceM * 2) / 2} offsetY={(o.h + o.clearanceM * 2) / 2} width={o.w + o.clearanceM * 2} height={o.h + o.clearanceM * 2} stroke="#b45309" dash={[4, 4]} strokeWidth={1} strokeScaleEnabled={false} listening={false} />}
                    {o.shape === 'CIRCLE'
                      ? <Circle {...common} radius={o.r} fill="#fde68a" stroke={sel ? colors.select : '#b45309'} strokeWidth={sel ? 3 : 1.5} strokeScaleEnabled={false} />
                      : <Rect {...common} offsetX={o.w / 2} offsetY={o.h / 2} width={o.w} height={o.h} fill="#fde68a" stroke={sel ? colors.select : '#b45309'} strokeWidth={sel ? 3 : 1.5} strokeScaleEnabled={false} />}
                  </Group>
                );
              })}
              {sectionPanels.map((p) => {
                const t = types.get(p.typeId);
                if (!t) return null;
                const sz = panelSize(p, t);
                const c = panelColor(p);
                const sel = selectedIds.has(p.id);
                return (
                  <Group key={p.id} x={p.x} y={p.y} rotation={p.rotationDeg} {...dragPanel(p)}
                    onClick={(e: Konva.KonvaEventObject<MouseEvent>) => { if (tool !== 'select') return; e.cancelBubble = true; const ids = e.evt.shiftKey ? (selectedIds.has(p.id) ? [...selectedIds].filter((i) => i !== p.id) : [...selectedIds, p.id]) : [p.id]; st.getState().setSelection(ids.length ? { kind: 'panel', ids } : null); }}>
                    <Rect offsetX={sz.w / 2} offsetY={sz.h / 2} width={sz.w} height={sz.h} fill={c.fill} stroke={sel ? colors.select : c.stroke} strokeWidth={sel ? 3 : 1} strokeScaleEnabled={false} perfectDrawEnabled={false} />
                    {/* up-slope marker: small chevron near the top edge */}
                    <Line points={[-sz.w * 0.18, sz.h * 0.28, 0, sz.h * 0.4, sz.w * 0.18, sz.h * 0.28]} stroke={c.stroke} strokeWidth={1} strokeScaleEnabled={false} listening={false} opacity={0.7} perfectDrawEnabled={false} />
                  </Group>
                );
              })}
              {/* vertex handles for the selected section / zone */}
              {edit && tool === 'select' && ((selection?.kind === 'section' && selection.ids[0] === section.id) || selection?.kind === 'zone') && (() => {
                const isZone = selection.kind === 'zone';
                const poly = isZone ? config.zones.find((z) => z.id === selection.ids[0])?.polygon : section.polygon;
                if (!poly) return null;
                return poly.map((pt, i) => (
                  <Circle key={i} x={pt.x} y={pt.y} radius={7 / view.scale} fill="#fff" stroke={colors.select} strokeWidth={2} strokeScaleEnabled={false} draggable
                    onDragStart={() => st.getState().beginTransient()}
                    onDragMove={(e) => {
                      const nx = snap(e.target.x(), snapStep); const ny = snap(e.target.y(), snapStep); e.target.position({ x: nx, y: ny });
                      st.getState().transient((c) => isZone
                        ? { ...c, zones: c.zones.map((z) => (z.id === selection.ids[0] ? { ...z, polygon: z.polygon.map((q, k) => (k === i ? { x: nx, y: ny } : q)) } : z)) }
                        : { ...c, roofSections: c.roofSections.map((s) => (s.id === section.id ? { ...s, polygon: s.polygon.map((q, k) => (k === i ? { x: nx, y: ny } : q)) } : s)) });
                    }} />
                ));
              })()}
              {gaps.map((g, i) => <Line key={i} points={[g.a.x, g.a.y, g.b.x, g.b.y]} stroke="#7c3aed" dash={[3, 3]} strokeWidth={1} strokeScaleEnabled={false} listening={false} />)}
              {draft.length > 0 && <Line points={flatPts(hover ? [...draft, snapped(hover)] : draft)} stroke="#dc2626" dash={[5, 4]} strokeWidth={2} strokeScaleEnabled={false} listening={false} />}
              {marquee && <Rect x={Math.min(marquee.a.x, marquee.b.x)} y={Math.min(marquee.a.y, marquee.b.y)} width={Math.abs(marquee.a.x - marquee.b.x)} height={Math.abs(marquee.a.y - marquee.b.y)} fill="rgba(22,163,74,0.12)" stroke={colors.select} strokeWidth={1} strokeScaleEnabled={false} listening={false} />}
            </>
          )}

          {plan && planGeo && (
            <>
              <Line points={flatPts(planGeo.footprint)} closed fill="#e5e7eb" stroke="#475569" strokeWidth={2} strokeScaleEnabled={false} listening={false} />
              {config.roofSections.map((s) => {
                const poly = s.polygon.map((p) => localToPlan(s, p.x, p.y));
                const sel = s.id === section.id;
                return (
                  <Line key={s.id} points={flatPts(poly)} closed fill={sel ? '#ecfdf5' : '#f8fafc'} stroke={sel ? colors.select : colors.roofStroke} strokeWidth={sel ? 3 : 1.5} strokeScaleEnabled={false}
                    onClick={(e) => { if (tool === 'select') { e.cancelBubble = true; st.getState().setActiveSection(s.id); st.getState().setSelection({ kind: 'section', ids: [s.id] }); } }}
                    onDblClick={() => { st.getState().setActiveSection(s.id); st.getState().setViewMode('section'); }} />
                );
              })}
              {config.panels.map((p) => {
                const s = config.roofSections.find((x) => x.id === p.sectionId);
                const t = types.get(p.typeId);
                if (!s || !t) return null;
                const c = panelColor(p);
                return <Line key={p.id} points={flatPts(panelCorners(p, t).map((q) => localToPlan(s, q.x, q.y)))} closed fill={c.fill} stroke={c.stroke} strokeWidth={0.8} strokeScaleEnabled={false} listening={false} perfectDrawEnabled={false} />;
              })}
              {config.obstacles.map((o) => { const s = config.roofSections.find((x) => x.id === o.sectionId); if (!s) return null; const m = localToPlan(s, o.x, o.y); return <Circle key={o.id} x={m.x} y={m.y} radius={Math.max(0.2, o.shape === 'CIRCLE' ? o.r : Math.max(o.w, o.h) / 2)} fill="#fde68a" stroke="#b45309" strokeWidth={1} strokeScaleEnabled={false} listening={false} />; })}
              {config.equipment.map((e) => (
                <Rect key={e.id} x={e.x} y={e.y} offsetX={e.widthM / 2} offsetY={e.depthM / 2} width={e.widthM} height={e.depthM} fill="#a7f3d0" stroke={selection?.ids[0] === e.id ? colors.select : '#047857'} strokeWidth={selection?.ids[0] === e.id ? 3 : 1.5} strokeScaleEnabled={false}
                  draggable={edit && tool === 'select'} onDragStart={() => { st.getState().beginTransient(); st.getState().setSelection({ kind: 'equipment', ids: [e.id] }); }}
                  onDragMove={(ev) => { const nx = snap(ev.target.x(), snapStep); const ny = snap(ev.target.y(), snapStep); ev.target.position({ x: nx, y: ny }); st.getState().transient((c) => ({ ...c, equipment: c.equipment.map((q) => (q.id === e.id ? { ...q, x: nx, y: ny } : q)) })); }}
                  onClick={(ev) => { if (tool === 'select') { ev.cancelBubble = true; st.getState().setSelection({ kind: 'equipment', ids: [e.id] }); } }} />
              ))}
              {draft.length > 0 && <Line points={flatPts(hover ? [...draft, snapped(hover)] : draft)} stroke="#dc2626" dash={[5, 4]} strokeWidth={2} strokeScaleEnabled={false} listening={false} />}
              {rectDraft && <Rect x={Math.min(rectDraft.a.x, rectDraft.b.x)} y={Math.min(rectDraft.a.y, rectDraft.b.y)} width={Math.abs(rectDraft.a.x - rectDraft.b.x)} height={Math.abs(rectDraft.a.y - rectDraft.b.y)} fill="rgba(22,163,74,0.12)" stroke={colors.select} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />}
            </>
          )}
        </Layer>

        {/* labels in screen space (not flipped) */}
        <Layer listening={false}>
          {!plan && showDims && section.polygon.map((p, i) => {
            const q = section.polygon[(i + 1) % section.polygon.length]!;
            const m = toStage({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
            const L = Math.hypot(q.x - p.x, q.y - p.y);
            return L * view.scale > 36 ? <Text key={i} x={m.x - 30} y={m.y - 14} width={60} align="center" text={u.fmt(L, 2)} fontSize={11} fill="#0f2a43" /> : null;
          })}
          {!plan && config.obstacles.filter((o) => o.sectionId === section.id).map((o) => { const m = toStage({ x: o.x, y: o.y }); return <Text key={o.id} x={m.x - 40} y={m.y - 6} width={80} align="center" text={OBSTACLE_LABELS[o.type]} fontSize={10} fill="#78350f" />; })}
          {!plan && gaps.map((g, i) => { const m = toStage({ x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 }); return <Text key={i} x={m.x - 24} y={m.y - 14} width={48} align="center" text={`${(g.d * 1000).toFixed(0)} mm`} fontSize={10} fill="#6d28d9" fontStyle="bold" />; })}
          {plan && config.roofSections.map((s) => { const c = s.polygon.reduce((a, p) => ({ x: a.x + p.x / s.polygon.length, y: a.y + p.y / s.polygon.length }), { x: 0, y: 0 }); const m = toStage(localToPlan(s, c.x, c.y)); return <Text key={s.id} x={m.x - 50} y={m.y - 6} width={100} align="center" text={s.name} fontSize={11} fill="#475569" />; })}
          {plan && planGeo && <Text x={toStage(planGeo.footprint[0]!).x} y={toStage({ x: 0, y: Math.max(...planGeo.footprint.map((p) => p.y)) }).y + 8} text={`${u.fmt(config.building.lengthM, 1)} × ${u.fmt(config.building.widthM, 1)} · ${config.building.floors} floor(s) · eave ${u.fmt(planGeo.eaveHeightM, 1)}`} fontSize={11} fill="#334155" />}
          {plan && (
            <Group x={northArrow.x} y={northArrow.y}>
              <Arrow points={[0, 18, 0, -18]} pointerLength={8} pointerWidth={8} fill="#0f2a43" stroke="#0f2a43" strokeWidth={2} /><Text x={-5} y={-34} text="N" fontSize={14} fontStyle="bold" fill="#0f2a43" />
            </Group>
          )}
          {!plan && (
            <Group x={size.w - 150} y={size.h - 52}>
              <Rect width={140} height={42} fill="rgba(255,255,255,0.9)" stroke="#e2e8f0" cornerRadius={6} />
              <Text x={8} y={6} text={`Faces ${azimuthName(section.azimuthDeg)} (${Math.round(section.azimuthDeg)}°)`} fontSize={11} fill="#0f2a43" fontStyle="bold" />
              <Text x={8} y={22} text={`Tilt ${section.tiltDeg}° · ↑ = up-slope`} fontSize={11} fill="#475569" />
            </Group>
          )}
        </Layer>
      </Stage>

      {/* pointer readout + hint */}
      <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 text-[11px] text-ink-muted shadow-sm">
        {hover ? `${plan ? 'x' : 'u'} ${u.fmt(hover.x, 2)} · ${plan ? 'y' : 'v'} ${u.fmt(hover.y, 2)}` : 'Move over the canvas'} · {Math.round(view.scale)} px/{u.len}
        <span className="ml-2">{hint(tool, plan, draft.length)}</span>
      </div>
    </div>
  );
}

function hint(tool: Tool, plan: boolean, draftPts: number) {
  switch (tool) {
    case 'select': return plan ? 'Click a roof area to select; double-click to edit it' : 'Click to select · drag panels · shift-click or drag a box to multi-select';
    case 'pan': return 'Drag to pan';
    case 'panel': return plan ? 'Switch to a roof section to place panels' : 'Click on the roof to place a panel';
    case 'obstacle': return 'Click on the roof to place the obstacle';
    case 'zone': return draftPts ? 'Double-click or Enter to finish · Esc to cancel' : 'Click to outline a restricted zone';
    case 'draw-rect': return plan ? 'Drag to draw a rectangular roof area' : 'Switch to the plan view to draw roof areas';
    case 'draw-poly': return plan ? (draftPts ? 'Double-click or Enter to finish · Esc to cancel' : 'Click to outline a custom roof area') : 'Switch to the plan view to draw roof areas';
  }
}
