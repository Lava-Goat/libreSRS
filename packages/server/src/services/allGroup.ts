// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../logger.js';

export const ALL_GROUP_NAME = 'All';

export async function ensureAllGroup(): Promise<number> {
  const existing = await db.query.groups.findFirst({
    where: eq(schema.groups.name, ALL_GROUP_NAME),
  });

  let groupId: number;

  if (existing) {
    groupId = existing.id;
  } else {
    const [created] = await db
      .insert(schema.groups)
      .values({ name: ALL_GROUP_NAME, description: 'All users' })
      .returning();
    groupId = created.id;
    logger.info({ groupId }, 'Created "All" group');
  }

  // Backfill all existing users into the group
  const allUsers = await db.query.users.findMany({
    columns: { id: true },
  });

  for (const user of allUsers) {
    await db
      .insert(schema.userGroups)
      .values({ userId: user.id, groupId })
      .onConflictDoNothing();
  }

  return groupId;
}

export async function addUserToAllGroup(userId: number): Promise<void> {
  const allGroup = await db.query.groups.findFirst({
    where: eq(schema.groups.name, ALL_GROUP_NAME),
  });

  if (!allGroup) return;

  await db
    .insert(schema.userGroups)
    .values({ userId, groupId: allGroup.id })
    .onConflictDoNothing();
}
