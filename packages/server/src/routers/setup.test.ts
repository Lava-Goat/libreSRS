// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { TRPCError } from '@trpc/server';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();
const originalEnv = process.env;

function createRequest(options: {
  protocol?: string;
  headers?: Record<string, string | undefined>;
} = {}): Request {
  const headerMap = new Map<string, string | undefined>(
    Object.entries(options.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value])
  );

  return {
    protocol: options.protocol ?? 'https',
    get(name: string) {
      return headerMap.get(name.toLowerCase());
    },
  } as unknown as Request;
}

async function createSetupCaller(req: Request) {
  const { setupRouter } = await import('./setup.js');
  return setupRouter.createCaller({
    req,
    res: {} as Response,
    user: null,
  });
}

async function expectTrpcCode(promise: Promise<unknown>, expectedCode: TRPCError['code']) {
  try {
    await promise;
    throw new Error(`Expected ${expectedCode} error`);
  } catch (error) {
    expect(error).toBeInstanceOf(TRPCError);
    expect((error as TRPCError).code).toBe(expectedCode);
  }
}

describe('setup router', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({
      db: testDb,
      schema,
    }));

    await setupFsrsSchema(client, { reset: true });
    process.env = { ...originalEnv };

    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.ADMIN_EMAIL;
    delete process.env.CLEVER_CLIENT_ID;
    delete process.env.CLEVER_CLIENT_SECRET;
    process.env.APP_SETTINGS_ENCRYPTION_KEY = 'router-setup-test-key';
  });

  afterAll(async () => {
    process.env = originalEnv;
    await client.close();
  });

  it('reports setup status with forwarded callback URL and feature flags', async () => {
    process.env.ADMIN_EMAIL = 'admin@example.com';
    process.env.CLEVER_CLIENT_ID = 'clever-id';
    process.env.CLEVER_CLIENT_SECRET = 'clever-secret';

    const req = createRequest({
      protocol: 'http',
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'school.example.com',
      },
    });

    const caller = await createSetupCaller(req);
    const status = await caller.getStatus();

    expect(status).toEqual({
      needsSetup: true,
      callbackUrl: 'https://school.example.com/auth/google/callback',
      hasAdminEmail: true,
      cleverEnabled: true,
    });
  });

  it('reports cleverEnabled=false when CLEVER_AUTH_DISABLED is set, even with credentials stored', async () => {
    process.env.CLEVER_AUTH_DISABLED = 'true';
    process.env.CLEVER_CLIENT_ID = 'clever-id';
    process.env.CLEVER_CLIENT_SECRET = 'clever-secret';
    try {
      const req = createRequest({
        protocol: 'http',
        headers: {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'school.example.com',
        },
      });

      const caller = await createSetupCaller(req);
      const status = await caller.getStatus();

      expect(status.cleverEnabled).toBe(false);
    } finally {
      delete process.env.CLEVER_AUTH_DISABLED;
    }
  });

  it('saves OAuth credentials, encrypts the secret, and marks setup complete', async () => {
    const { setStrategyRegistrar } = await import('../services/setupState.js');
    setStrategyRegistrar(async () => true);

    const caller = await createSetupCaller(createRequest({
      headers: {
        host: 'school.example.com',
      },
    }));

    const result = await caller.saveCredentials({
      googleClientId: '  test.apps.googleusercontent.com  ',
      googleClientSecret: '  super-secret  ',
    });
    expect(result).toEqual({ success: true });

    const row = await testDb.query.appSettings.findFirst({
      where: (appSettings, { eq }) => eq(appSettings.id, 1),
    });

    expect(row).toBeTruthy();
    expect(row?.googleClientId).toBe('test.apps.googleusercontent.com');
    expect(row?.googleClientSecret).not.toBe('super-secret');
    expect(row?.googleClientSecret?.startsWith('enc:v1:')).toBe(true);
    expect(process.env.GOOGLE_CLIENT_ID).toBe('test.apps.googleusercontent.com');
    expect(process.env.GOOGLE_CLIENT_SECRET).toBe('super-secret');

    const status = await caller.getStatus();
    expect(status.needsSetup).toBe(false);
  });

  it('rejects invalid client IDs', async () => {
    const { setStrategyRegistrar } = await import('../services/setupState.js');
    setStrategyRegistrar(async () => true);

    const caller = await createSetupCaller(createRequest({
      headers: { host: 'school.example.com' },
    }));

    await expectTrpcCode(
      caller.saveCredentials({
        googleClientId: 'not-a-google-client-id',
        googleClientSecret: 'secret',
      }),
      'BAD_REQUEST'
    );
  });

  it('forbids saving credentials after setup has already been completed', async () => {
    const { setStrategyRegistrar } = await import('../services/setupState.js');
    setStrategyRegistrar(async () => true);

    const caller = await createSetupCaller(createRequest({
      headers: { host: 'school.example.com' },
    }));

    await caller.saveCredentials({
      googleClientId: 'first.apps.googleusercontent.com',
      googleClientSecret: 'first-secret',
    });

    await expectTrpcCode(
      caller.saveCredentials({
        googleClientId: 'second.apps.googleusercontent.com',
        googleClientSecret: 'second-secret',
      }),
      'FORBIDDEN'
    );
  });

  it('returns internal error when OAuth strategy registration fails', async () => {
    const { setStrategyRegistrar } = await import('../services/setupState.js');
    setStrategyRegistrar(async () => false);

    const caller = await createSetupCaller(createRequest({
      headers: { host: 'school.example.com' },
    }));

    await expectTrpcCode(
      caller.saveCredentials({
        googleClientId: 'test.apps.googleusercontent.com',
        googleClientSecret: 'secret',
      }),
      'INTERNAL_SERVER_ERROR'
    );
  });
});
