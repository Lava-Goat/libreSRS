// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Setting up a class through the real API, as the teacher, for the specs
 * that test something else (studying, signing in). The teacher signs in
 * through the same OAuth routes as in the browser; calls are plain tRPC over
 * HTTP with the CSRF header the client sends. The conjugation journey does
 * its setup in the Admin UI instead, since that is part of what it tests.
 */
import { request, type APIRequestContext } from '@playwright/test';
import { API_URL, TEACHER, type Person } from '../env';
import { chooseNextUser } from './auth';

/** A roster CSV the way Google Classroom exports one, for the group import. */
export function rosterCsv(students: Person[]): string {
  const rows = students.map((s) => {
    const [first, ...last] = s.name.split(' ');
    return `${s.email},${first},${last.join(' ')}`;
  });
  return ['Email Address,First Name,Last Name', ...rows].join('\n');
}

/** A deck CSV: front,back rows. */
export function deckCsv(cards: [front: string, back: string][]): string {
  return ['front,back', ...cards.map(([front, back]) => `${front},${back}`)].join('\n');
}

/** pins.settings, as the Access tab reads it. */
export interface PinSettings {
  mode: 'auto' | 'on' | 'off';
  showing: boolean;
  google: {
    looksBlocked: boolean;
    since: number | null;
    reason: 'no_returns' | 'google_error' | null;
    unansweredBrowsers: number;
    lastStudentSignInAt: number | null;
    watchingSince: number;
  };
}

export class TeacherApi {
  private constructor(private readonly ctx: APIRequestContext, private readonly csrf: string) {}

  /** Signs the teacher in (ADMIN_EMAIL, so allowed from the first sign-in on). */
  static async signIn(): Promise<TeacherApi> {
    const ctx = await request.newContext({ baseURL: API_URL });
    await chooseNextUser(TEACHER);
    // /auth/google → the fake provider → the API's callback (session cookie) → the client's home page.
    const res = await ctx.get('/auth/google');
    if (!res.ok()) throw new Error(`teacher sign-in ended on ${res.url()} with ${res.status()}`);
    // A safe request hands out the CSRF cookie that mutations must echo.
    await ctx.get('/api/trpc/auth.me');
    const csrf = (await ctx.storageState()).cookies.find((c) => c.name === 'libresrs_csrf')?.value;
    if (!csrf) throw new Error('no CSRF cookie after signing in');
    const api = new TeacherApi(ctx, csrf);
    const me = await api.query<{ email: string; role: string } | null>('auth.me');
    if (me?.email !== TEACHER.email || me.role !== 'admin') throw new Error(`signed in as ${JSON.stringify(me)}, not the teacher`);
    return api;
  }

  async query<T>(path: string, input?: unknown): Promise<T> {
    const search = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`;
    return this.unwrap<T>(path, await this.ctx.get(`/api/trpc/${path}${search}`));
  }

  async mutate<T>(path: string, input?: unknown): Promise<T> {
    return this.unwrap<T>(path, await this.ctx.post(`/api/trpc/${path}`, {
      data: input ?? {},
      headers: { 'x-csrf-token': this.csrf },
    }));
  }

  private async unwrap<T>(path: string, res: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
    const body = await res.json() as { result?: { data: T }; error?: { message: string } };
    if (!res.ok() || !body.result) throw new Error(`${path}: ${res.status()} ${body.error?.message ?? JSON.stringify(body)}`);
    return body.result.data;
  }

  /** Lets a whole class sign in: an allowlist regex, as the Access tab adds it. */
  async allowEmails(pattern: string): Promise<void> {
    const existing = await this.query<{ pattern: string }[]>('admin.getAllowedEmails');
    if (!existing.some((e) => e.pattern === pattern)) await this.mutate('admin.addAllowedEmail', { pattern, isRegex: true });
  }

  /** A deck with its cards, assigned to a group made from a roster (students pre-registered by email). */
  async deckForClass(opts: { deck: string; cards: [string, string][]; group: string; students: Person[] }): Promise<{ deckId: number; groupId: number }> {
    const deck = await this.mutate<{ id: number }>('admin.createDeck', { name: opts.deck });
    const upload = await this.mutate<{ success: boolean; cardsAdded: number; errors: string[] }>(
      'admin.uploadCards', { deckId: deck.id, csvContent: deckCsv(opts.cards) },
    );
    if (!upload.success || upload.cardsAdded !== opts.cards.length) throw new Error(`card upload: ${JSON.stringify(upload)}`);
    const imported = await this.mutate<{ group: { id: number } }>(
      'admin.importGoogleClassroomGroup', { name: opts.group, csvContent: rosterCsv(opts.students) },
    );
    await this.mutate('admin.assignDeckToGroup', { deckId: deck.id, groupId: imported.group.id });
    return { deckId: deck.id, groupId: imported.group.id };
  }

  async deckId(name: string): Promise<number> {
    const decks = await this.query<{ id: number; name: string }[]>('admin.getDecks');
    const deck = decks.find((d) => d.name === name);
    if (!deck) throw new Error(`no deck named ${name}`);
    return deck.id;
  }

  async users(): Promise<{ email: string; role: string; googleId: string }[]> {
    return this.query('admin.getUsers');
  }

  /** A user's id, by email. */
  async userId(email: string): Promise<number> {
    const users = await this.query<{ id: number; email: string }[]>('admin.getUsers');
    const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (!user) throw new Error(`no user with the email ${email}`);
    return user.id;
  }

  /** A group made from a roster (students pre-registered by email, as an import does); its id. */
  async rosterGroup(name: string, students: Person[]): Promise<number> {
    const imported = await this.mutate<{ group: { id: number } }>(
      'admin.importGoogleClassroomGroup', { name, csvContent: rosterCsv(students) },
    );
    return imported.group.id;
  }

  // "Sign in with a PIN" (v1.22.0), as Admin > Access and a student's page do it.

  /** Admin > Access: who sees "Sign in with a PIN" (auto: only while Google refuses students). */
  async pinMode(mode: 'auto' | 'on' | 'off'): Promise<void> {
    await this.mutate('pins.setMode', { mode });
  }

  /** What the Access tab shows: the mode, and whether Google sign-in looks blocked for students. */
  async pinSettings(): Promise<PinSettings> {
    return this.query('pins.settings');
  }

  /** "Make a new PIN" on a student's page: the new PIN, which nothing else ever shows again. */
  async makePin(userId: number): Promise<string> {
    const made = await this.mutate<{ pin: string }>('pins.createForUser', { userId });
    // The keys only: a PIN never goes in a log, not even a test one.
    if (!/^\d{4}$/.test(made.pin)) throw new Error(`pins.createForUser answered no PIN (keys: ${Object.keys(made).join(', ')})`);
    return made.pin;
  }

  async unlockPin(userId: number): Promise<void> {
    await this.mutate('pins.unlock', { userId });
  }

  async removePin(userId: number): Promise<void> {
    await this.mutate('pins.remove', { userId });
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }
}
