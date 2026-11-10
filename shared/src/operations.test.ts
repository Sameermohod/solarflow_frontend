import { describe, expect, it } from 'vitest';
import {
  amcSchema, applyPackSchema, documentSchema, extractPlaceholders, materialMoveSchema, packSchema, projectProgress, projectSchema, renderTemplate, scheduleVisits, taskSchema, templateSchema,
  unknownPlaceholders, warrantySchema, warrantyState,
} from './operations';

const id = '11111111-1111-4111-8111-111111111111';

describe('projects', () => {
  it('validates a project and its dates', () => {
    expect(projectSchema.safeParse({ name: 'Roof A', customerId: id }).success).toBe(true);
    expect(projectSchema.safeParse({ name: 'x', customerId: id }).success).toBe(false);
    expect(projectSchema.safeParse({ name: 'Roof A', customerId: id, startDate: '2026-05-10', targetDate: '2026-05-01' }).success).toBe(false);
    const p = projectSchema.parse({ name: 'Roof A', customerId: id, startDate: '2026-05-01', targetDate: '2026-06-01' });
    expect(p.startDate!.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });
  it('progress uses weighted milestones, else tasks', () => {
    expect(projectProgress([{ weight: 1, completedAt: new Date() }, { weight: 3, completedAt: null }], [])).toBe(25);
    expect(projectProgress([], [{ status: 'DONE' }, { status: 'TODO' }, { status: 'TODO' }, { status: 'DONE' }])).toBe(50);
    expect(projectProgress([], [])).toBe(0);
  });
  it('material moves need a positive quantity with at most 3 decimals', () => {
    expect(materialMoveSchema.safeParse({ equipmentId: id, quantity: 2.5 }).success).toBe(true);
    expect(materialMoveSchema.safeParse({ equipmentId: id, quantity: 0 }).success).toBe(false);
    expect(materialMoveSchema.safeParse({ equipmentId: id, quantity: 1.2345 }).success).toBe(false);
  });
  it('tasks default to medium priority', () => { expect(taskSchema.parse({ title: 'Fit rails' }).priority).toBe('MEDIUM'); });
});

describe('maintenance', () => {
  it('warranty state around expiry', () => {
    const today = new Date('2026-06-01T00:00:00Z');
    expect(warrantyState(new Date('2026-05-31T00:00:00Z'), today)).toBe('EXPIRED');
    expect(warrantyState(new Date('2026-06-01T00:00:00Z'), today)).toBe('EXPIRING');
    expect(warrantyState(new Date('2026-07-31T00:00:00Z'), today)).toBe('EXPIRING');
    expect(warrantyState(new Date('2026-08-05T00:00:00Z'), today)).toBe('ACTIVE');
  });
  it('warranty and AMC must end after they start', () => {
    expect(warrantySchema.safeParse({ customerId: id, description: 'Inverter', startDate: '2026-01-01', endDate: '2026-01-01' }).success).toBe(false);
    expect(warrantySchema.safeParse({ customerId: id, description: 'Inverter', startDate: '2026-01-01', endDate: '2031-01-01' }).success).toBe(true);
    expect(amcSchema.safeParse({ customerId: id, startDate: '2026-02-01', endDate: '2026-01-01' }).success).toBe(false);
  });
  it('schedules evenly spaced visits inside the contract term', () => {
    const start = new Date('2026-01-01T00:00:00Z'); const end = new Date('2027-01-01T00:00:00Z');
    const v = scheduleVisits(start, end, 2);
    expect(v).toHaveLength(2);
    expect(v[0]! > start && v[1]! <= end).toBe(true);
    expect(v[1]!.getTime() - v[0]!.getTime()).toBeGreaterThan(150 * 86_400_000);
    expect(scheduleVisits(start, new Date('2028-01-01T00:00:00Z'), 4)).toHaveLength(8);
    expect(scheduleVisits(start, new Date('2026-02-01T00:00:00Z'), 1)).toHaveLength(1);
    expect(scheduleVisits(start, end, 2)).toEqual(v);
  });
});

describe('document templates', () => {
  it('finds, renders and reports placeholders', () => {
    const body = 'Dear {{customer.name}}, your {{project.capacityKw}} kW plant at {{ project.address }} - {{customer.name}}';
    expect(extractPlaceholders(body)).toEqual(['customer.name', 'project.capacityKw', 'project.address']);
    const r = renderTemplate(body, { 'customer.name': 'Acme', 'project.capacityKw': '5' });
    expect(r.text).toBe('Dear Acme, your 5 kW plant at [project.address] - Acme');
    expect(r.missing).toEqual(['project.address']);
  });
  it('rejects unknown placeholders in a template', () => {
    expect(unknownPlaceholders('{{customer.name}} {{nope.thing}}')).toEqual(['nope.thing']);
    expect(templateSchema.safeParse({ name: 'Letter', body: 'Hi {{customer.name}}' }).success).toBe(true);
    const bad = templateSchema.safeParse({ name: 'Letter', body: 'Hi {{customer.nmae}}' });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]!.message).toContain('{{customer.nmae}}');
  });
  it('validates documents and regulatory packs', () => {
    expect(documentSchema.safeParse({ title: 'Net metering application', templateId: id }).success).toBe(true);
    expect(packSchema.safeParse({ name: 'Pack', jurisdiction: 'Maharashtra', items: [] }).success).toBe(false);
    expect(packSchema.safeParse({ name: 'Pack', jurisdiction: 'Maharashtra', items: [{ title: 'Application', templateId: id }] }).success).toBe(true);
    expect(applyPackSchema.safeParse({ projectId: 'x' }).success).toBe(false);
  });
});
