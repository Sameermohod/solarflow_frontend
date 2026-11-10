/**
 * Mounting-structure (fabrication) drawing generator.
 *
 * Input: panel size, array layout and the fabricator's section sizes and dimensions. Output: a part list with
 * lengths and quantities and an A3 drawing sheet (isometric, side view, front view, two details, parts table and
 * title block) as SVG. Everything is derived from the inputs by plain geometry; nothing is looked up or assumed
 * silently: every optional input left blank is auto-filled by a stated rule and flagged "calculated" in the parts list.
 *
 * This is a drafting aid. It does NOT check wind/snow load, member strength, connections or foundations; the
 * structure must be verified by a qualified engineer / the fabricator before anything is cut.
 *
 * Model frame (mm): side view y = horizontal toward the low (front) side, z = up. Front view x = across the array.
 * The tall (back) column stands at y = 0; the rafter descends toward the front at the tilt angle.
 */

export interface SectionSpec { profile: string; material: string }

export interface StructureSpec {
  title: string;
  panelLengthMm: number; panelWidthMm: number; panelThicknessMm: number;
  /** Panels along the slope (rows) and across the array. */
  panelsAlongSlope: number; panelsAcross: number; panelGapMm: number;
  tiltDeg: number;
  frames: number;
  /** frames − 1 distances between frames; null = equal spacing over the array width. */
  frameSpacingsMm: number[] | null;
  backColumnMm: number;
  /** null = whatever puts the rafter on the front column at the tilt. */
  frontColumnMm: number | null;
  /** Horizontal distance between the two columns of a frame; null = half the rafter's horizontal run. */
  columnSpanMm: number | null;
  rafterLengthMm: number | null;
  /** Rafter length behind the back column, along the slope; null = rafter centred on the columns. */
  rafterBackOverhangMm: number | null;
  /** Distance between the two purlins under one panel; null = 60 % of the panel length. */
  purlinSpacingMm: number | null;
  /** Purlin lengths laid end to end (e.g. a stock-length split); null = one piece. */
  purlinPieces: number[] | null;
  purlinOverhangMm: number;
  horizontalSupportHeightMm: number | null;
  walkway: boolean;
  walkwayLength1Mm: number | null;
  walkwayLength2Mm: number | null;
  column: SectionSpec; rafter: SectionSpec; purlin: SectionSpec; horizontal: SectionSpec; walkway1: SectionSpec; walkway2: SectionSpec;
  basePlateMm: number; basePlateThicknessMm: number; basePlateMaterial: string;
  stiffenersPerBase: number; stiffenerLengthMm: number; stiffenerWidthMm: number; stiffenerThicknessMm: number; stiffenerMaterial: string;
}

export interface StructurePart { no: number; name: string; profile: string; material: string; lengthMm: number; thicknessMm: number; qty: number; calculated: boolean }

export interface StructureGeometry {
  tiltDeg: number; arrayAlongMm: number; arrayWidthMm: number; spanMm: number; rafterLengthMm: number; backOverhangMm: number;
  frontColumnMm: number; impliedFrontColumnMm: number; frameX: number[]; frameSpacingsMm: number[];
  purlinSpacingMm: number; purlinPieces: number[]; purlinS: number[]; panelS0: number; hsHeightMm: number; walkway1Mm: number; walkway2Mm: number;
  frontOverhangHorizontalMm: number; backOverhangHorizontalMm: number; panelCount: number;
}

export type BuiltStructure =
  | { ok: false; problems: string[] }
  | { ok: true; spec: StructureSpec; geometry: StructureGeometry; parts: StructurePart[]; warnings: string[] };

const rad = (d: number) => (d * Math.PI) / 180;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r0 = (n: number) => Math.round(n);

