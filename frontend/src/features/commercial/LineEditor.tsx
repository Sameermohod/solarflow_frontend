import { Plus, Trash2 } from 'lucide-react';
import { computeDocument } from '@solarflow/shared';
import { Button, Input, Select, Table, Td, Th } from '@/components/ui';
import { Notice } from '@/components/ui/extra';
import { useCatalogue, useCommercialOptions, useMoney2, type DocItem, type Totals } from './api';

export const blankItem = (): DocItem => ({ equipmentId: null, description: '', unit: 'nos', quantity: '1', unitCost: '0', unitPrice: '', discountPct: '0', taxRateCode: null, hsnCode: null });

/** Rows as the API expects them (numbers), from the editor's string fields. */
export const toPayload = (items: DocItem[]) => items.map((i) => ({
  equipmentId: i.equipmentId, description: i.description.trim(), unit: i.unit || 'nos', quantity: Number(i.quantity), unitCost: Number(i.unitCost ?? 0), unitPrice: Number(i.unitPrice),
  discountPct: Number(i.discountPct || 0), taxRateCode: i.taxRateCode || null, hsnCode: i.hsnCode || null,
}));

/** Why the lines cannot be saved yet, or null. */
export function itemsProblem(items: DocItem[]): string | null {
  if (!items.length) return 'Add at least one line.';
  for (const [k, i] of items.entries()) {
    if (!i.description.trim()) return `Line ${k + 1} needs a description.`;
    if (!(Number(i.quantity) > 0)) return `Line ${k + 1} needs a quantity above zero.`;
    if (i.unitPrice === '' || !(Number(i.unitPrice) >= 0)) return `Line ${k + 1} needs a price.`;
    if (!(Number(i.discountPct || 0) >= 0 && Number(i.discountPct || 0) <= 100)) return `Line ${k + 1}: discount must be 0–100%.`;
  }
  return null;
}

/** Client-side preview of the totals. The server recomputes and stores the authoritative figures. */
export function usePreview(items: DocItem[]): (Totals & { margin: number | null }) | null {
  const { data: o } = useCommercialOptions();
  if (!o || itemsProblem(items)) return null;
  const rate = (c: string | null) => (c ? o.tax.rates.find((r) => r.code === c)?.rate ?? 0 : 0);
  try {
    const t = computeDocument(items.map((i) => ({ quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), discountPct: Number(i.discountPct || 0), taxPercent: rate(i.taxRateCode) })), { pricesIncludeTax: o.tax.pricesIncludeTax });
    const cost = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unitCost ?? 0), 0);
    return { subtotal: String(t.subtotal), discountTotal: String(t.discountTotal), taxTotal: String(t.taxTotal), total: String(t.total), costTotal: String(cost), margin: o.canSeeCost && cost > 0 ? t.subtotal - cost : null };
  } catch { return null; }
}

export function TotalsBox({ t, showMargin }: { t: Totals & { margin?: number | null }; showMargin?: boolean }) {
  const money = useMoney2();
  const row = (k: string, v: string, strong = false) => <div className={`flex justify-between gap-8 ${strong ? 'border-t border-surface-line pt-2 text-base font-semibold' : 'text-sm'}`}><span className="text-ink-muted">{k}</span><span className="tabular-nums">{v}</span></div>;
  return (
    <div className="ml-auto w-full max-w-xs space-y-1.5">
      {row('Subtotal (before tax)', money(t.subtotal))}
      {Number(t.discountTotal) > 0 && row('Discounts included', money(t.discountTotal))}
      {row('Tax', money(t.taxTotal))}
      {row('Total', money(t.total), true)}
      {showMargin && t.margin !== null && t.margin !== undefined && row('Margin over cost (before tax)', money(t.margin))}
    </div>
  );
}

