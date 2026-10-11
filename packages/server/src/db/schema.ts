// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  googleId: text('google_id').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  picture: text('picture'),
  role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const groups = sqliteTable('groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const userGroups = sqliteTable('user_groups', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  joinedAt: integer('joined_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.groupId] }),
  groupIdx: index('idx_user_groups_group').on(table.groupId),
}));

export const decks = sqliteTable('decks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  reversible: integer('reversible', { mode: 'boolean' }).notNull().default(false),
  sourceLanguage: text('source_language'),
  targetLanguage: text('target_language'),
  speechAccent: text('speech_accent'),
  sourceAccent: text('source_accent'),
  targetAccent: text('target_accent'),
  // Which sides get pronunciation audio. A Spanish class usually wants the
  // Spanish side only — generating the English side costs credits, and an
  // unmapped English voice sounds wrong. Default on for existing decks.
  audioFrontEnabled: integer('audio_front_enabled', { mode: 'boolean' }).notNull().default(true),
  audioBackEnabled: integer('audio_back_enabled', { mode: 'boolean' }).notNull().default(true),
  createdBy: integer('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const deckGroups = sqliteTable('deck_groups', {
  deckId: integer('deck_id').notNull().references(() => decks.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.deckId, table.groupId] }),
  groupIdx: index('idx_deck_groups_group').on(table.groupId),
}));

export const cards = sqliteTable('cards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deckId: integer('deck_id').notNull().references(() => decks.id, { onDelete: 'cascade' }),
  front: text('front').notNull(),
  back: text('back').notNull(),
  /** @deprecated since v1.20.0: the cognate system was removed; no code reads or writes this. Drop in a later migration. See drizzle/DEPRECATED.md. */
  cognateScore: real('cognate_score'),
  /**
   * The mnemonic every student sees on this card: chosen by a teacher and
   * stored, so showing it is a read. Students never cause a generation.
   */
  mnemonic: text('mnemonic'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  deckIdx: index('idx_cards_deck').on(table.deckId),
}));

export const cardStates = sqliteTable('card_states', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cardId: integer('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  direction: integer('direction').notNull().default(0),
  stability: real('stability').notNull().default(0),
  difficulty: real('difficulty').notNull().default(0),
  elapsedDays: real('elapsed_days').notNull().default(0),
  scheduledDays: real('scheduled_days').notNull().default(0),
  reps: integer('reps').notNull().default(0),
  lapses: integer('lapses').notNull().default(0),
  learningSteps: integer('learning_steps').notNull().default(0),
  state: integer('state').notNull().default(0),
  lastReview: integer('last_review', { mode: 'timestamp' }),
  nextReview: integer('next_review', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  userNextIdx: index('idx_card_states_user_next').on(table.userId, table.nextReview),
  userCardDirectionIdx: uniqueIndex('uniq_card_states_user_card_direction')
    .on(table.userId, table.cardId, table.direction),
}));

export const reviewLogs = sqliteTable('review_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cardId: integer('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  cardStateId: integer('card_state_id').references(() => cardStates.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  rating: integer('rating').notNull(),
  reviewedAt: integer('reviewed_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  timeSpentMs: integer('time_spent_ms').notNull(),
  previousState: integer('previous_state').notNull(),
  newState: integer('new_state').notNull(),
  previousStateSnapshot: text('previous_state_snapshot'),
}, (table) => ({
  userReviewedIdx: index('idx_review_logs_user').on(table.userId, table.reviewedAt),
  cardStateReviewedIdx: index('idx_review_logs_card_state').on(table.cardStateId, table.reviewedAt),
  cardUserIdx: index('idx_review_logs_card_user').on(table.userId, table.cardId),
}));

/**
 * Every time a student reaches the "All Done!" sloth screen.
 *
 * `reason` matters for grading: finishing a session is work done, whereas
 * arriving to find nothing due is not — without the distinction an empty deck
 * would earn the same credit as a completed one.
 */
export const studyCompletions = sqliteTable('study_completions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  deckId: integer('deck_id').references(() => decks.id, { onDelete: 'cascade' }),
  virtualDeckId: integer('virtual_deck_id').references(() => virtualDecks.id, { onDelete: 'cascade' }),
  reason: text('reason', { enum: ['session_complete', 'nothing_due'] }).notNull(),
  newCardsDone: integer('new_cards_done').notNull().default(0),
  reviewsDone: integer('reviews_done').notNull().default(0),
  completedAt: integer('completed_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  userCompletedIdx: index('idx_study_completions_user').on(table.userId, table.completedAt),
  deckCompletedIdx: index('idx_study_completions_deck').on(table.deckId, table.completedAt),
}));

/**
 * The school days (YYYY-MM-DD, America/Los_Angeles) on which a student finished
 * ALL their flashcards (v1.18.0): nothing due in any deck of their groups (the
 * deck cards' "due today": learning, reviews and new cards within the limits),
 * after rating at least one card that day. One row per student and day, the
 * first moment it was so; for the teacher's Flashcards-by-day grid (and for
 * whatever an extension does with that day). Mini-decks do not count.
 */
export const flashcardAllDone = sqliteTable('flashcard_all_done', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: text('day').notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp_ms' }).notNull(),
  /** JSON array of the deck ids that were all done then (the student's assigned decks, newest first). */
  deckIds: text('deck_ids').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.day] }),
  dayIdx: index('idx_flashcard_all_done_day').on(table.day),
}));

/**
 * Listening labs: teacher-uploaded audio the student speaks along with.
 *
 * The course labs are pause-and-respond — the narrator prompts, the student
 * answers aloud in the pause, the model voice confirms. Nothing is recorded:
 * while the lab plays, the student's page only measures whether its
 * microphone hears a voice in each answer pause, and reports that per pause
 * with the listening log (see labListenEvents).
 *
 * `requiredThroughMs` is where the last speech ends, measured when the file is
 * scanned in the browser at upload. Requiring playback to the raw end would
 * make students sit through trailing silence; a fixed percentage would let
 * them skip real content. The same scan finds the answer pauses (`pauses`):
 * the server has no audio decoder, and a list made in a student's browser
 * could not be trusted.
 *
 * Labs start hidden (`active` false) so a semester can be uploaded at once and
 * released week by week.
 */
