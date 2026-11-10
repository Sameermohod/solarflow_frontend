import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Grid, Html, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  generateBuilding, planToLocal, sectionBasis3D, snap, type DesignConfig, type PanelType, type RoofSection, type Vec3,
} from '@solarflow/shared';
import { useAnalysis } from './analysis';
import { useDesign } from './store';
import { useUnits } from './units';
import { useAuth } from '@/store/auth';

export type ViewPreset = 'perspective' | 'top' | 'front' | 'side';
export interface SceneToggles { building: boolean; roof: boolean; panels: boolean; dimensions: boolean; equipment: boolean; obstacles: boolean }
export interface SceneApi { capture: () => string | null }

/** Section frame → Three.js world (x east, y up, z south). Identical maths to the 2D plan view. */
export function sectionMatrix(s: RoofSection): THREE.Matrix4 {
  const b = sectionBasis3D(s);
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...b.u), new THREE.Vector3(...b.v), new THREE.Vector3(...b.n));
  m.setPosition(b.origin[0], b.origin[1], b.origin[2]);
  return m;
}

function polyGeometry(polys: Vec3[][]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const poly of polys) for (let i = 1; i < poly.length - 1; i++) for (const p of [poly[0]!, poly[i]!, poly[i + 1]!]) pos.push(p.x, p.z, p.y);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function Walls({ config }: { config: DesignConfig }) {
  const geo = useMemo(() => polyGeometry(generateBuilding(config.building).walls), [config.building]);
  useEffect(() => () => geo.dispose(), [geo]);
  const edges = useMemo(() => new THREE.EdgesGeometry(geo, 20), [geo]);
  return (
    <group>
      <mesh geometry={geo} castShadow receiveShadow><meshStandardMaterial color={config.appearance.wallColor} side={THREE.DoubleSide} roughness={0.9} /></mesh>
      <lineSegments geometry={edges}><lineBasicMaterial color="#64748b" /></lineSegments>
    </group>
  );
}

function Roofs({ config, showRoof, showObstacles, onPick, onMove }: { config: DesignConfig; showRoof: boolean; showObstacles: boolean; onPick: (id: string) => void; onMove: (s: RoofSection, e: ThreeEvent<PointerEvent>) => void }) {
  const active = useDesign((s) => s.activeSectionId);
  return (
    <>
      {config.roofSections.map((s) => {
        const m = sectionMatrix(s);
        const shape = new THREE.Shape(s.polygon.map((p) => new THREE.Vector2(p.x, p.y)));
        const outline = [...s.polygon, s.polygon[0]!].map((p) => [p.x, p.y, 0.012] as [number, number, number]);
        return (
          <group key={s.id} matrix={m} matrixAutoUpdate={false}>
            {showRoof && (
              <mesh receiveShadow castShadow onClick={(e) => { e.stopPropagation(); onPick(s.id); }} onPointerMove={(e) => onMove(s, e)}>
                <shapeGeometry args={[shape]} />
                <meshStandardMaterial color={config.appearance.roofColor} side={THREE.DoubleSide} roughness={0.85} emissive={active === s.id ? '#16a34a' : '#000000'} emissiveIntensity={active === s.id ? 0.12 : 0} polygonOffset polygonOffsetFactor={1} polygonOffsetUnits={1} />
              </mesh>
            )}
            {showRoof && <Line points={outline} color={active === s.id ? '#16a34a' : '#334155'} lineWidth={active === s.id ? 2 : 1} />}
            {showObstacles && config.obstacles.filter((o) => o.sectionId === s.id).map((o) => (
              <mesh key={o.id} position={[o.x, o.y, o.heightM / 2]} rotation={o.shape === 'CIRCLE' ? [Math.PI / 2, 0, 0] : [0, 0, 0]} castShadow receiveShadow>
                {o.shape === 'CIRCLE' ? <cylinderGeometry args={[o.r, o.r, o.heightM, 24]} /> : <boxGeometry args={[o.w, o.h, o.heightM]} />}
                <meshStandardMaterial color={o.type === 'WATER_TANK' ? '#38bdf8' : o.type === 'SKYLIGHT' ? '#bae6fd' : '#a8a29e'} roughness={0.6} />
              </mesh>
            ))}
            {config.zones.filter((z) => z.sectionId === s.id).map((z) => (
              <mesh key={z.id} position={[0, 0, 0.02]}><shapeGeometry args={[new THREE.Shape(z.polygon.map((p) => new THREE.Vector2(p.x, p.y)))]} /><meshBasicMaterial color="#ef4444" transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} /></mesh>
            ))}
          </group>
        );
      })}
    </>
  );
}

