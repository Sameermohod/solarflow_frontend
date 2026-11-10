import { create } from 'zustand';
import {
  applyAutoArrange, reconcileConfig, regenerateRoof, uid, type AutoArrangeOptions, type AutoArrangeResult, type Building, type DesignConfig, type EquipmentItem, type LayoutSettings,
  type Obstacle, type Panel, type PanelType, type RoofSection, type Vec2, type Zone,
} from '@solarflow/shared';

export type Tool = 'select' | 'pan' | 'panel' | 'obstacle' | 'zone' | 'draw-rect' | 'draw-poly';
export type Selection = { kind: 'panel' | 'obstacle' | 'zone' | 'section' | 'equipment'; ids: string[] } | null;
export type ViewMode = 'section' | 'plan';

const HISTORY_LIMIT = 100;
const COALESCE_MS = 900;

interface DesignState {
  designId: string | null;
  name: string;
  /** Latest saved version number; sent as baseVersion on save. */
  baseVersion: number;
  config: DesignConfig | null;
  /** JSON of the last saved config, for the unsaved-changes indicator. */
  savedJson: string;
  past: DesignConfig[];
  future: DesignConfig[];
  lastKey: { key: string; at: number } | null;

  selection: Selection;
  activeSectionId: string | null;
  tool: Tool;
  obstacleType: Obstacle['type'];
  viewMode: ViewMode;
  showGrid: boolean;
  showDimensions: boolean;
  snapStep: number;
  placingTypeId: string | null;
  /** Set when switching between the 2D and 3D editors so the live (possibly unsaved) document survives the route change. */
  keepOnUnmount: boolean;

  load: (d: { designId: string; name: string; version: number; config: DesignConfig }) => void;
  markSaved: (version: number) => void;
  replaceConfig: (config: DesignConfig, version: number) => void;
  commit: (fn: (c: DesignConfig) => DesignConfig, key?: string) => void;
  beginTransient: () => void;
  transient: (fn: (c: DesignConfig) => DesignConfig) => void;
  undo: () => void;
  redo: () => void;

  setSelection: (s: Selection) => void;
  setActiveSection: (id: string | null) => void;
  setTool: (t: Tool) => void;
  setObstacleType: (t: Obstacle['type']) => void;
  setViewMode: (m: ViewMode) => void;
  toggle: (k: 'showGrid' | 'showDimensions') => void;
  setPlacingType: (id: string | null) => void;

  // domain operations (each is one undo step)
  addPanel: (sectionId: string, x: number, y: number, typeId?: string) => string | null;
  updatePanels: (ids: string[], patch: Partial<Panel>, key?: string) => void;
  nudgePanels: (ids: string[], dx: number, dy: number) => void;
  rotatePanels: (ids: string[], deltaDeg: number) => void;
  deletePanels: (ids: string[]) => void;
  clearPanels: (sectionId?: string) => void;
  addObstacle: (sectionId: string, x: number, y: number) => string | null;
  updateObstacle: (id: string, patch: Partial<Obstacle>, key?: string) => void;
  deleteObstacle: (id: string) => void;
  addZone: (sectionId: string, polygon: Vec2[]) => string;
  updateZone: (id: string, patch: Partial<Zone>, key?: string) => void;
  deleteZone: (id: string) => void;
  addSection: (polygon: Vec2[]) => string;
  updateSection: (id: string, patch: Partial<RoofSection>, key?: string) => void;
  deleteSection: (id: string) => void;
  updateBuilding: (patch: Partial<Building>, key?: string) => void;
  updateLayout: (patch: Partial<LayoutSettings>, key?: string) => void;
  updateAppearance: (patch: Partial<DesignConfig['appearance']>, key?: string) => void;
  setUnits: (u: DesignConfig['units']) => void;
  addPanelType: (t: Omit<PanelType, 'id'> & { id?: string }) => string;
  updatePanelType: (id: string, patch: Partial<PanelType>, key?: string) => void;
  deletePanelType: (id: string) => boolean;
  addEquipment: (kind: EquipmentItem['kind']) => string;
  updateEquipment: (id: string, patch: Partial<EquipmentItem>, key?: string) => void;
  deleteEquipment: (id: string) => void;
  autoArrange: (sectionId: string, o?: AutoArrangeOptions) => AutoArrangeResult | null;
}