export const labs = sqliteTable('labs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  description: text('description'),
  audioUrl: text('audio_url').notNull(),
  mimeType: text('mime_type').notNull(),
  durationMs: integer('duration_ms').notNull(),
  requiredThroughMs: integer('required_through_ms').notNull(),
  /**
   * Stored, not inferred from an empty group list: a lab assigned to groups
   * that are later deleted must fail closed (visible to nobody), not open up
   * to every student.
   */
  forEveryone: integer('for_everyone', { mode: 'boolean' }).notNull().default(false),
  active: integer('active', { mode: 'boolean' }).notNull().default(false),
  createdBy: integer('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  /**
   * The answer pauses the teacher's browser found, as JSON `[[startMs, endMs], ...]`
   * sorted by start (shared `validatePauseList`). NULL: never scanned, so the
   * lab keeps the old rule (speak for long enough); `[]`: scanned, none found.
   */
  pauses: text('pauses'),
  /** JSON: the scan's numbers (shared `LabPauseScan`) plus `scannedAt` (ms), which the server sets. */
  pauseScan: text('pause_scan'),
  /** Pauses that start at or after this point don't count (dictation). NULL: they all count. */
  pauseCountUntilMs: integer('pause_count_until_ms'),
  /**
   * NULL: a practice lab. A name ("U3"): an exam lab (v1.19.0), one form of
   * that exam set, stored canonical (shared `canonicalExamSet`, in the spelling
   * the set already has). Each student gets one start per set (labExamStarts).
   */
  examSet: text('exam_set'),
}, (table) => ({
  activeIdx: index('idx_labs_active').on(table.active),
  examSetIdx: index('idx_labs_exam_set').on(table.examSet),
}));

/** The groups a lab is assigned to, when it is not for everyone. */
export const labGroups = sqliteTable('lab_groups', {
  labId: integer('lab_id').notNull().references(() => labs.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.labId, table.groupId] }),
  groupIdx: index('idx_lab_groups_group').on(table.groupId),
}));

/**
 * A student's completed lab, with the evidence that goes with it. Labs are not
 * recorded; the microphone only measures whether and how long the student spoke.
 *
 * `startedAt` is server-verified (it comes from a start token the server
 * signed), so `submittedAt - startedAt` is a floor no client can shorten.
 * `listenedCoveredMs` comes from the server's listening log. `voicedMs` is
 * the browser's measurement of speech in the pauses.
 *
 * From v1.15.0 a lab can be scored: the server checks the page's per-pause
 * results against its log and the rules the session began with, and stores
 * the result with the snapshot it was judged by. `credit` is that automatic
 * result (it defaults to false, so a row written without it fails closed;
 * rows from before v1.15.0 were set to true); `creditOverride` is the
 * teacher's, and wins when set.
 */
export const labSubmissions = sqliteTable('lab_submissions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  labId: integer('lab_id').notNull().references(() => labs.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /**
   * The lab's must-hear-through point when this was accepted. Flags and exports
   * are judged against it, so editing the lab later does not rewrite history.
   */
  requiredThroughMs: integer('required_through_ms').notNull(),
  /** Time the microphone picked up a voice while the lab played. */
  voicedMs: integer('voiced_ms').notNull().default(0),
  /** How far into the lab the server's listening log shows the student heard without a gap. */
  listenedCoveredMs: integer('listened_covered_ms').notNull().default(0),
  /** Forward jumps in the listening log that outran the clock. */
  skipCount: integer('skip_count').notNull().default(0),
  /** Wall-clock time the lab audio was actually playing. */
  listenWallMs: integer('listen_wall_ms').notNull().default(0),
  /** The signed session start, to the millisecond: it identifies the session. */
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
  submittedAt: integer('submitted_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  /** 'off': the student did the lab without a microphone ("My mic doesn't work", or it was lost). */
  mic: text('mic', { enum: ['on', 'off'] }).notNull().default('on'),
  /** How many pauses counted, and how many were answered. NULL: not scored (legacy or unscanned lab). */
  pausesCounted: integer('pauses_counted'),
  pausesAnswered: integer('pauses_answered'),
  /** JSON `[[startMs, bestVoicedMs or -1], ...]` over the counted pauses (-1: no result accepted). */
  pauseResults: text('pause_results'),
  /** Pause results that did not match what the log shows was played. */
  rejectedAnswers: integer('rejected_answers').notNull().default(0),
  /** Pause results that reached the server long after they happened; they never count. */
  lateAnswers: integer('late_answers').notNull().default(0),
  /** The session's snapshot of the teacher's settings: share of pauses (%) and voice per pause (ms). */
  minAnsweredPct: integer('min_answered_pct'),
  voicePerPauseMs: integer('voice_per_pause_ms'),
  /** Played time outside every counted pause, and the voice heard in it (for the "Voice outside the pauses" flag, id 'noisy'). */
  outsideVoicedMs: integer('outside_voiced_ms'),
  outsidePlayedMs: integer('outside_played_ms'),
  /** JSON array of the flags decided at submit (LabSubmissionFlag). */
  flags: text('flags'),
  /** The automatic result. Use `creditOverride ?? credit`. */
  credit: integer('credit', { mode: 'boolean' }).notNull().default(false),
  /** The teacher's decision: true gave credit, false took it away or asked for a redo; NULL is automatic. */
  creditOverride: integer('credit_override', { mode: 'boolean' }),
  creditOverrideAt: integer('credit_override_at', { mode: 'timestamp' }),
  /** The teacher who set the override (a user id; no foreign key, like the other snapshot values). */
  creditOverrideBy: integer('credit_override_by'),
  /** When the student pressed "The mic didn't hear me": the row waits for the teacher. */
  checkRequestedAt: integer('check_requested_at', { mode: 'timestamp' }),
  /**
   * Why the row waits for the teacher ("Check it") instead of counting by
   * itself: a JSON array of reasons ('odd-answers', 'overlap', 'noisy'). NULL
   * is not held. Holds apply only when the session's rule was above 0%. From
   * v1.16.0 (0040); a server rolled back to v1.15 reads a held row as a redo.
   */
  heldFor: text('held_for'),
  /**
   * JSON `LabMicStats` (shared): what the page's voice meter measured (room
   * level, gate, the old meter's count, time in the background, the mic's
   * processing). The page reports it, so it is information, never evidence.
   * NULL: turned in before v1.16.0, or no stats sent.
   */
  micStats: text('mic_stats'),
  /**
   * The exam set the session was turned in under (v1.19.0): a test, done
   * without a microphone by design, so "No microphone" and "Little speech"
   * are left out of its flags. NULL: practice.
   */
  examSet: text('exam_set'),
}, (table) => ({
  labUserIdx: index('idx_lab_submissions_lab_user').on(table.labId, table.userId),
  userIdx: index('idx_lab_submissions_user').on(table.userId, table.submittedAt),
  /** One submission per session: a retried submit is the same submission, not another attempt. */
  sessionUnique: uniqueIndex('uq_lab_submissions_session').on(table.labId, table.userId, table.startedAt),
}));

/**
 * The listening log: where the lab audio was, stamped with the server's clock,
 * every few seconds while it plays and at each pause, jump back and end.
 *
 * It is what makes skipping visible — a position cannot advance faster than
 * the server's clock — and it shows how far a student got even if they never
 * submitted. Times are plain milliseconds, not the second-resolution
 * timestamps used elsewhere, because the checks compare them to audio time.
 */
