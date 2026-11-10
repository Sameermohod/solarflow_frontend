import { z } from 'zod';

/**
 * The ONE design document shared by the 2D editor, the 3D viewer, the API and (later) BOM/quotations.
 * All lengths are metres, angles degrees. Stored as JSONB in SolarDesignVersion.config.
 *
 * Coordinate systems
 *  • Plan frame (building): x = east, y = south (y down), origin at the building's centre.
 *  • Section frame: u = to the right, v = up the slope, true (un-foreshortened) metres, origin at the section's
 *    lower-left eave corner. Panels, obstacles and zones live in the section frame, so their sizes are exact.
 *  • A section is placed on the plan by (originX, originY, azimuthDeg, tiltDeg); see planes.ts.
 * This is a preliminary layout and visualisation model, NOT a certified structural or electrical design.
 */
const finite = z.number().finite();
const id = z.string().min(1).max(60);

export const vec2Schema = z.object({ x: finite.min(-1e5).max(1e5), y: finite.min(-1e5).max(1e5) });

export const ROOF_TYPES = ['FLAT', 'SHED', 'GABLE', 'HIP'] as const;
export type RoofType = (typeof ROOF_TYPES)[number];
export const ROOF_TYPE_LABELS: Record<RoofType, string> = { FLAT: 'Flat', SHED: 'Sloped (single pitch)', GABLE: 'Gable', HIP: 'Hip' };

export const buildingSchema = z.object({
  lengthM: finite.min(1).max(500),
  widthM: finite.min(1).max(500),
  floors: z.number().int().min(1).max(100),
  floorHeightM: finite.min(2).max(8),
  roofType: z.enum(ROOF_TYPES),
  roofAngleDeg: finite.min(0).max(60),
  /** Direction the ridge runs (gable). Hip roofs always run the ridge along the longer side. */
  ridgeAlong: z.enum(['LENGTH', 'WIDTH']).default('LENGTH'),
  /** Clockwise rotation of the whole building from the north-aligned plan. 0 = length runs west–east. */
  orientationDeg: finite.min(-360).max(360).default(0),
});

export const roofSectionSchema = z.object({
  id,
  name: z.string().trim().min(1).max(60),
  polygon: z.array(vec2Schema).min(3).max(64),
  originX: finite.min(-1e5).max(1e5),
  originY: finite.min(-1e5).max(1e5),
  /** True compass azimuth the slope faces (0 = north, 90 = east, 180 = south). */
  azimuthDeg: finite.min(-360).max(720),
  tiltDeg: finite.min(0).max(75),
  baseHeightM: finite.min(0).max(500),
  /** Minimum clear distance between any panel and this section's edges (safety / access setback). */
  setbackM: finite.min(0).max(10).default(0.5),
});

export const OBSTACLE_TYPES = ['WATER_TANK', 'CHIMNEY', 'SKYLIGHT', 'VENT', 'STAIRCASE', 'HVAC', 'OTHER'] as const;
export const OBSTACLE_LABELS: Record<(typeof OBSTACLE_TYPES)[number], string> = {
  WATER_TANK: 'Water tank', CHIMNEY: 'Chimney', SKYLIGHT: 'Skylight', VENT: 'Ventilation', STAIRCASE: 'Staircase', HVAC: 'HVAC unit', OTHER: 'Other',
};
export const obstacleSchema = z.object({
  id,
  sectionId: id,
  type: z.enum(OBSTACLE_TYPES),
  shape: z.enum(['RECT', 'CIRCLE']),
  /** Centre in the section frame. */
  x: finite.min(-1e5).max(1e5),
  y: finite.min(-1e5).max(1e5),
  w: finite.min(0.05).max(500).default(1),
  h: finite.min(0.05).max(500).default(1),
  r: finite.min(0.05).max(250).default(0.5),
  heightM: finite.min(0).max(50).default(1),
  /** Required clear distance from the obstacle to any panel (shading / maintenance). */
  clearanceM: finite.min(0).max(10).default(0.3),
});

export const zoneSchema = z.object({ id, sectionId: id, name: z.string().trim().min(1).max(60), polygon: z.array(vec2Schema).min(3).max(64) });

