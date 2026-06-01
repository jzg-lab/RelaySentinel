export function predictHoursRemaining(currentPercent: number, hourlyBurnPercent: number): number {
  if (hourlyBurnPercent <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  return currentPercent / hourlyBurnPercent;
}

export function isQuotaBelowThreshold(hoursRemaining: number, thresholdHours: number): boolean {
  return Number.isFinite(hoursRemaining) && hoursRemaining < thresholdHours;
}
