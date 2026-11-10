import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as THREE from 'three';
import { createDefaultConfig, defaultPermissionsFor, generateBuilding, localToWorld, summarizeDesign, validateLayout, type DesignConfig, type RoofType } from '@solarflow/shared';
import { tokenStore } from '@/lib/api';
import { useAuth, type SessionPayload } from '@/store/auth';
import { isDirty, useDesign } from '@/features/design/store';
import { sectionMatrix } from '@/features/design/Scene3D';
import { Editor2D } from '@/features/design/Editor2D';
import { DesignsPage } from '@/features/design/DesignsPage';

// Konva needs a real canvas, which jsdom does not have; the canvas itself is exercised by the store/geometry tests.
vi.mock('@/features/design/Canvas2D', () => ({ Canvas2D: () => <div data-testid="canvas-2d" /> }));

const session = (role: Parameters<typeof defaultPermissionsFor>[0]): SessionPayload => ({
  accessToken: 't', user: { id: 'u1', email: 'a@b.co', firstName: 'A', lastName: 'B', phone: null },
  organization: { id: 'o', name: 'Sun Co', slug: 'sun', logoUrl: null, primaryColor: '#0f2a43', accentColor: '#16a34a', currency: 'INR', country: 'IN', locale: 'en-IN', timezone: 'Asia/Kolkata', measurementSystem: 'METRIC' },
  roles: [], permissions: defaultPermissionsFor(role),
});
const qcWrap = (ui: ReactNode, url = '/') => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter></QueryClientProvider>
);
const flat = () => createDefaultConfig({ lengthM: 10, widthM: 6, floors: 2, roofType: 'FLAT' });
const loadStore = (c: DesignConfig = flat()) => useDesign.getState().load({ designId: 'd1', name: 'Test design', version: 1, config: c });
const S = () => useDesign.getState();

beforeEach(() => { tokenStore.set('t'); useAuth.setState({ status: 'authenticated', session: session('ORG_OWNER') }); useDesign.setState({ designId: null, config: null, past: [], future: [] }); });
afterEach(() => vi.restoreAllMocks());

