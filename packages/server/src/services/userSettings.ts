// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { type MnemonicMode, readMnemonicMode } from './mnemonicMode.js';

export type { MnemonicMode };

export const DEFAULT_USER_SETTINGS = {
  newCardsPerDay: 20,
  reviewsPerDay: 20,
  aiEnabled: true,
  autoPlayAudio: false,
  autoPlayAudioFront: false,
  mnemonicMode: 'manual' as MnemonicMode,
};

export interface EffectiveLimits {
  newCardsPerDay: number;
  reviewsPerDay: number;
}

export interface EffectiveDeckSettings extends EffectiveLimits {
  aiEnabled: boolean;
  autoPlayAudio: boolean;
  autoPlayAudioFront: boolean;
  mnemonicMode: MnemonicMode;
}

/**
 * How a student may set a deck's daily limits.
 * - `free`: any value (no teacher override, or the override allows both directions);
 * - `higher`: the teacher's value or more;
 * - `lower`: the teacher's value or less;
 * - `locked`: the teacher's value only.
 */
export type LimitRule = 'free' | 'locked' | 'higher' | 'lower';

type LimitLock = {
  isOverride?: boolean | null;
  allowHigher?: boolean | null;
  allowLower?: boolean | null;
};

/** The rule computeEffectiveLimits applies, as the deck form shows it. */
export function limitRuleFor(userSettings: LimitLock | null): LimitRule {
  if (!userSettings?.isOverride) return 'free';
  const allowHigher = userSettings.allowHigher ?? true;
  const allowLower = userSettings.allowLower ?? true;
  if (allowHigher && allowLower) return 'free';
  if (allowHigher) return 'higher';
  if (allowLower) return 'lower';
  return 'locked';
}

export function computeEffectiveLimits(
  userSettings: ({
    newCardsPerDay: number;
    reviewsPerDay: number;
  } & LimitLock) | null,
  deckSettings: {
    newCardsPerDay: number;
    reviewsPerDay: number;
  } | null
): EffectiveLimits {
  // With an override on, the user's own row holds the teacher's values.
  const baseNew = userSettings?.newCardsPerDay ?? DEFAULT_USER_SETTINGS.newCardsPerDay;
  const baseReviews = userSettings?.reviewsPerDay ?? DEFAULT_USER_SETTINGS.reviewsPerDay;
  const rule = limitRuleFor(userSettings);

  if (!deckSettings || rule === 'locked') {
    return { newCardsPerDay: baseNew, reviewsPerDay: baseReviews };
  }

  if (rule === 'higher') {
    return {
      newCardsPerDay: Math.max(baseNew, deckSettings.newCardsPerDay),
      reviewsPerDay: Math.max(baseReviews, deckSettings.reviewsPerDay),
    };
  }

  if (rule === 'lower') {
    return {
      newCardsPerDay: Math.min(baseNew, deckSettings.newCardsPerDay),
      reviewsPerDay: Math.min(baseReviews, deckSettings.reviewsPerDay),
    };
  }

  return {
    newCardsPerDay: deckSettings.newCardsPerDay,
    reviewsPerDay: deckSettings.reviewsPerDay,
  };
}

