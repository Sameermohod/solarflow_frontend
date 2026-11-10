import { useDesign } from './store';

/** Everything is stored in metres; the UI can show feet. */
export const FT = 3.280839895;

export interface Units {
  system: 'METRIC' | 'IMPERIAL';
  len: 'm' | 'ft';
  area: 'm²' | 'ft²';
  toDisplay: (m: number) => number;
  fromDisplay: (v: number) => number;
  fmt: (m: number, dp?: number) => string;
  fmtArea: (m2: number, dp?: number) => string;
}

export function makeUnits(system: 'METRIC' | 'IMPERIAL'): Units {
  const imp = system === 'IMPERIAL';
  const k = imp ? FT : 1;
  return {
    system,
    len: imp ? 'ft' : 'm',
    area: imp ? 'ft²' : 'm²',
    toDisplay: (m) => m * k,
    fromDisplay: (v) => v / k,
    fmt: (m, dp = 2) => `${(m * k).toFixed(dp)} ${imp ? 'ft' : 'm'}`,
    fmtArea: (m2, dp = 1) => `${(m2 * k * k).toFixed(dp)} ${imp ? 'ft²' : 'm²'}`,
  };
}

export function useUnits(): Units {
  const system = useDesign((s) => s.config?.units ?? 'METRIC');
  return makeUnits(system);
}
