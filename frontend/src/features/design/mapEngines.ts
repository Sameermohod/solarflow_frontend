import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLon } from '@solarflow/shared';

export type Base = 'sat' | 'street';
export interface DrawState { ring: LatLon[]; vertices: boolean; rect: LatLon[] | null }
export interface MapEngine {
  kind: 'google' | 'osm';
  setView(p: LatLon, zoom: number): void;
  setBase(b: Base): void;
  draw(s: DrawState): void;
  resize(): void;
  destroy(): void;
  /** Address search appropriate to this engine. */
  geocode(q: string): Promise<{ places: { name: string; lat: number; lon: number }[]; note?: string }>;
}
export interface EngineInit { center: LatLon | null; onClick: (p: LatLon) => void }

async function nominatim(q: string) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error(`Address search failed (${r.status}). Try again in a moment.`);
  const j = (await r.json()) as { display_name: string; lat: string; lon: string }[];
  return j.map((x) => ({ name: x.display_name, lat: Number(x.lat), lon: Number(x.lon) }));
}

/* ------------------------------------------------------------------ Leaflet + OpenStreetMap / Esri */

export function createLeafletEngine(el: HTMLElement, init: EngineInit): MapEngine {
  const m = L.map(el, { center: init.center ? [init.center.lat, init.center.lon] : [20, 10], zoom: init.center ? 19 : 2, maxZoom: 20 });
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' });
  const street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, attribution: '© OpenStreetMap contributors' });
  sat.addTo(m);
  const group = L.layerGroup().addTo(m);
  m.on('click', (e: L.LeafletMouseEvent) => init.onClick({ lat: e.latlng.lat, lon: e.latlng.lng }));
  const ll = (p: LatLon): L.LatLngTuple => [p.lat, p.lon];
  setTimeout(() => m.invalidateSize(), 150);
  return {
    kind: 'osm',
    setView: (p, z) => m.setView([p.lat, p.lon], z),
    setBase: (b) => { if (b === 'sat') { m.removeLayer(street); sat.addTo(m); } else { m.removeLayer(sat); street.addTo(m); } },
    draw: ({ ring, vertices, rect }) => {
      group.clearLayers();
      if (ring.length >= 3) L.polygon(ring.map(ll), { color: '#f59e0b', weight: 2, fillOpacity: 0.15 }).addTo(group);
      else if (ring.length > 1) L.polyline(ring.map(ll), { color: '#f59e0b', weight: 2 }).addTo(group);
      if (vertices) ring.forEach((p) => L.circleMarker(ll(p), { radius: 4, color: '#f59e0b', fillColor: '#fff', fillOpacity: 1, weight: 2 }).addTo(group));
      if (rect) L.polygon(rect.map(ll), { color: '#38bdf8', weight: 2, dashArray: '6 4', fill: false }).addTo(group);
    },
    resize: () => m.invalidateSize(),
    destroy: () => m.remove(),
    geocode: async (q) => ({ places: await nominatim(q) }),
  };
}

/* ------------------------------------------------------------------ Google Maps JavaScript API */

let gmapsPromise: Promise<void> | null = null;

/** Loads the Maps JavaScript API once. Rejects when the script fails or the key is refused. */
export function loadGoogleMaps(key: string): Promise<void> {
  if (typeof google !== 'undefined' && google.maps?.Map) return Promise.resolve();
  if (gmapsPromise) return gmapsPromise;
  gmapsPromise = new Promise<void>((resolve, reject) => {
    const w = window as unknown as { __gmapsReady?: () => void; gm_authFailure?: () => void };
    const fail = (msg: string) => { gmapsPromise = null; reject(new Error(msg)); };
    w.__gmapsReady = () => resolve();
    w.gm_authFailure = () => fail('Google rejected the Maps key (check that the Maps JavaScript API is enabled and the key allows this site).');
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__gmapsReady&loading=async&v=weekly`;
    s.async = true;
    s.onerror = () => { s.remove(); fail('Could not load Google Maps (network blocked?).'); };
    document.head.appendChild(s);
    setTimeout(() => { if (!(typeof google !== 'undefined' && google.maps?.Map)) fail('Google Maps did not load in time.'); }, 15000);
  });
  return gmapsPromise;
}

export function createGoogleEngine(el: HTMLElement, init: EngineInit): MapEngine {
  const map = new google.maps.Map(el, {
    center: init.center ? { lat: init.center.lat, lng: init.center.lon } : { lat: 20, lng: 10 }, zoom: init.center ? 19 : 2,
    mapTypeId: 'satellite', tilt: 0, gestureHandling: 'greedy', clickableIcons: false, streetViewControl: false, mapTypeControl: false, fullscreenControl: false, maxZoom: 21,
  });
  map.addListener('click', (e: google.maps.MapMouseEvent) => { if (e.latLng) init.onClick({ lat: e.latLng.lat(), lon: e.latLng.lng() }); });
  const shapes: { setMap(m: google.maps.Map | null): void }[] = [];
  const gl = (p: LatLon) => ({ lat: p.lat, lng: p.lon });
  let geocoder: google.maps.Geocoder | null = null;
  return {
    kind: 'google',
    setView: (p, z) => { map.setCenter(gl(p)); map.setZoom(z); },
    setBase: (b) => map.setMapTypeId(b === 'sat' ? 'satellite' : 'roadmap'),
    draw: ({ ring, vertices, rect }) => {
      shapes.splice(0).forEach((s) => s.setMap(null));
      if (ring.length >= 3) shapes.push(new google.maps.Polygon({ map, paths: ring.map(gl), strokeColor: '#f59e0b', strokeWeight: 2, fillColor: '#f59e0b', fillOpacity: 0.15, clickable: false }));
      else if (ring.length > 1) shapes.push(new google.maps.Polyline({ map, path: ring.map(gl), strokeColor: '#f59e0b', strokeWeight: 2, clickable: false }));
      if (vertices) ring.forEach((p) => shapes.push(new google.maps.Marker({ map, position: gl(p), clickable: false, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 4, strokeColor: '#f59e0b', strokeWeight: 2, fillColor: '#ffffff', fillOpacity: 1 } })));
      if (rect) shapes.push(new google.maps.Polyline({ map, path: [...rect, rect[0]!].map(gl), strokeColor: '#38bdf8', strokeOpacity: 0, clickable: false, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 }, offset: '0', repeat: '12px' }] }));
    },
    resize: () => google.maps.event.trigger(map, 'resize'),
    destroy: () => { shapes.splice(0).forEach((s) => s.setMap(null)); google.maps.event.clearInstanceListeners(map); el.innerHTML = ''; },
    geocode: async (q) => {
      try {
        geocoder ??= new google.maps.Geocoder();
        const r = await geocoder.geocode({ address: q });
        return { places: r.results.slice(0, 6).map((x) => ({ name: x.formatted_address, lat: x.geometry.location.lat(), lon: x.geometry.location.lng() })) };
      } catch (e) {
        if (/ZERO_RESULTS/.test(String(e))) return { places: [] };
        // Google's geocoder refused (commonly: billing not enabled, or the Geocoding API is not allowed for this key)
        return { places: await nominatim(q), note: 'Google address search is not available for this key (enable billing and the Geocoding API in Google Cloud); OpenStreetMap search was used instead.' };
      }
    },
  };
}