describe('design store: one document with undo/redo', () => {
  it('auto-arrange is a single undoable step', () => {
    loadStore();
    const r = S().autoArrange('roof-1');
    expect(r?.placed).toBe(14);
    expect(S().config!.panels).toHaveLength(14);
    S().undo();
    expect(S().config!.panels).toHaveLength(0);
    S().redo();
    expect(S().config!.panels).toHaveLength(14);
  });
  it('adding, rotating and deleting panels updates validation and can be undone step by step', () => {
    loadStore();
    const id = S().addPanel('roof-1', 5, 3)!;
    expect(S().config!.panels).toHaveLength(1);
    S().rotatePanels([id], 90);
    expect(S().config!.panels[0]!.rotationDeg).toBe(90);
    S().rotatePanels([id], 100);
    expect(S().config!.panels[0]!.rotationDeg).toBe(-170); // wraps into (-180, 180]
    S().deletePanels([id]);
    expect(S().config!.panels).toHaveLength(0);
    S().undo(); S().undo();
    expect(S().config!.panels[0]!.rotationDeg).toBe(90);
    expect(S().selection).toBeNull();
  });
  it('typing in a field coalesces into one undo step, but separate edits do not', () => {
    loadStore();
    for (const v of [11, 12, 13]) S().updateBuilding({ lengthM: v }, 'bld-l');
    expect(S().config!.building.lengthM).toBe(13);
    S().undo();
    expect(S().config!.building.lengthM).toBe(10); // the whole burst undone at once
    S().updateBuilding({ widthM: 7 }, 'bld-w');
    S().updateBuilding({ floors: 3 }, 'bld-f');
    S().undo();
    expect(S().config!.building.floors).toBe(2);
    expect(S().config!.building.widthM).toBe(7);
  });
  it('a drag (begin + many transient moves) is one undo step', () => {
    loadStore();
    const id = S().addPanel('roof-1', 5, 3)!;
    S().beginTransient();
    for (const x of [5.1, 5.3, 5.5, 6]) S().transient((c) => ({ ...c, panels: c.panels.map((p) => (p.id === id ? { ...p, x } : p)) }));
    expect(S().config!.panels[0]!.x).toBe(6);
    S().undo();
    expect(S().config!.panels[0]!.x).toBe(5);
  });
  it('changing the roof type regenerates sections, keeps surviving panels and flags those that no longer fit', () => {
    loadStore(createDefaultConfig({ lengthM: 14, widthM: 8, floors: 2, roofType: 'GABLE', roofAngleDeg: 20 }));
    S().autoArrange('roof-1'); S().autoArrange('roof-2');
    const before = S().config!.panels.length;
    expect(before).toBeGreaterThan(10);
    S().updateBuilding({ roofType: 'FLAT', roofAngleDeg: 0 });
    expect(S().config!.roofSections.map((s) => s.id)).toEqual(['roof-1']);
    expect(S().config!.panels.every((p) => p.sectionId === 'roof-1')).toBe(true);
    S().undo();
    expect(S().config!.roofSections).toHaveLength(2);
    expect(S().config!.panels).toHaveLength(before);
  });
  it('protects the last roof section and panel types that are in use', () => {
    loadStore();
    S().deleteSection('roof-1');
    expect(S().config!.roofSections).toHaveLength(1);
    S().addPanel('roof-1', 5, 3);
    expect(S().deletePanelType(S().config!.panelTypes[0]!.id)).toBe(false);
    const id = S().addPanelType({ name: 'Small', widthM: 1, lengthM: 1.7, wattage: 400 });
    expect(S().deletePanelType(id)).toBe(true);
  });
  it('draws a new roof area on the plan and keeps its true dimensions', () => {
    loadStore();
    const id = S().addSection([{ x: 8, y: -2 }, { x: 12, y: -2 }, { x: 12, y: 1 }, { x: 8, y: 1 }]);
    const s = S().config!.roofSections.find((x) => x.id === id)!;
    const xs = s.polygon.map((p) => p.x), ys = s.polygon.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4, 9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(3, 9);
    expect(S().activeSectionId).toBe(id);
  });
  it('tracks unsaved changes against the saved snapshot', () => {
    loadStore();
    expect(isDirty(S())).toBe(false);
    S().addPanel('roof-1', 5, 3);
    expect(isDirty(S())).toBe(true);
    S().markSaved(2);
    expect(isDirty(S())).toBe(false);
    expect(S().baseVersion).toBe(2);
    S().undo();
    expect(isDirty(S())).toBe(true); // undoing past the save point is a change
  });
});

describe('2D and 3D share the same geometry', () => {
  for (const roofType of ['FLAT', 'SHED', 'GABLE', 'HIP'] as RoofType[]) {
    it(`${roofType}: a panel's 3D world position equals the shared model's position (and its plan projection)`, () => {
      let c = createDefaultConfig({ lengthM: 14, widthM: 9, floors: 2, roofType, roofAngleDeg: 25, orientationDeg: 30 });
      const sec = c.roofSections[0]!;
      const cx = sec.polygon.reduce((n, p) => n + p.x / sec.polygon.length, 0);
      const cy = sec.polygon.reduce((n, p) => n + p.y / sec.polygon.length, 0);
      c = { ...c, panels: [{ id: 'p', sectionId: sec.id, typeId: c.panelTypes[0]!.id, x: cx, y: cy, rotationDeg: 0, orientation: 'PORTRAIT', tiltDeg: 0 }] };
      const w3 = new THREE.Vector3(cx, cy, 0).applyMatrix4(sectionMatrix(sec)); // what the 3D scene does
      const w = localToWorld(sec, cx, cy); // what the 2D plan uses (x, y plan; z height)
      expect(w3.x).toBeCloseTo(w.x, 6);
      expect(w3.z).toBeCloseTo(w.y, 6); // Three z = plan y
      expect(w3.y).toBeCloseTo(w.z, 6); // Three y = height
    });
    it(`${roofType}: the 3D roof plane follows the walls (eave corner touches wall top)`, () => {
      const c = createDefaultConfig({ lengthM: 12, widthM: 8, floors: 3, roofType, roofAngleDeg: 30 });
      const g = generateBuilding(c.building);
      const s = c.roofSections.find((x) => x.id === 'roof-1')!;
      const eave = new THREE.Vector3(s.polygon[0]!.x, s.polygon[0]!.y, 0).applyMatrix4(sectionMatrix(s));
      expect(eave.y).toBeCloseTo(g.eaveHeightM, 6);
      const top = Math.max(...g.walls.flat().map((p) => p.z));
      // gable and shed walls rise to the ridge / high eave; flat and hip walls stop at the eaves (the roof planes rise above them)
      expect(top).toBeCloseTo(roofType === 'HIP' ? g.eaveHeightM : g.ridgeHeightM, 6);
      if (roofType === 'HIP') expect(new THREE.Vector3(s.polygon[2]!.x, s.polygon[2]!.y, 0).applyMatrix4(sectionMatrix(s)).y).toBeCloseTo(g.ridgeHeightM, 6); // roof reaches the ridge
    });
  }
  it('the same edit changes both views: moving a panel in the store moves it in 3D space', () => {
    loadStore();
    const id = S().addPanel('roof-1', 2, 2)!;
    const sec = S().config!.roofSections[0]!;
    const at = () => { const p = S().config!.panels.find((x) => x.id === id)!; return new THREE.Vector3(p.x, p.y, 0).applyMatrix4(sectionMatrix(sec)); };
    const a = at();
    S().updatePanels([id], { x: 4 });
    const b = at();
    expect(b.x - a.x).toBeCloseTo(2, 6); // flat south-facing roof: +u is east
    expect(b.y).toBeCloseTo(a.y, 6);
  });
});

