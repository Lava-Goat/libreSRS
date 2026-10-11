// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE

/**
 * @module adminRouter
 *
 * Admin-only tRPC procedures: user and group management, roster import,
 * deck and card administration, AI configuration, analytics export.
 *
 * Module invariants
 * -----------------
 * • ALL procedures are `adminProcedure`.  requireAdmin is enforced in the tRPC
 *   context; no data access occurs until role === 'admin' is confirmed.
 * • CSV and Anki uploads are size-bounded before parsing:
 *     CSV:  CSV_MAX_CHARS = 2 MB
 *     APKG: APKG_MAX_BASE64_CHARS derived from ANKI_APKG_MAX_BYTES
 *
 * Function ledger
 * ---------------
 * getGoogleClassroomTokensFromSession(req)   [private]
 *   Pure read from session object.  Returns null if tokens absent.
 *   No DB, no state change.
 *
 * importStudentsIntoGroup(input)   [private]
 *   Requires:  input.students is a de-duplicated list of ClassroomStudent records.
 *   Restores:  Group created, new users inserted, all users assigned to group
 *              and to the ALL group — atomically within one DB transaction.
 *   TOCTOU: existingUser pre-check is outside the transaction.  A concurrent
 *           registration could create a user between the check and the INSERT.
 *           `onConflictDoNothing()` inside the transaction makes the INSERT
 *           idempotent; the re-query inside the transaction captures any
 *           concurrently created users.
 *   Early-return (group insert fails): transaction aborts — no group, no users
 *           assigned, no userGroup rows.
 *
 * normalizeAggregatedDate(value)   [exported]
 *   Pure.  Handles: null/undefined → null, Date, numeric (seconds or ms), string.
 *   Numeric heuristic: values < 1_000_000_000_000 are treated as seconds.
 *   Returns null for NaN, Infinity, empty string, or unparseable input.
 *
 * importCardsIntoDeck(input)   [private]
 *   Requires:  deckId exists (logs warning but continues if not found).
 *   Restores:  Cards inserted via insertCardBatch (bulk; no AI call, so no cognate score
 *              since v1.20.0, and a CSV's cognate_score column is ignored).
 *   AI enrichment (mnemonics, assets) runs AFTER the card batch.  If it fails,
 *   card rows exist without AI data — partial enrichment is acceptable.
 *   Early-return: N/A — errors propagate to the caller.
 *
 * insertCardBatch(input)   [private]
 *   Requires:  deckId is a valid deck.
 *   Restores:  Cards inserted; duplicates (same front+back) are skipped via
 *              existingCardSet lookup before insert — no ON CONFLICT needed.
 *   Returns:   { count: number; insertedIds: number[] }
 *
 * lastActiveByUser(scope?)   [exported]
 *   Reads only.  One grouped max() per activity table (ratings, conjugation
 *   answers, lab events and turn-ins, "All Done!"), never one query per user.
 *   Scope: every user, one user (an id), or one group's members ({ groupId }).
 *
 * userDetailFor(userId, offset)   [private, admin.userDetail]
 *   Reads only: never creates a user_settings row (getOrCreateUserSettings would)
 *   nor a card state (dueToday.dueTodayByDeck, as the student's deck list).
 *   NOT_FOUND for an unknown user.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from './trpc.js';
import { db, schema } from '../db/index.js';
import { eq, sql, and, inArray, gte, ne, desc, isNull, isNotNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { parseCSV, type CSVCard } from '../services/csv.js';
import { parseAnkiApkgBase64InBatches, previewAnkiApkgFields, ANKI_APKG_MAX_BYTES } from '../services/anki.js';
import {
  DEFAULT_USER_SETTINGS, computeEffectiveLimits, getOrCreateUserSettings, limitRuleFor, updateUserSettingsAdmin,
} from '../services/userSettings.js';
import { mnemonicModeInput, readMnemonicMode } from '../services/mnemonicMode.js';
import {
  getOrCreateGroupSettings, updateGroupSettings, applyGroupSettingsToMembers, applyGroupSettingsToUser, applyGroupSettingsToUsers,
} from '../services/groupSettings.js';
import { getNewUserRole } from '../services/authAccess.js';
import { parseGoogleClassroomRoster, type ClassroomStudent } from '../services/googleClassroom.js';
import {
  fetchGoogleClassroomCourse,
  fetchGoogleClassroomCourses,
  fetchGoogleClassroomStudents,
  type GoogleClassroomAuthTokens,
} from '../services/googleClassroomApi.js';
import { fetchCleverSections, fetchCleverSectionStudents } from '../services/cleverApi.js';
import { tryCompileSafeRegex } from '../utils/regex.js';
import { ALL_GROUP_NAME } from '../services/allGroup.js';
import { startOfDayForOffset } from '../utils/time.js';
import { scanDeck } from '../services/ai/scanService.js';
import { updateAppSettings, getAppSettings } from '../services/appSettings.js';
import { logger } from '../logger.js';
import { isCleverAuthDisabled } from '../services/setupState.js';
import { State } from '../services/fsrs.js';
import { CardDirection } from '@libresrs/shared';
import { csvCell, groupLabsCsv } from '../services/labExport.js';
import { countingRow, neededForRow, studentLabStatus } from '../services/labCredit.js';
import { groupFlashcardDay, isDayString, schoolDayBounds, RATING_TIME_CAP_MS } from '../services/flashcardDay.js';
import { dueTodayByDeck } from '../services/dueToday.js';
import { getUserDeckIds } from '../services/deckAccess.js';
import { studentNumberFromEmail, studentNumberOverrideMap } from '../services/studentNumbers.js';
import { fieldsBeside } from '../extensions/api.js';
import { ext, type ExtensionFields } from '../extensions/registry.js';
import {
  deckQuizState, delayedAnswers, dueByStudent, keepStudyAllRoundsOf, mistakeLabel, practiceDays, responseTimes, roundStats,
  studentTopMistakes, studyAllRounds,
} from './conjugation.js';
import { isMastered, itemLadder, schoolDay } from '../services/conjugationQuiz.js';

const CSV_MAX_CHARS = 2 * 1024 * 1024;
const APKG_MAX_BASE64_CHARS = Math.ceil((ANKI_APKG_MAX_BYTES * 4) / 3) + 4;

type GroupImportSummary = {
  studentsParsed: number;
  usersCreated: number;
  usersAlreadyPresent: number;
  usersAssignedToGroup: number;
  duplicateEmailsSkipped: number;
  nonStudentRowsSkipped: number;
  errors: string[];
};

function getGoogleClassroomTokensFromSession(req: {
  session?: {
    googleClassroomAccessToken?: unknown;
    googleClassroomRefreshToken?: unknown;
  };
}): GoogleClassroomAuthTokens | null {
  const accessToken = typeof req.session?.googleClassroomAccessToken === 'string'
    ? req.session.googleClassroomAccessToken
    : null;

  if (!accessToken) {
    return null;
  }

  const refreshToken = typeof req.session?.googleClassroomRefreshToken === 'string'
    ? req.session.googleClassroomRefreshToken
    : null;

  return {
    accessToken,
    refreshToken,
  };
}

async function importStudentsIntoGroup(input: {
  name: string;
  description?: string;
  students: ClassroomStudent[];
  duplicateEmailsSkipped: number;
  nonStudentRowsSkipped: number;
  errors: string[];
}) {
  logger.info({
    event: 'admin.group_import.start',
    groupName: input.name,
    studentCount: input.students.length,
    duplicateEmailsSkipped: input.duplicateEmailsSkipped,
    nonStudentRowsSkipped: input.nonStudentRowsSkipped,
    parseErrorCount: input.errors.length,
  }, 'Starting group import');

  const importedEmails = input.students.map((student) => student.email);

  const existingUsersBefore = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
    })
    .from(schema.users)
    .where(inArray(schema.users.email, importedEmails));

  const existingEmailSet = new Set(existingUsersBefore.map((user) => user.email.toLowerCase()));
  const studentsToCreate = input.students.filter((student) => !existingEmailSet.has(student.email));

  // better-sqlite3 transactions are synchronous — no async callback, and each
  // statement executes via .all()/.get()/.run() instead of await.
  const result = db.transaction((tx) => {
    const insertedGroup = tx.insert(schema.groups).values({
      name: input.name,
      description: input.description,
    }).returning().all();

    const group = insertedGroup[0];
    if (!group) {
      throw new Error('Failed to create group from Google Classroom import');
    }

    if (studentsToCreate.length > 0) {
      tx.insert(schema.users).values(
        studentsToCreate.map((student) => ({
          googleId: `pending:${student.email}`,
          email: student.email,
          name: student.fullName,
          picture: null,
          role: getNewUserRole(student.email),
        }))
      ).onConflictDoNothing().run();
    }

    const importedUsers = tx
      .select({
        id: schema.users.id,
        email: schema.users.email,
      })
      .from(schema.users)
      .where(inArray(schema.users.email, importedEmails))
      .all();

    if (importedUsers.length > 0) {
      tx.insert(schema.userGroups).values(
        importedUsers.map((user) => ({
          userId: user.id,
          groupId: group.id,
        }))
      ).onConflictDoNothing().run();

      const allGroup = tx.query.groups.findFirst({
        where: eq(schema.groups.name, ALL_GROUP_NAME),
      }).sync();

      if (allGroup) {
        tx.insert(schema.userGroups).values(
          importedUsers.map((user) => ({
            userId: user.id,
            groupId: allGroup.id,
          }))
        ).onConflictDoNothing().run();
      }
    }

    return {
      group,
      importedUserCount: importedUsers.length,
    };
  });

  const summary: GroupImportSummary = {
    studentsParsed: input.students.length,
    usersCreated: studentsToCreate.length,
    usersAlreadyPresent: existingUsersBefore.length,
    usersAssignedToGroup: result.importedUserCount,
    duplicateEmailsSkipped: input.duplicateEmailsSkipped,
    nonStudentRowsSkipped: input.nonStudentRowsSkipped,
    errors: input.errors,
  };

  logger.info({
    event: 'admin.group_import.finish',
    groupId: result.group.id,
    groupName: result.group.name,
    ...summary,
  }, 'Completed group import');

  return {
    group: result.group,
    summary,
  };
}

export function normalizeAggregatedDate(value: unknown): Date | null {
  if (value == null) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    const asMs = value < 1_000_000_000_000 ? value * 1000 : value;
    const asDate = new Date(asMs);
    return Number.isNaN(asDate.getTime()) ? null : asDate;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      const asMs = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
      const asDate = new Date(asMs);
      return Number.isNaN(asDate.getTime()) ? null : asDate;
    }

    const asDate = new Date(trimmed);
    return Number.isNaN(asDate.getTime()) ? null : asDate;
  }

  return null;
}

async function importCardsIntoDeck(input: {
  deckId: number;
  userId: number;
  cards: CSVCard[];
}): Promise<void> {
  logger.info({
    event: 'admin.card_import.start',
    deckId: input.deckId,
    userId: input.userId,
    cardCount: input.cards.length,
  }, 'Starting card import');

  const deck = await db.query.decks.findFirst({
    where: eq(schema.decks.id, input.deckId),
  });
  if (!deck) {
    logger.warn({
      event: 'admin.card_import.deck_missing',
      deckId: input.deckId,
      userId: input.userId,
    }, 'Card import target deck was not found');
  }

  const { count: cardsInserted, insertedIds } = await insertCardBatch({
    deckId: input.deckId,
    cards: input.cards,
  });
  logger.info({
    event: 'admin.card_import.finish',
    deckId: input.deckId,
    userId: input.userId,
    cardsRequested: input.cards.length,
    cardsInserted,
  }, 'Card import completed');

  // Import optional mnemonic and AI asset data from CSV columns
  const mnemonicRows: (typeof schema.aiMnemonics.$inferInsert)[] = [];
  const assetRows: (typeof schema.aiAssets.$inferInsert)[] = [];
  for (let i = 0; i < insertedIds.length; i++) {
    const cardId = insertedIds[i];
    const csvCard = input.cards[i];
    if (!csvCard) continue;

    if (csvCard.mnemonic) {
      mnemonicRows.push({
        cardId,
        userId: input.userId,
        provider: 'csv-import',
        text: csvCard.mnemonic,
        sourcePrompt: '',
        accepted: true,
        acceptedAt: new Date(),
      });
    }

    const frontText = csvCard.front.replace(/<[^>]*>/g, '').trim();
    const backText = csvCard.back.replace(/<[^>]*>/g, '').trim();

    if (csvCard.audioFront) {
      assetRows.push({ cardId, assetType: 'audio', provider: 'csv-import', prompt: frontText, url: csvCard.audioFront, status: 'ready' });
    }
    if (csvCard.audioBack) {
      assetRows.push({ cardId, assetType: 'audio', provider: 'csv-import', prompt: backText, url: csvCard.audioBack, status: 'ready' });
    }
    if (csvCard.imageFront) {
      assetRows.push({ cardId, assetType: 'image', provider: 'csv-import', prompt: `front: ${frontText}`, url: csvCard.imageFront, status: 'ready' });
    }
    if (csvCard.imageBack) {
      assetRows.push({ cardId, assetType: 'image', provider: 'csv-import', prompt: backText, url: csvCard.imageBack, status: 'ready' });
    }
  }

  if (mnemonicRows.length > 0) {
    await db.insert(schema.aiMnemonics).values(mnemonicRows);
  }
  if (assetRows.length > 0) {
    await db.insert(schema.aiAssets).values(assetRows);
  }

  // Fire-and-forget scan for pronunciation + images.
  logger.debug({
    event: 'admin.card_import.scan.queued',
    deckId: input.deckId,
    userId: input.userId,
  }, 'Queued background scan after card import');
  scanDeck(input.deckId, input.userId)
    .then(() => {
      logger.info({
        event: 'admin.card_import.scan.completed',
        deckId: input.deckId,
        userId: input.userId,
      }, 'Background scan after card import completed');
    })
    .catch((err) => {
      logger.error({
        event: 'admin.card_import.scan.failed',
        err,
        deckId: input.deckId,
        userId: input.userId,
      }, 'Background scan after import failed');
    });
}

async function insertCardBatch(input: {
  deckId: number;
  cards: CSVCard[];
}): Promise<{ count: number; insertedIds: number[] }> {
  if (input.cards.length === 0) {
    logger.debug({
      event: 'admin.card_import.batch.empty',
      deckId: input.deckId,
    }, 'Skipped empty card import batch');
    return { count: 0, insertedIds: [] };
  }

  logger.debug({
    event: 'admin.card_import.batch.start',
    deckId: input.deckId,
    cardCount: input.cards.length,
  }, 'Inserting imported cards');

  const insertedCards = await db.insert(schema.cards).values(
    input.cards.map((card) => ({
      deckId: input.deckId,
      front: card.front,
      back: card.back,
      // An admin imports these, so they are the card's mnemonic for every student.
      mnemonic: card.mnemonic?.trim() || null,
    }))
  ).returning();

  logger.info({
    event: 'admin.card_import.batch.inserted',
    deckId: input.deckId,
    insertedCount: insertedCards.length,
  }, 'Inserted imported cards');

  return { count: insertedCards.length, insertedIds: insertedCards.map(c => c.id) };
}

/**
 * When each user last did something (ms): a flashcard rating, a conjugation
 * answer, a lab session or turn-in, or an "All Done!". One query over the
 * users, each table read per user through an index that ends at the user's
 * newest row (review_logs, lab_listen_events, lab_submissions and
 * study_completions by user and time; conjugation_answers by user, whose ids
 * grow with time), never a scan of a whole table: the server does nothing
 * else while it runs. Pass a user id to read only theirs, or { groupId } for
 * only that group's members (still one query).
 */