export const panelTypeSchema = z.object({
  id,
  name: z.string().trim().min(1).max(100),
  widthM: finite.min(0.3).max(3),
  lengthM: finite.min(0.3).max(4),
  wattage: finite.min(50).max(1000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** Link to the equipment catalogue entry this type came from (used by the BOM in Phase 4). */
  equipmentId: z.string().uuid().optional(),
});

export const panelSchema = z.object({
  id,
  sectionId: id,
  typeId: id,
  /** Centre of the panel footprint in the section frame. */
  x: finite.min(-1e5).max(1e5),
  y: finite.min(-1e5).max(1e5),
  rotationDeg: finite.min(-360).max(360).default(0),
  orientation: z.enum(['PORTRAIT', 'LANDSCAPE']).default('PORTRAIT'),
  /** Extra mounting tilt above the roof plane (flat-roof racks). 0 = flush with the roof. */
  tiltDeg: finite.min(0).max(60).default(0),
});

export const layoutSchema = z.object({
  orientation: z.enum(['PORTRAIT', 'LANDSCAPE', 'AUTO']).default('AUTO'),
  gapXM: finite.min(0).max(2).default(0.02),
  gapYM: finite.min(0).max(2).default(0.02),
  mountTiltDeg: finite.min(0).max(60).default(0),
  /** Sun elevation used to size row spacing for tilted racks (assumption, shown to the user). */
  designSunElevationDeg: finite.min(5).max(80).default(22),
  typeId: id.optional(),
  /** Panels closer than this are flagged as a warning (not an error). */
  minSpacingM: finite.min(0).max(1).default(0.01),
});

export const EQUIPMENT_KINDS = ['INVERTER', 'BATTERY', 'DISTRIBUTION_BOARD', 'OTHER'] as const;
export const equipmentItemSchema = z.object({
  id,
  kind: z.enum(EQUIPMENT_KINDS),
  label: z.string().trim().max(60).default(''),
  /** Position in the plan frame (m) and size. Placed on the ground beside the building. */
  x: finite.min(-1e5).max(1e5),
  y: finite.min(-1e5).max(1e5),
  widthM: finite.min(0.1).max(10).default(0.6),
  depthM: finite.min(0.1).max(10).default(0.3),
  heightM: finite.min(0.1).max(10).default(0.8),
  equipmentId: z.string().uuid().optional(),
});

export const appearanceSchema = z.object({
  panelColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#1e3a8a'),
  panelFrameColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#cbd5e1'),
  panelMaterial: z.enum(['GLOSSY', 'MATTE']).default('GLOSSY'),
  wallColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#e5e7eb'),
  roofColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#9a5b4a'),
});

export const designMetaSchema = z.object({
  /** From the solar calculator, so the designer can see how the layout compares with the recommendation. */
  targetPanels: z.number().int().min(0).max(100000).optional(),
  targetKwp: finite.min(0).max(1e5).optional(),
  calculationId: z.string().uuid().optional(),
  notes: z.string().max(4000).optional(),
  /** Where the building is (set from the site map). Used to prefill the yield report. */
  site: z.object({
    latitude: finite.min(-90).max(90),
    longitude: finite.min(-180).max(180),
    address: z.string().max(300).optional(),
    source: z.enum(['OSM_BUILDING', 'TRACED']).optional(),
    footprintAreaM2: finite.min(0).max(1e7).optional(),
  }).optional(),
});

export const MAX_PANELS = 3000;
export const designConfigSchema = z.object({
  schemaVersion: z.literal(1),
  units: z.enum(['METRIC', 'IMPERIAL']).default('METRIC'),
  building: buildingSchema,
  roofSections: z.array(roofSectionSchema).min(1).max(40),
  obstacles: z.array(obstacleSchema).max(200).default([]),
  zones: z.array(zoneSchema).max(100).default([]),
  panelTypes: z.array(panelTypeSchema).min(1).max(12),
  panels: z.array(panelSchema).max(MAX_PANELS).default([]),
  layout: layoutSchema.default({}),
  equipment: z.array(equipmentItemSchema).max(40).default([]),
  appearance: appearanceSchema.default({}),
  meta: designMetaSchema.default({}),
}).superRefine((c, ctx) => {
  const sections = new Set(c.roofSections.map((s) => s.id));
  const types = new Set(c.panelTypes.map((t) => t.id));
  if (sections.size !== c.roofSections.length) ctx.addIssue({ code: 'custom', message: 'Duplicate roof section ids', path: ['roofSections'] });
  if (types.size !== c.panelTypes.length) ctx.addIssue({ code: 'custom', message: 'Duplicate panel type ids', path: ['panelTypes'] });
  const ids = new Set<string>();
  for (const p of c.panels) {
    if (ids.has(p.id)) ctx.addIssue({ code: 'custom', message: `Duplicate panel id ${p.id}`, path: ['panels'] });
    ids.add(p.id);
    if (!sections.has(p.sectionId)) ctx.addIssue({ code: 'custom', message: `Panel ${p.id} references an unknown roof section`, path: ['panels'] });
    if (!types.has(p.typeId)) ctx.addIssue({ code: 'custom', message: `Panel ${p.id} references an unknown panel type`, path: ['panels'] });
  }
  for (const o of c.obstacles) if (!sections.has(o.sectionId)) ctx.addIssue({ code: 'custom', message: `Obstacle ${o.id} references an unknown roof section`, path: ['obstacles'] });
  for (const z of c.zones) if (!sections.has(z.sectionId)) ctx.addIssue({ code: 'custom', message: `Zone ${z.id} references an unknown roof section`, path: ['zones'] });
});

export type Building = z.infer<typeof buildingSchema>;
export type RoofSection = z.infer<typeof roofSectionSchema>;
export type Obstacle = z.infer<typeof obstacleSchema>;
export type Zone = z.infer<typeof zoneSchema>;
export type PanelType = z.infer<typeof panelTypeSchema>;
export type Panel = z.infer<typeof panelSchema>;
export type LayoutSettings = z.infer<typeof layoutSchema>;
export type EquipmentItem = z.infer<typeof equipmentItemSchema>;
export type DesignConfig = z.infer<typeof designConfigSchema>;
export type DesignConfigInput = z.input<typeof designConfigSchema>;

let counter = 0;
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/**
 * Common panel size used only as an editable starting point (a typical 550 W module).
 * Real projects should pick a catalogue panel so BOM and layout use the same product.
 */
export const DEFAULT_PANEL_TYPE: PanelType = { id: 'pt-default', name: '550 W module (2.279 × 1.134 m), editable', widthM: 1.134, lengthM: 2.279, wattage: 550 };

export const createSchemaVersion = 1 as const;
