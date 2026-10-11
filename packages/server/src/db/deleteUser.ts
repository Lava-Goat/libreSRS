// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Delete one student's data at the school's request, or re-apply the deletion ledger after a
 * restore (services/userDeletion.ts says what each does). Prints the receipt as JSON: what the
 * deletion certificate quotes. Run beside the database the server uses (DATABASE_URL), for example
 * in the container: node packages/server/dist/db/deleteUser.js --email 123456@school.test \
 *   --request "School request of 2026-11-02" --by "Operator" [--dry-run]
 *
 *   --email <address> | --user-id <n>   the account
 *   --request <text>                    the school's request it answers (date, sender, reference)
 *   --by <text>                         who carries it out
 *   --dry-run                           count only; change nothing
 *   --allow-admin                       an administrator account (only at the school's request)
 *   --replay                            after a restore: delete again every account the ledger names
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(here, '../../../../.env'), quiet: true });

export interface CliArgs {
  email?: string;
  userId?: number;
  request?: string;
  by?: string;
  dryRun: boolean;
  allowAdmin: boolean;
  replay: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, allowAdmin: false, replay: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
      return v;
    };
    switch (flag) {
      case '--email': args.email = value(); break;
      case '--user-id': {
        const n = Number(value());
        if (!Number.isInteger(n) || n <= 0) throw new Error('--user-id needs a positive whole number');
        args.userId = n;
        break;
      }
      case '--request': args.request = value(); break;
      case '--by': args.by = value(); break;
      case '--dry-run': args.dryRun = true; break;
      case '--allow-admin': args.allowAdmin = true; break;
      case '--replay': args.replay = true; break;
      default: throw new Error(`Unknown option ${flag}`);
    }
  }
  return args;
}

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error((err as Error).message);
    return 2;
  }
  // Loaded only now: db/index.js opens the database when imported.
  const { deleteUserData, replayDeletions, DeletionError } = await import('../services/userDeletion.js');
  try {
    if (args.replay) {
      if (!args.by) throw new DeletionError('--replay needs --by');
      const done = await replayDeletions({ performedBy: args.by, dryRun: args.dryRun });
      console.log(JSON.stringify({ replayed: done.length, dryRun: args.dryRun, receipts: done }, null, 2));
      return 0;
    }
    const receipt = await deleteUserData({
      email: args.email, userId: args.userId, performedBy: args.by ?? '', requestRef: args.request ?? '',
      dryRun: args.dryRun, allowAdmin: args.allowAdmin,
    });
    console.log(JSON.stringify(receipt, null, 2));
    return 0;
  } catch (err) {
    if (err instanceof DeletionError) {
      console.error(`Not deleted: ${err.message}`);
      return 1;
    }
    throw err;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });
}