export function lastActiveByUser(scope?: number | { groupId: number }): Map<number, number> {
  const where = scope === undefined
    ? sql``
    : typeof scope === 'number'
      ? sql`where u.id = ${scope}`
      : sql`where u.id in (select g.user_id from user_groups g where g.group_id = ${scope.groupId})`;
  // Written out in full: each subquery must name the outer user by its own alias.
  const rows = db.all<{ userId: number; review: unknown; answer: unknown; listen: unknown; turnIn: unknown; finish: unknown }>(sql`
    select u.id as userId,
      (select r.reviewed_at from review_logs r where r.user_id = u.id order by r.reviewed_at desc limit 1) as review,
      (select a.at from conjugation_answers a where a.user_id = u.id order by a.id desc limit 1) as answer,
      (select e.at from lab_listen_events e where e.user_id = u.id order by e.at desc limit 1) as listen,
      (select l.submitted_at from lab_submissions l where l.user_id = u.id order by l.submitted_at desc limit 1) as turnIn,
      (select c.completed_at from study_completions c where c.user_id = u.id order by c.completed_at desc limit 1) as finish
    from users u
    ${where}
  `);

  const out = new Map<number, number>();
  for (const row of rows) {
    let latest = -Infinity;
    for (const value of [row.review, row.answer, row.listen, row.turnIn, row.finish]) {
      // Raw values: seconds for `timestamp` columns, ms for the others.
      const at = normalizeAggregatedDate(value)?.getTime();
      if (at !== undefined && at > latest) latest = at;
    }
    if (latest > -Infinity) out.set(row.userId, latest);
  }
  return out;
}

/** How many school days of "All Done!" the user detail shows per deck. */
export const FINISH_DAYS_SHOWN = 14;

/** The last `count` school days, oldest first, ending with today's (YYYY-MM-DD, America/Los_Angeles). */
export function lastSchoolDays(count: number, now = new Date()): string[] {
  const [year, month, date] = schoolDay(now).split('-').map(Number);
  return Array.from({ length: count }, (_, i) =>
    new Date(Date.UTC(year, month - 1, date - (count - 1 - i))).toISOString().slice(0, 10));
}

const byTitleOrName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Everything the Users tab's detail view shows about one user, read from the
 * tables that already hold it (nothing is created or changed): who they are,
 * their flashcards per assigned deck, conjugation per quiz, labs, speaking
 * tasks and their study limits, plus whatever an extension adds (its fields
 * last, in `user` and at the top level).
 */