export const useDesign = create<DesignState>((set, get) => {
  const edit = (fn: (c: DesignConfig) => DesignConfig, key?: string) => get().commit(fn, key);
  return {
    designId: null, name: '', baseVersion: 0, config: null, savedJson: '', past: [], future: [], lastKey: null,
    selection: null, activeSectionId: null, tool: 'select', obstacleType: 'WATER_TANK', viewMode: 'section', showGrid: true, showDimensions: true, snapStep: 0.05, placingTypeId: null, keepOnUnmount: false,

    load: ({ designId, name, version, config }) => set({
      designId, name, baseVersion: version, config, savedJson: JSON.stringify(config), past: [], future: [], lastKey: null, selection: null,
      activeSectionId: config.roofSections[0]?.id ?? null, tool: 'select', placingTypeId: config.layout.typeId ?? config.panelTypes[0]?.id ?? null,
    }),
    markSaved: (version) => set((s) => ({ baseVersion: version, savedJson: JSON.stringify(s.config) })),
    replaceConfig: (config, version) => set({ config, baseVersion: version, savedJson: JSON.stringify(config), past: [], future: [], lastKey: null, selection: null, activeSectionId: config.roofSections[0]?.id ?? null }),

    commit: (fn, key) => set((s) => {
      if (!s.config) return s;
      const next = fn(s.config);
      if (next === s.config) return s;
      const now = Date.now();
      const coalesce = key && s.lastKey && s.lastKey.key === key && now - s.lastKey.at < COALESCE_MS && s.past.length > 0;
      const past = coalesce ? s.past : [...s.past, s.config].slice(-HISTORY_LIMIT);
      return { config: next, past, future: [], lastKey: key ? { key, at: now } : null };
    }),
    beginTransient: () => set((s) => (s.config ? { past: [...s.past, s.config].slice(-HISTORY_LIMIT), future: [], lastKey: null } : s)),
    transient: (fn) => set((s) => (s.config ? { config: fn(s.config) } : s)),
    undo: () => set((s) => {
      if (!s.config || !s.past.length) return s;
      const prev = s.past[s.past.length - 1]!;
      return { config: prev, past: s.past.slice(0, -1), future: [s.config, ...s.future].slice(0, HISTORY_LIMIT), lastKey: null, selection: null };
    }),
    redo: () => set((s) => {
      if (!s.config || !s.future.length) return s;
      const [next, ...rest] = s.future;
      return { config: next!, past: [...s.past, s.config], future: rest, lastKey: null, selection: null };
    }),

    setSelection: (selection) => set({ selection }),
    setActiveSection: (activeSectionId) => set({ activeSectionId }),
    setTool: (tool) => set({ tool }),
    setObstacleType: (obstacleType) => set({ obstacleType }),
    setViewMode: (viewMode) => set({ viewMode }),
    toggle: (k) => set((s) => ({ [k]: !s[k] }) as Partial<DesignState>),
    setPlacingType: (placingTypeId) => set({ placingTypeId }),

    addPanel: (sectionId, x, y, typeId) => {
      const c = get().config;
      if (!c) return null;
      const tid = typeId ?? get().placingTypeId ?? c.panelTypes[0]!.id;
      const id = uid('p');
      const o = c.layout.orientation === 'LANDSCAPE' ? 'LANDSCAPE' : 'PORTRAIT';
      edit((cfg) => ({ ...cfg, panels: [...cfg.panels, { id, sectionId, typeId: tid, x, y, rotationDeg: 0, orientation: o, tiltDeg: cfg.layout.mountTiltDeg }] }));
      return id;
    },
    updatePanels: (ids, patch, key) => edit((c) => { const set = new Set(ids); return { ...c, panels: c.panels.map((p) => (set.has(p.id) ? { ...p, ...patch } : p)) }; }, key),
    nudgePanels: (ids, dx, dy) => edit((c) => { const set = new Set(ids); return { ...c, panels: c.panels.map((p) => (set.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p)) }; }, `nudge-${ids.join(',')}`),
    rotatePanels: (ids, d) => edit((c) => {
      const set = new Set(ids);
      const wrap = (r: number) => { let v = r % 360; if (v > 180) v -= 360; if (v <= -180) v += 360; return v; };
      return { ...c, panels: c.panels.map((p) => (set.has(p.id) ? { ...p, rotationDeg: wrap(p.rotationDeg + d) } : p)) };
    }),
    deletePanels: (ids) => { const set = new Set(ids); edit((c) => ({ ...c, panels: c.panels.filter((p) => !set.has(p.id)) })); set_sel(set); },
    clearPanels: (sectionId) => edit((c) => ({ ...c, panels: sectionId ? c.panels.filter((p) => p.sectionId !== sectionId) : [] })),

    addObstacle: (sectionId, x, y) => {
      if (!get().config) return null;
      const type = get().obstacleType;
      const id = uid('o');
      const sizes: Record<Obstacle['type'], Partial<Obstacle>> = {
        WATER_TANK: { shape: 'CIRCLE', r: 0.6, heightM: 1.5 }, CHIMNEY: { shape: 'RECT', w: 0.6, h: 0.6, heightM: 2 }, SKYLIGHT: { shape: 'RECT', w: 1.2, h: 1.2, heightM: 0.3, clearanceM: 0.2 },
        VENT: { shape: 'CIRCLE', r: 0.25, heightM: 0.8 }, STAIRCASE: { shape: 'RECT', w: 2.5, h: 3, heightM: 2.6, clearanceM: 0.5 }, HVAC: { shape: 'RECT', w: 1.5, h: 1, heightM: 1.2 }, OTHER: { shape: 'RECT', w: 1, h: 1, heightM: 1 },
      };
      edit((c) => ({ ...c, obstacles: [...c.obstacles, { id, sectionId, type, shape: 'RECT', x, y, w: 1, h: 1, r: 0.5, heightM: 1, clearanceM: 0.3, ...sizes[type] } as Obstacle] }));
      return id;
    },
    updateObstacle: (id, patch, key) => edit((c) => ({ ...c, obstacles: c.obstacles.map((o) => (o.id === id ? { ...o, ...patch } : o)) }), key),
    deleteObstacle: (id) => { edit((c) => ({ ...c, obstacles: c.obstacles.filter((o) => o.id !== id) })); set({ selection: null }); },

    addZone: (sectionId, polygon) => {
      const id = uid('z');
      edit((c) => ({ ...c, zones: [...c.zones, { id, sectionId, name: `Restricted zone ${c.zones.length + 1}`, polygon }] }));
      return id;
    },
    updateZone: (id, patch, key) => edit((c) => ({ ...c, zones: c.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) }), key),
    deleteZone: (id) => { edit((c) => ({ ...c, zones: c.zones.filter((z) => z.id !== id) })); set({ selection: null }); },

    addSection: (polygon) => {
      const id = uid('roof');
      const xs = polygon.map((p) => p.x);
      const ys = polygon.map((p) => p.y);
      const ox = Math.min(...xs);
      const oy = Math.max(...ys);
      // Flat section drawn on the plan: local u = x − ox, v = oy − y (south-facing, tilt 0).
      const local = polygon.map((p) => ({ x: round(p.x - ox), y: round(oy - p.y) }));
      edit((c) => ({
        ...c,
        roofSections: [...c.roofSections, { id, name: `Roof area ${c.roofSections.length + 1}`, polygon: local, originX: ox, originY: oy, azimuthDeg: 180, tiltDeg: 0, baseHeightM: c.building.floors * c.building.floorHeightM, setbackM: c.roofSections[0]?.setbackM ?? 0.5 }],
      }));
      set({ activeSectionId: id, selection: { kind: 'section', ids: [id] } });
      return id;
    },
    updateSection: (id, patch, key) => edit((c) => ({ ...c, roofSections: c.roofSections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }), key),
    deleteSection: (id) => {
      const c = get().config;
      if (!c || c.roofSections.length <= 1) return;
      edit((cfg) => reconcileConfig({ ...cfg, roofSections: cfg.roofSections.filter((s) => s.id !== id) }));
      set((s) => ({ selection: null, activeSectionId: s.config?.roofSections[0]?.id ?? null }));
    },
    updateBuilding: (patch, key) => edit((c) => regenerateRoof({ ...c, building: { ...c.building, ...patch } }), key),
    updateLayout: (patch, key) => edit((c) => ({ ...c, layout: { ...c.layout, ...patch } }), key),
    updateAppearance: (patch, key) => edit((c) => ({ ...c, appearance: { ...c.appearance, ...patch } }), key),
    setUnits: (units) => edit((c) => ({ ...c, units })),
    addPanelType: (t) => {
      const id = t.id ?? uid('pt');
      edit((c) => ({ ...c, panelTypes: [...c.panelTypes, { ...t, id }] }));
      return id;
    },
    updatePanelType: (id, patch, key) => edit((c) => ({ ...c, panelTypes: c.panelTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)) }), key),
    deletePanelType: (id) => {
      const c = get().config;
      if (!c || c.panelTypes.length <= 1 || c.panels.some((p) => p.typeId === id)) return false;
      edit((cfg) => ({ ...cfg, panelTypes: cfg.panelTypes.filter((t) => t.id !== id) }));
      return true;
    },
    addEquipment: (kind) => {
      const id = uid('eq');
      const b = get().config!.building;
      const sizes: Record<EquipmentItem['kind'], [number, number, number]> = { INVERTER: [0.6, 0.3, 0.8], BATTERY: [0.8, 0.4, 1.2], DISTRIBUTION_BOARD: [0.5, 0.2, 0.7], OTHER: [0.6, 0.6, 0.6] };
      const [w, d, h] = sizes[kind];
      edit((c) => ({ ...c, equipment: [...c.equipment, { id, kind, label: kind === 'INVERTER' ? 'Inverter' : kind === 'BATTERY' ? 'Battery' : kind === 'DISTRIBUTION_BOARD' ? 'DB' : 'Equipment', x: b.lengthM / 2 + 1.2 + c.equipment.length * 0.9, y: 0, widthM: w, depthM: d, heightM: h }] }));
      return id;
    },
    updateEquipment: (id, patch, key) => edit((c) => ({ ...c, equipment: c.equipment.map((e) => (e.id === id ? { ...e, ...patch } : e)) }), key),
    deleteEquipment: (id) => { edit((c) => ({ ...c, equipment: c.equipment.filter((e) => e.id !== id) })); set({ selection: null }); },

    autoArrange: (sectionId, o) => {
      const c = get().config;
      if (!c) return null;
      let result: AutoArrangeResult | null = null;
      edit((cfg) => { const r = applyAutoArrange(cfg, sectionId, o); result = r.result; return r.config; });
      set({ selection: null });
      return result;
    },
  };

  function set_sel(removed: Set<string>) {
    set((s) => (s.selection?.kind === 'panel' ? { selection: { kind: 'panel', ids: s.selection.ids.filter((i) => !removed.has(i)) } } : s));
    if (get().selection?.ids.length === 0) set({ selection: null });
  }
});

const round = (n: number) => Math.round(n * 1000) / 1000;

export const isDirty = (s: Pick<DesignState, 'config' | 'savedJson'>) => !!s.config && JSON.stringify(s.config) !== s.savedJson;

// Dev/test hook for browser tests (tree-shaken from production builds).
if (import.meta.env.DEV) (window as unknown as { __design?: unknown }).__design = useDesign;