export const labListenEvents = sqliteTable('lab_listen_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  labId: integer('lab_id').notNull().references(() => labs.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** The session's signed start, which ties events to one attempt. */
  sessionStartedAt: integer('session_started_at').notNull(),
  /** 'open' is written by the server when the session begins; the rest come from the page. */
  kind: text('kind', { enum: ['open', 'play', 'tick', 'pause', 'seek', 'end', 'nomic'] }).notNull(),
  positionMs: integer('position_ms').notNull(),
  /** The page's own clock since the session began: precise between entries, immune to network delay. */
  clientMs: integer('client_ms').notNull(),
  /** The server's clock when the entry arrived. */
  at: integer('at').notNull(),
  /** JSON `[[pauseStartMs, voicedMs], ...]`: the pause results this report carried, or NULL. */
  answers: text('answers'),
  /**
   * JSON `LabRules` (shared) on 'open' rows only: the counted pauses and the
   * settings the session is judged by, fixed when it began. NULL on every
   * other row, and on sessions opened before v1.15.0.
   */
  rules: text('rules'),
}, (table) => ({
  sessionIdx: index('idx_lab_listen_events_session').on(table.labId, table.userId, table.sessionStartedAt, table.at),
  /** A student's entries in any lab by time: finds two sessions playing at once. */
  userAtIdx: index('idx_lab_listen_events_user_at').on(table.userId, table.at),
}));

/**
 * Exam starts (v1.19.0): one row each time a student was counted as starting
 * a form of an exam set. The live row (`resetAt` NULL) is unique per set and
 * student: that is the student's one start. The teacher's Reset stamps
 * `resetAt`/`resetBy`, which gives exactly one more start and keeps the row
 * as history; nothing in the listening log or the submissions is touched.
 *
 * `source` 'start': claimed when the student pressed "Start the test";
 * 'past': counted from a play made before the lab joined the set, or in a
 * session opened before it did (a practice page left open). Times are
 * plain epoch milliseconds, like the listening log; `sessionStartedAt` is the
 * session's signed start. `labId` goes NULL when the lab is deleted
 * (`labTitle` keeps which form it was) and the start still counts.
 * `resetBy` is a user id with no foreign key, like `creditOverrideBy`.
 */
export const labExamStarts = sqliteTable('lab_exam_starts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  examSet: text('exam_set').notNull(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  labId: integer('lab_id').references(() => labs.id, { onDelete: 'set null' }),
  labTitle: text('lab_title').notNull(),
  sessionStartedAt: integer('session_started_at').notNull(),
  startedAt: integer('started_at').notNull(),
  source: text('source', { enum: ['start', 'past'] }).notNull().default('start'),
  resetAt: integer('reset_at'),
  resetBy: integer('reset_by'),
}, (table) => ({
  /** One start per student per set: two tabs racing cannot both claim it. */
  liveUnique: uniqueIndex('uq_lab_exam_starts_live').on(table.examSet, table.userId).where(sql`${table.resetAt} IS NULL`),
  userIdx: index('idx_lab_exam_starts_user').on(table.userId, table.examSet),
  labIdx: index('idx_lab_exam_starts_lab').on(table.labId, table.userId, table.sessionStartedAt),
}));

/**
 * The teacher's pause rule, one row (id 1): the share of a lab's counted
 * pauses a student must answer, and the voice that makes a pause answered.
 * Migration 0039 seeds 0% (watch first: every lab counts). No row reads as the
 * shared defaults (DEFAULT_MIN_ANSWERED_PCT, DEFAULT_VOICE_PER_PAUSE_MS,
 * DEFAULT_GATE_MARGIN_DB), which the column defaults repeat. A session keeps
 * the values it began with.
 */
export const labSettings = sqliteTable('lab_settings', {
  id: integer('id').primaryKey(),
  /** 0–100; 0 turns the rule off. */
  minAnsweredPct: integer('min_answered_pct').notNull().default(75),
  /** 200–2000 ms (the minimum was 250 before v1.16.0). */
  voicePerPauseMs: integer('voice_per_pause_ms').notNull().default(250),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  /** How far over the room level (dB) a voice must be for the lab page to count it: 4–12 (0040). */
  gateMarginDb: integer('gate_margin_db').notNull().default(6),
  /** Also hold labs with voice outside the pauses for the teacher. Off: it stays a flag (0040). */
  holdOutsideVoice: integer('hold_outside_voice', { mode: 'boolean' }).notNull().default(false),
});

/**
 * A speaking task: something a student records — reciting this week's cuento,
 * or a rung of the escalera oral. The recording is kept for the teacher to
 * hear and for a grader (an agent, later) to score against `referenceText`.
 */
export const speakingTasks = sqliteTable('speaking_tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  /** What to do, in the teacher's words. */
  instructions: text('instructions'),
  /** The exact words to say, when there are some (a cuento, a script). Graders compare against it. */
  referenceText: text('reference_text'),
  /** Show the text while recording (read aloud), or hide it (recite from memory). */
  showReference: integer('show_reference', { mode: 'boolean' }).notNull().default(true),
  /** A model recording in the public asset store, to hear before recording. */
  modelAudioUrl: text('model_audio_url'),
  /** A target length ("30 s"), shown to the student; not enforced. */
  targetSeconds: integer('target_seconds'),
  forEveryone: integer('for_everyone', { mode: 'boolean' }).notNull().default(false),
  active: integer('active', { mode: 'boolean' }).notNull().default(false),
  createdBy: integer('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  /**
   * NULL: a practice task. A name ("U2"): a speaking test of that exam set (v1.21.0), stored canonical
   * (shared `canonicalExamSet`) in the spelling the set already has (services/examLabs `resolveExamSet`,
   * shared with exam labs). Listed on the Tests page instead of the Speaking page; it records like any task.
   */
  examSet: text('exam_set'),
}, (table) => ({
  activeIdx: index('idx_speaking_tasks_active').on(table.active),
}));

export const speakingTaskGroups = sqliteTable('speaking_task_groups', {
  taskId: integer('task_id').notNull().references(() => speakingTasks.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.taskId, table.groupId] }),
  groupIdx: index('idx_speaking_task_groups_group').on(table.groupId),
}));

/**
 * A student's recording for a speaking task, and its grade once graded.
 * The grade columns are written later — by a teacher, or by an agent scoring
 * vowel accuracy against the reference text stored here.
 */