export async function getOrCreateUserSettings(userId: number) {
  await db
    .insert(schema.userSettings)
    .values({
      userId,
      newCardsPerDay: DEFAULT_USER_SETTINGS.newCardsPerDay,
      reviewsPerDay: DEFAULT_USER_SETTINGS.reviewsPerDay,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing({
      target: schema.userSettings.userId,
    });

  const settings = await db.query.userSettings.findFirst({
    where: eq(schema.userSettings.userId, userId),
  });
  if (!settings) {
    throw new Error('Failed to create user settings');
  }

  return settings;
}

export async function updateUserSettings(
  userId: number,
  updates: {
    newCardsPerDay: number;
    reviewsPerDay: number;
    aiEnabled?: boolean;
    autoPlayAudio?: boolean;
    autoPlayAudioFront?: boolean;
    mnemonicMode?: MnemonicMode;
    locale?: string | null;
  }
) {
  const existing = await db.query.userSettings.findFirst({
    where: eq(schema.userSettings.userId, userId),
  });

  const aiEnabled = updates.aiEnabled ?? true;

  if (!existing) {
    const created = await db
      .insert(schema.userSettings)
      .values({
        userId,
        newCardsPerDay: updates.newCardsPerDay,
        reviewsPerDay: updates.reviewsPerDay,
        aiEnabled,
        autoPlayAudio: updates.autoPlayAudio ?? false,
        autoPlayAudioFront: updates.autoPlayAudioFront ?? false,
        mnemonicMode: updates.mnemonicMode ?? DEFAULT_USER_SETTINGS.mnemonicMode,
        locale: updates.locale ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return created[0];
  }

  const setData: Record<string, unknown> = { updatedAt: new Date() };
  // A teacher's override is the student's base limit (computeEffectiveLimits): the student's own
  // form must not rewrite it, or "allow higher/lower" would lock nothing.
  if (!existing.isOverride) {
    setData.newCardsPerDay = updates.newCardsPerDay;
    setData.reviewsPerDay = updates.reviewsPerDay;
  }
  // Respect locked fields — skip any update if the field is admin-locked
  if (updates.aiEnabled !== undefined && !existing.aiEnabledLocked) {
    setData.aiEnabled = updates.aiEnabled;
  }
  if (updates.autoPlayAudio !== undefined && !existing.autoPlayAudioLocked) {
    setData.autoPlayAudio = updates.autoPlayAudio;
  }
  if (updates.autoPlayAudioFront !== undefined && !existing.autoPlayAudioFrontLocked) {
    setData.autoPlayAudioFront = updates.autoPlayAudioFront;
  }
  if (updates.mnemonicMode !== undefined && !existing.mnemonicModeLocked) {
    setData.mnemonicMode = updates.mnemonicMode;
  }
  if (updates.locale !== undefined && !existing.localeLocked) {
    setData.locale = updates.locale;
  }

  const updated = await db
    .update(schema.userSettings)
    .set(setData)
    .where(eq(schema.userSettings.userId, userId))
    .returning();

  return updated[0];
}

export interface AdminUserSettingsUpdate {
  newCardsPerDay: number;
  reviewsPerDay: number;
  isOverride: boolean;
  allowHigher: boolean;
  allowLower: boolean;
  aiEnabled: boolean;
  aiEnabledLocked: boolean;
  autoPlayAudio: boolean;
  autoPlayAudioLocked: boolean;
  autoPlayAudioFront: boolean;
  autoPlayAudioFrontLocked: boolean;
  mnemonicMode: MnemonicMode;
  mnemonicModeLocked: boolean;
  locale: string | null;
  localeLocked: boolean;
}

export async function updateUserSettingsAdmin(
  userId: number,
  updates: AdminUserSettingsUpdate
) {
  const existing = await db.query.userSettings.findFirst({
    where: eq(schema.userSettings.userId, userId),
  });

  if (!existing) {
    const created = await db
      .insert(schema.userSettings)
      .values({
        userId,
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
    .update(schema.userSettings)
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
    .where(eq(schema.userSettings.userId, userId))
    .returning();

  return updated[0];
}

export async function getDeckUserSettings(userId: number, deckId: number) {
  const userSettings = await getOrCreateUserSettings(userId);

  // Get deck-specific settings if they exist
  const deckSettings = await db.query.deckUserSettings.findFirst({
    where: and(
      eq(schema.deckUserSettings.userId, userId),
      eq(schema.deckUserSettings.deckId, deckId)
    ),
  });

  const effective = computeEffectiveLimits(userSettings, deckSettings ?? null);
  const limitRule = limitRuleFor(userSettings);
  // The teacher's values, whenever an override is on (even one that leaves the deck free).
  const teacherSet = userSettings.isOverride ?? false;

  // For AI/audio/mnemonic: deck value takes precedence when non-null
  const effectiveAiEnabled = deckSettings?.aiEnabled ?? userSettings.aiEnabled ?? DEFAULT_USER_SETTINGS.aiEnabled;
  const effectiveAutoPlayAudio = deckSettings?.autoPlayAudio ?? userSettings.autoPlayAudio ?? DEFAULT_USER_SETTINGS.autoPlayAudio;
  const effectiveAutoPlayAudioFront = deckSettings?.autoPlayAudioFront ?? userSettings.autoPlayAudioFront ?? DEFAULT_USER_SETTINGS.autoPlayAudioFront;
  const effectiveMnemonicMode = readMnemonicMode(deckSettings?.mnemonicMode ?? userSettings.mnemonicMode);

  return {
    userId,
    deckId,
    newCardsPerDay: effective.newCardsPerDay,
    reviewsPerDay: effective.reviewsPerDay,
    /** How the student may change the two limits on this deck (see LimitRule). */
    limitRule,
    /** The teacher's daily limits when an override is on; null otherwise. */
    teacherNewCardsPerDay: teacherSet ? userSettings.newCardsPerDay : null,
    teacherReviewsPerDay: teacherSet ? userSettings.reviewsPerDay : null,
    // Effective AI/audio/mnemonic settings
    aiEnabled: effectiveAiEnabled,
    autoPlayAudio: effectiveAutoPlayAudio,
    autoPlayAudioFront: effectiveAutoPlayAudioFront,
    mnemonicMode: effectiveMnemonicMode,
    // Raw deck overrides (null = using global default)
    deckAiEnabled: deckSettings?.aiEnabled ?? null,
    deckAutoPlayAudio: deckSettings?.autoPlayAudio ?? null,
    deckAutoPlayAudioFront: deckSettings?.autoPlayAudioFront ?? null,
    deckMnemonicMode: deckSettings?.mnemonicMode == null ? null : readMnemonicMode(deckSettings.mnemonicMode),
    createdAt: deckSettings?.createdAt ?? userSettings.createdAt,
    updatedAt: deckSettings?.updatedAt ?? userSettings.updatedAt,
  };
}

export async function updateDeckUserSettings(
  userId: number,
  deckId: number,
  updates: {
    newCardsPerDay: number;
    reviewsPerDay: number;
    aiEnabled?: boolean | null;
    autoPlayAudio?: boolean | null;
    autoPlayAudioFront?: boolean | null;
    mnemonicMode?: MnemonicMode | null;
  }
) {
  const existing = await db.query.deckUserSettings.findFirst({
    where: and(
      eq(schema.deckUserSettings.userId, userId),
      eq(schema.deckUserSettings.deckId, deckId)
    ),
  });

  if (!existing) {
    const created = await db
      .insert(schema.deckUserSettings)
      .values({
        userId,
        deckId,
        newCardsPerDay: updates.newCardsPerDay,
        reviewsPerDay: updates.reviewsPerDay,
        aiEnabled: updates.aiEnabled ?? null,
        autoPlayAudio: updates.autoPlayAudio ?? null,
        autoPlayAudioFront: updates.autoPlayAudioFront ?? null,
        mnemonicMode: updates.mnemonicMode ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return created[0];
  }

  const updated = await db
    .update(schema.deckUserSettings)
    .set({
      newCardsPerDay: updates.newCardsPerDay,
      reviewsPerDay: updates.reviewsPerDay,
      aiEnabled: updates.aiEnabled ?? null,
      autoPlayAudio: updates.autoPlayAudio ?? null,
      autoPlayAudioFront: updates.autoPlayAudioFront ?? null,
      mnemonicMode: updates.mnemonicMode ?? null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(schema.deckUserSettings.userId, userId),
      eq(schema.deckUserSettings.deckId, deckId)
    ))
    .returning();

  return updated[0];
}

export async function deleteDeckUserSettings(userId: number, deckId: number) {
  await db
    .delete(schema.deckUserSettings)
    .where(and(
      eq(schema.deckUserSettings.userId, userId),
      eq(schema.deckUserSettings.deckId, deckId)
    ));
}
