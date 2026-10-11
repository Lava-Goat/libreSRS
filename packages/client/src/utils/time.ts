// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
export function getTimezoneOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}
