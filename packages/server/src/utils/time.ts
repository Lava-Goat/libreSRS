// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
export function resolveTimezoneOffsetMinutes(offsetMinutes?: number): number {
  if (typeof offsetMinutes === 'number' && Number.isFinite(offsetMinutes)) {
    return offsetMinutes;
  }
  return -new Date().getTimezoneOffset();
}

export function startOfDayForOffset(offsetMinutes?: number, now: Date = new Date()): Date {
  const resolvedOffset = resolveTimezoneOffsetMinutes(offsetMinutes);
  const shifted = new Date(now.getTime() + resolvedOffset * 60 * 1000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - resolvedOffset * 60 * 1000);
}
