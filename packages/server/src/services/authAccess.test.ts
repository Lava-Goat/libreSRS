// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();
const originalAdminEmail = process.env.ADMIN_EMAIL;

describe('auth access bootstrap rules', () => {
  afterAll(async () => {
    process.env.ADMIN_EMAIL = originalAdminEmail;
    await client.close();
  });

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({
      db: testDb,
      schema,
    }));

    await setupFsrsSchema(client, { reset: true });
    delete process.env.ADMIN_EMAIL;
  });

  it('allows configured admin email for initial sign-in and assigns admin role', async () => {
    process.env.ADMIN_EMAIL = 'admin@example.com';

    const { checkEmailAllowed, getNewUserRole } = await import('./authAccess.js');
    const decision = await checkEmailAllowed('admin@example.com');

    expect(decision).toEqual({ allowed: true, reason: 'admin_email' });
    expect(getNewUserRole('Admin@Example.com')).toBe('admin');
  });

  it('denies non-admin initial sign-ins until the admin account exists', async () => {
    process.env.ADMIN_EMAIL = 'admin@example.com';

    const { checkEmailAllowed, getNewUserRole } = await import('./authAccess.js');
    const decision = await checkEmailAllowed('teacher@example.com');

    expect(decision).toEqual({ allowed: false, reason: 'initial_admin_required' });
    expect(getNewUserRole('teacher@example.com')).toBe('user');
  });

  it('requires ADMIN_EMAIL before any user can sign in', async () => {
    const { checkEmailAllowed } = await import('./authAccess.js');
    const decision = await checkEmailAllowed('teacher@example.com');

    expect(decision).toEqual({ allowed: false, reason: 'initial_admin_not_configured' });
  });

  it('allows existing users regardless of allowlist', async () => {
    await testDb.insert(schema.users).values({
      id: 1,
      googleId: 'existing-google-id',
      email: 'existing@example.com',
      name: 'Existing User',
      role: 'user',
    });

    const { checkEmailAllowed } = await import('./authAccess.js');
    const decision = await checkEmailAllowed('existing@example.com');

    expect(decision).toEqual({ allowed: true, reason: 'existing_user' });
  });

  it('allows allowlisted users once bootstrap is complete', async () => {
    process.env.ADMIN_EMAIL = 'admin@example.com';

    await testDb.insert(schema.users).values({
      id: 1,
      googleId: 'admin-google-id',
      email: 'admin@example.com',
      name: 'Admin User',
      role: 'admin',
    });

    await testDb.insert(schema.allowedEmails).values({
      pattern: 'teacher@example.com',
      isRegex: false,
      createdBy: 1,
    });

    const { checkEmailAllowed } = await import('./authAccess.js');
    const decision = await checkEmailAllowed('teacher@example.com');

    expect(decision).toEqual({ allowed: true, reason: 'allowlist' });
  });
});
