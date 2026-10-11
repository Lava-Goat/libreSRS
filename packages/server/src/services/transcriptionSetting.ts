// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The switch for the Vocabulómetro's "repeat the sentence" (elicited imitation, mode 'ei') test:
 * whether a student's recording may be sent to the AI provider to be transcribed. It is the one
 * flow of student-made content to a third party, so it has its own switch beside the master AI
 * switch. Off on a new install; migration 0049 kept it on where
 * the mode was already in use. The transcription needs both this switch and AI on.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { ensureAppSettings } from './appSettings.js';
import { logger } from '../logger.js';

const APP_SETTINGS_ROW_ID = 1;

/** Whether the switch is on (false when there is no settings row yet: a fresh install). */
export function isTranscriptionEnabled(): boolean {
  const row = db.select({ on: schema.appSettings.aiTranscriptionEnabled }).from(schema.appSettings)
    .where(eq(schema.appSettings.id, APP_SETTINGS_ROW_ID)).get();
  return row?.on === true;
}

export async function setTranscriptionEnabled(on: boolean): Promise<boolean> {
  // Seeds the row from the environment exactly as the settings page does when there is none yet.
  await ensureAppSettings();
  const from = isTranscriptionEnabled();
  db.update(schema.appSettings).set({ aiTranscriptionEnabled: on, updatedAt: new Date() })
    .where(eq(schema.appSettings.id, APP_SETTINGS_ROW_ID)).run();
  if (from !== on) {
    logger.info({ event: 'ai.transcription_switch', from, to: on }, 'Speech transcription switched');
  }
  return on;
}
