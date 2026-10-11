// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The mnemonic mode of a student, a group or a deck (mnemonic_mode). Its own module, with no
 * database import, so the routers and the settings services share one reading of it.
 */
import { z } from 'zod';
import { LEGACY_MNEMONIC_MODE, MNEMONIC_MODES } from '../db/schema.js';

/** 'manual' (a teacher asks for a suggestion on any card) or 'disabled' (no new suggestions). */
export type MnemonicMode = typeof MNEMONIC_MODES[number];

/**
 * A stored mnemonic_mode as the mode it means: 'disabled' stays 'disabled', and anything else
 * is 'manual', the deprecated 'auto-non-cognate' that old rows (and the SQL default of
 * user_settings and group_settings) still hold included. Every read of the column goes through here.
 */
export function readMnemonicMode(stored: string | null | undefined): MnemonicMode {
  return stored === 'disabled' ? 'disabled' : 'manual';
}

/**
 * A mnemonic mode from a client. A page loaded before v1.20.0 may still send 'auto-non-cognate':
 * it is taken, so that save does not fail, and saved as 'manual'.
 */
export const mnemonicModeInput = z.enum([...MNEMONIC_MODES, LEGACY_MNEMONIC_MODE]).transform(readMnemonicMode);
