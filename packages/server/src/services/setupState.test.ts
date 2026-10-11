// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./appSettings.js', () => ({
  getAppSettings: vi.fn(),
}));

import { getAppSettings } from './appSettings.js';
import {
  isGoogleOAuthConfigured,
  isSetupComplete,
  registerGoogleStrategy,
  setStrategyRegistrar,
} from './setupState.js';

describe('setupState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when Google OAuth credentials are configured', async () => {
    vi.mocked(getAppSettings).mockResolvedValue({
      googleClientId: 'client-id',
      googleClientSecret: 'client-secret',
    } as Awaited<ReturnType<typeof getAppSettings>>);

    await expect(isGoogleOAuthConfigured()).resolves.toBe(true);
    await expect(isSetupComplete()).resolves.toBe(true);
  });

  it('returns false when client id or secret is missing/blank', async () => {
    vi.mocked(getAppSettings).mockResolvedValue({
      googleClientId: '   ',
      googleClientSecret: 'secret',
    } as Awaited<ReturnType<typeof getAppSettings>>);
    await expect(isGoogleOAuthConfigured()).resolves.toBe(false);

    vi.mocked(getAppSettings).mockResolvedValue({
      googleClientId: 'client',
      googleClientSecret: '',
    } as Awaited<ReturnType<typeof getAppSettings>>);
    await expect(isGoogleOAuthConfigured()).resolves.toBe(false);
  });

  it('returns false when strategy registrar is not configured', async () => {
    vi.resetModules();
    const freshModule = await import('./setupState.js');
    await expect(freshModule.registerGoogleStrategy()).resolves.toBe(false);
  });

  it('calls configured strategy registrar and returns its boolean', async () => {
    const registrar = vi.fn(async () => true);
    setStrategyRegistrar(registrar);

    await expect(registerGoogleStrategy()).resolves.toBe(true);
    expect(registrar).toHaveBeenCalledTimes(1);
  });
});