describe('design editor shell', () => {
  const calls: { url: string; method: string; body?: any }[] = [];
  function mockApi(opts: { saveStatus?: number } = {}) {
    calls.length = 0;
    const cfg = flat();
    const detail = {
      id: 'd1', name: 'Sharma residence', status: 'DRAFT', latestVersion: 3, approvedVersion: null, approvedAt: null, updatedAt: '', createdAt: '', customerId: null, surveyId: null, calculationId: null, customer: null,
      version: { version: 3, label: null, config: cfg, createdAt: '' }, summary: summarizeDesign(cfg, validateLayout(cfg)),
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input)).pathname.replace('/api/v1', '');
      const method = init?.method ?? 'GET';
      calls.push({ url: `${method} ${url}`, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (url === '/solar-designs/d1' && method === 'GET') return json(detail);
      if (url === '/solar-designs/d1/versions' && method === 'POST') {
        if (opts.saveStatus === 409) return json({ error: { code: 'CONFLICT', message: 'A newer version (v5) was saved by someone else. Reload the design to merge your changes.' } }, 409);
        return json({ version: { version: 4 }, summary: {} }, 201);
      }
      if (url === '/solar-designs/d1/versions/5') return json({ config: cfg });
      return json({ error: { message: `unmocked ${method} ${url}` } }, 404);
    });
  }
  const renderEditor = () => render(qcWrap(<Routes><Route path="/designer-2d/:id" element={<Editor2D designId="d1" />} /><Route path="*" element={<div>other page</div>} /></Routes>, '/designer-2d/d1'));

  it('loads the design, shows version and saved state, and saves a new version with the base version', async () => {
    mockApi();
    renderEditor();
    expect(await screen.findByText('Sharma residence')).toBeInTheDocument();
    expect(screen.getByText(/v3 · saved/)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: /^Save$/ });
    expect(save).toBeDisabled(); // nothing to save yet
    act(() => { S().autoArrange('roof-1'); });
    await waitFor(() => expect(save).toBeEnabled());
    expect(screen.getByText(/unsaved changes/)).toBeInTheDocument();
    await userEvent.click(save);
    await waitFor(() => expect(calls.some((c) => c.url === 'POST /solar-designs/d1/versions')).toBe(true));
    const post = calls.find((c) => c.url === 'POST /solar-designs/d1/versions')!;
    expect(post.body.baseVersion).toBe(3);
    expect(post.body.config.panels).toHaveLength(14);
    await waitFor(() => expect(screen.getByText(/v4 · saved/)).toBeInTheDocument());
    expect(save).toBeDisabled();
  });

  it('undo and redo buttons reflect history', async () => {
    mockApi();
    renderEditor();
    await screen.findByText('Sharma residence');
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    expect(undo).toBeDisabled();
    act(() => { S().addPanel('roof-1', 5, 3); });
    await waitFor(() => expect(undo).toBeEnabled());
    await userEvent.click(undo);
    expect(S().config!.panels).toHaveLength(0);
    expect(redo).toBeEnabled();
    await userEvent.click(redo);
    expect(S().config!.panels).toHaveLength(1);
  });

  it('Ctrl+S saves, and shortcuts are ignored while typing in a field', async () => {
    mockApi();
    renderEditor();
    await screen.findByText('Sharma residence');
    act(() => { S().addPanel('roof-1', 5, 3); });
    await userEvent.keyboard('{Control>}s{/Control}');
    await waitFor(() => expect(calls.some((c) => c.url === 'POST /solar-designs/d1/versions')).toBe(true));
    // Delete while typing in the properties panel must not delete the selected panel
    act(() => { S().setSelection({ kind: 'panel', ids: [S().config!.panels[0]!.id] }); });
    const field = await screen.findByLabelText(/^Rotation/);
    await userEvent.click(field);
    await userEvent.keyboard('{Delete}');
    expect(S().config!.panels).toHaveLength(1);
  });

  it('shows a conflict banner when someone else saved first, and can reload the latest', async () => {
    mockApi({ saveStatus: 409 });
    renderEditor();
    await screen.findByText('Sharma residence');
    act(() => { S().addPanel('roof-1', 5, 3); });
    await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(/newer version \(v5\)/);
    expect(isDirty(S())).toBe(true); // our work is not discarded
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = new URL(String(input)).pathname.replace('/api/v1', '');
      const cfg = flat();
      if (url === '/solar-designs/d1') return new Response(JSON.stringify({ id: 'd1', latestVersion: 5, version: { config: cfg } }), { status: 200 });
      return new Response(JSON.stringify({ config: cfg }), { status: 200 });
    });
    await userEvent.click(within(banner).getByRole('button', { name: /reload latest/i }));
    await waitFor(() => expect(S().baseVersion).toBe(5));
    expect(isDirty(S())).toBe(false);
    expect(S().config!.panels).toHaveLength(0);
  });

  it('switching between the 2D and 3D editors keeps unsaved edits (regression: it used to reload a stale copy)', async () => {
    mockApi();
    render(qcWrap(<Routes><Route path="/designer-2d/:id" element={<Editor2D designId="d1" />} /><Route path="/designer-3d/:id" element={<Editor2D key="other-editor" designId="d1" />} /></Routes>, '/designer-2d/d1'));
    await screen.findByText('Sharma residence');
    act(() => { S().autoArrange('roof-1'); });
    expect(S().config!.panels).toHaveLength(14);
    await userEvent.click(screen.getByRole('button', { name: /open in 3d/i })); // no "discard changes?" prompt, nothing lost
    await waitFor(() => expect(calls.filter((c) => c.url === 'GET /solar-designs/d1').length).toBeGreaterThan(1)); // the new editor did fetch
    await screen.findByText('Sharma residence');
    expect(S().config!.panels).toHaveLength(14);
    expect(isDirty(S())).toBe(true);
    expect(S().past.length).toBeGreaterThan(0); // undo history carried over too
  });

  it('a StrictMode-style unmount/remount keeps the live document, but really leaving clears it', async () => {
    mockApi();
    const { unmount } = render(qcWrap(<Routes><Route path="/designer-2d/:id" element={<Editor2D designId="d1" />} /></Routes>, '/designer-2d/d1'));
    await screen.findByText('Sharma residence');
    act(() => { S().autoArrange('roof-1'); });
    // React StrictMode (dev) unmounts and immediately remounts: the document must survive that
    const strict = render(qcWrap(<Routes><Route path="/designer-2d/:id" element={<Editor2D designId="d1" />} /></Routes>, '/designer-2d/d1'));
    strict.unmount();
    const remounted = render(qcWrap(<Routes><Route path="/designer-2d/:id" element={<Editor2D designId="d1" />} /></Routes>, '/designer-2d/d1'));
    await new Promise((r) => setTimeout(r, 120));
    expect(S().config!.panels).toHaveLength(14);
    remounted.unmount();
    unmount();
    await waitFor(() => expect(S().config).toBeNull());
    expect(S().designId).toBeNull();
  });

  it('read-only roles cannot save, approve or use editing tools', async () => {
    useAuth.setState({ session: session('SALES_EXECUTIVE') }); // design:view only
    mockApi();
    renderEditor();
    await screen.findByText('Sharma residence');
    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Place panels' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Select / move' })).toBeInTheDocument();
  });

  it('approval needs a saved design and the approve permission', async () => {
    mockApi();
    renderEditor();
    await screen.findByText('Sharma residence');
    const approve = screen.getByRole('button', { name: /approve/i });
    expect(approve).toBeEnabled();
    act(() => { S().addPanel('roof-1', 5, 3); });
    await waitFor(() => expect(approve).toBeDisabled());
  });

  it('shows the building, layout and summary panels with live numbers', async () => {
    mockApi();
    renderEditor();
    await screen.findByText('Sharma residence');
    expect(screen.getByLabelText('Length (m)')).toHaveValue(10);
    await userEvent.click(screen.getByRole('tab', { name: 'Layout' }));
    await userEvent.click(screen.getByRole('button', { name: /fill selected section/i }));
    expect(await screen.findByText(/Placed 14 panels/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Summary' }));
    expect(screen.getAllByText('7.7 kWp').length).toBeGreaterThan(0);
    expect(screen.getAllByText('14').length).toBeGreaterThan(0);
  });
});

