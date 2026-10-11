// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as schema from '../db/schema.js';

/** Thin async-shaped adapter so existing tests keep their libsql-style
 *  `client.execute(...)` / `client.close()` calls (including `{rows}` on
 *  SELECTs) unchanged. */
export interface TestDbClient {
  execute(sqlText: string): Promise<{ rows: Record<string, unknown>[] }>;
  close(): Promise<void>;
}

export function createTestDb(): {
  client: TestDbClient;
  db: ReturnType<typeof drizzle<typeof schema>>;
  sqlite: DatabaseType;
} {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const filePath = join(tmpdir(), `libresrs-test-${id}.db`);
  if (existsSync(filePath)) {
    rmSync(filePath);
  }
  const sqlite: DatabaseType = new Database(filePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  const client: TestDbClient = {
    async execute(sqlText: string) {
      try {
        const stmt = sqlite.prepare(sqlText);
        if (stmt.reader) {
          return { rows: stmt.all() as Record<string, unknown>[] };
        }
        stmt.run();
        return { rows: [] };
      } catch {
        // Multi-statement strings (DDL blocks) cannot be prepared — exec them.
        sqlite.exec(sqlText);
        return { rows: [] };
      }
    },
    async close() { sqlite.close(); },
  };
  const db = drizzle(sqlite, { schema });
  return { client, db, sqlite };
}

export async function setupFsrsSchema(
  client: TestDbClient,
  options: { reset?: boolean } = {}
) {
  if (options.reset) {
    await client.execute('DROP TABLE IF EXISTS student_number_overrides');
    await client.execute('DROP TABLE IF EXISTS user_pins');
    await client.execute('DROP TABLE IF EXISTS conjugation_sentence_reports');
    await client.execute('DROP TABLE IF EXISTS conjugation_sentences');
    await client.execute('DROP TABLE IF EXISTS conjugation_answers');
    await client.execute('DROP TABLE IF EXISTS conjugation_rounds');
    await client.execute('DROP TABLE IF EXISTS conjugation_progress');
    await client.execute('DROP TABLE IF EXISTS deck_conjugation');
    await client.execute('DROP TABLE IF EXISTS signup_claims');
    await client.execute('DROP TABLE IF EXISTS signup_dates');
    await client.execute('DROP TABLE IF EXISTS signup_sheet_groups');
    await client.execute('DROP TABLE IF EXISTS signup_sheets');
    await client.execute('DROP TABLE IF EXISTS speaking_submissions');
    await client.execute('DROP TABLE IF EXISTS speaking_task_groups');
    await client.execute('DROP TABLE IF EXISTS speaking_tasks');
    await client.execute('DROP TABLE IF EXISTS lab_exam_starts');
    await client.execute('DROP TABLE IF EXISTS lab_settings');
    await client.execute('DROP TABLE IF EXISTS lab_listen_events');
    await client.execute('DROP TABLE IF EXISTS lab_submissions');
    await client.execute('DROP TABLE IF EXISTS lab_groups');
    await client.execute('DROP TABLE IF EXISTS labs');
    await client.execute('DROP TABLE IF EXISTS vocab_ei_sentences');
    await client.execute('DROP TABLE IF EXISTS vocab_texts');
    await client.execute('DROP TABLE IF EXISTS vocab_audio');
    await client.execute('DROP TABLE IF EXISTS vocab_results');
    await client.execute('DROP TABLE IF EXISTS vocab_test_groups');
    await client.execute('DROP TABLE IF EXISTS vocab_tests');
    await client.execute('DROP TABLE IF EXISTS card_ai_state');
    await client.execute('DROP TABLE IF EXISTS ai_mnemonics');
    await client.execute('DROP TABLE IF EXISTS ai_assets');
    await client.execute('DROP TABLE IF EXISTS app_settings');
    await client.execute('DROP TABLE IF EXISTS flashcard_all_done');
    await client.execute('DROP TABLE IF EXISTS study_completions');
    await client.execute('DROP TABLE IF EXISTS review_logs');
    await client.execute('DROP TABLE IF EXISTS card_states');
    await client.execute('DROP TABLE IF EXISTS virtual_decks');
    await client.execute('DROP TABLE IF EXISTS cards');
    await client.execute('DROP TABLE IF EXISTS allowed_emails');
    await client.execute('DROP TABLE IF EXISTS deck_groups');
    await client.execute('DROP TABLE IF EXISTS user_groups');
    await client.execute('DROP TABLE IF EXISTS group_settings');
    await client.execute('DROP TABLE IF EXISTS groups');
    await client.execute('DROP TABLE IF EXISTS user_settings');
    await client.execute('DROP TABLE IF EXISTS deck_user_settings');
    await client.execute('DROP TABLE IF EXISTS decks');
    await client.execute('DROP TABLE IF EXISTS users');
  }

  await client.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_id TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      picture TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS decks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      reversible INTEGER NOT NULL DEFAULT 0,
      source_language TEXT,
      target_language TEXT,
      speech_accent TEXT,
      source_accent TEXT,
      target_accent TEXT,
      audio_front_enabled INTEGER NOT NULL DEFAULT 1,
      audio_back_enabled INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS allowed_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL UNIQUE,
      is_regex INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY NOT NULL,
      google_client_id TEXT,
      google_client_secret TEXT,
      clever_client_id TEXT,
      clever_client_secret TEXT,
      ai_enabled INTEGER NOT NULL DEFAULT 0,
      ai_provider TEXT NOT NULL DEFAULT 'openai',
      openai_api_key TEXT,
      openai_base_url TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
      ai_pronunciation_enabled INTEGER NOT NULL DEFAULT 1,
      ai_image_enabled INTEGER NOT NULL DEFAULT 1,
      ai_mnemonic_enabled INTEGER NOT NULL DEFAULT 1,
      -- ai_cognate_enabled and ai_cognate_model: deprecated in v1.20.0, kept as an upgraded install has them (drizzle/DEPRECATED.md)
      ai_cognate_enabled INTEGER NOT NULL DEFAULT 1,
      ai_cognate_model TEXT NOT NULL DEFAULT 'heuristic-v1',
      ai_mnemonic_model TEXT NOT NULL DEFAULT 'gpt-5.2',
      ai_image_model TEXT NOT NULL DEFAULT 'gpt-image-1.5',
      ai_image_quality TEXT NOT NULL DEFAULT 'low',
      ai_tts_model TEXT NOT NULL DEFAULT 'gpt-4o-mini-tts-2025-12-15',
      ai_tts_provider TEXT NOT NULL DEFAULT 'openai',
      elevenlabs_api_key TEXT,
      ai_tts_voice_map TEXT NOT NULL DEFAULT '{}',
      vocab_tts_voice_id TEXT,
      anthropic_api_key TEXT,
      ai_text_provider TEXT NOT NULL DEFAULT 'openai',
      ai_anthropic_mnemonic_model TEXT NOT NULL DEFAULT 'claude-opus-5-5',
      pin_login_mode TEXT NOT NULL DEFAULT 'auto',
      ai_transcription_enabled INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS user_groups (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      joined_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (user_id, group_id)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS deck_groups (
      deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      PRIMARY KEY (deck_id, group_id)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      cognate_score REAL, -- deprecated in v1.20.0 (drizzle/DEPRECATED.md)
      mnemonic TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS virtual_decks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      card_selection TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS card_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      direction INTEGER NOT NULL DEFAULT 0,
      stability REAL NOT NULL DEFAULT 0,
      difficulty REAL NOT NULL DEFAULT 0,
      elapsed_days REAL NOT NULL DEFAULT 0,
      scheduled_days REAL NOT NULL DEFAULT 0,
      reps INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      learning_steps INTEGER NOT NULL DEFAULT 0,
      state INTEGER NOT NULL DEFAULT 0,
      last_review INTEGER,
      next_review INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE (user_id, card_id, direction)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS study_completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deck_id INTEGER REFERENCES decks(id) ON DELETE CASCADE,
      virtual_deck_id INTEGER REFERENCES virtual_decks(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      new_cards_done INTEGER NOT NULL DEFAULT 0,
      reviews_done INTEGER NOT NULL DEFAULT 0,
      completed_at INTEGER NOT NULL
    )
  `);

  // v1.18.0 (0042): the school days a student finished all their flashcards.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS flashcard_all_done (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      completed_at INTEGER NOT NULL,
      deck_ids TEXT NOT NULL,
      PRIMARY KEY (user_id, day)
    )
  `);
  await client.execute('CREATE INDEX IF NOT EXISTS idx_flashcard_all_done_day ON flashcard_all_done (day)');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS review_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      card_state_id INTEGER REFERENCES card_states(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL,
      reviewed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      time_spent_ms INTEGER NOT NULL,
      previous_state INTEGER NOT NULL,
      new_state INTEGER NOT NULL,
      previous_state_snapshot TEXT
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      new_cards_per_day INTEGER NOT NULL DEFAULT 20,
      reviews_per_day INTEGER NOT NULL DEFAULT 20,
      is_override INTEGER NOT NULL DEFAULT 0,
      allow_higher INTEGER NOT NULL DEFAULT 1,
      allow_lower INTEGER NOT NULL DEFAULT 1,
      ai_enabled INTEGER NOT NULL DEFAULT 1,
      ai_enabled_locked INTEGER NOT NULL DEFAULT 0,
      auto_play_audio INTEGER NOT NULL DEFAULT 0,
      auto_play_audio_locked INTEGER NOT NULL DEFAULT 0,
      auto_play_audio_front INTEGER NOT NULL DEFAULT 0,
      auto_play_audio_front_locked INTEGER NOT NULL DEFAULT 0,
      -- The SQL default is production's: 'auto-non-cognate' (deprecated in v1.20.0) reads as 'manual',
      -- and drizzle writes 'manual' on every insert. show_cognate_score(_locked): deprecated too.
      mnemonic_mode TEXT NOT NULL DEFAULT 'auto-non-cognate',
      mnemonic_mode_locked INTEGER NOT NULL DEFAULT 0,
      show_cognate_score INTEGER NOT NULL DEFAULT 1,
      show_cognate_score_locked INTEGER NOT NULL DEFAULT 0,
      locale TEXT,
      locale_locked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS deck_user_settings (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      new_cards_per_day INTEGER NOT NULL DEFAULT 20,
      reviews_per_day INTEGER NOT NULL DEFAULT 20,
      ai_enabled INTEGER,
      auto_play_audio INTEGER,
      auto_play_audio_front INTEGER,
      mnemonic_mode TEXT,
      show_cognate_score INTEGER, -- deprecated in v1.20.0 (drizzle/DEPRECATED.md)
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (user_id, deck_id)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS group_settings (
      group_id INTEGER PRIMARY KEY NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      new_cards_per_day INTEGER NOT NULL DEFAULT 20,
      reviews_per_day INTEGER NOT NULL DEFAULT 20,
      is_override INTEGER NOT NULL DEFAULT 0,
      allow_higher INTEGER NOT NULL DEFAULT 1,
      allow_lower INTEGER NOT NULL DEFAULT 1,
      ai_enabled INTEGER NOT NULL DEFAULT 1,
      ai_enabled_locked INTEGER NOT NULL DEFAULT 0,
      auto_play_audio INTEGER NOT NULL DEFAULT 0,
      auto_play_audio_locked INTEGER NOT NULL DEFAULT 0,
      auto_play_audio_front INTEGER NOT NULL DEFAULT 0,
      auto_play_audio_front_locked INTEGER NOT NULL DEFAULT 0,
      -- The SQL default is production's: 'auto-non-cognate' (deprecated in v1.20.0) reads as 'manual',
      -- and drizzle writes 'manual' on every insert. show_cognate_score(_locked): deprecated too.
      mnemonic_mode TEXT NOT NULL DEFAULT 'auto-non-cognate',
      mnemonic_mode_locked INTEGER NOT NULL DEFAULT 0,
      show_cognate_score INTEGER NOT NULL DEFAULT 1,
      show_cognate_score_locked INTEGER NOT NULL DEFAULT 0,
      locale TEXT,
      locale_locked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS ai_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      asset_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      prompt TEXT NOT NULL,
      url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS ai_mnemonics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      text TEXT NOT NULL,
      source_prompt TEXT NOT NULL,
      accepted INTEGER NOT NULL DEFAULT 0,
      accepted_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      rejected_at INTEGER,
      style TEXT
    )
  `);
  await client.execute('CREATE INDEX IF NOT EXISTS idx_ai_mnemonics_card_user ON ai_mnemonics (card_id, user_id)');

  await client.execute(`
    -- Deprecated in v1.20.0, the whole table (drizzle/DEPRECATED.md): nothing reads or writes it.
    CREATE TABLE IF NOT EXISTS card_ai_state (
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cognate_score REAL,
      mnemonic_enabled INTEGER NOT NULL DEFAULT 0,
      false_friend_dismissed INTEGER NOT NULL DEFAULT 0,
      last_regression_at INTEGER,
      last_generated_at INTEGER,
      PRIMARY KEY (card_id, user_id)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS vocab_tests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      mode TEXT NOT NULL,
      occasion TEXT,
      settings_json TEXT NOT NULL DEFAULT '{}',
      is_open INTEGER NOT NULL DEFAULT 0,
      opens_at INTEGER,
      closes_at INTEGER,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS vocab_test_groups (
      test_id INTEGER NOT NULL REFERENCES vocab_tests(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      PRIMARY KEY (test_id, group_id)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS vocab_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      test_id INTEGER NOT NULL REFERENCES vocab_tests(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      seed INTEGER NOT NULL,
      blk TEXT,
      form TEXT,
      occasion TEXT,
      summary_json TEXT NOT NULL,
      responses_json TEXT,
      quality_json TEXT,
      started_at INTEGER,
      completed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      duration_ms INTEGER
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS vocab_audio (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL,
      accent TEXT NOT NULL DEFAULT '',
      url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      voice_id TEXT,
      kind TEXT NOT NULL DEFAULT 'word'
    )
  `);

  await client.execute(`
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_vocab_audio_clip ON vocab_audio (kind, word, accent, ifnull(voice_id, ''))
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS vocab_ei_sentences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      difficulty INTEGER NOT NULL DEFAULT 1,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS vocab_texts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS labs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      audio_url TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      required_through_ms INTEGER NOT NULL,
      for_everyone INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      pauses TEXT,
      pause_scan TEXT,
      pause_count_until_ms INTEGER,
      exam_set TEXT
    )
  `);
  await client.execute('CREATE INDEX IF NOT EXISTS idx_labs_exam_set ON labs (exam_set)');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS lab_groups (
      lab_id INTEGER NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      PRIMARY KEY (lab_id, group_id)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS lab_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lab_id INTEGER NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      required_through_ms INTEGER NOT NULL,
      voiced_ms INTEGER NOT NULL DEFAULT 0,
      listened_covered_ms INTEGER NOT NULL DEFAULT 0,
      skip_count INTEGER NOT NULL DEFAULT 0,
      listen_wall_ms INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER NOT NULL,
      submitted_at INTEGER NOT NULL,
      mic TEXT NOT NULL DEFAULT 'on',
      pauses_counted INTEGER,
      pauses_answered INTEGER,
      pause_results TEXT,
      rejected_answers INTEGER NOT NULL DEFAULT 0,
      late_answers INTEGER NOT NULL DEFAULT 0,
      min_answered_pct INTEGER,
      voice_per_pause_ms INTEGER,
      outside_voiced_ms INTEGER,
      outside_played_ms INTEGER,
      flags TEXT,
      credit INTEGER NOT NULL DEFAULT 0,
      credit_override INTEGER,
      credit_override_at INTEGER,
      credit_override_by INTEGER,
      check_requested_at INTEGER,
      held_for TEXT,
      mic_stats TEXT,
      exam_set TEXT,
      UNIQUE (lab_id, user_id, started_at)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS lab_listen_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lab_id INTEGER NOT NULL REFERENCES labs(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_started_at INTEGER NOT NULL,
      kind TEXT NOT NULL,
      position_ms INTEGER NOT NULL,
      client_ms INTEGER NOT NULL,
      at INTEGER NOT NULL,
      answers TEXT,
      rules TEXT
    )
  `);
  await client.execute('CREATE INDEX IF NOT EXISTS idx_lab_listen_events_user_at ON lab_listen_events (user_id, at)');

  // v1.19.0 exam starts (0043): the live row is unique per set and student.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS lab_exam_starts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_set TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lab_id INTEGER REFERENCES labs(id) ON DELETE SET NULL,
      lab_title TEXT NOT NULL,
      session_started_at INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'start',
      reset_at INTEGER,
      reset_by INTEGER
    )
  `);
  await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS uq_lab_exam_starts_live ON lab_exam_starts (exam_set, user_id) WHERE reset_at IS NULL');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_lab_exam_starts_user ON lab_exam_starts (user_id, exam_set)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_lab_exam_starts_lab ON lab_exam_starts (lab_id, user_id, session_started_at)');

  // No seed row, unlike migration 0039: unit tests see the code defaults (75%, 0.25 s).
  await client.execute(`
    CREATE TABLE IF NOT EXISTS lab_settings (
      id INTEGER PRIMARY KEY NOT NULL,
      min_answered_pct INTEGER NOT NULL DEFAULT 75,
      voice_per_pause_ms INTEGER NOT NULL DEFAULT 250,
      updated_at INTEGER NOT NULL,
      gate_margin_db INTEGER NOT NULL DEFAULT 6,
      hold_outside_voice INTEGER NOT NULL DEFAULT 0
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS speaking_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      instructions TEXT,
      reference_text TEXT,
      show_reference INTEGER NOT NULL DEFAULT 1,
      model_audio_url TEXT,
      target_seconds INTEGER,
      for_everyone INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL,
      exam_set TEXT
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS speaking_task_groups (
      task_id INTEGER NOT NULL REFERENCES speaking_tasks(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, group_id)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS speaking_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES speaking_tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_key TEXT NOT NULL,
      audio_url TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      voiced_ms INTEGER NOT NULL DEFAULT 0,
      reference_text TEXT,
      submitted_at INTEGER NOT NULL,
      grade_score REAL,
      grade_details TEXT,
      grade_feedback TEXT,
      graded_by TEXT,
      graded_at INTEGER,
      content_sha256 TEXT,
      client_duration_ms INTEGER,
      client_voiced_ms INTEGER,
      flags TEXT,
      mic_settings TEXT,
      UNIQUE (user_id, client_key)
    )
  `);
  await client.execute('CREATE INDEX IF NOT EXISTS idx_speaking_submissions_sha ON speaking_submissions (content_sha256)');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS signup_sheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      slots_per_date INTEGER NOT NULL DEFAULT 2,
      picks_per_student INTEGER NOT NULL DEFAULT 1,
      show_names INTEGER NOT NULL DEFAULT 1,
      open INTEGER NOT NULL DEFAULT 1,
      time_zone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
      for_everyone INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS signup_sheet_groups (
      sheet_id INTEGER NOT NULL REFERENCES signup_sheets(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      PRIMARY KEY (sheet_id, group_id)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS signup_dates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sheet_id INTEGER NOT NULL REFERENCES signup_sheets(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      label TEXT,
      capacity INTEGER,
      UNIQUE (sheet_id, date)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS signup_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sheet_id INTEGER NOT NULL REFERENCES signup_sheets(id) ON DELETE CASCADE,
      date_id INTEGER NOT NULL REFERENCES signup_dates(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (date_id, user_id)
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS deck_conjugation (
      deck_id INTEGER PRIMARY KEY NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 0,
      tenses TEXT NOT NULL DEFAULT '["present"]',
      include_vosotros INTEGER NOT NULL DEFAULT 0,
      vos TEXT NOT NULL DEFAULT 'none',
      directions TEXT NOT NULL DEFAULT 'both',
      answer_mode TEXT NOT NULL DEFAULT 'progressive',
      accent_mode TEXT NOT NULL DEFAULT 'progressive',
      round_length INTEGER NOT NULL DEFAULT 20,
      excluded_entries TEXT NOT NULL DEFAULT '[]',
      extra_entries TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL,
      sentences TEXT NOT NULL DEFAULT 'off',
      sentence_holdback INTEGER NOT NULL DEFAULT 0,
      sentences_since INTEGER
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS conjugation_progress (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      item_key TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 0,
      mastered INTEGER NOT NULL DEFAULT 0,
      correct INTEGER NOT NULL DEFAULT 0,
      wrong INTEGER NOT NULL DEFAULT 0,
      last_at INTEGER NOT NULL,
      due_at INTEGER,
      review_step INTEGER NOT NULL DEFAULT 0,
      first_top_day TEXT,
      first_mastered_at INTEGER,
      PRIMARY KEY (user_id, deck_id, item_key)
    )
  `);
  await client.execute('CREATE INDEX IF NOT EXISTS idx_conjugation_progress_deck ON conjugation_progress (deck_id, user_id)');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS conjugation_rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      abandoned INTEGER NOT NULL DEFAULT 0,
      queue TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      prompts INTEGER NOT NULL,
      first_try_correct INTEGER NOT NULL DEFAULT 0,
      answers INTEGER NOT NULL DEFAULT 0,
      settings_snapshot TEXT NOT NULL,
      last_answer TEXT,
      scope TEXT NOT NULL DEFAULT 'deck'
    )
  `);
  await client.execute('CREATE INDEX IF NOT EXISTS idx_conjugation_rounds_deck_user ON conjugation_rounds (deck_id, user_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_conjugation_rounds_user ON conjugation_rounds (user_id)');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS conjugation_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER NOT NULL REFERENCES conjugation_rounds(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      item_key TEXT NOT NULL,
      level_kind TEXT NOT NULL,
      given TEXT NOT NULL,
      result TEXT NOT NULL,
      at INTEGER NOT NULL,
      response_ms INTEGER,
      mistake_kind TEXT,
      mistake_detail TEXT,
      retry INTEGER NOT NULL DEFAULT 0,
      review INTEGER NOT NULL DEFAULT 0,
      gap_ms INTEGER,
      subject_shown TEXT,
      sentence_ref TEXT,
      holdback_arm TEXT,
      holdback_probe INTEGER NOT NULL DEFAULT 0
    )
  `);
  await client.execute('CREATE INDEX IF NOT EXISTS idx_conjugation_answers_deck_item ON conjugation_answers (deck_id, item_key)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_conjugation_answers_round ON conjugation_answers (round_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_conjugation_answers_user ON conjugation_answers (user_id)');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS conjugation_sentences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      ref TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      entry TEXT,
      tense TEXT,
      person TEXT,
      number TEXT,
      text TEXT,
      english TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS uq_conjugation_sentences_deck_ref ON conjugation_sentences (deck_id, ref)');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS conjugation_sentence_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sentence_ref TEXT NOT NULL,
      item_key TEXT NOT NULL,
      sentence TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER
    )
  `);
  await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS uq_conjugation_sentence_reports_once ON conjugation_sentence_reports (deck_id, sentence_ref, user_id)');
  await client.execute('CREATE INDEX IF NOT EXISTS idx_conjugation_sentence_reports_user ON conjugation_sentence_reports (user_id)');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS student_number_overrides (
      user_id INTEGER PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      student_number TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS uq_student_number_overrides_number ON student_number_overrides (student_number)');

  await client.execute(`
    CREATE TABLE IF NOT EXISTS user_pins (
      user_id INTEGER PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pin_hash TEXT NOT NULL,
      pin_salt TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      failed_count INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER,
      lock_level INTEGER NOT NULL DEFAULT 0,
      last_used_at INTEGER
    )
  `);
}
