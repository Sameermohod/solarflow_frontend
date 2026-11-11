import { describe, expect, it } from 'vitest';
import { allocateLabour, decideSchema, hoursToMinutes, minutesToHours, monthRange, monthsBetween, projectResult, salaryOn, salarySchema, submitSchema, timeEntrySchema, weekdaysInRange } from './finance';
import { ALL_PERMISSIONS, defaultPermissionsFor } from './permissions';

const id = '11111111-1111-4111-8111-111111111111';

describe('timesheets', () => {
  it('accepts quarter-hour entries only, up to 24 h', () => {
    expect(timeEntrySchema.safeParse({ projectId: id, workDate: '2026-03-02', hours: 7.5 }).success).toBe(true);
    expect(timeEntrySchema.safeParse({ projectId: id, workDate: '2026-03-02', hours: 7.3 }).success).toBe(false);
    expect(timeEntrySchema.safeParse({ projectId: id, workDate: '2026-03-02', hours: 0 }).success).toBe(false);
    expect(timeEntrySchema.safeParse({ projectId: id, workDate: '2026-03-02', hours: 25 }).success).toBe(false);
    expect(hoursToMinutes(1.75)).toBe(105); expect(minutesToHours(105)).toBe(1.75);
  });
  it('limits the submit range and the decision payload', () => {
    expect(submitSchema.safeParse({ from: '2026-03-02', to: '2026-03-08' }).success).toBe(true);
    expect(submitSchema.safeParse({ from: '2026-03-08', to: '2026-03-02' }).success).toBe(false);
    expect(submitSchema.safeParse({ from: '2026-01-01', to: '2026-03-01' }).success).toBe(false);
    expect(decideSchema.safeParse({ ids: [], decision: 'APPROVED' }).success).toBe(false);
    expect(decideSchema.safeParse({ ids: [id], decision: 'MAYBE' }).success).toBe(false);
  });
  it('counts weekdays and builds month ranges', () => {
    expect(weekdaysInRange(new Date('2026-03-02T00:00:00Z'), new Date('2026-03-08T00:00:00Z'))).toBe(5);
    const r = monthRange('2026-02');
    expect(r.from.toISOString().slice(0, 10)).toBe('2026-02-01'); expect(r.to.toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(monthRange('2028-02').to.getUTCDate()).toBe(29);
    expect(() => monthRange('2026-13')).toThrow();
    expect(monthsBetween(new Date('2026-01-15T00:00:00Z'), new Date('2026-03-02T00:00:00Z'))).toEqual(['2026-01', '2026-02', '2026-03']);
  });
});

describe('monthly salary', () => {
  it('validates a salary and picks the one in force on a day', () => {
    expect(salarySchema.safeParse({ monthlySalary: 45000, effectiveFrom: '2026-01-01' }).success).toBe(true);
    expect(salarySchema.safeParse({ monthlySalary: 0, effectiveFrom: '2026-01-01' }).success).toBe(false);
    expect(salarySchema.safeParse({ monthlySalary: 1000.123, effectiveFrom: '2026-01-01' }).success).toBe(false);
    const h = [{ effectiveFrom: new Date('2026-01-01T00:00:00Z'), monthlySalary: '40000.00' }, { effectiveFrom: new Date('2026-07-01T00:00:00Z'), monthlySalary: '48000.00' }];
    expect(salaryOn(h, new Date('2025-12-31T00:00:00Z'))).toBeNull();
    expect(salaryOn(h, new Date('2026-06-30T00:00:00Z'))).toBe(40000);
    expect(salaryOn(h, new Date('2026-07-01T00:00:00Z'))).toBe(48000);
  });

  it('spreads the salary by logged time and always adds up to the cent', () => {
    // 22 weekdays x 8 h = 176 h expected. 100 h on A and 40 h on B logged -> 140 h; the other 36 h stay unallocated.
    const salary = 4_500_000; // 45,000.00
    const r = allocateLabour(salary, { A: 6000, B: 2400 }, 176 * 60);
    expect(r.byProject.A! + r.byProject.B! + r.unallocatedCents).toBe(salary);
    expect(r.byProject.A).toBe(Math.round((salary * 6000) / (176 * 60)));
    expect(r.unallocatedCents).toBeGreaterThan(0);
    // logging more than the expected hours: the whole salary is shared by the hours worked, nothing unallocated
    const over = allocateLabour(salary, { A: 12000, B: 6000 }, 176 * 60);
    expect(over.unallocatedCents).toBe(0);
    expect(over.byProject.A! + over.byProject.B!).toBe(salary);
    expect(over.byProject.A).toBe(3_000_000);
    // awkward split still balances exactly
    const odd = allocateLabour(1_000_001, { A: 100, B: 100, C: 100 }, 300);
    expect(odd.byProject.A! + odd.byProject.B! + odd.byProject.C! + odd.unallocatedCents).toBe(1_000_001);
    // no logged time: the whole salary is unallocated
    expect(allocateLabour(salary, {}, 176 * 60)).toEqual({ byProject: {}, unallocatedCents: salary });
  });

  it('computes project result, margin and budget use', () => {
    const r = projectResult({ revenueCents: 1_000_000, materialCents: 400_000, expenseCents: 50_000, labourCents: 150_000, budgetCents: 500_000 });
    expect(r).toMatchObject({ costCents: 600_000, profitCents: 400_000, marginPct: 40, budgetUsedPct: 120, overBudget: true });
    expect(projectResult({ revenueCents: 0, materialCents: 0, expenseCents: 0, labourCents: 0 }).marginPct).toBeNull();
  });
});

describe('access rights for the new modules', () => {
  it('only finance roles see salaries; project managers approve time', () => {
    expect(ALL_PERMISSIONS).toContain('payroll:view'); expect(ALL_PERMISSIONS).toContain('timesheet:approve');
    expect(defaultPermissionsFor('ACCOUNTANT')).toEqual(expect.arrayContaining(['payroll:view', 'payroll:edit', 'timesheet:export']));
    expect(defaultPermissionsFor('PROJECT_MANAGER')).toContain('timesheet:approve');
    expect(defaultPermissionsFor('PROJECT_MANAGER')).not.toContain('payroll:view');
    for (const r of ['SALES_MANAGER', 'SALES_EXECUTIVE', 'SOLAR_DESIGNER', 'SURVEY_ENGINEER', 'INSTALLATION_TECHNICIAN', 'PROJECT_MANAGER', 'CUSTOMER'] as const) expect(defaultPermissionsFor(r)).not.toContain('payroll:view');
    expect(defaultPermissionsFor('INSTALLATION_TECHNICIAN')).toEqual(expect.arrayContaining(['timesheet:view', 'timesheet:create', 'timesheet:edit']));
    expect(defaultPermissionsFor('INSTALLATION_TECHNICIAN')).not.toContain('timesheet:approve');
    expect(defaultPermissionsFor('ORG_OWNER')).toEqual(expect.arrayContaining(['payroll:view', 'payroll:edit', 'timesheet:approve']));
  });
});