const PANEL_THICK = 0.04;

/** All panels of one type as a single instanced mesh (thousands of panels stay fast). */
function PanelInstances({ type, config, matrices, ids, colors, onPointerDown }: {
  type: PanelType; config: DesignConfig; matrices: THREE.Matrix4[]; ids: string[]; colors: THREE.Color[]; onPointerDown: (id: string, e: ThreeEvent<PointerEvent>) => void;
}) {
  const body = useRef<THREE.InstancedMesh>(null);
  const frame = useRef<THREE.InstancedMesh>(null);
  const framesM = useMemo(() => matrices.map((m) => m.clone().multiply(new THREE.Matrix4().makeScale(1.04, 1.02, 0.7))), [matrices]);
  useLayoutEffect(() => {
    const b = body.current;
    const f = frame.current;
    if (!b || !f) return;
    matrices.forEach((m, i) => { b.setMatrixAt(i, m); b.setColorAt(i, colors[i]!); f.setMatrixAt(i, framesM[i]!); });
    b.instanceMatrix.needsUpdate = true; f.instanceMatrix.needsUpdate = true;
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    b.computeBoundingSphere(); f.computeBoundingSphere();
  }, [matrices, colors, framesM]);
  void type;
  if (!matrices.length) return null;
  const glossy = config.appearance.panelMaterial === 'GLOSSY';
  return (
    <>
      <instancedMesh key={`f-${matrices.length}`} ref={frame} args={[undefined, undefined, matrices.length]} castShadow onClick={(e) => e.stopPropagation()}>
        <boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color={config.appearance.panelFrameColor} roughness={0.5} metalness={0.6} />
      </instancedMesh>
      <instancedMesh key={`b-${matrices.length}`} ref={body} args={[undefined, undefined, matrices.length]} castShadow receiveShadow
        onClick={(e) => e.stopPropagation()} // a click on a panel must not fall through to the roof behind it
        onPointerDown={(e) => { if (e.instanceId !== undefined && ids[e.instanceId]) onPointerDown(ids[e.instanceId]!, e); }}>
        <boxGeometry args={[0.96, 0.97, 1.05]} /><meshStandardMaterial color="#ffffff" roughness={glossy ? 0.15 : 0.7} metalness={glossy ? 0.55 : 0.1} />
      </instancedMesh>
    </>
  );
}

function Panels({ config, selectedIds, errorIds, onPointerDown }: { config: DesignConfig; selectedIds: Set<string>; errorIds: Set<string>; onPointerDown: (id: string, e: ThreeEvent<PointerEvent>) => void }) {
  const groups = useMemo(() => {
    const secs = new Map(config.roofSections.map((s) => [s.id, s]));
    const secM = new Map(config.roofSections.map((s) => [s.id, sectionMatrix(s)]));
    const byType = new Map<string, { matrices: THREE.Matrix4[]; ids: string[]; colors: THREE.Color[] }>();
    const base = new THREE.Color(config.appearance.panelColor);
    const bad = new THREE.Color('#ef4444');
    const sel = new THREE.Color('#22c55e');
    for (const p of config.panels) {
      const t = config.panelTypes.find((x) => x.id === p.typeId);
      const s = secs.get(p.sectionId);
      if (!t || !s) continue;
      const portrait = p.orientation === 'PORTRAIT';
      const w = portrait ? t.widthM : t.lengthM;
      const fullH = portrait ? t.lengthM : t.widthM;
      const tilt = (p.tiltDeg * Math.PI) / 180;
      const footH = fullH * Math.cos(tilt);
      // local: move to centre, rotate in plane, pivot about the lower edge for rack tilt, lift slightly above the roof
      const m = new THREE.Matrix4().copy(secM.get(p.sectionId)!)
        .multiply(new THREE.Matrix4().makeTranslation(p.x, p.y, 0.05))
        .multiply(new THREE.Matrix4().makeRotationZ((p.rotationDeg * Math.PI) / 180))
        .multiply(new THREE.Matrix4().makeTranslation(0, -footH / 2, 0))
        .multiply(new THREE.Matrix4().makeRotationX(tilt))
        .multiply(new THREE.Matrix4().makeTranslation(0, fullH / 2, PANEL_THICK / 2))
        .multiply(new THREE.Matrix4().makeScale(w, fullH, PANEL_THICK));
      const g = byType.get(t.id) ?? byType.set(t.id, { matrices: [], ids: [], colors: [] }).get(t.id)!;
      g.matrices.push(m); g.ids.push(p.id);
      g.colors.push(selectedIds.has(p.id) ? sel : errorIds.has(p.id) ? bad : (t.color ? new THREE.Color(t.color) : base));
    }
    return [...byType.entries()].map(([typeId, g]) => ({ type: config.panelTypes.find((t) => t.id === typeId)!, ...g }));
  }, [config.panels, config.panelTypes, config.roofSections, config.appearance.panelColor, selectedIds, errorIds]);
  return <>{groups.map((g) => <PanelInstances key={g.type.id} config={config} {...g} onPointerDown={onPointerDown} />)}</>;
}

