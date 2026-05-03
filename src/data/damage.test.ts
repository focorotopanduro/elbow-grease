import { describe, it, expect } from 'vitest';
import { DAMAGE_BY_STAGE, INSURANCE_PREMIUM, fmtMoney, fmtRange } from './damage';

describe('damage cost estimates', () => {
  it('every cascade stage has an estimate', () => {
    expect(DAMAGE_BY_STAGE.drip_edge).toBeDefined();
    expect(DAMAGE_BY_STAGE.field_shingles).toBeDefined();
    expect(DAMAGE_BY_STAGE.underlayment).toBeDefined();
    expect(DAMAGE_BY_STAGE.sheathing).toBeDefined();
  });

  it('estimates increase monotonically with stage severity', () => {
    expect(DAMAGE_BY_STAGE.field_shingles.repairLow).toBeGreaterThan(DAMAGE_BY_STAGE.drip_edge.repairLow);
    expect(DAMAGE_BY_STAGE.underlayment.repairLow).toBeGreaterThan(DAMAGE_BY_STAGE.field_shingles.repairLow);
    expect(DAMAGE_BY_STAGE.sheathing.repairLow).toBeGreaterThan(DAMAGE_BY_STAGE.underlayment.repairLow);
  });

  it('every estimate has a scope and source citation', () => {
    Object.values(DAMAGE_BY_STAGE).forEach((d) => {
      expect(d.scope.length).toBeGreaterThan(20);
      expect(d.source.length).toBeGreaterThan(8);
    });
  });

  it('insurance premium for pre-2002 is meaningfully higher than fully mitigated', () => {
    expect(INSURANCE_PREMIUM.pre2002_unmitigated.low).toBeGreaterThan(INSURANCE_PREMIUM.fbc_fully_mitigated.high);
  });
});

describe('formatters', () => {
  it('fmtMoney adds thousand separators and dollar sign', () => {
    expect(fmtMoney(0)).toBe('$0');
    expect(fmtMoney(1500)).toBe('$1,500');
    expect(fmtMoney(85000)).toBe('$85,000');
  });

  it('fmtRange uses en-dash separator', () => {
    expect(fmtRange(1500, 4000)).toBe('$1,500\u2013$4,000');
  });
});