export function LineEditor({ items, onChange, readOnly, showCost, allowCatalogue = true }: { items: DocItem[]; onChange: (i: DocItem[]) => void; readOnly?: boolean; showCost?: boolean; allowCatalogue?: boolean }) {
  const { data: o } = useCommercialOptions();
  const catalogue = useCatalogue();
  const money = useMoney2();
  const set = (k: number, patch: Partial<DocItem>) => onChange(items.map((x, i) => (i === k ? { ...x, ...patch } : x)));
  const rates = o?.tax.rates ?? [];
  const unknownCode = (i: DocItem) => !!i.taxRateCode && !rates.some((r) => r.code === i.taxRateCode);
  const addFromCatalogue = (id: string) => {
    const e = catalogue.data?.find((x) => x.id === id);
    if (!e) return;
    onChange([...items, { equipmentId: e.id, description: `${e.name} (${e.manufacturer} ${e.modelNumber})`, unit: e.unit, quantity: '1', unitCost: e.purchasePrice, unitPrice: e.sellingPrice, discountPct: '0', taxRateCode: e.taxRateCode, hsnCode: e.hsnCode }]);
  };
  const flagged = items.some(unknownCode);
  return (
    <div className="space-y-3">
      <Table>
        <thead><tr>
          <Th className="min-w-[13rem] px-2">Description</Th><Th className="w-24 px-2">Qty</Th><Th className="w-20 px-2">Unit</Th>{showCost && <Th className="w-28 px-2">Cost</Th>}<Th className="w-32 px-2">Unit price</Th><Th className="w-20 px-2">Disc %</Th><Th className="w-40 px-2">Tax</Th><Th className="w-32 px-2 text-right">Line total</Th>{!readOnly && <Th className="w-10 px-1" />}
        </tr></thead>
        <tbody>
          {items.map((i, k) => (
            <tr key={k}>
              <Td className="px-2">
                {readOnly ? <span>{i.description}</span> : <Input aria-label={`Description ${k + 1}`} value={i.description} onChange={(e) => set(k, { description: e.target.value })} />}
                {Number(i.unitPrice) === 0 && i.unitPrice !== '' && <p className="mt-0.5 text-xs text-yellow-700">No price yet</p>}
                {!i.equipmentId && !readOnly && <p className="mt-0.5 text-xs text-ink-muted">Free-text line (not linked to the catalogue)</p>}
              </Td>
              <Td className="px-2">{readOnly ? Number(i.quantity) : <Input aria-label={`Quantity ${k + 1}`} inputMode="decimal" value={i.quantity} onChange={(e) => set(k, { quantity: e.target.value })} />}</Td>
              <Td className="px-2">{readOnly ? i.unit : <Input aria-label={`Unit ${k + 1}`} value={i.unit} onChange={(e) => set(k, { unit: e.target.value })} />}</Td>
              {showCost && <Td className="px-2">{readOnly ? money(i.unitCost) : <Input aria-label={`Cost ${k + 1}`} inputMode="decimal" value={i.unitCost ?? ''} onChange={(e) => set(k, { unitCost: e.target.value })} />}</Td>}
              <Td className="px-2">{readOnly ? money(i.unitPrice) : <Input aria-label={`Unit price ${k + 1}`} inputMode="decimal" value={i.unitPrice} onChange={(e) => set(k, { unitPrice: e.target.value })} />}</Td>
              <Td className="px-2">{readOnly ? `${Number(i.discountPct)}%` : <Input aria-label={`Discount ${k + 1}`} inputMode="decimal" value={i.discountPct} onChange={(e) => set(k, { discountPct: e.target.value })} />}</Td>
              <Td className="px-2">
                {readOnly ? (i.taxPercent !== undefined ? `${Number(i.taxPercent)}%` : (i.taxRateCode ?? 'None')) : (
                  <Select aria-label={`Tax ${k + 1}`} value={i.taxRateCode ?? ''} onChange={(e) => set(k, { taxRateCode: e.target.value || null })}>
                    <option value="">No tax</option>
                    {unknownCode(i) && <option value={i.taxRateCode!}>{i.taxRateCode} (not in settings)</option>}
                    {rates.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </Select>
                )}
              </Td>
              <Td className="px-2 text-right tabular-nums">{i.lineTotal !== undefined ? money(i.lineTotal) : '—'}</Td>
              {!readOnly && <Td className="px-2"><Button variant="ghost" size="sm" aria-label={`Remove line ${k + 1}`} onClick={() => onChange(items.filter((_, x) => x !== k))}><Trash2 className="h-4 w-4" /></Button></Td>}
            </tr>
          ))}
          {!items.length && <tr><td className="px-4 py-6 text-center text-ink-muted" colSpan={9}>No lines yet.</td></tr>}
        </tbody>
      </Table>
      {flagged && <Notice tone="warn">A line uses a tax code that is not in your tax settings. Pick another before saving.</Notice>}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onChange([...items, blankItem()])}><Plus className="h-4 w-4" />Add free-text line</Button>
          {allowCatalogue && (
            <Select aria-label="Add from catalogue" className="max-w-xs" value="" onChange={(e) => addFromCatalogue(e.target.value)}>
              <option value="">Add from catalogue…</option>
              {catalogue.data?.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.manufacturer} {e.modelNumber})</option>)}
            </Select>
          )}
        </div>
      )}
    </div>
  );
}