async function userDetailFor(userId: number, timezoneOffsetMinutes: number | undefined, now = new Date()) {
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found', cause: { appCode: 'USER_NOT_FOUND' } });
  }

  const override = db.select({ studentNumber: schema.studentNumberOverrides.studentNumber })
    .from(schema.studentNumberOverrides).where(eq(schema.studentNumberOverrides.userId, userId)).get();
  const groups = db.select({ id: schema.groups.id, name: schema.groups.name })
    .from(schema.userGroups)
    .innerJoin(schema.groups, eq(schema.userGroups.groupId, schema.groups.id))
    .where(eq(schema.userGroups.userId, userId))
    .all()
    .sort((a, b) => byTitleOrName(a.name, b.name));
  const groupIds = groups.map((g) => g.id);

  // Study limits: the user's own row as the teacher set it (none means the defaults).
  const settingsRow = db.select().from(schema.userSettings).where(eq(schema.userSettings.userId, userId)).get() ?? null;
  const settings = {
    newCardsPerDay: settingsRow?.newCardsPerDay ?? DEFAULT_USER_SETTINGS.newCardsPerDay,
    reviewsPerDay: settingsRow?.reviewsPerDay ?? DEFAULT_USER_SETTINGS.reviewsPerDay,
    isOverride: settingsRow?.isOverride ?? false,
    allowHigher: settingsRow?.allowHigher ?? true,
    allowLower: settingsRow?.allowLower ?? true,
    limitRule: limitRuleFor(settingsRow),
  };

  // --- Flashcards, per deck the user's groups have
  const deckIds = await getUserDeckIds(userId);
  const decks = deckIds.length === 0 ? [] : db.select({ id: schema.decks.id, name: schema.decks.name, reversible: schema.decks.reversible })
    .from(schema.decks).where(inArray(schema.decks.id, deckIds)).all()
    .sort((a, b) => byTitleOrName(a.name, b.name));
  const todayStart = startOfDayForOffset(timezoneOffsetMinutes, now);
  const finishDays = lastSchoolDays(FINISH_DAYS_SHOWN, now);
  const finishWindowStart = new Date(schoolDayBounds(finishDays[0]).start);
  const R = schema.reviewLogs;
  const S = schema.cardStates;
  const C = schema.studyCompletions;
  const perDeck = <T extends { deckId: number | null }>(rows: T[]) => new Map(rows.map((r) => [r.deckId, r]));
  const hasDecks = decks.length > 0;
  const shownDeckIds = decks.map((d) => d.id);
  const cardCounts = perDeck(!hasDecks ? [] : db.select({ deckId: schema.cards.deckId, count: sql<number>`count(*)` })
    .from(schema.cards).where(inArray(schema.cards.deckId, shownDeckIds)).groupBy(schema.cards.deckId).all());
  const stateCounts = perDeck(!hasDecks ? [] : db.select({
    deckId: schema.cards.deckId,
    // As the student's own deck list counts them: in review or relearning, one direction of a two-way deck.
    learned: sql<number>`coalesce(sum(case when ${S.state} >= ${State.Review} and (${schema.decks.reversible} = 0 or ${S.direction} = ${CardDirection.Forward}) then 1 else 0 end), 0)`,
  })
    .from(S)
    .innerJoin(schema.cards, eq(S.cardId, schema.cards.id))
    .innerJoin(schema.decks, eq(schema.cards.deckId, schema.decks.id))
    .where(and(eq(S.userId, userId), inArray(schema.cards.deckId, shownDeckIds)))
    .groupBy(schema.cards.deckId)
    .all());
  const ratings = perDeck(!hasDecks ? [] : db.select({
    deckId: schema.cards.deckId,
    newToday: sql<number>`coalesce(sum(case when ${R.previousState} = ${State.New} and ${R.reviewedAt} >= ${Math.floor(todayStart.getTime() / 1000)} then 1 else 0 end), 0)`,
    reviewsToday: sql<number>`coalesce(sum(case when ${R.previousState} = ${State.Review} and ${R.reviewedAt} >= ${Math.floor(todayStart.getTime() / 1000)} then 1 else 0 end), 0)`,
    total: sql<number>`count(*)`,
    correct: sql<number>`coalesce(sum(case when ${R.rating} >= 3 then 1 else 0 end), 0)`,
    lastAt: sql<number>`max(${R.reviewedAt})`,
  })
    .from(R)
    .innerJoin(schema.cards, eq(R.cardId, schema.cards.id))
    .where(and(eq(R.userId, userId), inArray(schema.cards.deckId, shownDeckIds)))
    .groupBy(schema.cards.deckId)
    .all());
  const deckSettings = perDeck(!hasDecks ? [] : db.select().from(schema.deckUserSettings)
    .where(and(eq(schema.deckUserSettings.userId, userId), inArray(schema.deckUserSettings.deckId, shownDeckIds))).all());
  // Due as the student's own deck list shows it: exactly what Study would open with now.
  const due = dueTodayByDeck(userId, shownDeckIds, timezoneOffsetMinutes, now);
  // "All Done!" the server verified: session_complete of the deck itself (never nothing_due, never a virtual deck).
  const finishRows = !hasDecks ? [] : db.select({ deckId: C.deckId, completedAt: C.completedAt })
    .from(C)
    .where(and(
      eq(C.userId, userId),
      inArray(C.deckId, shownDeckIds),
      isNull(C.virtualDeckId),
      eq(C.reason, 'session_complete'),
      gte(C.completedAt, finishWindowStart),
    ))
    .all();

  const flashcards = decks.map((deck) => {
    const cardCount = Number(cardCounts.get(deck.id)?.count ?? 0);
    const states = stateCounts.get(deck.id);
    const rated = ratings.get(deck.id);
    const limits = computeEffectiveLimits(settingsRow, deckSettings.get(deck.id) ?? null);
    const newToday = Number(rated?.newToday ?? 0);
    const finished = new Set(finishRows.filter((r) => r.deckId === deck.id).map((r) => schoolDay(r.completedAt)));
    return {
      id: deck.id,
      name: deck.name,
      cardCount,
      learned: Number(states?.learned ?? 0),
      dueToday: due.get(deck.id)?.total ?? 0,
      newToday,
      reviewsToday: Number(rated?.reviewsToday ?? 0),
      newLimit: limits.newCardsPerDay,
      reviewLimit: limits.reviewsPerDay,
      reviews: Number(rated?.total ?? 0),
      correctReviews: Number(rated?.correct ?? 0),
      lastStudiedAt: normalizeAggregatedDate(rated?.lastAt)?.getTime() ?? null,
      finishedDays: finishDays.filter((day) => finished.has(day)),
    };
  });

  // "Finished all flashcards" (v1.18.0): the shown school days on which nothing was due in any
  // deck of the student's, after rating a card that day (services/allFlashcards.ts).
  const allDoneOn = new Set(db.select({ day: schema.flashcardAllDone.day })
    .from(schema.flashcardAllDone)
    .where(and(eq(schema.flashcardAllDone.userId, userId), inArray(schema.flashcardAllDone.day, finishDays)))
    .all()
    .map((r) => r.day));
  const allDoneDays = finishDays.filter((day) => allDoneOn.has(day));

  // --- Conjugation, per quiz turned on for one of those decks
  const quizDeckIds = !hasDecks ? [] : db.select({ deckId: schema.deckConjugation.deckId })
    .from(schema.deckConjugation)
    .where(and(inArray(schema.deckConjugation.deckId, shownDeckIds), eq(schema.deckConjugation.enabled, true)))
    .all().map((r) => r.deckId);
  const P = schema.conjugationProgress;
  const Q = schema.conjugationRounds;
  const conjugation = [];
  if (quizDeckIds.length > 0) {
    const progress = db.select().from(P).where(and(eq(P.userId, userId), inArray(P.deckId, quizDeckIds))).all();
    // A deck's own rounds: a "Study all" round (v1.18.0) is no deck's round, and its deck_id is only its lead.
    const rounds = db.select().from(Q).where(and(eq(Q.userId, userId), inArray(Q.deckId, quizDeckIds), eq(Q.scope, 'deck'))).all();
    // Days with a round played to its end, as the conjugation export counts them: a deck's own rounds, and
    // "Study all" rounds under each deck they asked forms of.
    const playedToEnd = sql`(${Q.position} >= 2 * ${Q.prompts} - ${Q.firstTryCorrect} OR ${Q.position} >= json_array_length(${Q.queue}))`;
    const played = [
      ...db.select({ deckId: Q.deckId, finishedAt: Q.finishedAt }).from(Q).where(and(
        eq(Q.userId, userId),
        inArray(Q.deckId, quizDeckIds),
        eq(Q.scope, 'deck'),
        isNotNull(Q.finishedAt),
        eq(Q.abandoned, false),
        playedToEnd,
      )).all(),
      ...db.selectDistinct({ deckId: schema.conjugationAnswers.deckId, finishedAt: Q.finishedAt }).from(Q)
        .innerJoin(schema.conjugationAnswers, eq(schema.conjugationAnswers.roundId, Q.id))
        .where(and(
          eq(Q.userId, userId),
          eq(Q.scope, 'all'),
          inArray(schema.conjugationAnswers.deckId, quizDeckIds),
          isNotNull(Q.finishedAt),
          eq(Q.abandoned, false),
          playedToEnd,
        )).all(),
    ];
    for (const deckId of quizDeckIds) {
      const state = await deckQuizState(deckId);
      const mine = progress.filter((p) => p.deckId === deckId);
      const levels = new Map(mine.map((p) => [p.itemKey, { level: p.level, mastered: p.mastered }]));
      const mastered = state.items.filter((i) => isMastered(levels.get(i.key), itemLadder(state.settings, i.direction))).length;
      const lastProgress = mine.reduce<Date | null>((max, p) => (!max || p.lastAt > max ? p.lastAt : max), null);
      const stats = roundStats(rounds.filter((r) => r.deckId === deckId), lastProgress);
      const days = new Set(played.filter((r) => r.deckId === deckId && r.finishedAt).map((r) => schoolDay(r.finishedAt!)));
      conjugation.push({
        deckId,
        deckName: state.deckName,
        mastered,
        total: state.items.length,
        rounds: stats.rounds,
        lastPlayedAt: stats.lastPlayed?.getTime() ?? null,
        daysPractised: days.size,
      });
    }
    conjugation.sort((a, b) => byTitleOrName(a.deckName, b.deckName));
  }

  // --- Labs: the ones for this user's groups (or everyone), released or already turned in
  const labAssigned = new Set(groupIds.length === 0 ? [] : db.select({ labId: schema.labGroups.labId })
    .from(schema.labGroups).where(inArray(schema.labGroups.groupId, groupIds)).all().map((r) => r.labId));
  const labRows = db.select().from(schema.labSubmissions).where(eq(schema.labSubmissions.userId, userId)).all();
  const allLabs = db.select({ id: schema.labs.id, title: schema.labs.title, active: schema.labs.active, forEveryone: schema.labs.forEveryone })
    .from(schema.labs).all();
  const labs = allLabs
    .filter((lab) => (lab.forEveryone || labAssigned.has(lab.id)) && (lab.active || labRows.some((r) => r.labId === lab.id)))
    .sort((a, b) => byTitleOrName(a.title, b.title))
    .map((lab) => {
      const mine = labRows.filter((r) => r.labId === lab.id);
      const { status, reason } = studentLabStatus(mine);
      const row = countingRow(mine);
      return {
        id: lab.id,
        title: lab.title,
        active: lab.active,
        status,
        reason,
        attempts: mine.length,
        submittedAt: row?.submittedAt.getTime() ?? null,
        pausesAnswered: row?.pausesAnswered ?? null,
        pausesCounted: row?.pausesCounted ?? null,
        needed: row ? neededForRow(row) : null,
      };
    });

  // --- Speaking: the tasks for this user's groups (or everyone), released or already recorded
  const taskAssigned = new Set(groupIds.length === 0 ? [] : db.select({ taskId: schema.speakingTaskGroups.taskId })
    .from(schema.speakingTaskGroups).where(inArray(schema.speakingTaskGroups.groupId, groupIds)).all().map((r) => r.taskId));
  const recordings = db.select({
    id: schema.speakingSubmissions.id,
    taskId: schema.speakingSubmissions.taskId,
    submittedAt: schema.speakingSubmissions.submittedAt,
    durationMs: schema.speakingSubmissions.durationMs,
    gradeScore: schema.speakingSubmissions.gradeScore,
    gradedBy: schema.speakingSubmissions.gradedBy,
    gradedAt: schema.speakingSubmissions.gradedAt,
  }).from(schema.speakingSubmissions).where(eq(schema.speakingSubmissions.userId, userId))
    .orderBy(desc(schema.speakingSubmissions.submittedAt), desc(schema.speakingSubmissions.id))
    .all();
  const allTasks = db.select({ id: schema.speakingTasks.id, title: schema.speakingTasks.title, active: schema.speakingTasks.active, forEveryone: schema.speakingTasks.forEveryone })
    .from(schema.speakingTasks).all();
  const speaking = allTasks
    .filter((task) => (task.forEveryone || taskAssigned.has(task.id)) && (task.active || recordings.some((r) => r.taskId === task.id)))
    .sort((a, b) => byTitleOrName(a.title, b.title))
    .map((task) => {
      const mine = recordings.filter((r) => r.taskId === task.id);
      // The latest recording is the one the teacher grades (as the speaking export).
      const latest = mine[0];
      return {
        id: task.id,
        title: task.title,
        active: task.active,
        attempts: mine.length,
        lastSubmittedAt: latest?.submittedAt.getTime() ?? null,
        durationMs: latest?.durationMs ?? null,
        score: latest?.gradeScore ?? null,
        gradedBy: latest?.gradedBy ?? null,
        gradedAt: latest?.gradedAt?.getTime() ?? null,
      };
    });

  // --- What extensions add (outside any transaction)
  const extra: { user: ExtensionFields['userDetailUser']; detail: ExtensionFields['userDetail'] } =
    await ext().run('userDetail', { userId, now });

  const coreUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    picture: user.picture,
    role: user.role,
    createdAt: user.createdAt.getTime(),
    lastActiveAt: lastActiveByUser(userId).get(userId) ?? null,
    studentNumber: override?.studentNumber ?? studentNumberFromEmail(user.email),
    studentNumberSetByTeacher: !!override,
  };
  const detail = {
    user: { ...coreUser, ...fieldsBeside(coreUser, extra.user, 'admin.userDetail user') },
    groups,
    settings,
    finishDays,
    allDoneDays,
    flashcards,
    conjugation,
    labs,
    speaking,
  };
  // The extensions' fields last (in user, and at the top), as before; none may take a core field's name.
  return { ...detail, ...fieldsBeside(detail, extra.detail, 'admin.userDetail') };
}

export type UserDetail = Awaited<ReturnType<typeof userDetailFor>>;

