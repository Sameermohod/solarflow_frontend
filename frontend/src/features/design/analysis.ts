import { useMemo } from 'react';
import { summarizeDesign, validateLayout } from '@solarflow/shared';
import { useDesign } from './store';

/** Live validation + totals for the current (possibly unsaved) config. Recomputed only when the config changes. */
export function useAnalysis() {
  const config = useDesign((s) => s.config);
  return useMemo(() => {
    if (!config) return null;
    const report = validateLayout(config);
    return { report, summary: summarizeDesign(config, report) };
  }, [config]);
}
