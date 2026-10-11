// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The in-app logo (v1.22.3). The ?v= stamp is part of the URL so a browser that kept the old logo
 * fetches the new one: a CDN or proxy in front of the app may cache every file for hours (max-age=14400), and
 * v1.22.1 drew the new logo under the old URLs. Change the stamp whenever the logo changes, here
 * and in index.html's icon links (brand.test.ts checks that they agree).
 */
export const LOGO_VERSION = '20261010';
export const LOGO_SRC = `/logo.svg?v=${LOGO_VERSION}`;