/** Numbers inside a profile name, e.g. "C-LIP 140X80X15X2" -> [140, 80, 15, 2]. */
export function profileNumbers(profile: string): number[] {
  return (profile.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}
const isHat = (p: string) => /^\s*hat/i.test(p);
/** Depth of a section as seen from the side (height above the member below it). */
export const sectionDepth = (p: string) => { const n = profileNumbers(p); return isHat(p) ? n[1] ?? 40 : n[0] ?? 100; };
/** Width of a section across its depth. */
export const sectionWidth = (p: string) => { const n = profileNumbers(p); return isHat(p) ? n[0] ?? 70 : n[1] ?? 50; };
/** Thickness = last number in the profile name (matches the part-list convention of the sample drawing). */
export const sectionThickness = (p: string) => { const n = profileNumbers(p); return n.length ? n[n.length - 1]! : 0; };

const section = (profile: string, material: string): SectionSpec => ({ profile, material });

/** Starting points. Preset 1 reproduces the sample drawing; 2 and 3 are templates: replace sizes with your fabricator's. */
export const STRUCTURE_PRESETS: { id: string; label: string; note: string; spec: StructureSpec }[] = [
  {
    id: 'walkway-10',
    label: 'Elevated table with walkway, 10 panels (sample drawing)',
    note: 'Reproduces the "5KW with walkway" sample: 2 × 5 panels of 2382 × 1133 × 35, three frames, walkway channels on the horizontal supports.',
    spec: {
      title: 'SOLAR STRUCTURE 6FT-8FT',
      panelLengthMm: 2382, panelWidthMm: 1133, panelThicknessMm: 35, panelsAlongSlope: 2, panelsAcross: 5, panelGapMm: 20, tiltDeg: 10.35,
      frames: 3, frameSpacingsMm: [2289, 2310], backColumnMm: 2400, frontColumnMm: 2000, columnSpanMm: 2330,
      rafterLengthMm: 4500, rafterBackOverhangMm: 663, purlinSpacingMm: 1400, purlinPieces: [2500, 3655], purlinOverhangMm: 0,
      horizontalSupportHeightMm: 1150, walkway: true, walkwayLength1Mm: 2350, walkwayLength2Mm: 2370,
      column: section('C-LIP 140X80X15X2', 'HDG'), rafter: section('C-LIP 100X48X15X2', 'HDG'), purlin: section('HAT 70X40X25X10X0.9', 'GALVALUME'),
      horizontal: section('C-LIP 100X48X15X2', 'HDG'), walkway1: section('C-LIP 100X40X15X2', 'PRE-GALVA'), walkway2: section('C-LIP 90X30X15X2', 'PRE-GALVA'),
      basePlateMm: 250, basePlateThicknessMm: 5, basePlateMaterial: 'HDG',
      stiffenersPerBase: 3, stiffenerLengthMm: 70, stiffenerWidthMm: 60, stiffenerThicknessMm: 10, stiffenerMaterial: 'HDG',
    },
  },
  {
    id: 'elevated-10',
    label: 'Elevated table, 10 panels, no walkway (template)',
    note: 'Same section set as the sample, no walkway channels. Lengths are calculated from the geometry; confirm sizes with your engineer.',
    spec: {
      title: 'SOLAR STRUCTURE 6FT-8FT',
      panelLengthMm: 2382, panelWidthMm: 1133, panelThicknessMm: 35, panelsAlongSlope: 2, panelsAcross: 5, panelGapMm: 20, tiltDeg: 10,
      frames: 3, frameSpacingsMm: null, backColumnMm: 2400, frontColumnMm: null, columnSpanMm: null,
      rafterLengthMm: null, rafterBackOverhangMm: null, purlinSpacingMm: null, purlinPieces: null, purlinOverhangMm: 100,
      horizontalSupportHeightMm: null, walkway: false, walkwayLength1Mm: null, walkwayLength2Mm: null,
      column: section('C-LIP 140X80X15X2', 'HDG'), rafter: section('C-LIP 100X48X15X2', 'HDG'), purlin: section('HAT 70X40X25X10X0.9', 'GALVALUME'),
      horizontal: section('C-LIP 100X48X15X2', 'HDG'), walkway1: section('C-LIP 100X40X15X2', 'PRE-GALVA'), walkway2: section('C-LIP 90X30X15X2', 'PRE-GALVA'),
      basePlateMm: 250, basePlateThicknessMm: 5, basePlateMaterial: 'HDG',
      stiffenersPerBase: 3, stiffenerLengthMm: 70, stiffenerWidthMm: 60, stiffenerThicknessMm: 10, stiffenerMaterial: 'HDG',
    },
  },
  {
    id: 'low-single-row',
    label: 'Low single-row ground table, 6 panels (template)',
    note: 'One panel row along the slope at 20°, 1.2 m back column. Section sizes are the sample set; this is a starting point, not a verified design.',
    spec: {
      title: 'SOLAR STRUCTURE LOW TABLE',
      panelLengthMm: 2382, panelWidthMm: 1133, panelThicknessMm: 35, panelsAlongSlope: 1, panelsAcross: 6, panelGapMm: 20, tiltDeg: 20,
      frames: 4, frameSpacingsMm: null, backColumnMm: 1200, frontColumnMm: null, columnSpanMm: null,
      rafterLengthMm: null, rafterBackOverhangMm: null, purlinSpacingMm: null, purlinPieces: null, purlinOverhangMm: 100,
      horizontalSupportHeightMm: null, walkway: false, walkwayLength1Mm: null, walkwayLength2Mm: null,
      column: section('C-LIP 140X80X15X2', 'HDG'), rafter: section('C-LIP 100X48X15X2', 'HDG'), purlin: section('HAT 70X40X25X10X0.9', 'GALVALUME'),
      horizontal: section('C-LIP 100X48X15X2', 'HDG'), walkway1: section('C-LIP 100X40X15X2', 'PRE-GALVA'), walkway2: section('C-LIP 90X30X15X2', 'PRE-GALVA'),
      basePlateMm: 250, basePlateThicknessMm: 5, basePlateMaterial: 'HDG',
      stiffenersPerBase: 3, stiffenerLengthMm: 70, stiffenerWidthMm: 60, stiffenerThicknessMm: 10, stiffenerMaterial: 'HDG',
    },
  },
];

/** Validates the inputs, fills blanks by the stated rules, and produces geometry plus the part list. */
export function buildStructure(spec: StructureSpec): BuiltStructure {
  const problems: string[] = [];
  const pos = (v: number, label: string, max = 1e5) => { if (!(Number.isFinite(v) && v > 0 && v <= max)) problems.push(`${label} must be a positive number.`); };
  pos(spec.panelLengthMm, 'Panel length', 5000); pos(spec.panelWidthMm, 'Panel width', 5000); pos(spec.panelThicknessMm, 'Panel thickness', 200);
  pos(spec.backColumnMm, 'Back column height', 10000);
  if (!(Number.isInteger(spec.panelsAlongSlope) && spec.panelsAlongSlope >= 1 && spec.panelsAlongSlope <= 6)) problems.push('Panels along the slope must be a whole number from 1 to 6.');
  if (!(Number.isInteger(spec.panelsAcross) && spec.panelsAcross >= 1 && spec.panelsAcross <= 30)) problems.push('Panels across must be a whole number from 1 to 30.');
  if (!(Number.isFinite(spec.panelGapMm) && spec.panelGapMm >= 0 && spec.panelGapMm <= 200)) problems.push('Panel gap must be 0–200 mm.');
  if (!(Number.isFinite(spec.tiltDeg) && spec.tiltDeg > 0 && spec.tiltDeg <= 60)) problems.push('Tilt must be above 0° and at most 60°.');
  if (!(Number.isInteger(spec.frames) && spec.frames >= 2 && spec.frames <= 12)) problems.push('Frames must be a whole number from 2 to 12.');
  for (const [k, s] of Object.entries({ Column: spec.column, Rafter: spec.rafter, Purlin: spec.purlin, 'Horizontal support': spec.horizontal, 'Walkway channel 1': spec.walkway1, 'Walkway channel 2': spec.walkway2 })) {
    if (k.startsWith('Walkway') && !spec.walkway) continue;
    if (profileNumbers(s.profile).length < 2) problems.push(`${k}: profile name needs its dimensions, e.g. "C-LIP 100X48X15X2".`);
    if (!s.material.trim()) problems.push(`${k}: material is required.`);
  }
  pos(spec.basePlateMm, 'Base plate size', 2000); pos(spec.basePlateThicknessMm, 'Base plate thickness', 100);
  if (!(Number.isInteger(spec.stiffenersPerBase) && spec.stiffenersPerBase >= 0 && spec.stiffenersPerBase <= 12)) problems.push('Stiffeners per base plate must be 0–12.');
  if (spec.stiffenersPerBase > 0) { pos(spec.stiffenerLengthMm, 'Stiffener length'); pos(spec.stiffenerWidthMm, 'Stiffener width'); pos(spec.stiffenerThicknessMm, 'Stiffener thickness'); }
  const optPos = (v: number | null, label: string) => { if (v !== null && !(Number.isFinite(v) && v > 0)) problems.push(`${label} must be a positive number or blank.`); };
  optPos(spec.frontColumnMm, 'Front column height'); optPos(spec.columnSpanMm, 'Column span'); optPos(spec.rafterLengthMm, 'Rafter length');
  optPos(spec.purlinSpacingMm, 'Purlin spacing'); optPos(spec.horizontalSupportHeightMm, 'Horizontal support height'); optPos(spec.walkwayLength1Mm, 'Walkway channel 1 length'); optPos(spec.walkwayLength2Mm, 'Walkway channel 2 length');
  if (spec.rafterBackOverhangMm !== null && !(Number.isFinite(spec.rafterBackOverhangMm) && spec.rafterBackOverhangMm >= 0)) problems.push('Rafter back overhang must be 0 or more, or blank.');
  if (!(Number.isFinite(spec.purlinOverhangMm) && spec.purlinOverhangMm >= 0)) problems.push('Purlin overhang must be 0 or more.');
  if (spec.purlinPieces && (spec.purlinPieces.length === 0 || spec.purlinPieces.some((p) => !(p > 0)))) problems.push('Purlin pieces must be positive lengths.');
  if (problems.length) return { ok: false, problems };

  const warnings: string[] = [];
  const calc = new Set<string>();
  const t = rad(spec.tiltDeg);
  const L = spec.panelLengthMm; const W = spec.panelWidthMm; const g = spec.panelGapMm;
  const n = spec.panelsAlongSlope; const m = spec.panelsAcross;
  const arrayAlong = n * L + (n - 1) * g;
  const arrayWidth = m * W + (m - 1) * g;

  let rafterLength = spec.rafterLengthMm;
  if (rafterLength === null) { rafterLength = Math.round((arrayAlong - 260) / 10) * 10; calc.add('rafter'); }
  let span = spec.columnSpanMm;
  if (span === null) { span = Math.round((rafterLength * Math.cos(t)) / 2 / 10) * 10; calc.add('span'); }
  let bo = spec.rafterBackOverhangMm;
  if (bo === null) { bo = Math.max(0, (rafterLength - span / Math.cos(t)) / 2); calc.add('bo'); }
  const frontOverhangH = (rafterLength - bo) * Math.cos(t) - span;
  if (frontOverhangH < -1) problems.push(`The rafter (${r0(rafterLength)} mm) is too short to reach the front column: it needs at least ${r0(bo + span / Math.cos(t))} mm with this back overhang and span.`);
  const implied = spec.backColumnMm - span * Math.tan(t);
  if (!(implied > 100) && spec.frontColumnMm === null) problems.push('At this tilt and span the front column would be shorter than 100 mm. Reduce the span or tilt, or raise the back column.');
  if (problems.length) return { ok: false, problems };
  let front = spec.frontColumnMm;
  if (front === null) { front = r0(implied); calc.add('front'); }
  else if (Math.abs(front - implied) > 60) warnings.push(`The front column (${front} mm) does not match the tilt: a ${spec.tiltDeg}° rafter would meet the front column top at ${r0(implied)} mm (${r0(implied - front)} mm difference). Check the heights or the tilt.`);

  let spacings = spec.frameSpacingsMm;
  if (spacings && (spacings.length !== spec.frames - 1 || spacings.some((x) => !(x > 0)))) problems.push(`Give ${spec.frames - 1} frame spacings (one between each pair of frames), or leave blank for equal spacing.`);
  if (problems.length) return { ok: false, problems };
  if (!spacings) { const each = Math.round(arrayWidth / spec.frames); spacings = Array(spec.frames - 1).fill(each) as number[]; calc.add('frames'); warnings.push(`Frames are spaced equally at ${each} mm; overall ${each * (spec.frames - 1)} mm.`); }
  const frameX: number[] = [0];
  for (const s of spacings) frameX.push(frameX[frameX.length - 1]! + s);

  const purlinSpacing = spec.purlinSpacingMm ?? Math.round((L * 0.6) / 5) * 5;
  if (spec.purlinSpacingMm === null) calc.add('purlinSpacing');
  if (purlinSpacing >= L) problems.push('Purlin spacing must be smaller than the panel length.');
  if (problems.length) return { ok: false, problems };
  const pieces = spec.purlinPieces ?? [Math.round(arrayWidth + 2 * spec.purlinOverhangMm)];
  const purlinTotal = pieces.reduce((a, b) => a + b, 0);
  if (!spec.purlinPieces) calc.add('purlinLen');
  if (purlinTotal < arrayWidth) warnings.push(`The purlins (${r0(purlinTotal)} mm in total) are shorter than the panel array (${r0(arrayWidth)} mm).`);

  const panelS0 = (rafterLength - arrayAlong) / 2;
  const purlinS: number[] = [];
  for (let i = 0; i < n; i++) { const c = panelS0 + i * (L + g) + L / 2; purlinS.push(c - purlinSpacing / 2, c + purlinSpacing / 2); }
  const outside = purlinS.filter((s) => s < 0 || s > rafterLength);
  if (outside.length) warnings.push(`${outside.length} purlin position(s) fall outside the rafter (${r0(rafterLength)} mm). Lengthen the rafter or reduce the purlin spacing.`);
  const frameSpan = frameX[frameX.length - 1]!;
  if (arrayWidth > frameSpan + 2 * 1200) warnings.push(`The array is ${r0(arrayWidth)} mm wide but the frames cover ${r0(frameSpan)} mm: long purlin cantilevers. Check with your engineer.`);

  const hs = spec.horizontalSupportHeightMm ?? r0(Math.min(front, spec.backColumnMm) * 0.5);
  if (spec.horizontalSupportHeightMm === null) calc.add('hs');
  const w1 = spec.walkwayLength1Mm ?? r0(span + 20);
  const w2 = spec.walkwayLength2Mm ?? r0(span + 40);
  if (spec.walkway && (spec.walkwayLength1Mm === null || spec.walkwayLength2Mm === null)) { calc.add('walk'); warnings.push('Walkway channel lengths were set to the column span + 20 mm and + 40 mm. Enter your own lengths if they differ.'); }

  const parts: StructurePart[] = [];
  const add = (name: string, profile: string, material: string, lengthMm: number, thicknessMm: number, qty: number, key: string | null) => {
    if (qty > 0) parts.push({ no: parts.length + 1, name, profile, material, lengthMm: r0(lengthMm), thicknessMm, qty, calculated: key ? calc.has(key) : false });
  };
  const col = spec.column;
  if (r0(front) === r0(spec.backColumnMm)) add(`COLUMN ${r0(front)}`, col.profile.toUpperCase(), col.material.toUpperCase(), front, sectionThickness(col.profile), spec.frames * 2, 'front');
  else {
    const two = [[front, 'front'], [spec.backColumnMm, null]].sort((a, b) => (a[0] as number) - (b[0] as number));
    for (const [len, key] of two) add(`COLUMN ${r0(len as number)}`, col.profile.toUpperCase(), col.material.toUpperCase(), len as number, sectionThickness(col.profile), spec.frames, key as string | null);
  }
  add('BASE PLATE', `PLATE ${spec.basePlateMm}X${spec.basePlateMm}X${spec.basePlateThicknessMm}`, spec.basePlateMaterial.toUpperCase(), spec.basePlateMm, spec.basePlateThicknessMm, spec.frames * 2, null);
  add('STIFFENER PLATE', `PLATE ${spec.stiffenerLengthMm}X${spec.stiffenerWidthMm}X${spec.stiffenerThicknessMm}`, spec.stiffenerMaterial.toUpperCase(), spec.stiffenerLengthMm, spec.stiffenerThicknessMm, spec.frames * 2 * spec.stiffenersPerBase, null);
  add('RAFTER', spec.rafter.profile.toUpperCase(), spec.rafter.material.toUpperCase(), rafterLength, sectionThickness(spec.rafter.profile), spec.frames, 'rafter');
  const pName = isHat(spec.purlin.profile) ? 'HAT PURLIN' : 'PURLIN';
  pieces.forEach((len, k) => add(pieces.length > 1 ? `${pName} ${k + 1}` : pName, spec.purlin.profile.toUpperCase(), spec.purlin.material.toUpperCase(), len, sectionThickness(spec.purlin.profile), n * 2, 'purlinLen'));
  add('HORIZONTAL SUPPORT', spec.horizontal.profile.toUpperCase(), spec.horizontal.material.toUpperCase(), span, sectionThickness(spec.horizontal.profile), spec.frames, 'span');
  if (spec.walkway) {
    add('WALKWAY CHANNEL 1', spec.walkway1.profile.toUpperCase(), spec.walkway1.material.toUpperCase(), w1, sectionThickness(spec.walkway1.profile), spec.frames, 'walk');
    add('WALKWAY CHANNEL 2', spec.walkway2.profile.toUpperCase(), spec.walkway2.material.toUpperCase(), w2, sectionThickness(spec.walkway2.profile), spec.frames, 'walk');
  }

  return {
    ok: true, spec, parts, warnings,
    geometry: {
      tiltDeg: spec.tiltDeg, arrayAlongMm: arrayAlong, arrayWidthMm: arrayWidth, spanMm: span, rafterLengthMm: rafterLength, backOverhangMm: bo,
      frontColumnMm: front, impliedFrontColumnMm: implied, frameX, frameSpacingsMm: spacings, purlinSpacingMm: purlinSpacing, purlinPieces: pieces, purlinS, panelS0,
      hsHeightMm: hs, walkway1Mm: w1, walkway2Mm: w2, frontOverhangHorizontalMm: frontOverhangH, backOverhangHorizontalMm: bo * Math.cos(t), panelCount: n * m,
    },
  };
}

/* ------------------------------------------------------------------------------------------------ drawing */

export interface StructureSheetMeta {
  company: string; address?: string; project: string; drawingNo: string; description: string;
  drawnBy: string; checkedBy: string; approvedBy: string; date: string; revNo: string; revDate: string; notes: string[];
}
export const DEFAULT_SHEET_NOTES = [
  'Part must be free from sharp edges, burrs, fracture, stretching, scoring marks, wrinkles and any surface imperfection that may affect fit and function.',
  'Colour / finish as per work order.',
  'Preliminary drawing generated from the entered dimensions. It is not a structural calculation: verify sections, connections and foundations with a qualified engineer before fabrication.',
];

export const SHEET_W = 420;
export const SHEET_H = 297;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fx = (n: number) => String(Math.round(n * 100) / 100);
const num = (n: number) => String(Math.round(n * 100) / 100);

type Pt = [number, number];
const INK = '#111';
const FRAME = '#333';
const PANEL_FILL = '#dbe9f6';

class Out {
  parts: string[] = [];
  line(a: Pt, b: Pt, w = 0.25, o: { dash?: string; color?: string } = {}) { this.parts.push(`<line x1="${fx(a[0])}" y1="${fx(a[1])}" x2="${fx(b[0])}" y2="${fx(b[1])}" stroke="${o.color ?? INK}" stroke-width="${w}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`); }
  poly(pts: Pt[], o: { fill?: string; stroke?: string; w?: number; opacity?: number } = {}) { this.parts.push(`<polygon points="${pts.map((p) => `${fx(p[0])},${fx(p[1])}`).join(' ')}" fill="${o.fill ?? 'none'}" fill-opacity="${o.opacity ?? 1}" stroke="${o.stroke ?? INK}" stroke-width="${o.w ?? 0.25}" stroke-linejoin="round"/>`); }
  rect(x: number, y: number, w: number, h: number, o: { fill?: string; stroke?: string; w?: number } = {}) { this.parts.push(`<rect x="${fx(x)}" y="${fx(y)}" width="${fx(w)}" height="${fx(h)}" fill="${o.fill ?? 'none'}" stroke="${o.stroke ?? INK}" stroke-width="${o.w ?? 0.25}"/>`); }
  circle(c: Pt, r: number, o: { fill?: string; w?: number } = {}) { this.parts.push(`<circle cx="${fx(c[0])}" cy="${fx(c[1])}" r="${fx(r)}" fill="${o.fill ?? 'none'}" stroke="${INK}" stroke-width="${o.w ?? 0.25}"/>`); }
  text(x: number, y: number, s: string, o: { size?: number; anchor?: 'start' | 'middle' | 'end'; bold?: boolean; rot?: number; fill?: string; dy?: number } = {}) {
    const tr = o.rot ? ` transform="rotate(${fx(o.rot)} ${fx(x)} ${fx(y)})"` : '';
    this.parts.push(`<text x="${fx(x)}" y="${fx(y)}"${o.dy ? ` dy="${o.dy}"` : ''} font-size="${o.size ?? 2.6}" text-anchor="${o.anchor ?? 'start'}" font-family="Arial, Helvetica, sans-serif"${o.bold ? ' font-weight="bold"' : ''} fill="${o.fill ?? INK}"${tr}>${esc(s)}</text>`); }
  /** Aligned dimension between two paper points, drawn on the side of the line nearest `hint`. */
  dim(a: Pt, b: Pt, off: number, label: string, hint: Pt, size = 2.5) {
    const dx = b[0] - a[0]; const dy = b[1] - a[1]; const len = Math.hypot(dx, dy);
    if (len < 0.5) return;
    const ux = dx / len; const uy = dy / len;
    let nx = -uy; let ny = ux;
    if (nx * hint[0] + ny * hint[1] < 0) { nx = -nx; ny = -ny; }
    const p1: Pt = [a[0] + nx * off, a[1] + ny * off]; const p2: Pt = [b[0] + nx * off, b[1] + ny * off];
    const ext = (p: Pt, q: Pt) => this.line([p[0] + nx * 1.2, p[1] + ny * 1.2], [q[0] + nx * 1.8, q[1] + ny * 1.8], 0.15);
    ext(a, p1); ext(b, p2);
    this.line(p1, p2, 0.2);
    const ah = 1.7;
    const arrow = (p: Pt, s: number) => this.poly([p, [p[0] + s * ux * ah + nx * 0.5, p[1] + s * uy * ah + ny * 0.5], [p[0] + s * ux * ah - nx * 0.5, p[1] + s * uy * ah - ny * 0.5]], { fill: INK, w: 0.1 });
    arrow(p1, 1); arrow(p2, -1);
    let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    const mx = (p1[0] + p2[0]) / 2; const my = (p1[1] + p2[1]) / 2;
    // place the text on the outer side of the dimension line, upright
    const tx = mx + nx * 1.1; const ty = my + ny * 1.1;
    this.text(tx, ty, label, { size, anchor: 'middle', rot: ang, dy: ny > 0 ? 2.2 : 0 });
  }
  toString() { return this.parts.join(''); }
}

interface View { s: number; ox: number; oy: number }
const P = (v: View, y: number, z: number): Pt => [v.ox + v.s * y, v.oy - v.s * z];

function dims(b: Extract<BuiltStructure, { ok: true }>) {
  const { spec, geometry: g } = b;
  const t = rad(g.tiltDeg);
  const dir: Pt = [Math.cos(t), -Math.sin(t)]; // along the rafter, toward the front, in (y, z)
  const nrm: Pt = [Math.sin(t), Math.cos(t)]; // up from the rafter
  const dR = sectionDepth(spec.rafter.profile);
  const dP = sectionDepth(spec.purlin.profile);
  const wP = sectionWidth(spec.purlin.profile);
  const bottom = (s: number): Pt => [(s - g.backOverhangMm) * dir[0], spec.backColumnMm + (s - g.backOverhangMm) * dir[1]];
  const off = (p: Pt, h: number): Pt => [p[0] + nrm[0] * h, p[1] + nrm[1] * h];
  return { t, dir, nrm, dR, dP, wP, bottom, off };
}

/** Bounding box (model mm) of the side view. */
function sideBox(b: Extract<BuiltStructure, { ok: true }>) {
  const { spec, geometry: g } = b; const k = dims(b);
  const pts: Pt[] = [[0, 0], [g.spanMm, 0], [0, spec.backColumnMm]];
  for (const s of [0, g.rafterLengthMm]) { pts.push(k.bottom(s), k.off(k.bottom(s), k.dR + k.dP + spec.panelThicknessMm)); }
  for (let i = 0; i < spec.panelsAlongSlope; i++) for (const s of [g.panelS0 + i * (spec.panelLengthMm + spec.panelGapMm), g.panelS0 + i * (spec.panelLengthMm + spec.panelGapMm) + spec.panelLengthMm]) pts.push(k.off(k.bottom(s), k.dR + k.dP + spec.panelThicknessMm));
  const ys = pts.map((p) => p[0]); const zs = pts.map((p) => p[1]);
  return { y0: Math.min(...ys), y1: Math.max(...ys), z0: Math.min(...zs, 0), z1: Math.max(...zs) };
}

function drawSide(o: Out, b: Extract<BuiltStructure, { ok: true }>, v: View, withDims: boolean) {
  const { spec, geometry: g } = b; const k = dims(b);
  const cw = sectionWidth(spec.column.profile);
  const P2 = (y: number, z: number) => P(v, y, z);
  const box = sideBox(b);
  o.line(P2(box.y0 - 400, 0), P2(box.y1 + 400, 0), 0.5);
  for (let y = box.y0 - 400; y < box.y1 + 400; y += 200) o.line(P2(y, 0), P2(y - 120, -110), 0.12, { color: '#888' });
  // base plates, stiffeners, columns
  const plate = (cy: number) => {
    o.rect(...P2(cy - spec.basePlateMm / 2, spec.basePlateThicknessMm), spec.basePlateMm * v.s, Math.max(spec.basePlateThicknessMm * v.s, 0.6), { fill: '#999', w: 0.2 });
    if (spec.stiffenersPerBase > 0) {
      o.poly([P2(cy + cw / 2, spec.basePlateThicknessMm), P2(cy + cw / 2 + spec.stiffenerLengthMm, spec.basePlateThicknessMm), P2(cy + cw / 2, spec.basePlateThicknessMm + spec.stiffenerWidthMm)], { fill: '#bbb', w: 0.2 });
      o.poly([P2(cy - cw / 2, spec.basePlateThicknessMm), P2(cy - cw / 2 - spec.stiffenerLengthMm, spec.basePlateThicknessMm), P2(cy - cw / 2, spec.basePlateThicknessMm + spec.stiffenerWidthMm)], { fill: '#bbb', w: 0.2 });
    }
  };
  const column = (cy: number, h: number) => o.rect(...P2(cy - cw / 2, h), cw * v.s, h * v.s, { fill: '#eee', w: 0.35 });
  plate(0); plate(g.spanMm); column(0, spec.backColumnMm); column(g.spanMm, g.frontColumnMm);
  // horizontal support and walkway
  const hsDepth = sectionWidth(spec.horizontal.profile);
  o.rect(...P2(0, g.hsHeightMm + hsDepth / 2), g.spanMm * v.s, hsDepth * v.s, { fill: '#f2f2f2', w: 0.3 });
  if (spec.walkway) {
    const mid = g.spanMm / 2;
    const h1 = sectionWidth(spec.walkway1.profile); const h2 = sectionWidth(spec.walkway2.profile);
    o.rect(...P2(mid - g.walkway1Mm / 2, g.hsHeightMm + hsDepth / 2 + h1), g.walkway1Mm * v.s, h1 * v.s, { fill: '#cfd8dc', w: 0.3 });
    o.rect(...P2(mid - g.walkway2Mm / 2, g.hsHeightMm + hsDepth / 2 + h1 + h2), g.walkway2Mm * v.s, h2 * v.s, { fill: '#b0bec5', w: 0.3 });
  }
  // rafter
  const rb0 = k.bottom(0); const rb1 = k.bottom(g.rafterLengthMm);
  o.poly([P2(...rb0), P2(...rb1), P2(...k.off(rb1, k.dR)), P2(...k.off(rb0, k.dR))], { fill: '#e6e6e6', w: 0.4 });
  // purlins and panels
  for (const s of g.purlinS) {
    const a = k.off(k.bottom(s - k.wP / 2), k.dR); const c = k.off(k.bottom(s + k.wP / 2), k.dR);
    o.poly([P2(...a), P2(...c), P2(...k.off(c, k.dP)), P2(...k.off(a, k.dP))], { fill: '#ccc', w: 0.25 });
  }
  const seat = k.dR + k.dP;
  for (let i = 0; i < spec.panelsAlongSlope; i++) {
    const s0 = g.panelS0 + i * (spec.panelLengthMm + spec.panelGapMm); const s1 = s0 + spec.panelLengthMm;
    const a = k.off(k.bottom(s0), seat); const c = k.off(k.bottom(s1), seat);
    o.poly([P2(...a), P2(...c), P2(...k.off(c, spec.panelThicknessMm)), P2(...k.off(a, spec.panelThicknessMm))], { fill: PANEL_FILL, w: 0.35 });
  }
  if (!withDims) return;
  // dimensions
  const top = (s: number) => P2(...k.off(k.bottom(s), seat + spec.panelThicknessMm));
  const s0 = g.panelS0; const s1 = s0 + spec.panelLengthMm;
  const up: Pt = [0, -1]; const down: Pt = [0, 1];
  o.dim(top(s0), top(s1), 4, num(spec.panelLengthMm), up);
  if (spec.panelsAlongSlope > 1) { const a = g.panelS0 + spec.panelLengthMm + spec.panelGapMm; o.dim(top(a), top(a + spec.panelLengthMm), 4, num(spec.panelLengthMm), up); }
  o.dim(P2(...k.off(rb0, k.dR)), P2(...k.off(rb1, k.dR)), 17, num(r1(g.rafterLengthMm)), up);
  const p0 = k.bottom(g.purlinS[g.purlinS.length - 2]!); const p1 = k.bottom(g.purlinS[g.purlinS.length - 1]!);
  o.dim(P2(...p0), P2(...p1), 5, num(r1(g.purlinSpacingMm)), down);
  o.dim(P2(-cw / 2, 0), P2(-cw / 2, spec.backColumnMm), 6, num(spec.backColumnMm), [-1, 0]);
  o.dim(P2(g.spanMm + cw / 2, 0), P2(g.spanMm + cw / 2, g.frontColumnMm), 6, num(r1(g.frontColumnMm)), [1, 0]);
  o.dim(P2(0, 0), P2(g.spanMm, 0), 9, num(r1(g.spanMm)), down);
  if (g.frontOverhangHorizontalMm > 5) o.dim(P2(g.spanMm, 0), P2(g.spanMm + g.frontOverhangHorizontalMm, 0), 9, num(r1(g.frontOverhangHorizontalMm)), down);
  // tilt angle
  const apex = P2(...rb1); const ref: Pt = [apex[0] - 20, apex[1]];
  o.line(apex, ref, 0.15, { dash: '1.2 0.8' });
  const r = 16; const ex: Pt = [apex[0] - r * Math.cos(k.t), apex[1] - r * Math.sin(k.t)];
  o.parts.push(`<path d="M ${fx(apex[0] - r)} ${fx(apex[1])} A ${r} ${r} 0 0 1 ${fx(ex[0])} ${fx(ex[1])}" fill="none" stroke="${INK}" stroke-width="0.2"/>`);
  o.text(apex[0] - r - 1, apex[1] + 6, `${num(g.tiltDeg)}°`, { size: 3, anchor: 'end' });
}

/** Detail: the same side drawing, zoomed, clipped to a window around (cy, cz). */
function detail(o: Out, b: Extract<BuiltStructure, { ok: true }>, id: string, label: string, box: { x: number; y: number; w: number; h: number }, centre: Pt, zoom: number, baseScale: number) {
  const s = baseScale * zoom;
  const v: View = { s, ox: box.x + box.w / 2 - s * centre[0], oy: box.y + box.h / 2 + s * centre[1] };
  o.parts.push(`<clipPath id="${id}"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}"/></clipPath><g clip-path="url(#${id})">`);
  const sub = new Out(); drawSide(sub, b, v, false); o.parts.push(sub.toString(), '</g>');
  o.rect(box.x, box.y, box.w, box.h, { w: 0.15, stroke: '#999' });
  o.text(box.x + box.w / 2, box.y + box.h + 5, `DETAIL ${label}`, { size: 3.4, anchor: 'middle' });
  o.text(box.x + box.w / 2, box.y + box.h + 9, `SCALE 1 : ${Math.round(1 / s)}`, { size: 3.4, anchor: 'middle' });
}

function drawFront(o: Out, b: Extract<BuiltStructure, { ok: true }>, v: View) {
  const { spec, geometry: g } = b; const k = dims(b);
  const colW = sectionDepth(spec.column.profile);
  const cx = (g.frameX[g.frameX.length - 1]!) / 2; // centre of the frames (x across)
  const X = (x: number): number => v.ox + v.s * (x - cx);
  const Z = (z: number): number => v.oy - v.s * z;
  const arr0 = cx - g.arrayWidthMm / 2;
  const total = g.purlinPieces.reduce((a, c) => a + c, 0);
  const pur0 = cx - total / 2;
  const extent0 = Math.min(arr0, pur0) - 300; const extent1 = Math.max(arr0 + g.arrayWidthMm, pur0 + total) + 300;
  o.line([X(extent0), Z(0)], [X(extent1), Z(0)], 0.5);
  // frames
  for (const x of g.frameX) {
    for (const h of [spec.backColumnMm, g.frontColumnMm]) o.rect(X(x - colW / 2), Z(h), colW * v.s, h * v.s, { fill: '#eee', w: 0.35 });
    o.rect(X(x - spec.basePlateMm / 2), Z(spec.basePlateThicknessMm), spec.basePlateMm * v.s, Math.max(spec.basePlateThicknessMm * v.s, 0.6), { fill: '#999', w: 0.2 });
    const hsH = sectionDepth(spec.horizontal.profile); const hsW = sectionWidth(spec.horizontal.profile);
    o.rect(X(x - hsW / 2), Z(g.hsHeightMm + hsH / 2), hsW * v.s, hsH * v.s, { fill: '#f2f2f2', w: 0.3 });
    if (spec.walkway) o.rect(X(x - sectionDepth(spec.walkway1.profile) / 2), Z(g.hsHeightMm + hsH / 2 + sectionWidth(spec.walkway1.profile)), sectionDepth(spec.walkway1.profile) * v.s, sectionWidth(spec.walkway1.profile) * v.s, { fill: '#cfd8dc', w: 0.25 });
    // rafter seen end-on: spans the z-range of its slope
    const zr0 = k.bottom(0)[1]; const zr1 = k.bottom(g.rafterLengthMm)[1] + 0;
    const rw = sectionWidth(spec.rafter.profile);
    o.rect(X(x - rw / 2), Z(zr0 + k.dR * k.nrm[1]), rw * v.s, (zr0 - zr1 + k.dR * k.nrm[1]) * v.s, { fill: '#e0e0e0', w: 0.3 });
  }
  // purlins
  const pw = k.dP;
  g.purlinS.forEach((s) => {
    const zc = k.off(k.bottom(s), k.dR + pw / 2)[1];
    let x = pur0;
    for (const len of g.purlinPieces) { o.rect(X(x), Z(zc + pw / 2), len * v.s, pw * v.s, { fill: '#cfcfcf', w: 0.25 }); x += len; }
  });
  // panels (true elevation: each panel row projects to the z-range of its slope length)
  const seat = k.dR + k.dP;
  for (let i = 0; i < spec.panelsAlongSlope; i++) {
    const s0 = g.panelS0 + i * (spec.panelLengthMm + spec.panelGapMm); const s1 = s0 + spec.panelLengthMm;
    const za = k.off(k.bottom(s0), seat + spec.panelThicknessMm)[1]; const zb = k.off(k.bottom(s1), seat + spec.panelThicknessMm)[1];
    for (let j = 0; j < spec.panelsAcross; j++) {
      const x0 = arr0 + j * (spec.panelWidthMm + spec.panelGapMm);
      o.rect(X(x0), Z(za), spec.panelWidthMm * v.s, (za - zb) * v.s, { fill: PANEL_FILL, w: 0.3 });
    }
  }
  // dimensions: purlin pieces (top), frame spacings (bottom)
  const zTop = Math.max(...[0, g.purlinS.length - 1].map((i) => k.off(k.bottom(g.purlinS[i]!), seat + spec.panelThicknessMm)[1]), k.bottom(0)[1]) + 100;
  const topZ = Math.max(zTop, k.off(k.bottom(g.panelS0), seat + spec.panelThicknessMm)[1]);
  let x = pur0; let row = 0;
  for (const len of g.purlinPieces) { o.dim([X(x), Z(topZ)], [X(x + len), Z(topZ)], 6 + (g.purlinPieces.length > 1 && row % 2 ? 6 : 0), num(r1(len)), [0, -1]); x += len; row++; }
  for (let i = 0; i < g.frameSpacingsMm.length; i++) o.dim([X(g.frameX[i]!), Z(0)], [X(g.frameX[i + 1]!), Z(0)], 7, num(r1(g.frameSpacingsMm[i]!)), [0, 1]);
}

function drawIso(o: Out, b: Extract<BuiltStructure, { ok: true }>, box: { x: number; y: number; w: number; h: number }) {
  const { spec, geometry: g } = b; const k = dims(b);
  type P3 = [number, number, number]; // X across, Y toward front, Z up
  const proj = (p: P3): Pt => [(p[0] - p[1]) * 0.866, (p[0] + p[1]) * 0.5 - p[2]];
  const cx = g.frameX[g.frameX.length - 1]! / 2;
  const arr0 = cx - g.arrayWidthMm / 2; const total = g.purlinPieces.reduce((a, c) => a + c, 0); const pur0 = cx - total / 2;
  const at = (x: number, s: number, h: number): P3 => { const p = k.off(k.bottom(s), h); return [x, p[0], p[1]]; };
  type Prim = { kind: 'line'; a: P3; c: P3; w: number; color: string } | { kind: 'quad'; pts: P3[]; fill: string; opacity: number };
  const lines: Prim[] = []; const panels: Prim[] = [];
  const L = (a: P3, c: P3, w: number, color = FRAME) => lines.push({ kind: 'line', a, c, w, color });
  const cw = sectionDepth(spec.column.profile);
  for (const x of g.frameX) {
    for (const [y, h] of [[0, spec.backColumnMm], [g.spanMm, g.frontColumnMm]] as [number, number][]) {
      const hp = spec.basePlateMm / 2;
      lines.push({ kind: 'quad', pts: [[x - hp, y - hp, 0], [x + hp, y - hp, 0], [x + hp, y + hp, 0], [x - hp, y + hp, 0]], fill: '#999', opacity: 1 });
      L([x, y, 0], [x, y, h], 0.9);
      void cw;
    }
    L([x, 0, g.hsHeightMm], [x, g.spanMm, g.hsHeightMm], 0.6);
    if (spec.walkway) { L([x, g.spanMm / 2 - g.walkway1Mm / 2, g.hsHeightMm + 60], [x, g.spanMm / 2 + g.walkway1Mm / 2, g.hsHeightMm + 60], 0.5, '#546e7a'); }
    const a = at(x, 0, 0); const c = at(x, g.rafterLengthMm, 0);
    L(a, c, 0.9);
  }
  const seat = k.dR + k.dP;
  g.purlinS.forEach((s) => L(at(pur0, s, k.dR + k.dP / 2), at(pur0 + total, s, k.dR + k.dP / 2), 0.45, '#666'));
  for (let i = 0; i < spec.panelsAlongSlope; i++) for (let j = 0; j < spec.panelsAcross; j++) {
    const s0 = g.panelS0 + i * (spec.panelLengthMm + spec.panelGapMm); const s1 = s0 + spec.panelLengthMm;
    const x0 = arr0 + j * (spec.panelWidthMm + spec.panelGapMm); const x1 = x0 + spec.panelWidthMm;
    const h = seat + spec.panelThicknessMm;
    panels.push({ kind: 'quad', pts: [at(x0, s0, h), at(x1, s0, h), at(x1, s1, h), at(x0, s1, h)], fill: PANEL_FILL, opacity: 0.72 });
  }
  const pts2: Pt[] = []; for (const pr of [...lines, ...panels]) { if (pr.kind === 'line') pts2.push(proj(pr.a), proj(pr.c)); else pts2.push(...pr.pts.map(proj)); }
  const xs = pts2.map((p) => p[0]); const ys = pts2.map((p) => p[1]);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
  const s = Math.min((box.w - 8) / (x1 - x0), (box.h - 8) / (y1 - y0));
  const T = (p: P3): Pt => { const q = proj(p); return [box.x + box.w / 2 + (q[0] - (x0 + x1) / 2) * s, box.y + box.h / 2 + (q[1] - (y0 + y1) / 2) * s]; };
  for (const pr of lines) { if (pr.kind === 'line') o.line(T(pr.a), T(pr.c), pr.w, { color: pr.color }); else o.poly(pr.pts.map(T), { fill: pr.fill, w: 0.2 }); }
  const depth = (p: Prim) => (p.kind === 'quad' ? p.pts.reduce((a, q) => a + q[0] + q[1], 0) / p.pts.length : 0);
  for (const pr of [...panels].sort((a, c) => depth(a) - depth(c))) if (pr.kind === 'quad') o.poly(pr.pts.map(T), { fill: pr.fill, opacity: pr.opacity, w: 0.35, stroke: '#37526b' });
}

function wrap(s: string, max: number): string[] {
  const words = s.split(' '); const lines: string[] = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur);
  return lines;
}

