// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { getAppSettings } from './appSettings.js';

type StrategyRegistrar = () => boolean | Promise<boolean>;

let _registrar: StrategyRegistrar | null = null;

export async function isGoogleOAuthConfigured(): Promise<boolean> {
  const settings = await getAppSettings();
  return Boolean(
    settings.googleClientId?.trim() &&
    settings.googleClientSecret?.trim()
  );
}

export async function isSetupComplete(): Promise<boolean> {
  return isGoogleOAuthConfigured();
}

export function setStrategyRegistrar(fn: StrategyRegistrar): void {
  _registrar = fn;
}

export async function registerGoogleStrategy(): Promise<boolean> {
  if (!_registrar) {
    return false;
  }
  return await _registrar();
}

/**
 * Mothball switch for Clever login (set CLEVER_AUTH_DISABLED=true in the
 * environment). The feature stays in the code base and stored credentials are
 * untouched — the flag hides the login button, reports cleverEnabled=false
 * everywhere, and routes /auth/clever* to the not-configured redirect.
 * Unset the variable to bring Clever back.
 */
export function isCleverAuthDisabled(): boolean {
  return (process.env.CLEVER_AUTH_DISABLED ?? '').trim().toLowerCase() === 'true';
}