function Dimensions({ config }: { config: DesignConfig }) {
  const u = useUnits();
  const g = useMemo(() => generateBuilding(config.building), [config.building]);
  const fp = g.footprint;
  const y = 0.1;
  const label = (text: string) => <Html center distanceFactor={14} style={{ pointerEvents: 'none' }}><div className="whitespace-nowrap rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-medium text-ink shadow">{text}</div></Html>;
  const mid = (a: { x: number; y: number }, b: { x: number; y: number }): [number, number, number] => [(a.x + b.x) / 2, y, (a.y + b.y) / 2];
  const corner = fp[3]!;
  return (
    <group>
      <Line points={[[fp[0]!.x, y, fp[0]!.y], [fp[1]!.x, y, fp[1]!.y]]} color="#0f2a43" lineWidth={2} />
      <Line points={[[fp[1]!.x, y, fp[1]!.y], [fp[2]!.x, y, fp[2]!.y]]} color="#0f2a43" lineWidth={2} />
      <Line points={[[corner.x, 0, corner.y], [corner.x, g.eaveHeightM, corner.y]]} color="#0f2a43" lineWidth={2} />
      <group position={mid(fp[0]!, fp[1]!)}>{label(`Length ${u.fmt(config.building.lengthM, 1)}`)}</group>
      <group position={mid(fp[1]!, fp[2]!)}>{label(`Width ${u.fmt(config.building.widthM, 1)}`)}</group>
      <group position={[corner.x, g.eaveHeightM / 2, corner.y]}>{label(`Eave ${u.fmt(g.eaveHeightM, 1)}`)}</group>
      {g.ridgeHeightM > g.eaveHeightM + 0.01 && <group position={[0, g.ridgeHeightM + 0.5, 0]}>{label(`Ridge ${u.fmt(g.ridgeHeightM, 1)}`)}</group>}
    </group>
  );
}

function Equipment({ config }: { config: DesignConfig }) {
  const select = useDesign((s) => s.setSelection);
  return (
    <>
      {config.equipment.map((e) => (
        <group key={e.id} position={[e.x, e.heightM / 2, e.y]}>
          <mesh castShadow onClick={(ev) => { ev.stopPropagation(); select({ kind: 'equipment', ids: [e.id] }); }}><boxGeometry args={[e.widthM, e.heightM, e.depthM]} /><meshStandardMaterial color={e.kind === 'INVERTER' ? '#10b981' : e.kind === 'BATTERY' ? '#6366f1' : '#94a3b8'} roughness={0.5} /></mesh>
          <Html position={[0, e.heightM / 2 + 0.25, 0]} center distanceFactor={14} style={{ pointerEvents: 'none' }}><div className="whitespace-nowrap rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-medium shadow">{e.label || e.kind}</div></Html>
        </group>
      ))}
    </>
  );
}

function CameraRig({ view, nonce, radius, height }: { view: ViewPreset; nonce: number; radius: number; height: number }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    const r = radius;
    const pos: Record<ViewPreset, [number, number, number]> = {
      perspective: [r * 0.95, r * 0.75 + height, r * 0.95], top: [0, r * 1.9 + height, 0.001], front: [0, height * 0.6 + 2, r * 1.7], side: [r * 1.7, height * 0.6 + 2, 0],
    };
    camera.position.set(...pos[view]);
    camera.up.set(0, 1, 0);
    const c = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    if (c) { c.target.set(0, Math.max(0, height * 0.4), 0); c.update(); } else camera.lookAt(0, height * 0.4, 0);
  }, [view, nonce, radius, height, camera, controls]);
  return null;
}

