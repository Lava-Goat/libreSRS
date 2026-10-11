// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The teacher's pause rule for labs (Admin → Labs → "Speaking in the pauses"):
 * the share of a lab's counted pauses a student must answer, how much voice
 * makes a pause answered, the voice meter's room margin, and whether voice
 * outside the pauses also holds a lab. One row, id 1. Migration 0039 seeds 0%
 * (watch first: every lab counts); with no row at all the shared defaults apply.
 *
 * A session copies these into its rules when it begins (routers/labs.ts
 * `begin`), so a change applies to labs started from then on.
 */
import { eq } from 'drizzle-orm';
import { clampLabSettings, type LabPauseSettings } from '@libresrs/shared';
import { db, schema } from '../db/index.js';

const SETTINGS_ROW_ID = 1;

/** Read when every session begins, so a plain one-row read. Out-of-range values read as clamped. */
export function getLabSettings(): LabPauseSettings {
  return clampLabSettings(db.select().from(schema.labSettings).where(eq(schema.labSettings.id, SETTINGS_ROW_ID)).get());
}

export type LabSettingsUpdate = Partial<LabPauseSettings>;

/** Saves what the update sets (clamped to the ranges); the rest stays. */
export function saveLabSettings(update: LabSettingsUpdate, now = new Date()): LabPauseSettings {
  return db.transaction((tx) => {
    const current = clampLabSettings(
      tx.select().from(schema.labSettings).where(eq(schema.labSettings.id, SETTINGS_ROW_ID)).get(),
    );
    const next = clampLabSettings({
      minAnsweredPct: update.minAnsweredPct ?? current.minAnsweredPct,
      voicePerPauseMs: update.voicePerPauseMs ?? current.voicePerPauseMs,
      gateMarginDb: update.gateMarginDb ?? current.gateMarginDb,
      holdOutsideVoice: update.holdOutsideVoice ?? current.holdOutsideVoice,
    });
    const values = { ...next, updatedAt: now };
    tx.insert(schema.labSettings)
      .values({ id: SETTINGS_ROW_ID, ...values })
      .onConflictDoUpdate({ target: schema.labSettings.id, set: values })
      .run();
    return next;
  });
}
