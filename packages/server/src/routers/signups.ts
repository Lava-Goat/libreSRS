// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Sign-up sheets: the teacher lists class days, each holding a few students,
 * and each student picks their days — who presents on which day.
 *
 * Days are calendar dates ('YYYY-MM-DD'). A day locks for students once it
 * arrives in the sheet's time zone; after that only the teacher moves people.
 * Capacity and the per-student limit are checked inside one synchronous
 * transaction, so two students taking the last seat at the same moment
 * cannot both get it.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, adminProcedure } from './trpc.js';
import { db, schema } from '../db/index.js';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { logger } from '../logger.js';
import { isCalendarDate, isTimeZone, shortName, todayIn } from '../services/signups.js';

type Sheet = typeof schema.signupSheets.$inferSelect;

/** Days one sheet may hold: a school year of class days, with room to spare. */
export const MAX_SIGNUP_DATES = 400;

const byTitle = (a: { title: string }, b: { title: string }) =>
  a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });

function sqliteCode(err: unknown): string | undefined {
  // Drizzle wraps driver errors; the SQLite code may be on the cause.
  return (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
}

async function groupIdsBySheet(sheetIds: number[]): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (sheetIds.length === 0) return map;
  const rows = await db.select().from(schema.signupSheetGroups).where(inArray(schema.signupSheetGroups.sheetId, sheetIds));
  for (const row of rows) map.set(row.sheetId, [...(map.get(row.sheetId) ?? []), row.groupId]);
  return map;
}

async function userGroupIds(userId: number): Promise<Set<number>> {
  const rows = await db.select({ groupId: schema.userGroups.groupId })
    .from(schema.userGroups)
    .where(eq(schema.userGroups.userId, userId));
  return new Set(rows.map((r) => r.groupId));
}

/** For everyone, or shares a group. A sheet whose groups were all deleted is for nobody. */
function isForStudent(sheet: Pick<Sheet, 'forEveryone'>, sheetGroupIds: number[] | undefined, mine: Set<number>): boolean {
  return sheet.forEveryone || (sheetGroupIds ?? []).some((id) => mine.has(id));
}

async function assertGroupsExist(groupIds: number[]) {
  const unique = [...new Set(groupIds)];
  if (unique.length === 0) return unique;
  const found = await db.select({ id: schema.groups.id }).from(schema.groups).where(inArray(schema.groups.id, unique));
  if (found.length !== unique.length) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'One of the chosen groups no longer exists. Reload and try again.' });
  }
  return unique;
}

/** The sheet, if this user may see it. Admins may open any sheet, active or not. */
async function assertSheetVisible(user: { id: number; role: string }, sheetId: number): Promise<Sheet> {
  const sheet = await db.query.signupSheets.findFirst({ where: eq(schema.signupSheets.id, sheetId) });
  if (!sheet) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sign-up sheet not found' });
  if (user.role === 'admin') return sheet;
  if (!sheet.active) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sign-up sheet not found' });
  const groups = (await groupIdsBySheet([sheet.id])).get(sheet.id);
  if (!isForStudent(sheet, groups, await userGroupIds(user.id))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This sign-up sheet is not for your class' });
  }
  return sheet;
}

async function expectedStudents(sheet: Pick<Sheet, 'forEveryone'>, sheetGroupIds: number[]) {
  const columns = { id: schema.users.id, name: schema.users.name, email: schema.users.email };
  if (sheet.forEveryone) return db.select(columns).from(schema.users).where(ne(schema.users.role, 'admin'));
  if (sheetGroupIds.length === 0) return [];
  return db.selectDistinct(columns)
    .from(schema.users)
    .innerJoin(schema.userGroups, eq(schema.userGroups.userId, schema.users.id))
    .where(and(inArray(schema.userGroups.groupId, sheetGroupIds), ne(schema.users.role, 'admin')));
}

/** The date row, or NOT_FOUND in words a student understands. */
async function findDate(dateId: number) {
  const date = await db.query.signupDates.findFirst({ where: eq(schema.signupDates.id, dateId) });
  if (!date) throw new TRPCError({ code: 'NOT_FOUND', message: 'That day is no longer on the sheet. Reload the page.' });
  return date;
}

const calendarDate = z.string().refine(isCalendarDate, 'Not a date (YYYY-MM-DD)');

const dateFields = z.object({
  date: calendarDate,
  label: z.string().max(200).nullish(),
  /** Students this day holds; null or absent uses the sheet's number. */
  capacity: z.number().int().min(0).max(100).nullish(),
});

const sheetFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).nullish(),
  slotsPerDate: z.number().int().min(1).max(100),
  picksPerStudent: z.number().int().min(1).max(50),
  showNames: z.boolean(),
  open: z.boolean(),
  timeZone: z.string().refine(isTimeZone, 'Unknown time zone'),
  active: z.boolean(),
};

/** One row per day; a day listed twice keeps its first line. */
function uniqueDates(dates: z.infer<typeof dateFields>[]) {
  const seen = new Set<string>();
  return dates.filter((d) => (seen.has(d.date) ? false : (seen.add(d.date), true)));
}

export const signupsRouter = router({
  /** Sheets this student can see, with how many days they have picked. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const active = await db.query.signupSheets.findMany({ where: eq(schema.signupSheets.active, true) });
    let visible = active;
    if (ctx.user.role !== 'admin') {
      const groups = await groupIdsBySheet(active.map((s) => s.id));
      const mine = await userGroupIds(ctx.user.id);
      visible = active.filter((s) => isForStudent(s, groups.get(s.id), mine));
    }
    if (visible.length === 0) return [];
    const own = await db
      .select({ sheetId: schema.signupClaims.sheetId, date: schema.signupDates.date })
      .from(schema.signupClaims)
      .innerJoin(schema.signupDates, eq(schema.signupClaims.dateId, schema.signupDates.id))
      .where(and(
        eq(schema.signupClaims.userId, ctx.user.id),
        inArray(schema.signupClaims.sheetId, visible.map((s) => s.id)),
      ))
      .orderBy(asc(schema.signupDates.date));
    return visible.sort(byTitle).map((s) => {
      const mineHere = own.filter((c) => c.sheetId === s.id);
      return {
        id: s.id,
        title: s.title,
        open: s.open,
        picksPerStudent: s.picksPerStudent,
        myDates: mineHere.map((c) => c.date),
      };
    });
  }),

  /**
   * One sheet, every day on it, and who has each. Classmates appear as
   * "Ana R." when the teacher shows names, and not at all otherwise.
   */
  get: protectedProcedure
    .input(z.object({ sheetId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const sheet = await assertSheetVisible(ctx.user, input.sheetId);
      const today = todayIn(sheet.timeZone);
      const dates = await db.query.signupDates.findMany({
        where: eq(schema.signupDates.sheetId, sheet.id),
        orderBy: [asc(schema.signupDates.date)],
      });
      const claims = await db
        .select({
          dateId: schema.signupClaims.dateId,
          userId: schema.signupClaims.userId,
          assignedBy: schema.signupClaims.assignedBy,
          name: schema.users.name,
          // Only to recognise a name that is really the address; never sent.
          email: schema.users.email,
        })
        .from(schema.signupClaims)
        .innerJoin(schema.users, eq(schema.signupClaims.userId, schema.users.id))
        .where(eq(schema.signupClaims.sheetId, sheet.id))
        .orderBy(asc(schema.signupClaims.createdAt), asc(schema.signupClaims.id));
      const myCount = claims.filter((c) => c.userId === ctx.user.id).length;
      return {
        id: sheet.id,
        title: sheet.title,
        description: sheet.description,
        open: sheet.open,
        picksPerStudent: sheet.picksPerStudent,
        showNames: sheet.showNames,
        today,
        myCount,
        dates: dates.map((d) => {
          const here = claims.filter((c) => c.dateId === d.id);
          const mine = here.find((c) => c.userId === ctx.user.id);
          return {
            id: d.id,
            date: d.date,
            label: d.label,
            capacity: d.capacity ?? sheet.slotsPerDate,
            taken: here.length,
            /** The day has arrived: students can no longer pick or drop it. */
            locked: d.date <= today,
            mine: !!mine,
            /** The teacher put this student here, so only the teacher moves them. */
            assigned: !!mine?.assignedBy,
            people: here.map((c) => ({
              you: c.userId === ctx.user.id,
              name: c.userId === ctx.user.id || sheet.showNames ? shortName(c.name, c.email) : null,
            })),
          };
        }),
      };
    }),

  /** Take a day. Picking a day you already have is not an error. */
  claim: protectedProcedure
    .input(z.object({ dateId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role === 'admin') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Teachers put students on days from the roster (Admin → Sign-ups), not here.' });
      }
      const found = await findDate(input.dateId);
      await assertSheetVisible(ctx.user, found.sheetId);
      try {
        db.transaction((tx) => {
          // Everything is read again here: the teacher may have closed the
          // sheet or shrunk the day since the checks above.
          const date = tx.select().from(schema.signupDates).where(eq(schema.signupDates.id, input.dateId)).get();
          if (!date) throw new TRPCError({ code: 'NOT_FOUND', message: 'That day is no longer on the sheet. Reload the page.' });
          const sheet = tx.select().from(schema.signupSheets).where(eq(schema.signupSheets.id, date.sheetId)).get();
          if (!sheet) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sign-up sheet not found' });
          if (!sheet.open) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This sign-up sheet is closed. Ask your teacher to change your day.' });
          if (date.date <= todayIn(sheet.timeZone)) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'That day has already started. Pick a later one.' });
          }
          const mine = tx.select({ dateId: schema.signupClaims.dateId })
            .from(schema.signupClaims)
            .where(and(eq(schema.signupClaims.sheetId, sheet.id), eq(schema.signupClaims.userId, ctx.user.id)))
            .all();
          if (mine.some((c) => c.dateId === date.id)) return;
          const taken = tx.select({ id: schema.signupClaims.id })
            .from(schema.signupClaims)
            .where(eq(schema.signupClaims.dateId, date.id))
            .all().length;
          if (taken >= (date.capacity ?? sheet.slotsPerDate)) {
            throw new TRPCError({ code: 'CONFLICT', message: 'Someone just took the last spot on that day. Pick another one.' });
          }
          if (mine.length >= sheet.picksPerStudent) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: sheet.picksPerStudent === 1
                ? 'You already have a day. Drop it first to pick a different one.'
                : `You already have ${sheet.picksPerStudent} days. Drop one first to pick a different one.`,
            });
          }
          tx.insert(schema.signupClaims).values({ sheetId: sheet.id, dateId: date.id, userId: ctx.user.id }).run();
        });
      } catch (err) {
        // A double click that lost the race to its twin: the day is theirs.
        if (sqliteCode(err) === 'SQLITE_CONSTRAINT_UNIQUE') return { success: true };
        throw err;
      }
      logger.info({ event: 'signups.claimed', sheetId: found.sheetId, dateId: input.dateId, userId: ctx.user.id }, 'Sign-up day claimed');
      return { success: true };
    }),

  /** Give a day back while the sheet is open and the day is still ahead. */
  release: protectedProcedure
    .input(z.object({ dateId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const date = await findDate(input.dateId);
      const sheet = await assertSheetVisible(ctx.user, date.sheetId);
      if (!sheet.open) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This sign-up sheet is closed. Ask your teacher to change your day.' });
      if (date.date <= todayIn(sheet.timeZone)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That day has already started. Ask your teacher to change it.' });
      }
      const claim = await db.query.signupClaims.findFirst({
        where: and(eq(schema.signupClaims.dateId, date.id), eq(schema.signupClaims.userId, ctx.user.id)),
      });
      if (!claim) return { success: true };
      if (claim.assignedBy !== null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Your teacher put you on this day. Ask them to change it.' });
      }
      await db.delete(schema.signupClaims).where(eq(schema.signupClaims.id, claim.id));
      logger.info({ event: 'signups.released', sheetId: sheet.id, dateId: date.id, userId: ctx.user.id }, 'Sign-up day released');
      return { success: true };
    }),

  adminList: adminProcedure.query(async () => {
    const sheets = await db.query.signupSheets.findMany();
    const ids = sheets.map((s) => s.id);
    const groups = await groupIdsBySheet(ids);
    const dates = ids.length === 0 ? [] : await db
      .select({ sheetId: schema.signupDates.sheetId, date: schema.signupDates.date, capacity: schema.signupDates.capacity })
      .from(schema.signupDates)
      .where(inArray(schema.signupDates.sheetId, ids));
    const claims = ids.length === 0 ? [] : await db
      .select({ sheetId: schema.signupClaims.sheetId })
      .from(schema.signupClaims)
      .where(inArray(schema.signupClaims.sheetId, ids));
    return sheets.sort(byTitle).map((s) => {
      const days = dates.filter((d) => d.sheetId === s.id).map((d) => d.date).sort();
      return {
        ...s,
        groupIds: groups.get(s.id) ?? [],
        dateCount: days.length,
        firstDate: days[0] ?? null,
        lastDate: days[days.length - 1] ?? null,
        slots: dates.filter((d) => d.sheetId === s.id).reduce((n, d) => n + (d.capacity ?? s.slotsPerDate), 0),
        claimCount: claims.filter((c) => c.sheetId === s.id).length,
      };
    });
  }),

  /** Everything the teacher sees: each day with full names, and who still owes picks. */
  adminGet: adminProcedure
    .input(z.object({ sheetId: z.number().int() }))
    .query(async ({ input }) => {
      const sheet = await db.query.signupSheets.findFirst({ where: eq(schema.signupSheets.id, input.sheetId) });
      if (!sheet) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sign-up sheet not found' });
      const groupIds = (await groupIdsBySheet([sheet.id])).get(sheet.id) ?? [];
      const dates = await db.query.signupDates.findMany({
        where: eq(schema.signupDates.sheetId, sheet.id),
        orderBy: [asc(schema.signupDates.date)],
      });
      const claims = await db
        .select({
          id: schema.signupClaims.id,
          dateId: schema.signupClaims.dateId,
          userId: schema.users.id,
          name: schema.users.name,
          email: schema.users.email,
          assignedBy: schema.signupClaims.assignedBy,
          createdAt: schema.signupClaims.createdAt,
        })
        .from(schema.signupClaims)
        .innerJoin(schema.users, eq(schema.signupClaims.userId, schema.users.id))
        .where(eq(schema.signupClaims.sheetId, sheet.id))
        .orderBy(asc(schema.signupClaims.createdAt), asc(schema.signupClaims.id));
      const expected = await expectedStudents(sheet, groupIds);
      const picks = new Map<number, string[]>();
      const dayOf = new Map(dates.map((d) => [d.id, d.date]));
      for (const c of claims) picks.set(c.userId, [...(picks.get(c.userId) ?? []), dayOf.get(c.dateId) ?? '']);
      return {
        sheet: { ...sheet, groupIds },
        today: todayIn(sheet.timeZone),
        dates: dates.map((d) => ({
          ...d,
          effectiveCapacity: d.capacity ?? sheet.slotsPerDate,
          claims: claims
            .filter((c) => c.dateId === d.id)
            .map(({ dateId: _dateId, assignedBy, ...c }) => ({ ...c, assigned: assignedBy !== null })),
        })),
        roster: expected
          .map((s) => ({ ...s, dates: (picks.get(s.id) ?? []).sort() }))
          .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email, undefined, { sensitivity: 'base' })),
      };
    }),

  create: adminProcedure
    .input(z.object({
      ...sheetFields,
      groupIds: z.array(z.number().int()).default([]),
      dates: z.array(dateFields).max(MAX_SIGNUP_DATES).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const groupIds = await assertGroupsExist(input.groupIds);
      const dates = uniqueDates(input.dates);
      const sheet = db.transaction((tx) => {
        const [row] = tx.insert(schema.signupSheets).values({
          title: input.title,
          description: input.description?.trim() || null,
          slotsPerDate: input.slotsPerDate,
          picksPerStudent: input.picksPerStudent,
          showNames: input.showNames,
          open: input.open,
          timeZone: input.timeZone,
          forEveryone: groupIds.length === 0,
          active: input.active,
          createdBy: ctx.user.id,
        }).returning().all();
        if (groupIds.length > 0) {
          tx.insert(schema.signupSheetGroups).values(groupIds.map((groupId) => ({ sheetId: row.id, groupId }))).run();
        }
        if (dates.length > 0) {
          tx.insert(schema.signupDates).values(dates.map((d) => ({
            sheetId: row.id,
            date: d.date,
            label: d.label?.trim() || null,
            capacity: d.capacity ?? null,
          }))).run();
        }
        return row;
      });
      logger.info({ event: 'signups.sheet_created', sheetId: sheet.id, dates: dates.length }, 'Sign-up sheet created');
      return sheet;
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number().int(),
      title: sheetFields.title.optional(),
      description: sheetFields.description,
      slotsPerDate: sheetFields.slotsPerDate.optional(),
      picksPerStudent: sheetFields.picksPerStudent.optional(),
      showNames: sheetFields.showNames.optional(),
      open: sheetFields.open.optional(),
      timeZone: sheetFields.timeZone.optional(),
      active: sheetFields.active.optional(),
      /** Replaces the sheet's groups; an empty list means every student. */
      groupIds: z.array(z.number().int()).optional(),
    }))
    .mutation(async ({ input }) => {
      const sheet = await db.query.signupSheets.findFirst({ where: eq(schema.signupSheets.id, input.id) });
      if (!sheet) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sign-up sheet not found' });
      const groups = input.groupIds === undefined ? undefined : await assertGroupsExist(input.groupIds);

      const data: Partial<typeof schema.signupSheets.$inferInsert> = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.description !== undefined) data.description = input.description?.trim() || null;
      if (input.slotsPerDate !== undefined) data.slotsPerDate = input.slotsPerDate;
      if (input.picksPerStudent !== undefined) data.picksPerStudent = input.picksPerStudent;
      if (input.showNames !== undefined) data.showNames = input.showNames;
      if (input.open !== undefined) data.open = input.open;
      if (input.timeZone !== undefined) data.timeZone = input.timeZone;
      if (input.active !== undefined) data.active = input.active;
      if (groups !== undefined) data.forEveryone = groups.length === 0;

      db.transaction((tx) => {
        if (Object.keys(data).length > 0) tx.update(schema.signupSheets).set(data).where(eq(schema.signupSheets.id, input.id)).run();
        if (groups !== undefined) {
          tx.delete(schema.signupSheetGroups).where(eq(schema.signupSheetGroups.sheetId, input.id)).run();
          if (groups.length > 0) tx.insert(schema.signupSheetGroups).values(groups.map((groupId) => ({ sheetId: input.id, groupId }))).run();
        }
      });
      return { success: true };
    }),

  /** Deletes the sheet, its days and every pick on it. */
  remove: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      await db.delete(schema.signupSheets).where(eq(schema.signupSheets.id, input.id));
      logger.info({ event: 'signups.sheet_removed', sheetId: input.id }, 'Sign-up sheet removed');
      return { success: true };
    }),

  /**
   * Adds days, and relabels or resizes the ones already there (matched by
   * date). Never removes a day: that is removeDate, which says who loses it.
   */
  saveDates: adminProcedure
    .input(z.object({ sheetId: z.number().int(), dates: z.array(dateFields).min(1).max(MAX_SIGNUP_DATES) }))
    .mutation(async ({ input }) => {
      const sheet = await db.query.signupSheets.findFirst({ where: eq(schema.signupSheets.id, input.sheetId) });
      if (!sheet) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sign-up sheet not found' });
      const dates = uniqueDates(input.dates);
      return db.transaction((tx) => {
        const existing = new Map(tx.select().from(schema.signupDates)
          .where(eq(schema.signupDates.sheetId, sheet.id)).all()
          .map((d) => [d.date, d]));
        const toAdd = dates.filter((d) => !existing.has(d.date));
        if (existing.size + toAdd.length > MAX_SIGNUP_DATES) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `A sheet holds at most ${MAX_SIGNUP_DATES} days.` });
        }
        let updated = 0;
        for (const d of dates) {
          const row = existing.get(d.date);
          if (!row) continue;
          // Only what the line says changes: a bare date keeps its label, and a
          // pasted list (which never carries capacities) keeps each day's size.
          const change: Partial<typeof schema.signupDates.$inferInsert> = {};
          if (d.label?.trim()) change.label = d.label.trim();
          if (d.capacity !== undefined) change.capacity = d.capacity;
          if (Object.keys(change).length === 0) continue;
          tx.update(schema.signupDates).set(change).where(eq(schema.signupDates.id, row.id)).run();
          updated += 1;
        }
        if (toAdd.length > 0) {
          tx.insert(schema.signupDates).values(toAdd.map((d) => ({
            sheetId: sheet.id,
            date: d.date,
            label: d.label?.trim() || null,
            capacity: d.capacity ?? null,
          }))).run();
        }
        return { added: toAdd.length, updated };
      });
    }),

  /** Takes a day off the sheet. Students on it lose it; the count says how many. */
  removeDate: adminProcedure
    .input(z.object({ dateId: z.number().int() }))
    .mutation(async ({ input }) => {
      const removedClaims = db.transaction((tx) => {
        const n = tx.select({ id: schema.signupClaims.id })
          .from(schema.signupClaims)
          .where(eq(schema.signupClaims.dateId, input.dateId))
          .all().length;
        tx.delete(schema.signupDates).where(eq(schema.signupDates.id, input.dateId)).run();
        return n;
      });
      return { removedClaims };
    }),

  /**
   * The teacher puts a student on a day. Past days, full days and the
   * per-student limit do not apply: the teacher is fixing the schedule.
   */
  assign: adminProcedure
    .input(z.object({ dateId: z.number().int(), userId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const date = await findDate(input.dateId);
      const user = await db.query.users.findFirst({ where: eq(schema.users.id, input.userId), columns: { id: true } });
      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: 'Student not found' });
      try {
        await db.insert(schema.signupClaims).values({
          sheetId: date.sheetId,
          dateId: date.id,
          userId: user.id,
          assignedBy: ctx.user.id,
        });
      } catch (err) {
        if (sqliteCode(err) === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new TRPCError({ code: 'CONFLICT', message: 'That student already has this day.' });
        }
        throw err;
      }
      return { success: true };
    }),

  unassign: adminProcedure
    .input(z.object({ claimId: z.number().int() }))
    .mutation(async ({ input }) => {
      await db.delete(schema.signupClaims).where(eq(schema.signupClaims.id, input.claimId));
      return { success: true };
    }),
});
