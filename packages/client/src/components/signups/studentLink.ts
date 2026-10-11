// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/** The address to give students (Canvas, an announcement): signing in brings them back to it. */
export function studentLink(sheetId: number): string {
  return `${window.location.origin}/signups?sheet=${sheetId}`;
}