function Capture({ apiRef }: { apiRef: React.MutableRefObject<SceneApi | null> }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    // Dev/test hook: project a point on a roof section to page coordinates so browser tests can click and drag panels.
    if (import.meta.env.DEV) {
      (window as unknown as { __scene3d?: unknown }).__scene3d = {
        project: (sectionId: string, u: number, v: number) => {
          const sec = useDesign.getState().config?.roofSections.find((x) => x.id === sectionId);
          if (!sec) return null;
          const p = new THREE.Vector3(u, v, 0.07).applyMatrix4(sectionMatrix(sec)).project(camera);
          const r = gl.domElement.getBoundingClientRect();
          return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
        },
      };
    }
    apiRef.current = { capture: () => { gl.render(scene, camera); return gl.domElement.toDataURL('image/png'); } };
    return () => { apiRef.current = null; };
  }, [gl, scene, camera, apiRef]);
  return null;
}

export function Scene3D({ view, viewNonce, toggles, apiRef }: { view: ViewPreset; viewNonce: number; toggles: SceneToggles; apiRef: React.MutableRefObject<SceneApi | null> }) {
  const config = useDesign((s) => s.config)!;
  const selection = useDesign((s) => s.selection);
  const analysis = useAnalysis();
  const can = useAuth((s) => s.can)('design:edit');
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: string; sectionId: string } | null>(null);
  const g = useMemo(() => generateBuilding(config.building), [config.building]);
  const radius = Math.max(config.building.lengthM, config.building.widthM, g.ridgeHeightM) * 1.2 + 6;
  const selectedIds = useMemo(() => new Set(selection?.kind === 'panel' ? selection.ids : []), [selection]);
  const errorIds = analysis!.report.errorIds;
  const st = useDesign;

  useEffect(() => {
    const up = () => { drag.current = null; setDragging(false); };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const onPanelDown = (id: string, e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const p = st.getState().config?.panels.find((x) => x.id === id);
    if (!p) return;
    const additive = e.shiftKey && st.getState().selection?.kind === 'panel';
    st.getState().setSelection({ kind: 'panel', ids: additive ? [...new Set([...st.getState().selection!.ids, id])] : [id] });
    st.getState().setActiveSection(p.sectionId);
    if (can) { st.getState().beginTransient(); drag.current = { id, sectionId: p.sectionId }; setDragging(true); }
  };
  const onRoofMove = (s: RoofSection, e: ThreeEvent<PointerEvent>) => {
    const d = drag.current;
    if (!d || d.sectionId !== s.id) return;
    e.stopPropagation();
    const inv = sectionMatrix(s).invert();
    const local = e.point.clone().applyMatrix4(inv);
    const step = st.getState().snapStep;
    const x = snap(local.x, step);
    const y = snap(local.y, step);
    st.getState().transient((c) => ({ ...c, panels: c.panels.map((q) => (q.id === d.id ? { ...q, x, y } : q)) }));
  };
  void planToLocal;

  return (
    <Canvas shadows dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true }} camera={{ fov: 45, near: 0.1, far: 5000, position: [radius, radius * 0.8, radius] }} onPointerMissed={() => st.getState().setSelection(null)}>
      <color attach="background" args={['#e8eef5']} />
      <ambientLight intensity={0.65} />
      <directionalLight position={[radius, radius * 1.6, radius * 0.6]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.04} shadow-camera-left={-radius * 1.5} shadow-camera-right={radius * 1.5} shadow-camera-top={radius * 1.5} shadow-camera-bottom={-radius * 1.5} shadow-camera-far={radius * 6} />
      <hemisphereLight args={['#ffffff', '#cbd5e1', 0.35]} />
      <Suspense fallback={null}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow><circleGeometry args={[radius * 6, 64]} /><meshStandardMaterial color="#dbe4ee" roughness={1} /></mesh>
        <Grid position={[0, -0.01, 0]} args={[200, 200]} cellSize={1} cellThickness={0.5} cellColor="#b6c3d1" sectionSize={5} sectionThickness={1} sectionColor="#94a3b8" fadeDistance={radius * 4} infiniteGrid />
        {toggles.building && <Walls config={config} />}
        <Roofs config={config} showRoof={toggles.roof} showObstacles={toggles.obstacles} onPick={(id) => { st.getState().setActiveSection(id); st.getState().setSelection({ kind: 'section', ids: [id] }); }} onMove={onRoofMove} />
        {toggles.panels && <Panels config={config} selectedIds={selectedIds} errorIds={errorIds} onPointerDown={onPanelDown} />}
        {toggles.equipment && <Equipment config={config} />}
        {toggles.dimensions && <Dimensions config={config} />}
      </Suspense>
      <OrbitControls makeDefault enabled={!dragging} enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2 - 0.01} minDistance={2} maxDistance={radius * 6} />
      <CameraRig view={view} nonce={viewNonce} radius={radius} height={g.ridgeHeightM} />
      <Capture apiRef={apiRef} />
    </Canvas>
  );
}