export const speakingSubmissions = sqliteTable('speaking_submissions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: integer('task_id').notNull().references(() => speakingTasks.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** Chosen by the page for each recording, so a retried upload is recognised. */
  clientKey: text('client_key').notNull(),
  audioUrl: text('audio_url').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull().default(0),
  /**
   * The take's length and the voice in it. From v1.16.0 the length is the
   * server's reading of the file when it can read one, and the voice is capped
   * at that length; what the page claimed is in the client_* columns.
   */
  durationMs: integer('duration_ms').notNull().default(0),
  voicedMs: integer('voiced_ms').notNull().default(0),
  /** The task's reference text when this was recorded: what it is graded against. */
  referenceText: text('reference_text'),
  submittedAt: integer('submitted_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  /** 0–100. */
  gradeScore: real('grade_score'),
  /** JSON, grader-defined (e.g. per-vowel accuracy). */
  gradeDetails: text('grade_details'),
  gradeFeedback: text('grade_feedback'),
  /** Who or what graded it: "teacher", "vowel-agent v1". */
  gradedBy: text('graded_by'),
  gradedAt: integer('graded_at', { mode: 'timestamp' }),
  /**
   * SHA-256 (hex) of the recording's audio payload, not of the file, so an
   * edited or re-posted copy of a take (this student's, a classmate's, or the
   * model) is found. A file the server cannot read as WebM (MP4, Ogg, or
   * unreadable) gets the whole file's hash instead. NULL: recorded before
   * v1.16.0 (0040).
   */
  contentSha256: text('content_sha256'),
  /** What the page claimed: the take's length and the voice it heard, in ms (0040). */
  clientDurationMs: integer('client_duration_ms'),
  clientVoicedMs: integer('client_voiced_ms'),
  /**
   * JSON array of the flags decided at upload: 'same-file', 'copied', 'model',
   * 'length-mismatch', 'little-speech', 'unmeasured'. NULL before v1.16.0 (0040).
   */
  flags: text('flags'),
  /** JSON: the microphone processing the page's browser reported (`track.getSettings()`) (0040). */
  micSettings: text('mic_settings'),
}, (table) => ({
  taskUserIdx: index('idx_speaking_submissions_task_user').on(table.taskId, table.userId),
  userIdx: index('idx_speaking_submissions_user').on(table.userId, table.submittedAt),
  clientKeyUnique: uniqueIndex('uq_speaking_submissions_client_key').on(table.userId, table.clientKey),
  /** Finds earlier takes with the same audio: this student's, a classmate's. */
  contentShaIdx: index('idx_speaking_submissions_sha').on(table.contentSha256),
}));

/**
 * A sign-up sheet: a list of class days students pick from — who presents
 * on which day, who recites on which Friday. Each day holds
 * a few students; each student picks a set number of days.
 */
export const signupSheets = sqliteTable('signup_sheets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  /** What students are signing up to do, in the teacher's words. */
  description: text('description'),
  /** Students per day, unless a day sets its own. */
  slotsPerDate: integer('slots_per_date').notNull().default(2),
  /** How many days each student picks. */
  picksPerStudent: integer('picks_per_student').notNull().default(1),
  /** Classmates see who took a day ("Ana R."); otherwise only that it is taken. */
  showNames: integer('show_names', { mode: 'boolean' }).notNull().default(true),
  /** Students may pick and drop days. A closed sheet is still shown, read-only. */
  open: integer('open', { mode: 'boolean' }).notNull().default(true),
  /** The school's time zone: a day locks when it arrives there, not in UTC. */
  timeZone: text('time_zone').notNull().default('America/Los_Angeles'),
  forEveryone: integer('for_everyone', { mode: 'boolean' }).notNull().default(false),
  active: integer('active', { mode: 'boolean' }).notNull().default(false),
  createdBy: integer('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  activeIdx: index('idx_signup_sheets_active').on(table.active),
}));

export const signupSheetGroups = sqliteTable('signup_sheet_groups', {
  sheetId: integer('sheet_id').notNull().references(() => signupSheets.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.sheetId, table.groupId] }),
  groupIdx: index('idx_signup_sheet_groups_group').on(table.groupId),
}));

/** One day on a sheet. `date` is a calendar day, 'YYYY-MM-DD', with no time or zone. */
export const signupDates = sqliteTable('signup_dates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sheetId: integer('sheet_id').notNull().references(() => signupSheets.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  /** What happens that day ("Presentations"). */
  label: text('label'),
  /** Students this day holds, when it differs from the sheet's. */
  capacity: integer('capacity'),
}, (table) => ({
  sheetDateUnique: uniqueIndex('uq_signup_dates_sheet_date').on(table.sheetId, table.date),
}));

/** A student on a day. `assignedBy` is the teacher who put them there; null when they picked it. */
export const signupClaims = sqliteTable('signup_claims', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sheetId: integer('sheet_id').notNull().references(() => signupSheets.id, { onDelete: 'cascade' }),
  dateId: integer('date_id').notNull().references(() => signupDates.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  assignedBy: integer('assigned_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  dateUserUnique: uniqueIndex('uq_signup_claims_date_user').on(table.dateId, table.userId),
  sheetUserIdx: index('idx_signup_claims_sheet_user').on(table.sheetId, table.userId),
}));

/**
 * A deck's conjugation quiz ("[Deck name] conjugation"): off until the teacher
 * turns it on. The verbs are detected from the deck's cards on every read, so
 * cards added later join; only the teacher's corrections are stored here.
 */
export const deckConjugation = sqliteTable('deck_conjugation', {
  deckId: integer('deck_id').primaryKey().references(() => decks.id, { onDelete: 'cascade' }),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  /** JSON array of engine tense ids, in TENSES order. */
  tenses: text('tenses').notNull().default('["present"]'),
  includeVosotros: integer('include_vosotros', { mode: 'boolean' }).notNull().default(false),
  /** 'none' | 'rioplatense' | 'centroamericano'. */
  vos: text('vos').notNull().default('none'),
  /** 'both' | 'toForm' | 'fromForm'. */
  directions: text('directions').notNull().default('both'),
  /** 'progressive' (choice, then typed) | 'choice' | 'typed'. */
  answerMode: text('answer_mode').notNull().default('progressive'),
  /** 'progressive' (forgiven, then required) | 'forgiven' | 'required'. */
  accentMode: text('accent_mode').notNull().default('progressive'),
  roundLength: integer('round_length').notNull().default(20),
  /** JSON array of detected entry ids the teacher left out. */
  excludedEntries: text('excluded_entries').notNull().default('[]'),
  /** JSON array of entry ids the teacher added by hand. */
  extraEntries: text('extra_entries').notNull().default('[]'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  /**
   * How a "give the form" prompt is shown (v1.25.0, 0048): 'off' (the person label, the default), 'builtIn' (the
   * engine's sentences with a blank), 'approved' (the deck's approved conjugation_sentences rows) or 'both'.
   */
  sentences: text('sentences').notNull().default('off'),
  /** The holdback measurement: half of each student's verbs show sentences, half the label (services/conjugationSentences.ts). */
  sentenceHoldback: integer('sentence_holdback', { mode: 'boolean' }).notNull().default(false),
  /** When sentences last went on for this deck (from off); null while they never have. */
  sentencesSince: integer('sentences_since', { mode: 'timestamp_ms' }),
});

/**
 * Where a student stands on one item of a deck's quiz: its rung on the level
 * ladder and whether they mastered it. item_key is
 * `${entry}|${tense}|${person}|${number ?? '-'}|${'to' | 'from'}`.
 *
 * Mastery takes right answers at the top rung on two different school days
 * (first_top_day holds the first). A mastered item comes back when due_at
 * passes: 1, then 3, then 8 weeks (review_step), so earlier units stay alive.
 */
export const conjugationProgress = sqliteTable('conjugation_progress', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  deckId: integer('deck_id').notNull().references(() => decks.id, { onDelete: 'cascade' }),
  itemKey: text('item_key').notNull(),
  level: integer('level').notNull().default(0),
  mastered: integer('mastered', { mode: 'boolean' }).notNull().default(false),
  correct: integer('correct').notNull().default(0),
  wrong: integer('wrong').notNull().default(0),
  lastAt: integer('last_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  /** When a mastered item is next due for review; null while not mastered. */
  dueAt: integer('due_at', { mode: 'timestamp_ms' }),
  /** Which review interval was last scheduled: 0 = 1 week, 1 = 3 weeks, 2 = 8 weeks (and every one after). */
  reviewStep: integer('review_step').notNull().default(0),
  /** The school day (YYYY-MM-DD, America/Los_Angeles) of a first top-rung success not yet confirmed on a later day. */
  firstTopDay: text('first_top_day'),
  /** The first time the item was mastered; never cleared, so a later lapse does not undo "mastered at least once". */
  firstMasteredAt: integer('first_mastered_at', { mode: 'timestamp_ms' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.deckId, table.itemKey] }),
  deckIdx: index('idx_conjugation_progress_deck').on(table.deckId, table.userId),
}));