/** The complete A3 drawing sheet as an SVG string (viewBox in millimetres). */
export function renderStructureSvg(b: Extract<BuiltStructure, { ok: true }>, meta: StructureSheetMeta): string {
  const o = new Out();
  const { spec, geometry: g, parts } = b;
  o.rect(5, 5, SHEET_W - 10, SHEET_H - 10, { w: 0.6 });

  // parts table (top right)
  const tx = 238; const cols = [11, 34, 41, 23, 17, 19, 14]; const heads = ['SR.NO.', 'PART NAME', 'PROFILE', 'MATERIAL', 'LENGTH', 'THICKNESS', 'QTY'];
  const rowH = 9; let y = 12; let cx = tx;
  heads.forEach((h, i) => { o.rect(cx, y, cols[i]!, 7, { w: 0.25 }); o.text(cx + cols[i]! / 2, y + 4.6, h, { size: 2.2, anchor: 'middle', bold: true }); cx += cols[i]!; });
  y += 7;
  for (const p of parts) {
    cx = tx;
    const cells = [String(p.no), p.name, p.profile, p.material, String(p.lengthMm), num(p.thicknessMm), String(p.qty)];
    cells.forEach((c, i) => {
      o.rect(cx, y, cols[i]!, rowH, { w: 0.2 });
      const ls = wrap(c, i === 1 ? 14 : i === 2 ? 22 : 12);
      const lh = 2.7; const y0 = y + rowH / 2 - ((ls.length - 1) * lh) / 2 + 0.9;
      ls.forEach((l, li) => o.text(cx + cols[i]! / 2, y0 + li * lh, l, { size: 2.3, anchor: 'middle' }));
      cx += cols[i]!;
    });
    if (p.calculated) o.text(tx + cols.reduce((a, c) => a + c, 0) + 1, y + rowH / 2 + 0.8, '*', { size: 3 });
    y += rowH;
  }
  if (parts.some((p) => p.calculated)) o.text(tx, y + 4.5, '* length calculated from the geometry (not entered)', { size: 2.1 });

  // isometric view
  drawIso(o, b, { x: 72, y: 12, w: 160, h: 112 });

  // side view + details
  const box = sideBox(b);
  const reg = { x: 12, y: 128, w: 168, h: 118 };
  const pad = 24; // paper mm reserved around the model for dimensions
  const sSide = Math.min((reg.w - 2 * pad) / (box.y1 - box.y0), (reg.h - 2 * pad - 4) / (box.z1 - box.z0));
  const side: View = { s: sSide, ox: reg.x + pad - box.y0 * sSide + (reg.w - 2 * pad - (box.y1 - box.y0) * sSide) / 2, oy: reg.y + reg.h - pad };
  drawSide(o, b, side, true);
  o.text(reg.x + reg.w / 2, 253, 'SIDE VIEW', { size: 6, anchor: 'middle' });
  const detailScale = sSide;
  const hsPt: Pt = [0, g.hsHeightMm];
  detail(o, b, 'dC', 'C', { x: 12, y: 12, w: 52, h: 46 }, [0, spec.backColumnMm], 5, detailScale);
  detail(o, b, 'dD', 'D', { x: 12, y: 68, w: 52, h: 46 }, hsPt, 5, detailScale);
  for (const [l, pt] of [['C', P(side, 0, spec.backColumnMm)], ['D', P(side, 0, g.hsHeightMm)]] as [string, Pt][]) {
    o.circle(pt, 4, { w: 0.25 }); o.text(pt[0] + 6, pt[1] - 4, l, { size: 4.5, bold: true });
  }

  // front view
  const freg = { x: 186, y: 134, w: 146, h: 114 };
  const fw = g.frameX[g.frameX.length - 1]! + 700; const fext = Math.max(fw, g.arrayWidthMm + 600, g.purlinPieces.reduce((a, c) => a + c, 0) + 600);
  const fh = Math.max(spec.backColumnMm, 1) + 500;
  const sFront = Math.min((freg.w - 14) / fext, (freg.h - 34) / fh);
  const front: View = { s: sFront, ox: freg.x + freg.w / 2, oy: freg.y + freg.h - 14 };
  drawFront(o, b, front);
  o.text(freg.x + freg.w / 2, 253, 'FRONT VIEW', { size: 6, anchor: 'middle' });

  // title block text
  let ty = 152;
  for (const l of wrap(spec.title, 15)) { o.text(338, ty, l, { size: 5.2 }); ty += 7; }
  o.text(338, ty + 4, `${g.panelCount}PANELS`, { size: 5.2 });
  o.text(338, 190, `SOLAR PANEL SIZE - ${spec.panelLengthMm}X${spec.panelWidthMm}X${spec.panelThicknessMm}`, { size: 2.6 });
  // legend
  o.text(338, 200, `TILT ${num(g.tiltDeg)}°  ·  ${spec.panelsAlongSlope} × ${spec.panelsAcross} PANELS`, { size: 2.4 });
  o.text(338, 205, `${spec.frames} FRAMES`, { size: 2.4 });

  // notes
  o.text(12, 263, 'NOTE:-', { size: 2.8, bold: true });
  let ny = 267;
  meta.notes.forEach((n, i) => { for (const l of wrap(`${['i', 'ii', 'iii', 'iv', 'v', 'vi'][i] ?? i + 1}) ${n}`, 118)) { o.text(12, ny, l, { size: 2.3 }); ny += 3.2; } });
  o.text(12, 289.5, 'ALL DIMENSIONS ARE IN MM UNLESS SPECIFIED', { size: 2.3 });

  // title block
  const bx = 238; const by = 258; const bw = 170; const bh = 34;
  o.rect(bx, by, bw, bh, { w: 0.5 });
  o.line([bx, by + 10], [bx + bw, by + 10], 0.3); o.line([bx, by + 22], [bx + bw, by + 22], 0.3);
  o.line([bx + 90, by + 10], [bx + 90, by + bh], 0.3); o.line([bx + 118, by + 10], [bx + 118, by + bh], 0.3);
  o.text(bx + 3, by + 6.5, meta.company.toUpperCase(), { size: 4.2, bold: true });
  if (meta.address) o.text(bx + bw - 3, by + 6.5, meta.address, { size: 2.2, anchor: 'end' });
  o.text(bx + 3, by + 14, 'PROJECT', { size: 1.9 }); o.text(bx + 3, by + 19, meta.project, { size: 3 });
  o.text(bx + 3, by + 25, 'DRG NO. / DESCRIPTION', { size: 1.9 }); o.text(bx + 3, by + 30, `${meta.drawingNo}${meta.drawingNo && meta.description ? '  ·  ' : ''}${meta.description}`, { size: 2.8 });
  const kv = (x: number, yy: number, k2: string, v2: string) => { o.text(x, yy, k2, { size: 1.9 }); o.text(x, yy + 4.5, v2, { size: 2.6 }); };
  kv(bx + 93, by + 14, 'DRAWN', meta.drawnBy); kv(bx + 121, by + 14, 'CHECKED', meta.checkedBy);
  kv(bx + 93, by + 26, 'APPROVED', meta.approvedBy); kv(bx + 121, by + 26, 'DATE', meta.date);
  kv(bx + 150, by + 14, 'REV. NO.', meta.revNo); kv(bx + 150, by + 26, 'REV. DT.', meta.revDate);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_W * 4}" height="${SHEET_H * 4}" viewBox="0 0 ${SHEET_W} ${SHEET_H}"><rect width="${SHEET_W}" height="${SHEET_H}" fill="#fff"/>${o.toString()}</svg>`;
}
