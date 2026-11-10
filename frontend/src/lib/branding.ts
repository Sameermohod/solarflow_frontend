import { hexToRgbTriplet, readableOn } from './utils';

const DEFAULTS = { primaryColor: '#0f2a43', accentColor: '#16a34a' };

/** Apply a tenant's colours as CSS variables so every component re-themes without rebuilds. */
export function applyBranding(b?: { primaryColor?: string; accentColor?: string; name?: string } | null) {
  const root = document.documentElement;
  const primary = b?.primaryColor ?? DEFAULTS.primaryColor;
  const accent = b?.accentColor ?? DEFAULTS.accentColor;
  root.style.setProperty('--brand', hexToRgbTriplet(primary));
  root.style.setProperty('--brand-fg', readableOn(primary));
  root.style.setProperty('--accent', hexToRgbTriplet(accent));
  root.style.setProperty('--accent-fg', readableOn(accent));
  document.title = b?.name ? `${b.name} · SolarFlow` : 'SolarFlow';
}
