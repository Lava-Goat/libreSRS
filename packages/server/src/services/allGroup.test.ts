// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import * as schema from '../db/schema.js';
import { createTestDb, setupFsrsSchema } from '../testUtils/fsrsTestDb.js';

const { client, db: testDb } = createTestDb();

describe('allGroup service', () => {
  afterAll(async () => {
    await client.close();
  });

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../db/index.js', () => ({
      db: testDb,
      schema,
    }));

    await setupFsrsSchema(client, { reset: true });
  });

  it('creates the All group when it does not exist', async () => {
    const { ensureAllGroup } = await import('./allGroup.js');

    const groupId = await ensureAllGroup();

    expect(groupId).toBeGreaterThan(0);
    const group = await testDb.query.groups.findFirst({
      where: (groups, { eq }) => eq(groups.name, 'All'),
    });
    expect(group).toBeDefined();
    expect(group!.name).toBe('All');
  });

  it('is idempotent — returns same group on second call', async () => {
    const { ensureAllGroup } = await import('./allGroup.js');

    const id1 = await ensureAllGroup();
    const id2 = await ensureAllGroup();

    expect(id1).toBe(id2);

    const groups = await testDb.query.groups.findMany({
      where: (groups, { eq }) => eq(groups.name, 'All'),
    });
    expect(groups).toHaveLength(1);
  });

  it('backfills existing users into the All group', async () => {
    await testDb.insert(schema.users).values([
      { id: 1, googleId: 'u1', email: 'a@example.test', name: 'A', role: 'user' },
      { id: 2, googleId: 'u2', email: 'b@example.test', name: 'B', role: 'user' },
    ]);

    const { ensureAllGroup } = await import('./allGroup.js');
    const groupId = await ensureAllGroup();

    const memberships = await testDb.query.userGroups.findMany({
      where: (ug, { eq }) => eq(ug.groupId, groupId),
    });
    expect(memberships).toHaveLength(2);
  });

  it('addUserToAllGroup adds a single user', async () => {
    const { ensureAllGroup, addUserToAllGroup } = await import('./allGroup.js');
    const groupId = await ensureAllGroup();

    await testDb.insert(schema.users).values({
      id: 1, googleId: 'u1', email: 'a@example.test', name: 'A', role: 'user',
    });

    await addUserToAllGroup(1);

    const memberships = await testDb.query.userGroups.findMany({
      where: (ug, { eq }) => eq(ug.groupId, groupId),
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].userId).toBe(1);
  });

  it('addUserToAllGroup is idempotent', async () => {
    const { ensureAllGroup, addUserToAllGroup } = await import('./allGroup.js');
    const groupId = await ensureAllGroup();

    await testDb.insert(schema.users).values({
      id: 1, googleId: 'u1', email: 'a@example.test', name: 'A', role: 'user',
    });

    await addUserToAllGroup(1);
    await addUserToAllGroup(1);

    const memberships = await testDb.query.userGroups.findMany({
      where: (ug, { eq }) => eq(ug.groupId, groupId),
    });
    expect(memberships).toHaveLength(1);
  });
});