/**
 * One round of a quiz, graded on the server. `queue` holds the prompts with
 * their answers and never leaves the server. A round replaced by a new one
 * before its end is finished and `abandoned`, and not counted as a score.
 */
export const conjugationRounds = sqliteTable('conjugation_rounds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  deckId: integer('deck_id').notNull().references(() => decks.id, { onDelete: 'cascade' }),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  abandoned: integer('abandoned', { mode: 'boolean' }).notNull().default(false),
  queue: text('queue').notNull(),
  /** Index of the prompt waiting for an answer. */
  position: integer('position').notNull().default(0),
  /** Prompts the round started with (retries of missed items come on top). */
  prompts: integer('prompts').notNull(),
  firstTryCorrect: integer('first_try_correct').notNull().default(0),
  answers: integer('answers').notNull().default(0),
  /** The settings and verbs the round was built with, so a teacher's edit does not change it midway. */
  settingsSnapshot: text('settings_snapshot').notNull(),
  /**
   * The last answer taken (its index and input) and the response sent for it,
   * so a retry of a request whose response was lost gets the same response
   * instead of an out-of-sync error.
   */
  lastAnswer: text('last_answer'),
  /**
   * 'deck': this deck's quiz (reviews of other decks mixed in), as before v1.18.0. 'all': "Study
   * all", forms of every quiz the student may play; deck_id is then the newest of those decks (the
   * round's lead), kept for the cascade. Deleting the lead first hands the round to its next deck
   * (conjugation.ts keepStudyAllRoundsOf), so the other decks' answers stay. Each answer names its
   * form's deck.
   */
  scope: text('scope', { enum: ['deck', 'all'] }).notNull().default('deck'),
}, (table) => ({
  deckUserIdx: index('idx_conjugation_rounds_deck_user').on(table.deckId, table.userId),
  // Deleting a student cascades here; without it that scans every round.
  userIdx: index('idx_conjugation_rounds_user').on(table.userId),
}));

/**
 * Every answer given, for the teacher's numbers. deck_id is the deck the item
 * belongs to, which for a review brought back from an earlier unit is not the
 * deck of the round.
 */
export const conjugationAnswers = sqliteTable('conjugation_answers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  roundId: integer('round_id').notNull().references(() => conjugationRounds.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  deckId: integer('deck_id').notNull().references(() => decks.id, { onDelete: 'cascade' }),
  itemKey: text('item_key').notNull(),
  levelKind: text('level_kind', { enum: ['choice', 'typed-lenient', 'typed-strict'] }).notNull(),
  /** What the student chose or typed (at most 200 characters). */
  given: text('given').notNull(),
  result: text('result', { enum: ['correct', 'accent', 'wrong'] }).notNull(),
  at: integer('at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  /** From the question appearing to the answer being sent, measured in the browser (no clock is shown); null when not sent. */
  responseMs: integer('response_ms'),
  /** What a wrong (or accent-slip) answer most likely was (classifyMistake's kind); null when right. */
  mistakeKind: text('mistake_kind'),
  /** The mistake's detail, as JSON ({"person":"el"}). */
  mistakeDetail: text('mistake_detail'),
  /** The second try of an item missed earlier in the round. */
  retry: integer('retry', { mode: 'boolean' }).notNull().default(false),
  /** A scheduled review: the item (or the name-the-verb item it stood for) was mastered and due. */
  review: integer('review', { mode: 'boolean' }).notNull().default(false),
  /**
   * How long since the student last answered this form (either direction, any
   * deck), in ms; null the first time. A week or more makes it a delayed answer,
   * the teacher's best predictor of a test.
   */
  gapMs: integer('gap_ms'),
  /**
   * The subject the prompt showed for the item's own person (v1.24.0, 0047): "ustedes", "ellas", "a usted".
   * Null before v1.24.0, for impersonal verbs, and for prompts built before it (they kept the long label).
   */
  subjectShown: text('subject_shown'),
  /** The sentence the prompt showed (v1.25.0, 0048): its stable ref; null for a label prompt. */
  sentenceRef: text('sentence_ref'),
  /** Under the deck's holdback: the verb's half, 'sentence' or 'label'; null without one, or for a form with no sentence. */
  holdbackArm: text('holdback_arm', { enum: ['sentence', 'label'] }),
  /**
   * Under the holdback: the probe, the item's first answer 7 or more days after its first showing in the deck,
   * shown 50/50 sentence / label (its retry keeps the flag: the probe itself has retry = 0).
   */
  holdbackProbe: integer('holdback_probe', { mode: 'boolean' }).notNull().default(false),
}, (table) => ({
  deckItemIdx: index('idx_conjugation_answers_deck_item').on(table.deckId, table.itemKey),
  // The cascades from a round (every deck delete, every replaced round) and a student.
  roundIdx: index('idx_conjugation_answers_round').on(table.roundId),
  userIdx: index('idx_conjugation_answers_user').on(table.userId),
}));

/**
 * A deck's own sentences (v1.25.0, 0048). A built-in sentence the teacher hid is a row with its ref (source
 * 'builtIn', status 'hidden'). A sentence written for the deck (source 'teacher', or 'ai' from v1.27.0) is a row with
 * its text ("Mis primos ___ (vivir) en Lima."), its cell, its English and a status: students see only 'approved'
 * rows, and each is checked again (validate) whenever it is used, so a settings change parks it instead.
 */
export const CONJUGATION_SENTENCE_SOURCES = ['builtIn', 'teacher', 'ai'] as const;
export const CONJUGATION_SENTENCE_STATUSES = ['hidden', 'pending', 'approved', 'rejected'] as const;
export const conjugationSentences = sqliteTable('conjugation_sentences', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deckId: integer('deck_id').notNull().references(() => decks.id, { onDelete: 'cascade' }),
  /** A built-in sentence's ref (tpl:vivir.city/np:mis-primos/city=lima/present), or a written row's own (row:…). */
  ref: text('ref').notNull(),
  source: text('source', { enum: CONJUGATION_SENTENCE_SOURCES }).notNull(),
  status: text('status', { enum: CONJUGATION_SENTENCE_STATUSES }).notNull(),
  /** A written row's cell: entry id, tense, person, number (dative entries); null for a built-in row. */
  entry: text('entry'),
  tense: text('tense'),
  person: text('person'),
  number: text('number'),
  /** A written row's sentence with its blank; null for a built-in row (the engine renders it). */
  text: text('text'),
  english: text('english'),
  createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  deckRefUnique: uniqueIndex('uq_conjugation_sentences_deck_ref').on(table.deckId, table.ref),
}));

