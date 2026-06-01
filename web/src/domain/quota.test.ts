import { describe, expect, it } from 'vitest';
import { isQuotaBelowThreshold, predictHoursRemaining } from './quota';

describe('quota prediction', () => {
  it('predicts remaining hours from current percent and hourly burn', () => {
    expect(predictHoursRemaining(18, 3.75)).toBeCloseTo(4.8, 2);
  });

  it('returns infinity when burn rate is zero', () => {
    expect(predictHoursRemaining(86.7, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('marks quota as alerting when remaining hours is below threshold', () => {
    expect(isQuotaBelowThreshold(4.8, 5)).toBe(true);
    expect(isQuotaBelowThreshold(31, 5)).toBe(false);
  });
});
