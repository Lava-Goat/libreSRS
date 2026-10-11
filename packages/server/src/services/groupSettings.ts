// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { type AdminUserSettingsUpdate, updateUserSettingsAdmin } from './userSettings.js';
import { readMnemonicMode } from './mnemonicMode.js';

export const DEFAULT_GROUP_SETTINGS: AdminUserSettingsUpdate = {
  newCardsPerDay: 20,
  reviewsPerDay: 20,
  isOverride: false,
  allowHigher: true,
  allowLower: true,
  aiEnabled: true,
  aiEnabledLocked: false,
  autoPlayAudio: false,
  autoPlayAudioLocked: false,
  autoPlayAudioFront: false,
  autoPlayAudioFrontLocked: false,
  mnemonicMode: 'manual',
  mnemonicModeLocked: false,
  locale: null,
  localeLocked: false,
};

export async function getOrCreateGroupSettings(groupId: number) {
  await db
    .insert(schema.groupSettings)
    .values({
      groupId,
      ...DEFAULT_GROUP_SETTINGS,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing({
      target: schema.groupSettings.groupId,
    });

  const settings = await db.query.groupSettings.findFirst({
    where: eq(schema.groupSettings.groupId, groupId),
  });

  if (!settings) {
    throw new Error('Failed to create group settings');
  }

  return settings;
}

export async function updateGroupSettings(
  groupId: number,
  updates: AdminUserSettingsUpdate
) {
  const existing = await db.query.groupSettings.findFirst({
    where: eq(schema.groupSettings.groupId, groupId),
  });

  if (!existing) {
    const created = await db
      .insert(schema.groupSettings)
      .values({
        groupId,
        newCardsPerDay: updates.newCardsPerDay,
        reviewsPerDay: updates.reviewsPerDay,
        isOverride: updates.isOverride,
        allowHigher: updates.allowHigher,
        allowLower: updates.allowLower,
        aiEnabled: updates.aiEnabled,
        aiEnabledLocked: updates.aiEnabledLocked,
        autoPlayAudio: updates.autoPlayAudio,
        autoPlayAudioLocked: updates.autoPlayAudioLocked,
        autoPlayAudioFront: updates.autoPlayAudioFront,
        autoPlayAudioFrontLocked: updates.autoPlayAudioFrontLocked,
        mnemonicMode: updates.mnemonicMode,
        mnemonicModeLocked: updates.mnemonicModeLocked,
        locale: updates.locale,
        localeLocked: updates.localeLocked,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return created[0];
  }

  const updated = await db
    .update(schema.groupSettings)
    .set({
      newCardsPerDay: updates.newCardsPerDay,
      reviewsPerDay: updates.reviewsPerDay,
      isOverride: updates.isOverride,
      allowHigher: updates.allowHigher,
      allowLower: updates.allowLower,
      aiEnabled: updates.aiEnabled,
      aiEnabledLocked: updates.aiEnabledLocked,
      autoPlayAudio: updates.autoPlayAudio,
      autoPlayAudioLocked: updates.autoPlayAudioLocked,
      autoPlayAudioFront: updates.autoPlayAudioFront,
      autoPlayAudioFrontLocked: updates.autoPlayAudioFrontLocked,
      mnemonicMode: updates.mnemonicMode,
      mnemonicModeLocked: updates.mnemonicModeLocked,
      locale: updates.locale,
      localeLocked: updates.localeLocked,
      updatedAt: new Date(),
    })
    .where(eq(schema.groupSettings.groupId, groupId))
    .returning();

  return updated[0];
}

/** A group's settings row as the admin update every member gets. */
function groupSettingsToUserUpdate(
  row: typeof schema.groupSettings.$inferSelect
): AdminUserSettingsUpdate {
  return {
    newCardsPerDay: row.newCardsPerDay,
    reviewsPerDay: row.reviewsPerDay,
    isOverride: row.isOverride ?? false,
    allowHigher: row.allowHigher ?? true,
    allowLower: row.allowLower ?? true,
    aiEnabled: row.aiEnabled ?? true,
    aiEnabledLocked: row.aiEnabledLocked ?? false,
    autoPlayAudio: row.autoPlayAudio ?? false,
    autoPlayAudioLocked: row.autoPlayAudioLocked ?? false,
    autoPlayAudioFront: row.autoPlayAudioFront ?? false,
    autoPlayAudioFrontLocked: row.autoPlayAudioFrontLocked ?? false,
    // A group saved before v1.20.0 may hold 'auto-non-cognate': its members get 'manual'.
    mnemonicMode: readMnemonicMode(row.mnemonicMode),
    mnemonicModeLocked: row.mnemonicModeLocked ?? false,
    locale: row.locale ?? null,
    localeLocked: row.localeLocked ?? false,
  };
}

export async function applyGroupSettingsToMembers(groupId: number): Promise<number> {
  const [groupSettingsRow, members] = await Promise.all([
    getOrCreateGroupSettings(groupId),
    db.query.userGroups.findMany({
      where: eq(schema.userGroups.groupId, groupId),
    }),
  ]);

  const updates = groupSettingsToUserUpdate(groupSettingsRow);

  await Promise.all(
    members.map((member) => updateUserSettingsAdmin(member.userId, updates))
  );

  return members.length;
}

/**
 * A student added to a group later gets the group's settings, the same fields "Apply to All
 * Members" writes (limits, AI, audio, mnemonics, locale, and their locks), but
 * only when the group's Override is on. It does nothing when the group has no settings row
 * (none is created) or its Override is off, or for someone who is not in the group.
 * Call it after the membership insert, outside any transaction. With several groups, the last
 * one applied wins. Returns how many users were updated.
 */
export async function applyGroupSettingsToUsers(groupId: number, userIds: number[]): Promise<number> {
  if (userIds.length === 0) return 0;
  const groupSettingsRow = await db.query.groupSettings.findFirst({
    where: eq(schema.groupSettings.groupId, groupId),
  });
  if (!groupSettingsRow?.isOverride) return 0;

  const members = await db.query.userGroups.findMany({
    where: and(
      eq(schema.userGroups.groupId, groupId),
      inArray(schema.userGroups.userId, [...new Set(userIds)]),
    ),
  });
  const updates = groupSettingsToUserUpdate(groupSettingsRow);
  for (const member of members) {
    await updateUserSettingsAdmin(member.userId, updates);
  }
  return members.length;
}

/** One student's join: see applyGroupSettingsToUsers. True when applied. */
export async function applyGroupSettingsToUser(groupId: number, userId: number): Promise<boolean> {
  return (await applyGroupSettingsToUsers(groupId, [userId])) > 0;
}