/**
 * "Something's wrong with this sentence" (v1.25.0, 0048): a student's report, once per student and sentence. It only
 * queues the sentence for the teacher (resolved_at once dealt with); nothing changes for students until the teacher acts.
 */
export const conjugationSentenceReports = sqliteTable('conjugation_sentence_reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deckId: integer('deck_id').notNull().references(() => decks.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sentenceRef: text('sentence_ref').notNull(),
  itemKey: text('item_key').notNull(),
  /** The sentence as the student saw it, with its blank. */
  sentence: text('sentence').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  resolvedAt: integer('resolved_at', { mode: 'timestamp_ms' }),
}, (table) => ({
  onceUnique: uniqueIndex('uq_conjugation_sentence_reports_once').on(table.deckId, table.sentenceRef, table.userId),
  // Deleting a student cascades here.
  userIdx: index('idx_conjugation_sentence_reports_user').on(table.userId),
}));

/**
 * How a student's cards get mnemonic suggestions: 'manual', a teacher asks for one on any card
 * (students read the approved one on the back of the card), or 'disabled', no new suggestions
 * (an approved mnemonic still shows). Only the teacher ever generates.
 */
export const MNEMONIC_MODES = ['manual', 'disabled'] as const;
/**
 * @deprecated since v1.20.0: the cognate system was removed; no code writes this value, and every
 * read maps it to 'manual'. Drop in a later migration (drizzle/DEPRECATED.md). It was the default
 * mode: a teacher's card view asked for a suggestion when the card's cognate score was under 0.72.
 */
export const LEGACY_MNEMONIC_MODE = 'auto-non-cognate';
/** What mnemonic_mode may hold: the two modes, and the legacy value old rows still have. */
const MNEMONIC_MODE_VALUES = [...MNEMONIC_MODES, LEGACY_MNEMONIC_MODE] as const;

