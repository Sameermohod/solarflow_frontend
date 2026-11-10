import { useEffect, useMemo, useRef, useState } from 'react';
import { ROOF_TYPES, ROOF_TYPE_LABELS, fromPlanMetres, measureOutline, osmFloors, parseOverpassBuildings, pickBuilding, type LatLon, type RoofType } from '@solarflow/shared';
import { Button, ErrorNote, Field, Input, Modal, Select } from '@/components/ui';
import { useDesign } from './store';
import { createGoogleEngine, createLeafletEngine, loadGoogleMaps, type Base, type MapEngine } from './mapEngines';

interface Place { name: string; lat: number; lon: number }

async function buildingsAround(p: LatLon) {
  const query = `[out:json][timeout:20];way(around:40,${p.lat},${p.lon})["building"];out tags geom;`;
  const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(query)}` });
  if (!r.ok) throw new Error(`Building lookup failed (${r.status}). Try again, or trace the roof by hand.`);
  return parseOverpassBuildings(await r.json());
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const GOOGLE_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() || '';

/**
 * Find the site on a map, pick or trace the roof and size the building from it. Uses Google Maps when a key is
 * configured (VITE_GOOGLE_MAPS_API_KEY) and falls back to free OpenStreetMap / Esri imagery otherwise or on failure.
 */
export function SiteMapModal({ onClose }: { onClose: () => void }) {
  const config = useDesign((s) => s.config)!;
  const mapEl = useRef<HTMLDivElement>(null);
  const engine = useRef<MapEngine | null>(null);
  const [engineKind, setEngineKind] = useState<'google' | 'osm' | null>(null);
  const modeRef = useRef<'pick' | 'trace'>('pick');
  const [mode, setMode] = useState<'pick' | 'trace'>('pick');
  const [base, setBase] = useState<Base>('sat');
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [address, setAddress] = useState(config.meta.site?.address ?? '');
  const [ring, setRing] = useState<LatLon[]>([]);
  const [source, setSource] = useState<'OSM_BUILDING' | 'TRACED' | null>(null);
  const [tags, setTags] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [info, setInfo] = useState('');
  const [floors, setFloors] = useState(String(config.building.floors));
  const [roofType, setRoofType] = useState<RoofType>(config.building.roofType);
  const [roofAngle, setRoofAngle] = useState(String(config.building.roofAngleDeg));
  const [clearPanels, setClearPanels] = useState(true);
  const [arrange, setArrange] = useState(true);

  modeRef.current = mode;
  const measured = useMemo(() => (ring.length >= 3 ? measureOutline(ring) : null), [ring]);

  // map setup: Google when a key is set, otherwise (or if Google fails) the free OpenStreetMap / Esri map
  useEffect(() => {
    const el = mapEl.current;
    if (!el) return;
    let cancelled = false;
    const site = config.meta.site;
    const init = { center: site ? { lat: site.latitude, lon: site.longitude } : null, onClick: (pt: LatLon) => { void onMapClick(pt); } };
    (async () => {
      let e: MapEngine | null = null;
      if (GOOGLE_KEY) {
        try { await loadGoogleMaps(GOOGLE_KEY); if (!cancelled) e = createGoogleEngine(el, init); }
        catch (x) { if (!cancelled) setInfo(`${x instanceof Error ? x.message : 'Google Maps failed'} Using the free OpenStreetMap map instead.`); }
      }
      if (cancelled) return;
      if (!e) { el.innerHTML = ''; e = createLeafletEngine(el, init); }
      engine.current = e; setEngineKind(e.kind);
    })();
    return () => { cancelled = true; engine.current?.destroy(); engine.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { engine.current?.setBase(base); }, [base, engineKind]);

  // redraw outline, vertices and the rectangle the designer will use
  useEffect(() => {
    engine.current?.draw({ ring, vertices: source === 'TRACED', rect: measured ? fromPlanMetres(measured.rect.corners, measured.origin) : null });
  }, [ring, measured, source, engineKind]);

  const onMapClick = async (p: LatLon) => {
    if (modeRef.current === 'trace') {
      setSource('TRACED'); setTags({}); setInfo('');
      setRing((r) => (sourceRef.current === 'OSM_BUILDING' || sourceRef.current === null ? [...(sourceRef.current === 'OSM_BUILDING' ? [] : r), p] : [...r, p]));
      return;
    }
    setBusy(true); setErr(null); setInfo('');
    try {
      const found = pickBuilding(await buildingsAround(p), p);
      if (!found) { setInfo('No building is mapped at that point in OpenStreetMap. Choose "Trace the roof" and click its corners instead.'); return; }
      setRing(found.building.ring); setSource('OSM_BUILDING'); setTags(found.building.tags);
      const f = osmFloors(found.building.tags); if (f) setFloors(String(f));
      setInfo(found.inside ? 'Building outline loaded from OpenStreetMap.' : `Nearest mapped building (${Math.round(found.distanceM)} m from the click) loaded.`);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const sourceRef = useRef(source); sourceRef.current = source;

  const search = async () => {
    if (!query.trim()) return;
    setBusy(true); setErr(null); setPlaces([]);
    try {
      const r = await engine.current!.geocode(query.trim());
      setInfo(r.places.length ? r.note ?? '' : 'No match for that address. Try a simpler or more general search.');
      setPlaces(r.places);
    } catch (e) {
      if (/ZERO_RESULTS/.test(String(e))) setInfo('No match for that address. Try a simpler or more general search.'); else setErr(e);
    } finally { setBusy(false); }
  };
  const goTo = (p: Place) => { engine.current?.setView({ lat: p.lat, lon: p.lon }, 19); setAddress(p.name); setPlaces([]); };

  const problems: string[] = [];
  const fl = Number(floors); const ang = Number(roofAngle);
  if (measured) {
    if (measured.rect.lengthM < 1 || measured.rect.widthM < 1) problems.push('The outline is smaller than 1 m on a side.');
    if (measured.rect.lengthM > 500) problems.push('The outline is larger than 500 m; the designer supports buildings up to 500 m.');
  }
  if (!(Number.isInteger(fl) && fl >= 1 && fl <= 100)) problems.push('Floors must be a whole number from 1 to 100.');
  if (roofType !== 'FLAT' && !(ang > 0 && ang <= 60)) problems.push('Roof angle must be above 0° and at most 60°.');

  const apply = () => {
    if (!measured || problems.length) return;
    const st = useDesign.getState();
    const panelsBefore = st.config!.panels.length;
    st.updateBuilding({ lengthM: r1(measured.rect.lengthM), widthM: r1(measured.rect.widthM), orientationDeg: r1(measured.rect.orientationDeg), floors: fl, roofType, roofAngleDeg: roofType === 'FLAT' ? 0 : ang });
    if (clearPanels && panelsBefore) st.clearPanels();
    st.commit((c) => ({ ...c, meta: { ...c.meta, site: { latitude: r1(measured.centre.lat * 1e5) / 1e5, longitude: r1(measured.centre.lon * 1e5) / 1e5, address: address || undefined, source: source ?? 'TRACED', footprintAreaM2: r1(measured.areaM2) } } }));
    if (arrange && (clearPanels || panelsBefore === 0)) for (const s of useDesign.getState().config!.roofSections) st.autoArrange(s.id);
    onClose();
  };

  const panelsNow = config.panels.length;
  return (
    <Modal open wide title="Site map: place the building" onClose={onClose}>
      <p className="mb-3 text-sm text-ink-muted">
        Search the address, then click the building to load its outline from OpenStreetMap, or choose Trace and click the roof corners on the satellite image. The building length, width and orientation come from the outline; floors, roof type and angle are yours to set (a flat map cannot show height or pitch).
      </p>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          <form className="mb-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(); }}>
            <Input aria-label="Address or place" placeholder="Address, city or landmark" value={query} onChange={(e) => setQuery(e.target.value)} />
            <Button type="submit" variant="outline" loading={busy} disabled={!query.trim()}>Search</Button>
          </form>
          {places.length > 0 && (
            <ul className="mb-2 max-h-32 overflow-y-auto rounded-lg border border-surface-line bg-white text-sm">
              {places.map((p) => <li key={`${p.lat},${p.lon}`}><button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-surface-alt" onClick={() => goTo(p)}>{p.name}</button></li>)}
            </ul>
          )}
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <div role="group" aria-label="Click action" className="inline-flex overflow-hidden rounded-lg border border-surface-line">
              <button type="button" aria-pressed={mode === 'pick'} className={`px-3 py-1.5 ${mode === 'pick' ? 'bg-brand text-white' : 'bg-white'}`} onClick={() => setMode('pick')}>Pick building</button>
              <button type="button" aria-pressed={mode === 'trace'} className={`px-3 py-1.5 ${mode === 'trace' ? 'bg-brand text-white' : 'bg-white'}`} onClick={() => setMode('trace')}>Trace the roof</button>
            </div>
            <div role="group" aria-label="Map layer" className="inline-flex overflow-hidden rounded-lg border border-surface-line">
              <button type="button" aria-pressed={base === 'sat'} className={`px-3 py-1.5 ${base === 'sat' ? 'bg-brand text-white' : 'bg-white'}`} onClick={() => setBase('sat')}>Satellite</button>
              <button type="button" aria-pressed={base === 'street'} className={`px-3 py-1.5 ${base === 'street' ? 'bg-brand text-white' : 'bg-white'}`} onClick={() => setBase('street')}>Street</button>
            </div>
            {mode === 'trace' && source === 'TRACED' && ring.length > 0 && <>
              <Button size="sm" variant="outline" onClick={() => setRing((r) => r.slice(0, -1))}>Undo point</Button>
              <Button size="sm" variant="outline" onClick={() => { setRing([]); setSource(null); }}>Clear</Button>
            </>}
          </div>
          <div ref={mapEl} data-testid="site-map" style={{ height: 416 }} className="w-full overflow-hidden rounded-lg border border-surface-line" />
          <p className="mt-1 text-[11px] text-ink-muted">{engineKind === 'google' ? 'Map and imagery © Google. Building outlines from OpenStreetMap contributors (Overpass); address search by Google, or OpenStreetMap (Nominatim) when Google refuses it.' : "Map data © OpenStreetMap contributors (search by Nominatim, buildings by Overpass). Satellite imagery © Esri and its providers: check Esri's terms for commercial use before relying on it in production."}</p>
        </div>

        <div className="space-y-3 text-sm">
          {info && <p className="rounded bg-sky-50 px-3 py-2 text-xs text-sky-800">{info}</p>}
          <ErrorNote error={err} />
          {measured ? (
            <div className="rounded-lg border border-surface-line p-3">
              <p className="font-medium">Measured from the outline</p>
              <dl className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                <dt className="text-ink-muted">Length × width</dt><dd>{r1(measured.rect.lengthM)} × {r1(measured.rect.widthM)} m</dd>
                <dt className="text-ink-muted">Orientation</dt><dd>{r1(measured.rect.orientationDeg)}° from west–east</dd>
                <dt className="text-ink-muted">Footprint area</dt><dd>{Math.round(measured.areaM2)} m²</dd>
                <dt className="text-ink-muted">Location</dt><dd>{measured.centre.lat.toFixed(5)}, {measured.centre.lon.toFixed(5)}</dd>
                {source === 'OSM_BUILDING' && tags['building:levels'] && <><dt className="text-ink-muted">Floors (OSM)</dt><dd>{tags['building:levels']}</dd></>}
              </dl>
              {measured.rect.fill < 0.85 && <p className="mt-2 text-xs text-amber-700">The outline fills only {Math.round(measured.rect.fill * 100)} % of its bounding rectangle (dashed blue). The designer's building is a rectangle, so its roof will be the full rectangle: remove panels from missing corners with a no-go zone, or draw extra roof areas in the editor.</p>}
            </div>
          ) : <p className="rounded-lg border border-dashed border-surface-line p-3 text-xs text-ink-muted">{mode === 'pick' ? 'Click a building on the map.' : 'Click at least three roof corners.'}</p>}

          <div className="grid grid-cols-2 gap-2">
            <Field label="Floors"><Input inputMode="numeric" value={floors} onChange={(e) => setFloors(e.target.value)} /></Field>
            <Field label="Roof type"><Select value={roofType} onChange={(e) => setRoofType(e.target.value as RoofType)}>{ROOF_TYPES.map((t) => <option key={t} value={t}>{ROOF_TYPE_LABELS[t]}</option>)}</Select></Field>
            {roofType !== 'FLAT' && <Field label="Roof angle (°)"><Input inputMode="decimal" value={roofAngle} onChange={(e) => setRoofAngle(e.target.value)} /></Field>}
          </div>
          <Field label="Address saved with the design"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
          {panelsNow > 0 && <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={clearPanels} onChange={(e) => setClearPanels(e.target.checked)} />Remove the {panelsNow} placed panels (they were laid out for the old roof size)</label>}
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={arrange} disabled={panelsNow > 0 && !clearPanels} onChange={(e) => setArrange(e.target.checked)} />Fill the roof with panels automatically (setbacks and obstacle clearances apply; you can undo)</label>
          {problems.length > 0 && <ul className="list-disc pl-5 text-xs text-amber-700">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="accent" disabled={!measured || problems.length > 0} onClick={apply}>Apply to design</Button>
      </div>
    </Modal>
  );
}