describe('designs list and creation', () => {
  const page = (data: unknown[]) => ({ data, meta: { page: 1, pageSize: 15, total: data.length, totalPages: 1 } });
  it('lists designs with status and capacity, and creates one from entered dimensions', async () => {
    const calls: { url: string; body?: any }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input)).pathname.replace('/api/v1', '');
      const method = init?.method ?? 'GET';
      calls.push({ url: `${method} ${url}`, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });
      if (url === '/solar-designs' && method === 'GET') return json(page([{ id: 'a', name: 'Villa roof', status: 'APPROVED', latestVersion: 4, approvedVersion: 3, updatedAt: '2026-11-01T00:00:00Z', customer: { id: 'c', name: 'Asha' }, latest: { version: 4, validPanelCount: 12, installedKwp: '6.6', issueCount: 0 } }, { id: 'b', name: 'Shed', status: 'DRAFT', latestVersion: 1, approvedVersion: null, updatedAt: '2026-11-02T00:00:00Z', customer: null, latest: { version: 1, validPanelCount: 4, installedKwp: '2.2', issueCount: 2 } }]));
      if (url === '/solar-designs' && method === 'POST') return json({ id: 'new1' }, 201);
      if (url === '/customers') return json(page([]));
      return json(page([]));
    });
    render(qcWrap(<Routes><Route path="/designer-2d" element={<DesignsPage mode="2d" />} /><Route path="/designer-2d/:id" element={<div>editor opened</div>} /></Routes>, '/designer-2d'));
    expect(await screen.findByText('Villa roof')).toBeInTheDocument();
    expect(screen.getByText('Approved v3')).toBeInTheDocument();
    expect(screen.getByText('6.6 kWp')).toBeInTheDocument();
    expect(screen.getByText('2 issues')).toBeInTheDocument();
    expect(screen.getByText(/not certified structural or electrical/i)).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: /new design/i })[0]!);
    const dialog = await screen.findByRole('dialog');
    const create = within(dialog).getByRole('button', { name: /create and open/i });
    expect(create).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Design name'), 'New roof');
    await userEvent.clear(within(dialog).getByLabelText('Length (m)')); await userEvent.type(within(dialog).getByLabelText('Length (m)'), '15');
    await userEvent.selectOptions(within(dialog).getByLabelText('Roof type'), 'GABLE');
    await userEvent.click(create);
    await waitFor(() => expect(screen.getByText('editor opened')).toBeInTheDocument());
    const post = calls.find((c) => c.url === 'POST /solar-designs')!;
    expect(post.body).toMatchObject({ name: 'New roof', building: { lengthM: 15, widthM: 8, floors: 2, roofType: 'GABLE', roofAngleDeg: 25 } });
  });
});