export const adminRouter = router({
  /**
   * Every user, newest first, with when they were last active (ms, or null)
   * and their school ID (the teacher's override, else the digits of their email).
   */
  getUsers: adminProcedure.query(async () => {
    const users = await db.query.users.findMany({
      orderBy: (users, { desc }) => [desc(users.createdAt)],
    });
    const lastActive = lastActiveByUser();
    const overrides = studentNumberOverrideMap();
    return users.map((user) => ({
      ...user,
      lastActiveAt: lastActive.get(user.id) ?? null,
      studentNumber: overrides.get(user.id) ?? studentNumberFromEmail(user.email),
    }));
  }),

  /** One user's detail view (Admin → Users → a name). Reads only. */
  userDetail: adminProcedure
    .input(z.object({
      userId: z.number().int(),
      timezoneOffsetMinutes: z.number().int().min(-720).max(840).optional(),
    }))
    .query(({ input }) => userDetailFor(input.userId, input.timezoneOffsetMinutes)),

  /** Admin → Groups → "Flashcards by day": who reached "All Done!" in each of the group's decks on a school day. */
  groupFlashcardDay: adminProcedure
    .input(z.object({
      groupId: z.number().int(),
      day: z.string().refine(isDayString, { message: 'Pick a day (YYYY-MM-DD).' }).optional(),
    }))
    .query(({ input }) => groupFlashcardDay(input.groupId, input.day)),

  updateUserRole: adminProcedure
    .input(z.object({
      userId: z.number(),
      role: z.enum(['admin', 'user']),
    }))
    .mutation(async ({ input }) => {
      if (input.role === 'user') {
        const adminCount = await db
          .select({ count: sql<number>`count(*)` })
          .from(schema.users)
          .where(eq(schema.users.role, 'admin'));
        if ((adminCount[0]?.count ?? 0) <= 1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot demote the last admin. Promote another user to admin first.',
          });
        }
      }
      await db.update(schema.users)
        .set({ role: input.role })
        .where(eq(schema.users.id, input.userId));
      return { success: true };
    }),

  getGroups: adminProcedure.query(async () => {
    const [groups, memberCounts, deckCounts] = await Promise.all([
      db.query.groups.findMany({
        orderBy: (groups, { desc }) => [desc(groups.createdAt)],
      }),
      db.select({
        groupId: schema.userGroups.groupId,
        count: sql<number>`count(*)`,
      })
        .from(schema.userGroups)
        .groupBy(schema.userGroups.groupId),
      db.select({
        groupId: schema.deckGroups.groupId,
        count: sql<number>`count(*)`,
      })
        .from(schema.deckGroups)
        .groupBy(schema.deckGroups.groupId),
    ]);

    const memberCountMap = new Map(memberCounts.map((row) => [row.groupId, row.count]));
    const deckCountMap = new Map(deckCounts.map((row) => [row.groupId, row.count]));

    return groups.map((group) => ({
      ...group,
      memberCount: memberCountMap.get(group.id) ?? 0,
      deckCount: deckCountMap.get(group.id) ?? 0,
    }));
  }),

  createGroup: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      const result = await db.insert(schema.groups).values({
        name: input.name,
        description: input.description,
      }).returning();
      return result[0];
    }),

  importGoogleClassroomGroup: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
      csvContent: z.string().max(CSV_MAX_CHARS),
    }))
    .mutation(async ({ input }) => {
      const parsed = parseGoogleClassroomRoster(input.csvContent);
      if (parsed.students.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: parsed.errors[0] ?? 'No student emails found in Google Classroom CSV.',
          cause: { appCode: 'CLASSROOM_IMPORT_EMPTY' },
        });
      }

      return importStudentsIntoGroup({
        name: input.name,
        description: input.description,
        students: parsed.students,
        duplicateEmailsSkipped: parsed.duplicateEmailsSkipped,
        nonStudentRowsSkipped: parsed.nonStudentRowsSkipped,
        errors: parsed.errors,
      });
    }),

  listGoogleClassroomCourses: adminProcedure
    .query(async ({ ctx }) => {
      const tokens = getGoogleClassroomTokensFromSession(ctx.req);
      if (!tokens) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Google Classroom is not connected for this admin session.',
          cause: { appCode: 'GOOGLE_CLASSROOM_AUTH_REQUIRED' },
        });
      }
      const courses = await fetchGoogleClassroomCourses(tokens);
      ctx.req.session.googleClassroomAccessToken = tokens.accessToken;
      return courses;
    }),

  previewGoogleClassroomStudents: adminProcedure
    .input(z.object({ courseId: z.string().min(1).max(120) }))
    .query(async ({ ctx, input }) => {
      const tokens = getGoogleClassroomTokensFromSession(ctx.req);
      if (!tokens) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Google Classroom is not connected for this admin session.',
          cause: { appCode: 'GOOGLE_CLASSROOM_AUTH_REQUIRED' },
        });
      }
      const students = await fetchGoogleClassroomStudents(input.courseId, tokens);
      ctx.req.session.googleClassroomAccessToken = tokens.accessToken;
      return students;
    }),

  importGoogleClassroomCourse: adminProcedure
    .input(z.object({
      courseId: z.string().min(1).max(120),
      selectedStudentEmails: z.array(z.string().email()).min(1).optional(),
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const tokens = getGoogleClassroomTokensFromSession(ctx.req);
      if (!tokens) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Google Classroom is not connected for this admin session.',
          cause: { appCode: 'GOOGLE_CLASSROOM_AUTH_REQUIRED' },
        });
      }

      const course = await fetchGoogleClassroomCourse(input.courseId, tokens);
      const allStudents = await fetchGoogleClassroomStudents(input.courseId, tokens);
      ctx.req.session.googleClassroomAccessToken = tokens.accessToken;

      const students = input.selectedStudentEmails
        ? allStudents.filter(s => input.selectedStudentEmails!.includes(s.email))
        : allStudents;

      if (students.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No students were found in this Google Classroom course.',
          cause: { appCode: 'CLASSROOM_IMPORT_EMPTY' },
        });
      }

      const groupName = input.name?.trim() || course.name;
      const description = input.description?.trim()
        || course.description
        || (course.section ? `Imported from Google Classroom (${course.section})` : 'Imported from Google Classroom');

      const imported = await importStudentsIntoGroup({
        name: groupName,
        description,
        students,
        duplicateEmailsSkipped: 0,
        nonStudentRowsSkipped: 0,
        errors: [],
      });

      return {
        ...imported,
        course: {
          id: course.id,
          name: course.name,
          section: course.section,
        },
      };
    }),

  listCleverSections: adminProcedure
    .query(async ({ ctx }) => {
      const token = typeof ctx.req.session?.cleverRosterAccessToken === 'string'
        ? ctx.req.session.cleverRosterAccessToken
        : null;
      if (!token) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Clever is not connected for this admin session.',
          cause: { appCode: 'CLEVER_AUTH_REQUIRED' },
        });
      }
      return fetchCleverSections(token);
    }),

  previewCleverStudents: adminProcedure
    .input(z.object({ sectionId: z.string().min(1).max(120) }))
    .query(async ({ ctx, input }) => {
      const token = typeof ctx.req.session?.cleverRosterAccessToken === 'string'
        ? ctx.req.session.cleverRosterAccessToken
        : null;
      if (!token) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Clever is not connected for this admin session.',
          cause: { appCode: 'CLEVER_AUTH_REQUIRED' },
        });
      }
      return fetchCleverSectionStudents(input.sectionId, token);
    }),

  importCleverSection: adminProcedure
    .input(z.object({
      sectionId: z.string().min(1).max(120),
      selectedStudentEmails: z.array(z.string().email()).min(1).optional(),
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const token = typeof ctx.req.session?.cleverRosterAccessToken === 'string'
        ? ctx.req.session.cleverRosterAccessToken
        : null;
      if (!token) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Clever is not connected for this admin session.',
          cause: { appCode: 'CLEVER_AUTH_REQUIRED' },
        });
      }

      const allStudents = await fetchCleverSectionStudents(input.sectionId, token);
      const students = input.selectedStudentEmails
        ? allStudents.filter(s => input.selectedStudentEmails!.includes(s.email))
        : allStudents;

      if (students.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No students were found in this Clever section.',
          cause: { appCode: 'CLASSROOM_IMPORT_EMPTY' },
        });
      }

      return importStudentsIntoGroup({
        name: input.name,
        description: input.description ?? 'Imported from Clever',
        students,
        duplicateEmailsSkipped: 0,
        nonStudentRowsSkipped: 0,
        errors: [],
      });
    }),

  updateGroup: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const group = await db.query.groups.findFirst({
        where: eq(schema.groups.id, id),
      });
      if (group?.name === ALL_GROUP_NAME && data.name && data.name !== ALL_GROUP_NAME) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'The "All" group cannot be renamed.' });
      }
      await db.update(schema.groups)
        .set(data)
        .where(eq(schema.groups.id, id));
      return { success: true };
    }),

  deleteGroup: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const group = await db.query.groups.findFirst({
        where: eq(schema.groups.id, input.id),
      });
      if (group?.name === ALL_GROUP_NAME) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'The "All" group cannot be deleted.' });
      }
      await db.delete(schema.groups).where(eq(schema.groups.id, input.id));
      return { success: true };
    }),

  /**
   * A group's members, with when each joined it, when they were last active at
   * anything (ms, or null; one query for the whole group) and their school ID,
   * for the Groups tab's search and sort.
   */
  getGroupMembers: adminProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ input }) => {
      const members = await db
        .select({
          user: schema.users,
          joinedAt: schema.userGroups.joinedAt,
        })
        .from(schema.userGroups)
        .innerJoin(schema.users, eq(schema.userGroups.userId, schema.users.id))
        .where(eq(schema.userGroups.groupId, input.groupId));
      const lastActive = lastActiveByUser({ groupId: input.groupId });
      const overrides = studentNumberOverrideMap();

      return members.map(m => ({
        ...m.user,
        joinedAt: m.joinedAt,
        lastActiveAt: lastActive.get(m.user.id) ?? null,
        studentNumber: overrides.get(m.user.id) ?? studentNumberFromEmail(m.user.email),
      }));
    }),

  getGroupDecks: adminProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ input }) => {
      const decks = await db
        .select({ deck: schema.decks })
        .from(schema.deckGroups)
        .innerJoin(schema.decks, eq(schema.deckGroups.deckId, schema.decks.id))
        .where(eq(schema.deckGroups.groupId, input.groupId));
      const deckIds = decks.map(({ deck }) => deck.id);

      const cardCounts = deckIds.length === 0
        ? []
        : await db
          .select({
            deckId: schema.cards.deckId,
            count: sql<number>`count(*)`,
          })
          .from(schema.cards)
          .where(inArray(schema.cards.deckId, deckIds))
          .groupBy(schema.cards.deckId);

      const cardCountMap = new Map(cardCounts.map((row) => [row.deckId, row.count]));

      return decks.map(({ deck }) => ({
        ...deck,
        cardCount: cardCountMap.get(deck.id) ?? 0,
      }));
    }),

  addUserToGroup: adminProcedure
    .input(z.object({
      userId: z.number(),
      groupId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const added = await db.insert(schema.userGroups).values({
        userId: input.userId,
        groupId: input.groupId,
      }).onConflictDoNothing().returning({ userId: schema.userGroups.userId });
      // A student added later gets the group's settings when its Override is on.
      // Only a real join: re-adding a member must not undo what the teacher set for that one student.
      const settingsApplied = added.length > 0 && await applyGroupSettingsToUser(input.groupId, input.userId);
      return { success: true, settingsApplied };
    }),

  /** Batch membership add — the group panel's multi-select. */
  addUsersToGroup: adminProcedure
    .input(z.object({
      groupId: z.number(),
      userIds: z.array(z.number().int()).min(1).max(500),
    }))
    .mutation(async ({ input }) => {
      const unique = [...new Set(input.userIds)];
      const added = await db.insert(schema.userGroups)
        .values(unique.map((userId) => ({ userId, groupId: input.groupId })))
        .onConflictDoNothing()
        .returning({ userId: schema.userGroups.userId });
      // As addUserToGroup: the group's settings reach the students who just joined, with its Override on.
      const settingsApplied = await applyGroupSettingsToUsers(input.groupId, added.map((row) => row.userId));
      return { success: true, requested: unique.length, added: added.length, settingsApplied };
    }),

  /**
   * Group data export. Three datasets because a class usually has flashcard
   * activity long before it has Vocabulómetro results — exporting only the
   * latter produced header-only "blank" files for active classes.
   */
  exportGroupData: adminProcedure
    .input(z.object({
      groupId: z.number(),
      dataset: z.enum(['summary', 'reviews', 'vocab', 'completions', 'labs', 'speaking', 'conjugation']).default('summary'),
    }))
    .query(async ({ input }) => {
      // Every text cell is formula-safe: the file opens in a spreadsheet, and names and titles are typed by people.
      const esc = csvCell;
      const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v ? String(v) : ''));
      const secs = (ms: number) => (ms / 1000).toFixed(0);
      const byTitle = (a: { title: string }, b: { title: string }) =>
        a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
      /** The group's students by name, active or not. The teacher is never one of them. */
      const groupStudents = async () => (await db
        .selectDistinct({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
        .from(schema.users)
        .innerJoin(schema.userGroups, eq(schema.userGroups.userId, schema.users.id))
        .where(and(eq(schema.userGroups.groupId, input.groupId), ne(schema.users.role, 'admin'))))
        .sort((a, b) => a.name.localeCompare(b.name));

      if (input.dataset === 'summary') {
        // One row per group member — LEFT JOINs so students with no activity
        // still appear (a zero row is information; a missing row is confusing).
        // cards_studied counts cards started (a New row set up when a deck was
        // opened is not one); sessions are a deck's "All Done!", never a mini-deck's
        // (its rows go when the student deletes it, and a selection is not the day's work).
        const rows = await db.all<{
          name: string; email: string; cards_studied: number; total_reviews: number;
          again: number; hard: number; good: number; easy: number;
          first_review: number | null; last_review: number | null; vocab_tests: number;
          sessions_finished: number; last_finished: number | null;
        }>(sql`
          SELECT u.name AS name, u.email AS email,
            (SELECT COUNT(*) FROM card_states cs WHERE cs.user_id = u.id AND cs.state != ${State.New}) AS cards_studied,
            COUNT(rl.id) AS total_reviews,
            COALESCE(SUM(CASE WHEN rl.rating = 1 THEN 1 ELSE 0 END), 0) AS again,
            COALESCE(SUM(CASE WHEN rl.rating = 2 THEN 1 ELSE 0 END), 0) AS hard,
            COALESCE(SUM(CASE WHEN rl.rating = 3 THEN 1 ELSE 0 END), 0) AS good,
            COALESCE(SUM(CASE WHEN rl.rating = 4 THEN 1 ELSE 0 END), 0) AS easy,
            MIN(rl.reviewed_at) AS first_review,
            MAX(rl.reviewed_at) AS last_review,
            (SELECT COUNT(*) FROM vocab_results vr WHERE vr.user_id = u.id) AS vocab_tests,
            (SELECT COUNT(*) FROM study_completions sc
               WHERE sc.user_id = u.id AND sc.reason = 'session_complete' AND sc.virtual_deck_id IS NULL) AS sessions_finished,
            (SELECT MAX(sc.completed_at) FROM study_completions sc
               WHERE sc.user_id = u.id AND sc.reason = 'session_complete' AND sc.virtual_deck_id IS NULL) AS last_finished
          FROM user_groups ug
          JOIN users u ON u.id = ug.user_id
          LEFT JOIN review_logs rl ON rl.user_id = u.id
          WHERE ug.group_id = ${input.groupId} AND u.role != 'admin'
          GROUP BY u.id
          ORDER BY u.name
        `);

        const csvRows = ['student_name,student_email,cards_studied,total_reviews,again,hard,good,easy,accuracy_pct,first_review,last_review,vocab_tests_taken,sessions_finished,last_finished'];
        for (const r of rows) {
          // "Accuracy" = share of reviews the student did NOT answer Again.
          const acc = r.total_reviews > 0
            ? (((r.total_reviews - r.again) / r.total_reviews) * 100).toFixed(1)
            : '';
          csvRows.push([
            esc(r.name), esc(r.email), r.cards_studied, r.total_reviews,
            r.again, r.hard, r.good, r.easy, acc,
            // reviewed_at is stored as Unix SECONDS (drizzle mode:'timestamp');
            // raw SQL bypasses drizzle's mapping, so convert explicitly.
            esc(r.first_review ? new Date(r.first_review * 1000).toISOString() : ''),
            esc(r.last_review ? new Date(r.last_review * 1000).toISOString() : ''),
            r.vocab_tests,
            r.sessions_finished,
            esc(r.last_finished ? new Date(r.last_finished * 1000).toISOString() : ''),
          ].join(','));
        }
        return { csv: csvRows.join('\n'), rowCount: rows.length };
      }

      if (input.dataset === 'reviews') {
        const rows = await db
          .select({
            userName: schema.users.name,
            userEmail: schema.users.email,
            front: schema.cards.front,
            back: schema.cards.back,
            rating: schema.reviewLogs.rating,
            reviewedAt: schema.reviewLogs.reviewedAt,
            timeSpentMs: schema.reviewLogs.timeSpentMs,
            previousState: schema.reviewLogs.previousState,
            newState: schema.reviewLogs.newState,
          })
          .from(schema.reviewLogs)
          .innerJoin(schema.users, eq(schema.reviewLogs.userId, schema.users.id))
          .innerJoin(schema.cards, eq(schema.reviewLogs.cardId, schema.cards.id))
          .innerJoin(schema.userGroups, and(
            eq(schema.userGroups.userId, schema.users.id),
            eq(schema.userGroups.groupId, input.groupId),
          ))
          .where(ne(schema.users.role, 'admin'))
          .orderBy(schema.users.name, schema.reviewLogs.reviewedAt);

        const csvRows = ['student_name,student_email,card_front,card_back,rating,reviewed_at,time_spent_ms,previous_state,new_state'];
        for (const r of rows) {
          csvRows.push([
            esc(r.userName), esc(r.userEmail), esc(r.front), esc(r.back),
            r.rating, esc(iso(r.reviewedAt)), r.timeSpentMs, r.previousState, r.newState,
          ].join(','));
        }
        return { csv: csvRows.join('\n'), rowCount: rows.length };
      }

      if (input.dataset === 'labs') {
        // services/labExport.ts: one row per student per lab, missing ones included, with the
        // v1.15 status (done, redo, check, missing) of each student's counting row.
        return groupLabsCsv(input.groupId);
      }

      if (input.dataset === 'speaking') {
        // Like 'labs': one row per student per speaking task, missing ones
        // included; tasks appear once released and stay after being hidden
        // again if anyone in the group recorded them. The columns describe the
        // latest recording, which is the one the teacher grades.
        const members = await groupStudents();
        const memberIds = members.map((m) => m.id);

        const allTasks = await db.query.speakingTasks.findMany();
        const taskGroupRows = await db.select().from(schema.speakingTaskGroups);
        const forGroup = allTasks.filter((task) =>
          task.forEveryone || taskGroupRows.some((g) => g.taskId === task.id && g.groupId === input.groupId));
        const submissions = memberIds.length === 0 || forGroup.length === 0 ? [] : await db.query.speakingSubmissions.findMany({
          where: and(
            inArray(schema.speakingSubmissions.userId, memberIds),
            inArray(schema.speakingSubmissions.taskId, forGroup.map((t) => t.id)),
          ),
          orderBy: [desc(schema.speakingSubmissions.submittedAt), desc(schema.speakingSubmissions.id)],
        });
        const tasksToExport = forGroup
          .filter((task) => task.active || submissions.some((s) => s.taskId === task.id))
          .sort(byTitle);

        // flags: what the server found in the latest file (routers/audioUploads.ts), space-separated;
        // page_length_s: how long the student's page said it was (duration_s is the file's own).
        const speakingFlags = (raw: string | null) => {
          try {
            const list: unknown = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list.filter((f): f is string => typeof f === 'string').join(' ') : '';
          } catch {
            return '';
          }
        };
        const csvRows = ['student_name,student_email,task,status,submitted_at,attempts,duration_s,voice_s,grade_score,graded_by,graded_at,feedback,flags,page_length_s'];
        for (const task of tasksToExport) {
          for (const m of members) {
            const mine = submissions.filter((s) => s.taskId === task.id && s.userId === m.id);
            const latest = mine[0];
            if (!latest) {
              csvRows.push([esc(m.name), esc(m.email), esc(task.title), 'missing', '', 0, '', '', '', '', '', '', '', ''].join(','));
              continue;
            }
            csvRows.push([
              esc(m.name), esc(m.email), esc(task.title), 'submitted', esc(iso(latest.submittedAt)), mine.length,
              secs(latest.durationMs), secs(latest.voicedMs),
              latest.gradeScore ?? '', esc(latest.gradedBy), esc(iso(latest.gradedAt)), esc(latest.gradeFeedback),
              esc(speakingFlags(latest.flags)), latest.clientDurationMs === null ? '' : secs(latest.clientDurationMs),
            ].join(','));
          }
        }
        return { csv: csvRows.join('\n'), rowCount: csvRows.length - 1 };
      }

      if (input.dataset === 'conjugation') {
        // One row per student per deck the group sees with a conjugation quiz
        // turned on, unplayed ones included. esc() neutralises a cell that
        // would start a spreadsheet formula (names and deck titles are typed).
        const pct = (v: number | null) => (v === null ? '' : (v * 100).toFixed(1));
        const members = await groupStudents();
        const memberIds = members.map((m) => m.id);
        const decks = await db
          .select({ id: schema.decks.id, name: schema.decks.name })
          .from(schema.deckGroups)
          .innerJoin(schema.decks, eq(schema.deckGroups.deckId, schema.decks.id))
          .innerJoin(schema.deckConjugation, eq(schema.deckConjugation.deckId, schema.decks.id))
          .where(and(eq(schema.deckGroups.groupId, input.groupId), eq(schema.deckConjugation.enabled, true)));
        decks.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        const deckIds = decks.map((d) => d.id);
        const noRows = memberIds.length === 0 || deckIds.length === 0;
        // A deck's own rounds; "Study all" rounds (v1.18.0) count under each deck they asked forms of (study_all_rounds).
        const rounds = noRows ? [] : await db.select().from(schema.conjugationRounds).where(and(
          inArray(schema.conjugationRounds.userId, memberIds),
          inArray(schema.conjugationRounds.deckId, deckIds),
          eq(schema.conjugationRounds.scope, 'deck'),
        ));
        const progress = noRows ? [] : await db.select().from(schema.conjugationProgress).where(and(
          inArray(schema.conjugationProgress.userId, memberIds),
          inArray(schema.conjugationProgress.deckId, deckIds),
        ));

        // The numbers that predict a test come after the v1.12 columns, so existing sheets keep their columns:
        // forms due; days with a round played to its end (any quiz); accuracy on forms not seen for 7+ days;
        // median seconds to answer (first tries); the student's commonest named mistake.
        const now = new Date();
        const [days, delayed, times, studyAll] = await Promise.all([
          practiceDays(memberIds, now), delayedAnswers(memberIds, deckIds), responseTimes(memberIds, deckIds), studyAllRounds(memberIds, deckIds),
        ]);
        const seconds = (ms: number | null | undefined) => (ms === null || ms === undefined ? '' : (ms / 1000).toFixed(1));
        const csvRows = [[
          'student_name,student_email,deck,status,rounds,last_score,best_score,mastered,items_total,mastery_pct,last_played',
          'due_now,days_practised_14d,days_practised,delayed_answers,delayed_accuracy,median_typed_s,median_choice_s',
          'top_mistake,top_mistake_count,top_mistake_example',
          // v1.18.0, last so existing sheets keep their columns: "Study all" rounds played to the end that asked forms of the deck.
          'study_all_rounds',
        ].join(',')];
        for (const deck of decks) {
          const state = await deckQuizState(deck.id);
          const total = state.items.length;
          const [due, mistakes] = await Promise.all([
            dueByStudent(state, memberIds, now.getTime()), studentTopMistakes(deck.id, memberIds, state.settings),
          ]);
          for (const m of members) {
            const mine = progress.filter((p) => p.deckId === deck.id && p.userId === m.id);
            const levels = new Map(mine.map((p) => [p.itemKey, { level: p.level, mastered: p.mastered }]));
            const mastered = state.items.filter((i) => isMastered(levels.get(i.key), itemLadder(state.settings, i.direction))).length;
            const lastProgress = mine.reduce<Date | null>((max, p) => (!max || p.lastAt > max ? p.lastAt : max), null);
            const stats = roundStats(rounds.filter((r) => r.deckId === deck.id && r.userId === m.id), lastProgress);
            const allRounds = studyAll.get(`${m.id}:${deck.id}`) ?? 0;
            const played = stats.rounds > 0 || allRounds > 0 || mine.length > 0;
            const late = delayed.get(`${m.id}:${deck.id}`);
            const time = times.get(`${m.id}:${deck.id}`);
            const top = mistakes.get(m.id);
            csvRows.push([
              esc(m.name), esc(m.email), esc(deck.name), played ? 'played' : 'not played',
              stats.rounds, pct(stats.lastScore), pct(stats.bestScore), mastered, total,
              total > 0 ? ((mastered / total) * 100).toFixed(1) : '', esc(iso(stats.lastPlayed)),
              due.get(m.id) ?? 0, days.get(m.id)?.days14 ?? 0, days.get(m.id)?.days ?? 0,
              late?.answers ?? 0, pct(late && late.answers > 0 ? late.right / late.answers : null),
              seconds(time?.typedMs), seconds(time?.choiceMs),
              esc(top ? mistakeLabel(top) : ''), top?.count ?? '',
              esc(top?.example ? `${top.example.given} for ${top.example.expected} (${top.example.prompt})` : ''),
              allRounds,
            ].join(','));
          }
        }
        return { csv: csvRows.join('\n'), rowCount: csvRows.length - 1 };
      }

      if (input.dataset === 'completions') {
        // A mini-deck's row names only the mini-deck: its deck is the one it was made from.
        const sourceDeck = alias(schema.decks, 'source_deck');
        const rows = await db
          .select({
            userName: schema.users.name,
            userEmail: schema.users.email,
            deckName: schema.decks.name,
            sourceDeckName: sourceDeck.name,
            miniDeckName: schema.virtualDecks.name,
            reason: schema.studyCompletions.reason,
            newCardsDone: schema.studyCompletions.newCardsDone,
            reviewsDone: schema.studyCompletions.reviewsDone,
            completedAt: schema.studyCompletions.completedAt,
          })
          .from(schema.studyCompletions)
          .innerJoin(schema.users, eq(schema.studyCompletions.userId, schema.users.id))
          .leftJoin(schema.decks, eq(schema.studyCompletions.deckId, schema.decks.id))
          .leftJoin(schema.virtualDecks, eq(schema.studyCompletions.virtualDeckId, schema.virtualDecks.id))
          .leftJoin(sourceDeck, eq(schema.virtualDecks.sourceDeckId, sourceDeck.id))
          .innerJoin(schema.userGroups, and(
            eq(schema.userGroups.userId, schema.users.id),
            eq(schema.userGroups.groupId, input.groupId),
          ))
          .where(ne(schema.users.role, 'admin'))
          .orderBy(schema.users.name, schema.studyCompletions.completedAt);

        // "Finished all flashcards" (v1.18.0): one row per student and school day, deck "All
        // flashcards", reason all_flashcards, when nothing was left in any of their decks. Its
        // cards are counted in each deck's own rows, so its counts are left empty.
        const allDoneRows = db
          .select({ userName: schema.users.name, userEmail: schema.users.email, completedAt: schema.flashcardAllDone.completedAt })
          .from(schema.flashcardAllDone)
          .innerJoin(schema.users, eq(schema.flashcardAllDone.userId, schema.users.id))
          .innerJoin(schema.userGroups, and(
            eq(schema.userGroups.userId, schema.users.id),
            eq(schema.userGroups.groupId, input.groupId),
          ))
          .where(ne(schema.users.role, 'admin'))
          .all();
        const lines = [
          ...rows.map((r) => ({
            userName: r.userName,
            completedAt: r.completedAt,
            line: [
              esc(r.userName), esc(r.userEmail), esc(r.deckName ?? r.sourceDeckName ?? ''), esc(r.reason),
              r.newCardsDone, r.reviewsDone, esc(iso(r.completedAt)), esc(r.miniDeckName ?? ''),
            ].join(','),
          })),
          ...allDoneRows.map((r) => ({
            userName: r.userName,
            completedAt: r.completedAt,
            line: [esc(r.userName), esc(r.userEmail), esc('All flashcards'), esc('all_flashcards'), '', '', esc(iso(r.completedAt)), esc('')].join(','),
          })),
        ];
        // By student, then time, as the rows were read (a stable sort keeps each deck row's order).
        const byNameThenTime = (a: (typeof lines)[number], b: (typeof lines)[number]) =>
          (a.userName < b.userName ? -1 : a.userName > b.userName ? 1 : 0)
          || (a.completedAt?.getTime() ?? 0) - (b.completedAt?.getTime() ?? 0);
        if (allDoneRows.length > 0) lines.sort(byNameThenTime);
        const csvRows = ['student_name,student_email,deck,reason,new_cards_done,reviews_done,completed_at,mini_deck', ...lines.map((l) => l.line)];
        return { csv: csvRows.join('\n'), rowCount: lines.length };
      }

      const rows = await db
        .select({
          userName: schema.users.name,
          userEmail: schema.users.email,
          testName: schema.vocabTests.name,
          mode: schema.vocabResults.mode,
          occasion: schema.vocabResults.occasion,
          form: schema.vocabResults.form,
          seed: schema.vocabResults.seed,
          completedAt: schema.vocabResults.completedAt,
          durationMs: schema.vocabResults.durationMs,
          summaryJson: schema.vocabResults.summaryJson,
          qualityJson: schema.vocabResults.qualityJson,
        })
        .from(schema.vocabResults)
        .innerJoin(schema.users, eq(schema.vocabResults.userId, schema.users.id))
        .innerJoin(schema.vocabTests, eq(schema.vocabResults.testId, schema.vocabTests.id))
        .innerJoin(schema.userGroups, and(
          eq(schema.userGroups.userId, schema.users.id),
          eq(schema.userGroups.groupId, input.groupId),
        ))
        // Students only, as in every other dataset: a teacher's own test run is not a student row.
        .where(ne(schema.users.role, 'admin'))
        .orderBy(schema.users.name, schema.vocabResults.completedAt);

      const csvRows = ['student_name,student_email,test_name,mode,occasion,form,seed,completed_at,duration_ms,summary_json,quality_json'];
      for (const r of rows) {
        csvRows.push([
          esc(r.userName), esc(r.userEmail), esc(r.testName), r.mode,
          esc(r.occasion), esc(r.form), r.seed, esc(iso(r.completedAt)),
          r.durationMs ?? '', esc(r.summaryJson), esc(r.qualityJson),
        ].join(','));
      }
      return { csv: csvRows.join('\n'), rowCount: rows.length };
    }),

  removeUserFromGroup: adminProcedure
    .input(z.object({
      userId: z.number(),
      groupId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const group = await db.query.groups.findFirst({
        where: eq(schema.groups.id, input.groupId),
      });
      if (group?.name === ALL_GROUP_NAME) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Users cannot be removed from the "All" group.',
        });
      }

      await db.delete(schema.userGroups)
        .where(and(
          eq(schema.userGroups.userId, input.userId),
          eq(schema.userGroups.groupId, input.groupId)
        ));
      return { success: true };
    }),

  getDecks: adminProcedure.query(async () => {
    const decks = await db.query.decks.findMany({
      orderBy: (decks, { desc }) => [desc(decks.createdAt)],
    });
    const deckIds = decks.map((deck) => deck.id);
    const cardCounts = deckIds.length === 0
      ? []
      : await db
        .select({
          deckId: schema.cards.deckId,
          count: sql<number>`count(*)`,
        })
        .from(schema.cards)
        .where(inArray(schema.cards.deckId, deckIds))
        .groupBy(schema.cards.deckId);
    const cardCountMap = new Map(cardCounts.map((row) => [row.deckId, row.count]));

    return decks.map((deck) => ({
      ...deck,
      cardCount: cardCountMap.get(deck.id) ?? 0,
    }));
  }),

  createDeck: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
      sourceLanguage: z.string().max(10).optional(),
      targetLanguage: z.string().max(10).optional(),
      sourceAccent: z.string().max(100).optional(),
      targetAccent: z.string().max(100).optional(),
      audioFrontEnabled: z.boolean().optional(),
      audioBackEnabled: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.insert(schema.decks).values({
        name: input.name,
        description: input.description,
        sourceLanguage: input.sourceLanguage,
        targetLanguage: input.targetLanguage,
        sourceAccent: input.sourceAccent,
        targetAccent: input.targetAccent,
        audioFrontEnabled: input.audioFrontEnabled ?? true,
        audioBackEnabled: input.audioBackEnabled ?? true,
        createdBy: ctx.user.id,
      }).returning();
      return result[0];
    }),

  updateDeck: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional(),
      reversible: z.boolean().optional(),
      sourceLanguage: z.string().max(10).nullish(),
      targetLanguage: z.string().max(10).nullish(),
      sourceAccent: z.string().max(100).nullish(),
      targetAccent: z.string().max(100).nullish(),
      audioFrontEnabled: z.boolean().optional(),
      audioBackEnabled: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.update(schema.decks)
        .set(data)
        .where(eq(schema.decks.id, id));
      return { success: true };
    }),

  deleteDeck: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(({ input }) => {
      db.transaction((tx) => {
        // A "Study all" conjugation round it leads keeps its other decks' answers (v1.18.0).
        keepStudyAllRoundsOf(tx, input.id);
        tx.delete(schema.decks).where(eq(schema.decks.id, input.id)).run();
      });
      return { success: true };
    }),

  /**
   * Wipe study progress for a deck so it is as if never seen — for one student
   * or for everyone. Cards and their generated assets are untouched; only the
   * per-user scheduling state and review history go.
   */
  resetDeckProgress: adminProcedure
    .input(z.object({
      deckId: z.number(),
      /** Omit to reset every user on the deck. */
      userId: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const cards = await db.query.cards.findMany({
        where: eq(schema.cards.deckId, input.deckId),
        columns: { id: true },
      });
      const cardIds = cards.map((c) => c.id);
      if (cardIds.length === 0) {
        return { success: true, cardStatesCleared: 0, reviewLogsCleared: 0 };
      }

      const scope = (userColumn: typeof schema.cardStates.userId | typeof schema.reviewLogs.userId) =>
        input.userId === undefined ? undefined : eq(userColumn, input.userId);

      const logsResult = await db.delete(schema.reviewLogs).where(
        and(inArray(schema.reviewLogs.cardId, cardIds), scope(schema.reviewLogs.userId)),
      );
      const statesResult = await db.delete(schema.cardStates).where(
        and(inArray(schema.cardStates.cardId, cardIds), scope(schema.cardStates.userId)),
      );

      logger.warn({
        event: 'admin.reset_deck_progress',
        deckId: input.deckId,
        targetUserId: input.userId ?? 'all',
        byUserId: ctx.user.id,
      }, 'Deck progress reset');

      return {
        success: true,
        cardStatesCleared: statesResult.changes ?? 0,
        reviewLogsCleared: logsResult.changes ?? 0,
      };
    }),

  uploadCards: adminProcedure
    .input(z.object({
      deckId: z.number(),
      csvContent: z.string().max(CSV_MAX_CHARS),
    }))
    .mutation(async ({ input, ctx }) => {
      logger.info({
        event: 'admin.upload_csv.start',
        deckId: input.deckId,
        userId: ctx.user.id,
        csvChars: input.csvContent.length,
      }, 'CSV upload requested');

      const { cards, errors } = parseCSV(input.csvContent);
      logger.info({
        event: 'admin.upload_csv.parsed',
        deckId: input.deckId,
        userId: ctx.user.id,
        cardsParsed: cards.length,
        parseErrorCount: errors.length,
      }, 'CSV upload parsed');

      if (cards.length === 0) {
        logger.warn({
          event: 'admin.upload_csv.empty',
          deckId: input.deckId,
          userId: ctx.user.id,
          parseErrorCount: errors.length,
        }, 'CSV upload produced no importable cards');
        return { success: false, errors, warnings: [], cardsAdded: 0 };
      }

      await importCardsIntoDeck({
        deckId: input.deckId,
        userId: ctx.user.id,
        cards,
      });

      logger.info({
        event: 'admin.upload_csv.finish',
        deckId: input.deckId,
        userId: ctx.user.id,
        cardsAdded: cards.length,
        parseErrorCount: errors.length,
      }, 'CSV upload import completed');
      return { success: true, errors, warnings: [], cardsAdded: cards.length };
    }),

  previewAnkiDeck: adminProcedure
    .input(z.object({
      apkgBase64: z.string().max(APKG_MAX_BASE64_CHARS),
    }))
    .mutation(async ({ input }) => {
      const result = await previewAnkiApkgFields(input.apkgBase64);
      return result;
    }),

  uploadAnkiDeck: adminProcedure
    .input(z.object({
      deckId: z.number(),
      apkgBase64: z.string().max(APKG_MAX_BASE64_CHARS),
      frontFieldIndex: z.number().int().min(0).max(50).optional(),
      backFieldIndex: z.number().int().min(0).max(50).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      logger.info({
        event: 'admin.upload_anki.start',
        deckId: input.deckId,
        userId: ctx.user.id,
        payloadChars: input.apkgBase64.length,
      }, 'Anki upload requested');

      const { cardsAdded, errors, warnings } = await parseAnkiApkgBase64InBatches({
        apkgBase64: input.apkgBase64,
        noteBatchSize: 200,
        frontFieldIndex: input.frontFieldIndex,
        backFieldIndex: input.backFieldIndex,
        onBatch: async (cards) => {
          await insertCardBatch({
            deckId: input.deckId,
            cards,
          });
        },
      });

      logger.info({
        event: 'admin.upload_anki.parsed',
        deckId: input.deckId,
        userId: ctx.user.id,
        cardsAdded,
        parseErrorCount: errors.length,
        warningCount: warnings.length,
      }, 'Anki upload parsed');

      if (cardsAdded === 0) {
        logger.warn({
          event: 'admin.upload_anki.empty',
          deckId: input.deckId,
          userId: ctx.user.id,
          parseErrorCount: errors.length,
          warningCount: warnings.length,
        }, 'Anki upload produced no importable cards');
        return { success: false, errors, warnings, cardsAdded: 0 };
      }

      logger.debug({
        event: 'admin.upload_anki.scan.queued',
        deckId: input.deckId,
        userId: ctx.user.id,
      }, 'Queued background scan after Anki import');
      scanDeck(input.deckId, ctx.user.id)
        .then(() => {
          logger.info({
            event: 'admin.upload_anki.scan.completed',
            deckId: input.deckId,
            userId: ctx.user.id,
          }, 'Background scan after Anki import completed');
        })
        .catch((err) => {
          logger.error({
            event: 'admin.upload_anki.scan.failed',
            err,
            deckId: input.deckId,
            userId: ctx.user.id,
          }, 'Background scan after import failed');
        });

      logger.info({
        event: 'admin.upload_anki.finish',
        deckId: input.deckId,
        userId: ctx.user.id,
        cardsAdded,
        parseErrorCount: errors.length,
        warningCount: warnings.length,
      }, 'Anki upload import completed');
      return { success: true, errors, warnings, cardsAdded };
    }),

  assignDeckToGroup: adminProcedure
    .input(z.object({
      deckId: z.number(),
      groupId: z.number(),
    }))
    .mutation(async ({ input }) => {
      await db.insert(schema.deckGroups).values({
        deckId: input.deckId,
        groupId: input.groupId,
      }).onConflictDoNothing();
      return { success: true };
    }),

  removeDeckFromGroup: adminProcedure
    .input(z.object({
      deckId: z.number(),
      groupId: z.number(),
    }))
    .mutation(async ({ input }) => {
      await db.delete(schema.deckGroups)
        .where(and(
          eq(schema.deckGroups.deckId, input.deckId),
          eq(schema.deckGroups.groupId, input.groupId)
        ));
      return { success: true };
    }),

  getDeckGroups: adminProcedure
    .input(z.object({ deckId: z.number() }))
    .query(async ({ input }) => {
      const deckGroups = await db
        .select({ group: schema.groups })
        .from(schema.deckGroups)
        .innerJoin(schema.groups, eq(schema.deckGroups.groupId, schema.groups.id))
        .where(eq(schema.deckGroups.deckId, input.deckId));

      return deckGroups.map(dg => dg.group);
    }),

  /**
   * Every user's flashcard totals. `role` and `correctReviews` let the
   * dashboard pool retention over students (a teacher's test reviews and users
   * with no reviews would skew a mean of rates). `lastActive` is any activity,
   * not only flashcards, as the Users tab and a user's page show it; and
   * `studentNumber` is their school ID, for the dashboard's search.
   */
  getUserStats: adminProcedure.query(async () => {
    const stats = await db.select({
      userId: schema.users.id,
      userName: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      totalReviews: sql<number>`count(${schema.reviewLogs.id})`,
      // Each rating counted up to RATING_TIME_CAP_MS: older rows could claim any time.
      totalTimeMs: sql<number>`coalesce(sum(min(max(${schema.reviewLogs.timeSpentMs}, 0), ${RATING_TIME_CAP_MS})), 0)`,
      correctReviews: sql<number>`coalesce(sum(case when ${schema.reviewLogs.rating} >= 3 then 1 else 0 end), 0)`,
    })
      .from(schema.users)
      .leftJoin(schema.reviewLogs, eq(schema.reviewLogs.userId, schema.users.id))
      .groupBy(schema.users.id)
      .orderBy(schema.users.createdAt);
    const lastActive = lastActiveByUser();
    const overrides = studentNumberOverrideMap();

    return stats.map((row) => ({
      userId: row.userId,
      userName: row.userName,
      email: row.email,
      role: row.role,
      totalReviews: row.totalReviews,
      totalTimeMs: row.totalTimeMs,
      correctReviews: row.correctReviews,
      retentionRate: row.totalReviews > 0 ? row.correctReviews / row.totalReviews : 0,
      lastActive: lastActive.has(row.userId) ? new Date(lastActive.get(row.userId)!) : null,
      studentNumber: overrides.get(row.userId) ?? studentNumberFromEmail(row.email),
    }));
  }),

  getGroupStats: adminProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ input }) => {
      const [memberRows, reviewStatsRows] = await Promise.all([
        db.select({
          count: sql<number>`count(*)`,
        })
          .from(schema.userGroups)
          .where(eq(schema.userGroups.groupId, input.groupId)),
        db.select({
          totalReviews: sql<number>`count(${schema.reviewLogs.id})`,
          totalTimeMs: sql<number>`coalesce(sum(min(max(${schema.reviewLogs.timeSpentMs}, 0), ${RATING_TIME_CAP_MS})), 0)`,
          correctReviews: sql<number>`coalesce(sum(case when ${schema.reviewLogs.rating} >= 3 then 1 else 0 end), 0)`,
        })
          .from(schema.reviewLogs)
          .innerJoin(schema.userGroups, eq(schema.reviewLogs.userId, schema.userGroups.userId))
          .where(eq(schema.userGroups.groupId, input.groupId)),
      ]);

      const totalMembers = memberRows[0]?.count ?? 0;
      const reviewStats = reviewStatsRows[0] ?? {
        totalReviews: 0,
        totalTimeMs: 0,
        correctReviews: 0,
      };

      const averageRetention = reviewStats.totalReviews > 0
        ? reviewStats.correctReviews / reviewStats.totalReviews
        : 0;

      return {
        totalMembers,
        totalReviews: reviewStats.totalReviews,
        totalTimeMs: reviewStats.totalTimeMs,
        averageRetention,
      };
    }),

  getUserSettings: adminProcedure
    .input(z.object({
      userId: z.number(),
      timezoneOffsetMinutes: z.number().int().min(-720).max(840).optional(),
    }))
    .query(async ({ input }) => {
      const settings = await getOrCreateUserSettings(input.userId);

      // Get today's review counts for this user
      const todayStart = startOfDayForOffset(input.timezoneOffsetMinutes);

      // Count new cards done today (previousState was New)
      const newCardsToday = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.reviewLogs)
        .where(and(
          eq(schema.reviewLogs.userId, input.userId),
          eq(schema.reviewLogs.previousState, State.New),
          gte(schema.reviewLogs.reviewedAt, todayStart)
        ));

      // Count review-state cards done today (exclude Learning/Relearning steps)
      const reviewsToday = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.reviewLogs)
        .where(and(
          eq(schema.reviewLogs.userId, input.userId),
          eq(schema.reviewLogs.previousState, State.Review),
          gte(schema.reviewLogs.reviewedAt, todayStart)
        ));

      return {
        userId: settings.userId,
        newCardsPerDay: settings.newCardsPerDay,
        reviewsPerDay: settings.reviewsPerDay,
        isOverride: settings.isOverride ?? false,
        allowHigher: settings.allowHigher ?? true,
        allowLower: settings.allowLower ?? true,
        reviewsDoneToday: reviewsToday[0].count,
        newCardsDoneToday: newCardsToday[0].count,
        createdAt: settings.createdAt,
        updatedAt: settings.updatedAt,
      };
    }),

  updateUserSettings: adminProcedure
    .input(z.object({
      userId: z.number(),
      newCardsPerDay: z.number().int().min(0).max(500),
      reviewsPerDay: z.number().int().min(0).max(500),
      isOverride: z.boolean(),
      allowHigher: z.boolean(),
      allowLower: z.boolean(),
      aiEnabled: z.boolean(),
      aiEnabledLocked: z.boolean(),
      autoPlayAudio: z.boolean(),
      autoPlayAudioLocked: z.boolean(),
      autoPlayAudioFront: z.boolean(),
      autoPlayAudioFrontLocked: z.boolean(),
      // 'auto-non-cognate' from a page loaded before v1.20.0 is saved as 'manual'; its
      // showCognateScore(Locked) fields are dropped unread.
      mnemonicMode: mnemonicModeInput,
      mnemonicModeLocked: z.boolean(),
      locale: z.string().max(10).nullable(),
      localeLocked: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const settings = await updateUserSettingsAdmin(input.userId, {
        newCardsPerDay: input.newCardsPerDay,
        reviewsPerDay: input.reviewsPerDay,
        isOverride: input.isOverride,
        allowHigher: input.allowHigher,
        allowLower: input.allowLower,
        aiEnabled: input.aiEnabled,
        aiEnabledLocked: input.aiEnabledLocked,
        autoPlayAudio: input.autoPlayAudio,
        autoPlayAudioLocked: input.autoPlayAudioLocked,
        autoPlayAudioFront: input.autoPlayAudioFront,
        autoPlayAudioFrontLocked: input.autoPlayAudioFrontLocked,
        mnemonicMode: input.mnemonicMode,
        mnemonicModeLocked: input.mnemonicModeLocked,
        locale: input.locale,
        localeLocked: input.localeLocked,
      });

      return {
        userId: settings.userId,
        newCardsPerDay: settings.newCardsPerDay,
        reviewsPerDay: settings.reviewsPerDay,
        isOverride: settings.isOverride ?? false,
        allowHigher: settings.allowHigher ?? true,
        allowLower: settings.allowLower ?? true,
        aiEnabled: settings.aiEnabled ?? true,
        aiEnabledLocked: settings.aiEnabledLocked ?? false,
        autoPlayAudio: settings.autoPlayAudio ?? false,
        autoPlayAudioLocked: settings.autoPlayAudioLocked ?? false,
        autoPlayAudioFront: settings.autoPlayAudioFront ?? false,
        autoPlayAudioFrontLocked: settings.autoPlayAudioFrontLocked ?? false,
        mnemonicMode: readMnemonicMode(settings.mnemonicMode),
        mnemonicModeLocked: settings.mnemonicModeLocked ?? false,
        locale: settings.locale ?? null,
        localeLocked: settings.localeLocked ?? false,
        createdAt: settings.createdAt,
        updatedAt: settings.updatedAt,
      };
    }),

  getAllUserSettings: adminProcedure
    .input(z.object({
      timezoneOffsetMinutes: z.number().int().min(-720).max(840).optional(),
    }).optional())
    .query(async ({ input }) => {
      const users = await db.query.users.findMany();
      const todayStart = startOfDayForOffset(input?.timezoneOffsetMinutes);

      const settingsRows = await db.query.userSettings.findMany();
      const settingsMap = new Map(settingsRows.map((row) => [row.userId, row]));

      // Today's ratings per user AND deck: the limits are per deck, so a student who did
      // 20 new cards in each of two decks is at 20/20, not 40/20.
      const reviewCounts = await db
        .select({
          userId: schema.reviewLogs.userId,
          deckId: schema.cards.deckId,
          newCardsDone: sql<number>`coalesce(sum(case when ${schema.reviewLogs.previousState} = ${State.New} then 1 else 0 end), 0)`,
          reviewsDone: sql<number>`coalesce(sum(case when ${schema.reviewLogs.previousState} = ${State.Review} then 1 else 0 end), 0)`,
        })
        .from(schema.reviewLogs)
        .innerJoin(schema.cards, eq(schema.reviewLogs.cardId, schema.cards.id))
        .where(gte(schema.reviewLogs.reviewedAt, todayStart))
        .groupBy(schema.reviewLogs.userId, schema.cards.deckId);

      type TodayCounts = { newCardsDoneToday: number; reviewsDoneToday: number; decksToday: number; studiedToday: number };
      const reviewMap = new Map<number, TodayCounts>();
      for (const row of reviewCounts) {
        const counts = reviewMap.get(row.userId) ?? { newCardsDoneToday: 0, reviewsDoneToday: 0, decksToday: 0, studiedToday: 0 };
        const newDone = Number(row.newCardsDone ?? 0);
        const reviewsDone = Number(row.reviewsDone ?? 0);
        counts.newCardsDoneToday = Math.max(counts.newCardsDoneToday, newDone);
        counts.reviewsDoneToday = Math.max(counts.reviewsDoneToday, reviewsDone);
        counts.decksToday += 1;
        counts.studiedToday += newDone + reviewsDone;
        reviewMap.set(row.userId, counts);
      }

      return users.map((user) => {
        const settings = settingsMap.get(user.id);
        const counts = reviewMap.get(user.id) ?? { newCardsDoneToday: 0, reviewsDoneToday: 0, decksToday: 0, studiedToday: 0 };

        return {
          userId: user.id,
          userName: user.name,
          email: user.email,
          newCardsPerDay: settings?.newCardsPerDay ?? DEFAULT_USER_SETTINGS.newCardsPerDay,
          reviewsPerDay: settings?.reviewsPerDay ?? DEFAULT_USER_SETTINGS.reviewsPerDay,
          isOverride: settings?.isOverride ?? false,
          allowHigher: settings?.allowHigher ?? true,
          allowLower: settings?.allowLower ?? true,
          aiEnabled: settings?.aiEnabled ?? DEFAULT_USER_SETTINGS.aiEnabled,
          aiEnabledLocked: settings?.aiEnabledLocked ?? false,
          autoPlayAudio: settings?.autoPlayAudio ?? DEFAULT_USER_SETTINGS.autoPlayAudio,
          autoPlayAudioLocked: settings?.autoPlayAudioLocked ?? false,
          autoPlayAudioFront: settings?.autoPlayAudioFront ?? DEFAULT_USER_SETTINGS.autoPlayAudioFront,
          autoPlayAudioFrontLocked: settings?.autoPlayAudioFrontLocked ?? false,
          mnemonicMode: readMnemonicMode(settings?.mnemonicMode),
          mnemonicModeLocked: settings?.mnemonicModeLocked ?? false,
          locale: settings?.locale ?? null,
          localeLocked: settings?.localeLocked ?? false,
          /** The most rated today in any one deck (limits are per deck). */
          reviewsDoneToday: counts.reviewsDoneToday,
          newCardsDoneToday: counts.newCardsDoneToday,
          /** Decks with a rating today. */
          decksToday: counts.decksToday,
          /** New cards and reviews rated today, all decks together (the Users tab sorts on it). */
          studiedToday: counts.studiedToday,
        };
      });
  }),

  exportDeckCards: adminProcedure
    .input(z.object({ deckId: z.number() }))
    .query(async ({ input }) => {
      const cards = await db
        .select({
          id: schema.cards.id,
          front: schema.cards.front,
          back: schema.cards.back,
          mnemonic: schema.cards.mnemonic,
        })
        .from(schema.cards)
        .where(eq(schema.cards.deckId, input.deckId))
        .orderBy(schema.cards.id);

      const deck = await db.query.decks.findFirst({
        where: eq(schema.decks.id, input.deckId),
      });

      const cardIds = cards.map(c => c.id);

      // Fetch AI assets (audio + image) for all cards in one query
      const aiAssets = cardIds.length > 0
        ? await db.query.aiAssets.findMany({
            where: and(
              inArray(schema.aiAssets.cardId, cardIds),
              eq(schema.aiAssets.status, 'ready'),
            ),
          })
        : [];

      // Build lookup maps
      const assetsByCard = new Map<number, typeof aiAssets>();
      for (const asset of aiAssets) {
        const list = assetsByCard.get(asset.cardId) ?? [];
        list.push(asset);
        assetsByCard.set(asset.cardId, list);
      }

      const csvEsc = (s: string | null | undefined) => `"${(s ?? '').replace(/"/g, '""')}"`;

      // No cognate_score column since v1.20.0 (an import ignores one if a file has it).
      const csvRows = ['front,back,mnemonic,audio_front,audio_back,image_front,image_back'];
      for (const card of cards) {
        const cardAssets = assetsByCard.get(card.id) ?? [];
        const frontText = card.front.replace(/<[^>]*>/g, '').trim();
        const backText = card.back.replace(/<[^>]*>/g, '').trim();
        const audioFront = cardAssets.find(a => a.assetType === 'audio' && a.prompt === frontText)?.url ?? '';
        const audioBack = cardAssets.find(a => a.assetType === 'audio' && a.prompt === backText)?.url ?? '';
        const imageFront = cardAssets.find(a => a.assetType === 'image' && a.prompt?.includes('front'))?.url ?? '';
        const imageBack = cardAssets.find(a => a.assetType === 'image' && !a.prompt?.includes('front'))?.url ?? '';

        csvRows.push([
          csvEsc(card.front),
          csvEsc(card.back),
          // The one students see — never a student's private pick.
          csvEsc(card.mnemonic ?? ''),
          csvEsc(audioFront),
          csvEsc(audioBack),
          csvEsc(imageFront),
          csvEsc(imageBack),
        ].join(','));
      }

      return {
        deckName: deck?.name ?? 'deck',
        csv: csvRows.join('\n'),
        cardCount: cards.length,
      };
    }),

  exportUserProgress: adminProcedure.query(async () => {
    const reviews = await db
      .select({
        userName: schema.users.name,
        userEmail: schema.users.email,
        front: schema.cards.front,
        back: schema.cards.back,
        rating: schema.reviewLogs.rating,
        reviewedAt: schema.reviewLogs.reviewedAt,
        timeSpentMs: schema.reviewLogs.timeSpentMs,
        previousState: schema.reviewLogs.previousState,
        newState: schema.reviewLogs.newState,
      })
      .from(schema.reviewLogs)
      .innerJoin(schema.users, eq(schema.reviewLogs.userId, schema.users.id))
      .innerJoin(schema.cards, eq(schema.reviewLogs.cardId, schema.cards.id))
      .orderBy(schema.reviewLogs.reviewedAt);

    const csvRows = ['user_name,user_email,card_front,card_back,rating,reviewed_at,time_spent_ms,previous_state,new_state'];
    for (const r of reviews) {
      const name = r.userName.replace(/"/g, '""');
      const email = r.userEmail.replace(/"/g, '""');
      const front = r.front.replace(/"/g, '""');
      const back = r.back.replace(/"/g, '""');
      const reviewedAt = r.reviewedAt instanceof Date ? r.reviewedAt.toISOString() : String(r.reviewedAt);
      csvRows.push(`"${name}","${email}","${front}","${back}",${r.rating},"${reviewedAt}",${r.timeSpentMs},${r.previousState},${r.newState}`);
    }

    return {
      csv: csvRows.join('\n'),
      reviewCount: reviews.length,
    };
  }),

  getUserReviewHistory: adminProcedure
    .input(z.object({
      userId: z.number(),
      limit: z.number().int().min(1).max(200).optional().default(50),
      offset: z.number().int().min(0).optional().default(0),
    }))
    .query(async ({ input }) => {
      const reviews = await db
        .select({
          id: schema.reviewLogs.id,
          cardId: schema.reviewLogs.cardId,
          rating: schema.reviewLogs.rating,
          reviewedAt: schema.reviewLogs.reviewedAt,
          timeSpentMs: schema.reviewLogs.timeSpentMs,
          previousState: schema.reviewLogs.previousState,
          newState: schema.reviewLogs.newState,
          front: schema.cards.front,
          back: schema.cards.back,
        })
        .from(schema.reviewLogs)
        .innerJoin(schema.cards, eq(schema.reviewLogs.cardId, schema.cards.id))
        .where(eq(schema.reviewLogs.userId, input.userId))
        .orderBy(sql`${schema.reviewLogs.reviewedAt} DESC`)
        .limit(input.limit)
        .offset(input.offset);

      const total = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.reviewLogs)
        .where(eq(schema.reviewLogs.userId, input.userId));

      return {
        reviews,
        total: total[0].count,
      };
    }),

  // Group settings
  getGroupSettings: adminProcedure
    .input(z.object({ groupId: z.number() }))
    .query(async ({ input }) => {
      const settings = await getOrCreateGroupSettings(input.groupId);
      return {
        groupId: settings.groupId,
        newCardsPerDay: settings.newCardsPerDay,
        reviewsPerDay: settings.reviewsPerDay,
        isOverride: settings.isOverride ?? false,
        allowHigher: settings.allowHigher ?? true,
        allowLower: settings.allowLower ?? true,
        aiEnabled: settings.aiEnabled ?? true,
        aiEnabledLocked: settings.aiEnabledLocked ?? false,
        autoPlayAudio: settings.autoPlayAudio ?? false,
        autoPlayAudioLocked: settings.autoPlayAudioLocked ?? false,
        autoPlayAudioFront: settings.autoPlayAudioFront ?? false,
        autoPlayAudioFrontLocked: settings.autoPlayAudioFrontLocked ?? false,
        mnemonicMode: readMnemonicMode(settings.mnemonicMode),
        mnemonicModeLocked: settings.mnemonicModeLocked ?? false,
        locale: settings.locale ?? null,
        localeLocked: settings.localeLocked ?? false,
        createdAt: settings.createdAt,
        updatedAt: settings.updatedAt,
      };
    }),

  updateGroupSettings: adminProcedure
    .input(z.object({
      groupId: z.number(),
      newCardsPerDay: z.number().int().min(0).max(500),
      reviewsPerDay: z.number().int().min(0).max(500),
      isOverride: z.boolean(),
      allowHigher: z.boolean(),
      allowLower: z.boolean(),
      aiEnabled: z.boolean(),
      aiEnabledLocked: z.boolean(),
      autoPlayAudio: z.boolean(),
      autoPlayAudioLocked: z.boolean(),
      autoPlayAudioFront: z.boolean(),
      autoPlayAudioFrontLocked: z.boolean(),
      // 'auto-non-cognate' from a page loaded before v1.20.0 is saved as 'manual'; its
      // showCognateScore(Locked) fields are dropped unread.
      mnemonicMode: mnemonicModeInput,
      mnemonicModeLocked: z.boolean(),
      locale: z.string().max(10).nullable(),
      localeLocked: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const settings = await updateGroupSettings(input.groupId, {
        newCardsPerDay: input.newCardsPerDay,
        reviewsPerDay: input.reviewsPerDay,
        isOverride: input.isOverride,
        allowHigher: input.allowHigher,
        allowLower: input.allowLower,
        aiEnabled: input.aiEnabled,
        aiEnabledLocked: input.aiEnabledLocked,
        autoPlayAudio: input.autoPlayAudio,
        autoPlayAudioLocked: input.autoPlayAudioLocked,
        autoPlayAudioFront: input.autoPlayAudioFront,
        autoPlayAudioFrontLocked: input.autoPlayAudioFrontLocked,
        mnemonicMode: input.mnemonicMode,
        mnemonicModeLocked: input.mnemonicModeLocked,
        locale: input.locale,
        localeLocked: input.localeLocked,
      });
      return {
        groupId: settings.groupId,
        newCardsPerDay: settings.newCardsPerDay,
        reviewsPerDay: settings.reviewsPerDay,
        isOverride: settings.isOverride ?? false,
        allowHigher: settings.allowHigher ?? true,
        allowLower: settings.allowLower ?? true,
        aiEnabled: settings.aiEnabled ?? true,
        aiEnabledLocked: settings.aiEnabledLocked ?? false,
        autoPlayAudio: settings.autoPlayAudio ?? false,
        autoPlayAudioLocked: settings.autoPlayAudioLocked ?? false,
        autoPlayAudioFront: settings.autoPlayAudioFront ?? false,
        autoPlayAudioFrontLocked: settings.autoPlayAudioFrontLocked ?? false,
        mnemonicMode: readMnemonicMode(settings.mnemonicMode),
        mnemonicModeLocked: settings.mnemonicModeLocked ?? false,
        locale: settings.locale ?? null,
        localeLocked: settings.localeLocked ?? false,
        createdAt: settings.createdAt,
        updatedAt: settings.updatedAt,
      };
    }),

  applyGroupSettingsToMembers: adminProcedure
    .input(z.object({ groupId: z.number() }))
    .mutation(async ({ input }) => {
      const count = await applyGroupSettingsToMembers(input.groupId);
      return { membersUpdated: count };
    }),

  // Allowed emails management
  getAllowedEmails: adminProcedure.query(async () => {
    const patterns = await db.query.allowedEmails.findMany({
      orderBy: (emails, { desc }) => [desc(emails.createdAt)],
    });
    return patterns;
  }),

  addAllowedEmail: adminProcedure
    .input(z.object({
      pattern: z.string().min(1).max(500),
      isRegex: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Validate regex if it's a regex pattern
      if (input.isRegex) {
        const regex = tryCompileSafeRegex(input.pattern);
        if (!regex) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Invalid or unsafe regular expression pattern',
            cause: { appCode: 'UNSAFE_REGEX' },
          });
        }
      }

      const result = await db.insert(schema.allowedEmails).values({
        pattern: input.pattern,
        isRegex: input.isRegex,
        createdBy: ctx.user.id,
      }).returning();

      return result[0];
    }),

  deleteAllowedEmail: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.delete(schema.allowedEmails).where(eq(schema.allowedEmails.id, input.id));
      return { success: true };
    }),

  testEmailPattern: adminProcedure
    .input(z.object({
      pattern: z.string(),
      isRegex: z.boolean(),
      testEmail: z.string().email(),
    }))
    .query(({ input }) => {
      if (input.isRegex) {
        const regex = tryCompileSafeRegex(input.pattern);
        if (!regex) {
          return { matches: false, error: 'Invalid or unsafe regex' };
        }
        return { matches: regex.test(input.testEmail) };
      } else {
        return { matches: input.pattern.toLowerCase() === input.testEmail.toLowerCase() };
      }
    }),

  getCleverCredentials: adminProcedure.query(async () => {
    const settings = await getAppSettings();
    return {
      hasClientId: Boolean(settings.cleverClientId),
      hasClientSecret: Boolean(settings.cleverClientSecret),
      cleverEnabled: !isCleverAuthDisabled() && Boolean(settings.cleverClientId && settings.cleverClientSecret),
    };
  }),

  saveCleverCredentials: adminProcedure
    .input(z.object({
      cleverClientId: z.string().trim().min(1).max(500),
      cleverClientSecret: z.string().trim().min(1).max(500),
    }))
    .mutation(async ({ input }) => {
      await updateAppSettings({
        cleverClientId: input.cleverClientId,
        cleverClientSecret: input.cleverClientSecret,
      });
      logger.info({ event: 'admin.clever_credentials.saved' }, 'Clever OAuth credentials updated');
      return { success: true };
    }),

  clearCleverCredentials: adminProcedure.mutation(async () => {
    await updateAppSettings({
      cleverClientId: null,
      cleverClientSecret: null,
    });
    logger.info({ event: 'admin.clever_credentials.cleared' }, 'Clever OAuth credentials cleared');
    return { success: true };
  }),
});