export const userSettings = sqliteTable('user_settings', {
  userId: integer('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  newCardsPerDay: integer('new_cards_per_day').notNull().default(20),
  reviewsPerDay: integer('reviews_per_day').notNull().default(20),
  isOverride: integer('is_override', { mode: 'boolean' }).notNull().default(false),
  allowHigher: integer('allow_higher', { mode: 'boolean' }).notNull().default(true),
  allowLower: integer('allow_lower', { mode: 'boolean' }).notNull().default(true),
  aiEnabled: integer('ai_enabled', { mode: 'boolean' }).notNull().default(true),
  aiEnabledLocked: integer('ai_enabled_locked', { mode: 'boolean' }).notNull().default(false),
  autoPlayAudio: integer('auto_play_audio', { mode: 'boolean' }).notNull().default(false),
  autoPlayAudioLocked: integer('auto_play_audio_locked', { mode: 'boolean' }).notNull().default(false),
  autoPlayAudioFront: integer('auto_play_audio_front', { mode: 'boolean' }).notNull().default(false),
  autoPlayAudioFrontLocked: integer('auto_play_audio_front_locked', { mode: 'boolean' }).notNull().default(false),
  /**
   * See MNEMONIC_MODES. Old rows may hold the deprecated LEGACY_MNEMONIC_MODE, and the table's SQL
   * default stays 'auto-non-cognate' until a later migration rebuilds it (drizzle/DEPRECATED.md):
   * drizzle sends the 'manual' below on every insert, and every read maps the legacy value to
   * 'manual' (readMnemonicMode in services/mnemonicMode.ts).
   */
  mnemonicMode: text('mnemonic_mode', { enum: MNEMONIC_MODE_VALUES }).notNull().default('manual'),
  mnemonicModeLocked: integer('mnemonic_mode_locked', { mode: 'boolean' }).notNull().default(false),
  /** @deprecated since v1.20.0: the cognate system was removed; no code reads or writes this. Drop in a later migration. */
  showCognateScore: integer('show_cognate_score', { mode: 'boolean' }).notNull().default(true),
  /** @deprecated since v1.20.0: the cognate system was removed; no code reads or writes this. Drop in a later migration. */
  showCognateScoreLocked: integer('show_cognate_score_locked', { mode: 'boolean' }).notNull().default(false),
  locale: text('locale'),
  localeLocked: integer('locale_locked', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const groupSettings = sqliteTable('group_settings', {
  groupId: integer('group_id').primaryKey().references(() => groups.id, { onDelete: 'cascade' }),
  newCardsPerDay: integer('new_cards_per_day').notNull().default(20),
  reviewsPerDay: integer('reviews_per_day').notNull().default(20),
  isOverride: integer('is_override', { mode: 'boolean' }).notNull().default(false),
  allowHigher: integer('allow_higher', { mode: 'boolean' }).notNull().default(true),
  allowLower: integer('allow_lower', { mode: 'boolean' }).notNull().default(true),
  aiEnabled: integer('ai_enabled', { mode: 'boolean' }).notNull().default(true),
  aiEnabledLocked: integer('ai_enabled_locked', { mode: 'boolean' }).notNull().default(false),
  autoPlayAudio: integer('auto_play_audio', { mode: 'boolean' }).notNull().default(false),
  autoPlayAudioLocked: integer('auto_play_audio_locked', { mode: 'boolean' }).notNull().default(false),
  autoPlayAudioFront: integer('auto_play_audio_front', { mode: 'boolean' }).notNull().default(false),
  autoPlayAudioFrontLocked: integer('auto_play_audio_front_locked', { mode: 'boolean' }).notNull().default(false),
  /**
   * See MNEMONIC_MODES. Old rows may hold the deprecated LEGACY_MNEMONIC_MODE, and the table's SQL
   * default stays 'auto-non-cognate' until a later migration rebuilds it (drizzle/DEPRECATED.md):
   * drizzle sends the 'manual' below on every insert, and every read maps the legacy value to
   * 'manual' (readMnemonicMode in services/mnemonicMode.ts).
   */
  mnemonicMode: text('mnemonic_mode', { enum: MNEMONIC_MODE_VALUES }).notNull().default('manual'),
  mnemonicModeLocked: integer('mnemonic_mode_locked', { mode: 'boolean' }).notNull().default(false),
  /** @deprecated since v1.20.0: the cognate system was removed; no code reads or writes this. Drop in a later migration. */
  showCognateScore: integer('show_cognate_score', { mode: 'boolean' }).notNull().default(true),
  /** @deprecated since v1.20.0: the cognate system was removed; no code reads or writes this. Drop in a later migration. */
  showCognateScoreLocked: integer('show_cognate_score_locked', { mode: 'boolean' }).notNull().default(false),
  locale: text('locale'),
  localeLocked: integer('locale_locked', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const deckUserSettings = sqliteTable('deck_user_settings', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  deckId: integer('deck_id').notNull().references(() => decks.id, { onDelete: 'cascade' }),
  newCardsPerDay: integer('new_cards_per_day').notNull().default(20),
  reviewsPerDay: integer('reviews_per_day').notNull().default(20),
  // Nullable AI/audio overrides: null means "inherit from user settings"
  aiEnabled: integer('ai_enabled', { mode: 'boolean' }),
  autoPlayAudio: integer('auto_play_audio', { mode: 'boolean' }),
  autoPlayAudioFront: integer('auto_play_audio_front', { mode: 'boolean' }),
  /** null inherits the user's mode. A stored LEGACY_MNEMONIC_MODE reads as 'manual'. */
  mnemonicMode: text('mnemonic_mode', { enum: MNEMONIC_MODE_VALUES }),
  /** @deprecated since v1.20.0: the cognate system was removed; no code reads or writes this. Drop in a later migration. */
  showCognateScore: integer('show_cognate_score', { mode: 'boolean' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.deckId] }),
}));

export const sessions = sqliteTable('sessions', {
  sid: text('sid').primaryKey(),
  sess: text('sess').notNull(),
  expire: integer('expire', { mode: 'timestamp' }).notNull(),
});

export const virtualDecks = sqliteTable('virtual_decks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceDeckId: integer('source_deck_id').notNull().references(() => decks.id, { onDelete: 'cascade' }),
  cardSelection: text('card_selection').notNull(), // e.g., "1-100, 250, 550-557"
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const allowedEmails = sqliteTable('allowed_emails', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pattern: text('pattern').notNull().unique(), // Email address or regex pattern
  isRegex: integer('is_regex', { mode: 'boolean' }).notNull().default(false),
  createdBy: integer('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/** Who sees "Sign in with a PIN": 'auto' (only while Google sign-in looks blocked for students), 'on', 'off'. */
export const PIN_LOGIN_MODES = ['auto', 'on', 'off'] as const;
export type PinLoginMode = typeof PIN_LOGIN_MODES[number];

export const appSettings = sqliteTable('app_settings', {
  id: integer('id').primaryKey(),
  googleClientId: text('google_client_id'),
  googleClientSecret: text('google_client_secret'),
  cleverClientId: text('clever_client_id'),
  cleverClientSecret: text('clever_client_secret'),
  aiEnabled: integer('ai_enabled', { mode: 'boolean' }).notNull().default(false),
  aiProvider: text('ai_provider').notNull().default('openai'),
  openaiApiKey: text('openai_api_key'),
  openaiBaseUrl: text('openai_base_url').notNull().default('https://api.openai.com/v1'),
  aiPronunciationEnabled: integer('ai_pronunciation_enabled', { mode: 'boolean' }).notNull().default(true),
  aiImageEnabled: integer('ai_image_enabled', { mode: 'boolean' }).notNull().default(true),
  aiMnemonicEnabled: integer('ai_mnemonic_enabled', { mode: 'boolean' }).notNull().default(true),
  /** @deprecated since v1.20.0: the cognate system was removed; no code reads or writes this. Drop in a later migration. */
  aiCognateEnabled: integer('ai_cognate_enabled', { mode: 'boolean' }).notNull().default(true),
  /** @deprecated since v1.20.0: the cognate system was removed; no code reads or writes this. Drop in a later migration. */
  aiCognateModel: text('ai_cognate_model').notNull().default('heuristic-v1'),
  aiMnemonicModel: text('ai_mnemonic_model').notNull().default('gpt-5.2'),
  aiImageModel: text('ai_image_model').notNull().default('gpt-image-1.5'),
  aiImageQuality: text('ai_image_quality').notNull().default('low'),
  aiTtsModel: text('ai_tts_model').notNull().default('gpt-4o-mini-tts-2025-12-15'),
  // TTS can use a dedicated speech provider while chat/image stay on OpenAI.
  // Values: 'openai' | 'elevenlabs' (validated at the router; plain text here
  // so the settings layer's string type flows through).
  aiTtsProvider: text('ai_tts_provider').notNull().default('openai'),
  elevenlabsApiKey: text('elevenlabs_api_key'),
  // JSON object mapping accent name → ElevenLabs voice_id ('' key = default voice).
  aiTtsVoiceMap: text('ai_tts_voice_map').notNull().default('{}'),
  // ElevenLabs voice_id that speaks the Vocabulómetro's default accent ('');
  // null falls back to the voice map's default. Not a secret.
  vocabTtsVoiceId: text('vocab_tts_voice_id'),
  // Claude, for mnemonic suggestions only. Encrypted enc:v1 like openaiApiKey.
  anthropicApiKey: text('anthropic_api_key'),
  // Who writes mnemonic suggestions: 'openai' | 'anthropic' (validated at the router; plain text
  // like aiTtsProvider). Images, speech, transcription and moderation never move.
  aiTextProvider: text('ai_text_provider').notNull().default('openai'),
  // The Claude model used while aiTextProvider is 'anthropic'; separate from aiMnemonicModel so
  // the OpenAI choice stays saved for a switch back.
  aiAnthropicMnemonicModel: text('ai_anthropic_mnemonic_model').notNull().default('claude-opus-5-5'),
  // Sign in with a PIN: see PIN_LOGIN_MODES (services/pinLogin.ts reads and writes it; not part of AppSettings).
  pinLoginMode: text('pin_login_mode', { enum: PIN_LOGIN_MODES }).notNull().default('auto'),
  // The "repeat the sentence" test's transcription (a student's recording to the AI provider), apart from the
  // master AI switch: off on a new install (0049), kept on where an install already used the mode.
  // Read and written by services/transcriptionSetting.ts, like pinLoginMode (not part of AppSettings).
  aiTranscriptionEnabled: integer('ai_transcription_enabled', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const aiAssets = sqliteTable('ai_assets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cardId: integer('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  assetType: text('asset_type', { enum: ['image', 'audio'] }).notNull(),
  provider: text('provider').notNull(),
  prompt: text('prompt').notNull(),
  url: text('url'),
  status: text('status', { enum: ['pending', 'generating', 'ready', 'failed'] }).notNull().default('pending'),
  errorMessage: text('error_message'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  cardIdx: index('idx_ai_assets_card').on(table.cardId),
  cardTypeIdx: index('idx_ai_assets_card_type').on(table.cardId, table.assetType),
}));

/**
 * The two kinds of mnemonic suggestion the teacher chooses between (v1.20.0): 'keyword', a
 * sound-alike word in one picture with the meaning, and 'sentence', a short example sentence for
 * words that are hard to picture.
 */
export const MNEMONIC_STYLES = ['keyword', 'sentence'] as const;
export type MnemonicStyle = typeof MNEMONIC_STYLES[number];

/**
 * Mnemonic suggestions. Since v1.20.0 a rejected one is kept (rejected_at), never shown as
 * pending again, and listed with every other suggestion for the card when the teacher asks for
 * another, so the model really writes a different one.
 */
export const aiMnemonics = sqliteTable('ai_mnemonics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cardId: integer('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  text: text('text').notNull(),
  sourcePrompt: text('source_prompt').notNull(),
  accepted: integer('accepted', { mode: 'boolean' }).notNull().default(false),
  acceptedAt: integer('accepted_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  /** When the teacher turned it down ("Try another", or deleted it from the card); null otherwise (0044). */
  rejectedAt: integer('rejected_at', { mode: 'timestamp' }),
  /** See MNEMONIC_STYLES. null on rows from before v1.20.0, which read as 'keyword' (0044). */
  style: text('style', { enum: MNEMONIC_STYLES }),
}, (table) => ({
  cardUserIdx: index('idx_ai_mnemonics_card_user').on(table.cardId, table.userId),
}));

export const vocabTests = sqliteTable('vocab_tests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  mode: text('mode', { enum: ['size', 'mastery', 'listen', 'c500', 'a500', 's5000', 'listen2', 'dictado', 'ctest', 'ldt', 'ei'] }).notNull(),
  occasion: text('occasion'),
  // Mode-specific configuration (band counts, block/week, form A/B, seed, adaptive stop, plan code)
  settingsJson: text('settings_json').notNull().default('{}'),
  isOpen: integer('is_open', { mode: 'boolean' }).notNull().default(false),
  opensAt: integer('opens_at', { mode: 'timestamp' }),
  closesAt: integer('closes_at', { mode: 'timestamp' }),
  createdBy: integer('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const vocabTestGroups = sqliteTable('vocab_test_groups', {
  testId: integer('test_id').notNull().references(() => vocabTests.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.testId, table.groupId] }),
  groupIdx: index('idx_vocab_test_groups_group').on(table.groupId),
}));

export const vocabResults = sqliteTable('vocab_results', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  testId: integer('test_id').notNull().references(() => vocabTests.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mode: text('mode', { enum: ['size', 'mastery', 'listen', 'c500', 'a500', 's5000', 'listen2', 'dictado', 'ctest', 'ldt', 'ei'] }).notNull(),
  seed: integer('seed').notNull(),
  blk: text('blk'),
  form: text('form'),
  occasion: text('occasion'),
  // Band/pseudoword counts (v1) or per-word states (v2) — the sufficient statistics for all estimators
  summaryJson: text('summary_json').notNull(),
  // Full item-level responses for CSV export and auditing
  responsesJson: text('responses_json'),
  // Attempt quality metrics computed at submit (false-alarm rate, latency profile)
  qualityJson: text('quality_json'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  durationMs: integer('duration_ms'),
}, (table) => ({
  testUserIdx: index('idx_vocab_results_test_user').on(table.testId, table.userId),
  userCompletedIdx: index('idx_vocab_results_user_completed').on(table.userId, table.completedAt),
}));

// Graded Spanish sentence bank for elicited imitation (hear a sentence, repeat
// it aloud). Difficulty ~ length/complexity; higher = harder.
export const vocabEiSentences = sqliteTable('vocab_ei_sentences', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  text: text('text').notNull(),
  difficulty: integer('difficulty').notNull().default(1),
  createdBy: integer('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Class reading passages supplied by the teacher: source material for the
// generated proficiency measures (C-test gaps, maze, sentence dictation).
export const vocabTexts = sqliteTable('vocab_texts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  content: text('content').notNull(),
  createdBy: integer('created_by').notNull().references(() => users.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// TTS-generated audio bank for the Vocabulómetro aural modes: one clip per
// (kind, word, accent, voice), shared across tests and students.
export const vocabAudio = sqliteTable('vocab_audio', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  word: text('word').notNull(),
  accent: text('accent').notNull().default(''),
  url: text('url'),
  status: text('status', { enum: ['pending', 'generating', 'ready', 'failed'] }).notNull().default('pending'),
  errorMessage: text('error_message'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  // ElevenLabs voice that spoke the clip; null = OpenAI TTS (clips from before this column).
  // Reads under ElevenLabs serve only clips from the accent's current voice.
  voiceId: text('voice_id'),
  // 'sentence' rows are elicited-imitation clips (word = the sentence text).
  kind: text('kind', { enum: ['word', 'sentence'] }).notNull().default('word'),
}, (table) => ({
  // ifnull: SQLite treats NULLs as distinct, which would let OpenAI clips duplicate.
  clipIdx: uniqueIndex('uniq_vocab_audio_clip').on(table.kind, table.word, table.accent, sql`ifnull(${table.voiceId}, '')`),
  statusIdx: index('idx_vocab_audio_status').on(table.status),
}));

/**
 * @deprecated since v1.20.0: the cognate system was removed; no code reads or writes this. Drop in a later migration.
 * The whole table (drizzle/DEPRECATED.md): a per-student cognate score and false-friend
 * dismissal, plus flags that the review trigger (services/ai/triggerService.ts, removed) and
 * the mnemonic service wrote and nothing read. Kept so old databases keep their shape.
 */
export const cardAiState = sqliteTable('card_ai_state', {
  cardId: integer('card_id').notNull().references(() => cards.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** @deprecated since v1.20.0: the cognate system was removed; no code reads or writes this. Drop in a later migration. */
  cognateScore: real('cognate_score'),
  /** @deprecated since v1.20.0: the cognate system was removed; no code reads or writes this. Drop in a later migration. */
  falseFriendDismissed: integer('false_friend_dismissed', { mode: 'boolean' }).notNull().default(false),
  /** @deprecated since v1.20.0: written by the removed review trigger and the mnemonic service, never read. Drop with the table. */
  mnemonicEnabled: integer('mnemonic_enabled', { mode: 'boolean' }).notNull().default(false),
  /** @deprecated since v1.20.0: written by the removed review trigger, never read. Drop with the table. */
  lastRegressionAt: integer('last_regression_at', { mode: 'timestamp' }),
  /** @deprecated since v1.20.0: written by the mnemonic service before v1.20.0, never read. Drop with the table. */
  lastGeneratedAt: integer('last_generated_at', { mode: 'timestamp' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.cardId, table.userId] }),
}));

/**
 * A student's school ID when their email's local part is not it: used by
 * sign-in and the admin lists (services/studentNumbers.ts). Most students need
 * none: nearly all sign in as <student ID>@school.example. One student per ID.
 */
export const studentNumberOverrides = sqliteTable('student_number_overrides', {
  userId: integer('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  studentNumber: text('student_number').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
}, (table) => ({
  numberUnique: uniqueIndex('uq_student_number_overrides_number').on(table.studentNumber),
}));

/**
 * A student's PIN for "Sign in with a PIN" (v1.22.0): a salted scrypt hash, never the PIN. failed_count counts wrong
 * PINs since the last success or lock; five lock PIN sign-in until locked_until (15 min × 2^lock_level, at most 24 h).
 */
export const userPins = sqliteTable('user_pins', {
  userId: integer('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  pinHash: text('pin_hash').notNull(),
  pinSalt: text('pin_salt').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  failedCount: integer('failed_count').notNull().default(0),
  lockedUntil: integer('locked_until', { mode: 'timestamp_ms' }),
  lockLevel: integer('lock_level').notNull().default(0),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
});
