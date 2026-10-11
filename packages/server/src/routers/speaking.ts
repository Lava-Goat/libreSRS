// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * Speaking tasks: something a student records — reciting this week's cuento,
 * a rung of the escalera oral — for the teacher to hear and for a grader (an
 * agent, later) to score against the task's reference text.
 *
 * Recordings arrive through POST /api/speaking/:taskId/submission
 * (routers/audioUploads.ts); everything else is here.
 *
 * A task can be a speaking test (v1.21.0): its exam set ("U2") lists it on
 * the student's Tests page with that set's listening forms, instead of on the
 * Speaking page. That is the only difference: it records, caps and is graded
 * exactly like a practice task. Set names are shared with exam labs
 * (services/examLabs `resolveExamSet`).
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { access } from 'fs/promises';
import { resolve } from 'path';
import { router, protectedProcedure, adminProcedure } from './trpc.js';
import { db, schema } from '../db/index.js';
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { EXAM_APP_CODES, canonicalExamSet, parseSpeakingFlags, pickMicSettings, type LabMicProcessing } from '@libresrs/shared';
import { logger } from '../logger.js';
import { getAssetsDir } from '../services/ai/assetStorage.js';
import * as exams from '../services/examLabs.js';
import { ASSET_AUDIO_URL_RE, deleteRecordings } from '../services/recordings.js';
import { EXAM_SET_MESSAGE } from './labs.js';

type Task = typeof schema.speakingTasks.$inferSelect;

/** Recordings kept per student per task; beyond this, ask the teacher. */
export const MAX_SPEAKING_ATTEMPTS = 10;

/** The same refusal as an exam lab's (routers/labs.ts): the editor words it from its appCode. */
const examSetInvalid = () => new TRPCError({ code: 'BAD_REQUEST', message: EXAM_SET_MESSAGE, cause: { appCode: EXAM_APP_CODES.setInvalid } });

const byTitle = (a: { title: string }, b: { title: string }) =>
  a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });

async function groupIdsByTask(taskIds: number[]): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (taskIds.length === 0) return map;
  const rows = await db.select().from(schema.speakingTaskGroups).where(inArray(schema.speakingTaskGroups.taskId, taskIds));
  for (const row of rows) map.set(row.taskId, [...(map.get(row.taskId) ?? []), row.groupId]);
  return map;
}

async function userGroupIds(userId: number): Promise<Set<number>> {
  const rows = await db.select({ groupId: schema.userGroups.groupId })
    .from(schema.userGroups)
    .where(eq(schema.userGroups.userId, userId));
  return new Set(rows.map((r) => r.groupId));
}

/** For everyone, or shares a group. A task whose groups were all deleted is for nobody. */
function isForStudent(task: Pick<Task, 'forEveryone'>, taskGroupIds: number[] | undefined, mine: Set<number>): boolean {
  return task.forEveryone || (taskGroupIds ?? []).some((id) => mine.has(id));
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

/** The task, if this user may record it. Admins may open any task, active or not. */
export async function assertSpeakingTaskVisible(user: { id: number; role: string }, taskId: number): Promise<Task> {
  const task = await db.query.speakingTasks.findFirst({ where: eq(schema.speakingTasks.id, taskId) });
  if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
  if (user.role === 'admin') return task;
  if (!task.active) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
  const groups = (await groupIdsByTask([task.id])).get(task.id);
  if (!isForStudent(task, groups, await userGroupIds(user.id))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This task is not assigned to you' });
  }
  return task;
}

async function expectedStudents(task: Pick<Task, 'forEveryone'>, taskGroupIds: number[]) {
  const columns = { id: schema.users.id, name: schema.users.name, email: schema.users.email };
  if (task.forEveryone) return db.select(columns).from(schema.users).where(ne(schema.users.role, 'admin'));
  if (taskGroupIds.length === 0) return [];
  return db.selectDistinct(columns)
    .from(schema.users)
    .innerJoin(schema.userGroups, eq(schema.userGroups.userId, schema.users.id))
    .where(and(inArray(schema.userGroups.groupId, taskGroupIds), ne(schema.users.role, 'admin')));
}

async function assertAssetExists(url: string) {
  try {
    await access(resolve(getAssetsDir(), url.slice('/api/assets/'.length)));
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'The uploaded audio file was not found' });
  }
}

const taskFields = {
  title: z.string().trim().min(1).max(200),
  instructions: z.string().max(4000).nullish(),
  referenceText: z.string().max(20_000).nullish(),
  showReference: z.boolean(),
  modelAudioUrl: z.string().regex(ASSET_AUDIO_URL_RE, 'Not an uploaded audio file').nullish(),
  targetSeconds: z.number().int().min(5).max(3600).nullish(),
  active: z.boolean(),
};

const gradeInput = z.object({
  submissionId: z.number().int(),
  /** 0–100, or null to clear the grade. */
  score: z.number().min(0).max(100).nullable(),
  /**
   * Grader-defined JSON, e.g. per-vowel accuracy. Left out when saving a
   * score, the details already stored are kept (the teacher's Save that
   * releases an agent's grade to the student); null or '' clears them.
   */
  details: z.string().max(50_000).nullish(),
  /** Shown to the student with a teacher's grade (see `get`). */
  feedback: z.string().max(4000).nullish(),
  /**
   * Who graded it: 'teacher' from the review page, an agent's name and version
   * otherwise. Required with a score, so an agent can never pass as the teacher;
   * clearing a grade needs no name.
   */
  gradedBy: z.string().trim().min(1).max(100).optional(),
});

/** The grader name the review page sends; only these grades reach the student. */
export const TEACHER_GRADER = 'teacher';

/**
 * The details kept when a grade is saved without new ones. When the teacher's
 * save releases another grader's grade, that grader's name is kept in them
 * (`gradedByAgent`), so the record still says where the score came from.
 */
function keptDetails(stored: string | null, releasedFrom: string | null): string | null {
  if (!releasedFrom) return stored;
  let parsed: unknown = null;
  try { parsed = stored === null ? null : JSON.parse(stored); } catch { parsed = undefined; }
  if (parsed === null) return JSON.stringify({ gradedByAgent: releasedFrom });
  if (typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    return 'gradedByAgent' in obj ? stored : JSON.stringify({ ...obj, gradedByAgent: releasedFrom });
  }
  // A list or a plain value: kept whole, with the name beside it.
  return parsed === undefined ? stored : JSON.stringify({ gradedByAgent: releasedFrom, details: parsed });
}

type OwnSubmission = Pick<
  typeof schema.speakingSubmissions.$inferSelect,
  'id' | 'audioUrl' | 'durationMs' | 'submittedAt' | 'gradeScore' | 'gradeFeedback' | 'gradedBy' | 'gradedAt' | 'flags'
>;

/** The teacher's grade is on it: the only grade a student sees. */
const teacherGraded = (s: Pick<OwnSubmission, 'gradedBy' | 'gradedAt' | 'gradeScore'>) =>
  s.gradedBy === TEACHER_GRADER && s.gradedAt !== null && s.gradeScore !== null;

/**
 * The take had very little voice for its length and the teacher has not
 * graded it: the student is asked to record it again, closer to the
 * microphone. Only a nudge, by design: the task still counts as
 * turned in. The other flags are the teacher's and never reach the student.
 */
const quietForStudent = (s: Pick<OwnSubmission, 'gradedBy' | 'gradedAt' | 'gradeScore' | 'flags'>) =>
  !teacherGraded(s) && parseSpeakingFlags(s.flags).includes('little-speech');

/**
 * A recording as its student sees it. The grade and comment are shown only
 * when the teacher gave them (strictly 'teacher': an agent's grade waits until
 * the teacher saves it, and a NULL grader can only come from raw SQL). The
 * grader's name and details are never sent.
 */
function forStudent(s: OwnSubmission) {
  const shown = teacherGraded(s);
  return {
    id: s.id,
    audioUrl: s.audioUrl,
    durationMs: s.durationMs,
    submittedAt: s.submittedAt,
    score: shown ? s.gradeScore : null,
    feedback: shown ? s.gradeFeedback : null,
    gradedAt: shown ? s.gradedAt : null,
    littleSpeech: quietForStudent(s),
  };
}

/** A row's stored mic processing, or null. */
function parseMicSettings(text: string | null): LabMicProcessing | null {
  if (!text) return null;
  try { return pickMicSettings(JSON.parse(text)); } catch { return null; }
}

/** Another take with the same audio, as the teacher's Review names it. */
export interface AudioMatch {
  submissionId: number;
  taskId: number;
  taskTitle: string;
  studentName: string;
  submittedAt: Date;
}

/**
 * For each of these takes flagged 'same-file' or 'copied', the first earlier
 * take with the same audio: by the same student (on any task), and by anyone
 * else. Looked up when the Review opens, so a take that has been deleted
 * since just goes unnamed.
 */
function audioMatches(rows: { id: number; userId: number; contentSha256: string | null; flags: string | null }[]) {
  const wanted = rows.filter((r) => r.contentSha256 && parseSpeakingFlags(r.flags).some((f) => f === 'same-file' || f === 'copied'));
  const found = new Map<number, { sameFileAs: AudioMatch | null; copiedFrom: AudioMatch | null }>();
  if (wanted.length === 0) return found;
  const candidates = db
    .select({
      submissionId: schema.speakingSubmissions.id,
      userId: schema.speakingSubmissions.userId,
      contentSha256: schema.speakingSubmissions.contentSha256,
      taskId: schema.speakingSubmissions.taskId,
      taskTitle: schema.speakingTasks.title,
      studentName: schema.users.name,
      submittedAt: schema.speakingSubmissions.submittedAt,
    })
    .from(schema.speakingSubmissions)
    .innerJoin(schema.speakingTasks, eq(schema.speakingSubmissions.taskId, schema.speakingTasks.id))
    .innerJoin(schema.users, eq(schema.speakingSubmissions.userId, schema.users.id))
    .where(inArray(schema.speakingSubmissions.contentSha256, [...new Set(wanted.map((r) => r.contentSha256!))]))
    .orderBy(asc(schema.speakingSubmissions.id))
    .all();
  for (const row of wanted) {
    // Ids only grow, so a smaller one was stored first.
    const before = candidates.filter((c) => c.contentSha256 === row.contentSha256 && c.submissionId < row.id);
    const strip = ({ userId: _userId, contentSha256: _sha, ...match }: (typeof candidates)[number]): AudioMatch => match;
    const own = before.find((c) => c.userId === row.userId);
    const other = before.find((c) => c.userId !== row.userId);
    found.set(row.id, { sameFileAs: own ? strip(own) : null, copiedFrom: other ? strip(other) : null });
  }
  return found;
}

export const speakingRouter = router({
  /**
   * Tasks this student can record, with their own latest submission. Speaking
   * tests too (v1.21.0), each with its `examSet`: the page splits them, the
   * Speaking page showing practice tasks and the Tests page tests.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const active = await db.query.speakingTasks.findMany({ where: eq(schema.speakingTasks.active, true) });
    let visible = active;
    if (ctx.user.role !== 'admin') {
      const groups = await groupIdsByTask(active.map((t) => t.id));
      const mine = await userGroupIds(ctx.user.id);
      visible = active.filter((t) => isForStudent(t, groups.get(t.id), mine));
    }
    if (visible.length === 0) return [];
    const own = await db.query.speakingSubmissions.findMany({
      where: and(
        eq(schema.speakingSubmissions.userId, ctx.user.id),
        inArray(schema.speakingSubmissions.taskId, visible.map((t) => t.id)),
      ),
      orderBy: [desc(schema.speakingSubmissions.submittedAt), desc(schema.speakingSubmissions.id)],
      columns: { taskId: true, submittedAt: true, flags: true, gradeScore: true, gradedBy: true, gradedAt: true },
    });
    return visible.sort(byTitle).map((t) => {
      const mineForTask = own.filter((s) => s.taskId === t.id);
      return {
        id: t.id,
        title: t.title,
        targetSeconds: t.targetSeconds,
        submittedAt: mineForTask[0]?.submittedAt ?? null,
        attempts: mineForTask.length,
        /** The latest take was very quiet and is not graded: the list asks for a new one (still turned in). */
        littleSpeech: mineForTask.length > 0 && quietForStudent(mineForTask[0]),
        /** v1.21.0: null for a practice task; a set name ("U2") for a speaking test. */
        examSet: t.examSet,
      };
    });
  }),

  /**
   * One task, ready to record. When the teacher chose "recite from memory",
   * the reference text is not sent to the page at all. The student's own
   * recordings carry the teacher's grade and comment once there is one.
   */
  get: protectedProcedure
    .input(z.object({ taskId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const task = await assertSpeakingTaskVisible(ctx.user, input.taskId);
      // All of them (the cap keeps it to a handful): `attempts` must count
      // every recording, not only the ones shown.
      const own = await db.query.speakingSubmissions.findMany({
        where: and(eq(schema.speakingSubmissions.taskId, task.id), eq(schema.speakingSubmissions.userId, ctx.user.id)),
        orderBy: [desc(schema.speakingSubmissions.submittedAt), desc(schema.speakingSubmissions.id)],
        columns: {
          id: true, audioUrl: true, durationMs: true, submittedAt: true,
          gradeScore: true, gradeFeedback: true, gradedBy: true, gradedAt: true, flags: true,
        },
      });
      return {
        id: task.id,
        title: task.title,
        instructions: task.instructions,
        referenceText: task.showReference ? task.referenceText : null,
        recitesFromMemory: !task.showReference && !!task.referenceText,
        modelAudioUrl: task.modelAudioUrl,
        targetSeconds: task.targetSeconds,
        attempts: own.length,
        maxAttempts: MAX_SPEAKING_ATTEMPTS,
        mySubmissions: own.slice(0, 5).map(forStudent),
        /** v1.21.0: a speaking test's set, so the page says so and goes back to the Tests page. */
        examSet: task.examSet,
      };
    }),

  create: adminProcedure
    .input(z.object({
      ...taskFields,
      groupIds: z.array(z.number().int()).default([]),
      /** v1.21.0: a name ("U2") makes the task a speaking test of that exam set; missing or null: a practice task. */
      examSet: z.string().max(200).nullish(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.examSet != null && canonicalExamSet(input.examSet) === null) throw examSetInvalid();
      if (input.modelAudioUrl) await assertAssetExists(input.modelAudioUrl);
      const groupIds = await assertGroupsExist(input.groupIds);
      const task = db.transaction((tx) => {
        const [row] = tx.insert(schema.speakingTasks).values({
          title: input.title,
          instructions: input.instructions?.trim() || null,
          referenceText: input.referenceText?.trim() || null,
          showReference: input.showReference,
          modelAudioUrl: input.modelAudioUrl ?? null,
          targetSeconds: input.targetSeconds ?? null,
          forEveryone: groupIds.length === 0,
          active: input.active,
          createdBy: ctx.user.id,
          examSet: input.examSet == null ? null : exams.resolveExamSet(tx, input.examSet),
        }).returning().all();
        if (groupIds.length > 0) {
          tx.insert(schema.speakingTaskGroups).values(groupIds.map((groupId) => ({ taskId: row.id, groupId }))).run();
        }
        return row;
      });
      logger.info({ event: 'speaking.task_created', taskId: task.id, examSet: task.examSet }, 'Speaking task created');
      return task;
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number().int(),
      title: taskFields.title.optional(),
      instructions: taskFields.instructions,
      referenceText: taskFields.referenceText,
      showReference: taskFields.showReference.optional(),
      modelAudioUrl: taskFields.modelAudioUrl,
      targetSeconds: taskFields.targetSeconds,
      active: taskFields.active.optional(),
      /** Replaces the task's groups; an empty list means every student. */
      groupIds: z.array(z.number().int()).optional(),
      /**
       * v1.21.0: the exam set ("U2", trimmed, in the spelling the set already has); null makes it a
       * practice task again (its recordings stay). Missing: unchanged.
       */
      examSet: z.string().max(200).nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const task = await db.query.speakingTasks.findFirst({ where: eq(schema.speakingTasks.id, input.id) });
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      if (typeof input.examSet === 'string' && canonicalExamSet(input.examSet) === null) throw examSetInvalid();
      if (input.modelAudioUrl) await assertAssetExists(input.modelAudioUrl);
      const groups = input.groupIds === undefined ? undefined : await assertGroupsExist(input.groupIds);

      const data: Partial<typeof schema.speakingTasks.$inferInsert> = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.instructions !== undefined) data.instructions = input.instructions?.trim() || null;
      if (input.referenceText !== undefined) data.referenceText = input.referenceText?.trim() || null;
      if (input.showReference !== undefined) data.showReference = input.showReference;
      if (input.modelAudioUrl !== undefined) data.modelAudioUrl = input.modelAudioUrl ?? null;
      if (input.targetSeconds !== undefined) data.targetSeconds = input.targetSeconds ?? null;
      if (input.active !== undefined) data.active = input.active;
      if (groups !== undefined) data.forEveryone = groups.length === 0;

      const exam = db.transaction((tx) => {
        if (Object.keys(data).length > 0) tx.update(schema.speakingTasks).set(data).where(eq(schema.speakingTasks.id, input.id)).run();
        if (groups !== undefined) {
          tx.delete(schema.speakingTaskGroups).where(eq(schema.speakingTaskGroups.taskId, input.id)).run();
          if (groups.length > 0) tx.insert(schema.speakingTaskGroups).values(groups.map((groupId) => ({ taskId: input.id, groupId }))).run();
        }
        if (input.examSet === undefined) return null;
        // Read and resolved here, so the name joins the set as it is spelled at this moment.
        const now = tx.select({ examSet: schema.speakingTasks.examSet }).from(schema.speakingTasks)
          .where(eq(schema.speakingTasks.id, input.id)).get();
        const next = input.examSet === null ? null : exams.resolveExamSet(tx, input.examSet);
        if (!now || next === now.examSet) return null;
        tx.update(schema.speakingTasks).set({ examSet: next }).where(eq(schema.speakingTasks.id, input.id)).run();
        return { from: now.examSet, to: next };
      });
      if (exam) {
        logger.info({ event: 'speaking.exam_set_changed', taskId: input.id, from: exam.from, to: exam.to }, 'Speaking task exam set changed');
      }
      return { success: true };
    }),

  /** Deletes the task, its submissions, and the students' recordings with them. */
  remove: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      // Read and delete together, so a submission landing in between cannot
      // lose its row to the cascade while its file stays on disk.
      const recordings = db.transaction((tx) => {
        const rows = tx.select({ audioUrl: schema.speakingSubmissions.audioUrl })
          .from(schema.speakingSubmissions)
          .where(eq(schema.speakingSubmissions.taskId, input.id))
          .all();
        tx.delete(schema.speakingTasks).where(eq(schema.speakingTasks.id, input.id)).run();
        return rows;
      });
      await deleteRecordings(recordings.map((r) => r.audioUrl));
      logger.info({ event: 'speaking.task_removed', taskId: input.id, recordings: recordings.length }, 'Speaking task removed');
      return { success: true };
    }),

  adminList: adminProcedure.query(async () => {
    const tasks = await db.query.speakingTasks.findMany();
    const groups = await groupIdsByTask(tasks.map((t) => t.id));
    const subs = await db
      .select({
        taskId: schema.speakingSubmissions.taskId,
        userId: schema.speakingSubmissions.userId,
        submittedAt: schema.speakingSubmissions.submittedAt,
        gradedAt: schema.speakingSubmissions.gradedAt,
      })
      .from(schema.speakingSubmissions)
      .innerJoin(schema.users, eq(schema.speakingSubmissions.userId, schema.users.id))
      .where(ne(schema.users.role, 'admin'))
      // The same order as `submissions`, so "latest" means the row the review shows.
      .orderBy(desc(schema.speakingSubmissions.submittedAt), desc(schema.speakingSubmissions.id));
    return tasks.sort(byTitle).map((t) => {
      const forTask = subs.filter((s) => s.taskId === t.id);
      // Only each student's latest recording waits for a grade: the review
      // hides earlier attempts, so counting them would never reach 0.
      const latest = new Map<number, (typeof forTask)[number]>();
      for (const s of forTask) if (!latest.has(s.userId)) latest.set(s.userId, s);
      return {
        ...t,
        groupIds: groups.get(t.id) ?? [],
        studentCount: latest.size,
        ungraded: [...latest.values()].filter((s) => !s.gradedAt).length,
        lastSubmittedAt: forTask[0]?.submittedAt ?? null,
      };
    });
  }),

  /**
   * Every recording for a task, newest first per student, with its grade and
   * the reference text it was recorded against (the task's may have changed since).
   */
  submissions: adminProcedure
    .input(z.object({ taskId: z.number().int() }))
    .query(async ({ input }) => {
      const task = await db.query.speakingTasks.findFirst({ where: eq(schema.speakingTasks.id, input.taskId) });
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      const rows = await db
        .select({
          id: schema.speakingSubmissions.id,
          userId: schema.users.id,
          studentName: schema.users.name,
          studentEmail: schema.users.email,
          role: schema.users.role,
          audioUrl: schema.speakingSubmissions.audioUrl,
          durationMs: schema.speakingSubmissions.durationMs,
          voicedMs: schema.speakingSubmissions.voicedMs,
          referenceText: schema.speakingSubmissions.referenceText,
          submittedAt: schema.speakingSubmissions.submittedAt,
          gradeScore: schema.speakingSubmissions.gradeScore,
          gradeDetails: schema.speakingSubmissions.gradeDetails,
          gradeFeedback: schema.speakingSubmissions.gradeFeedback,
          gradedBy: schema.speakingSubmissions.gradedBy,
          gradedAt: schema.speakingSubmissions.gradedAt,
          contentSha256: schema.speakingSubmissions.contentSha256,
          flags: schema.speakingSubmissions.flags,
          clientDurationMs: schema.speakingSubmissions.clientDurationMs,
          clientVoicedMs: schema.speakingSubmissions.clientVoicedMs,
          micSettings: schema.speakingSubmissions.micSettings,
        })
        .from(schema.speakingSubmissions)
        .innerJoin(schema.users, eq(schema.speakingSubmissions.userId, schema.users.id))
        .where(eq(schema.speakingSubmissions.taskId, input.taskId))
        .orderBy(schema.users.name, desc(schema.speakingSubmissions.submittedAt), desc(schema.speakingSubmissions.id));
      const attempts = new Map<number, number>();
      for (const r of rows) attempts.set(r.userId, (attempts.get(r.userId) ?? 0) + 1);
      const matches = audioMatches(rows);
      return {
        task: { id: task.id, title: task.title, targetSeconds: task.targetSeconds, referenceText: task.referenceText, modelAudioUrl: task.modelAudioUrl },
        submissions: rows.map(({ role, contentSha256: _sha, flags, micSettings, ...r }) => ({
          ...r,
          isTeacher: role === 'admin',
          attempts: attempts.get(r.userId) ?? 1,
          // The checks made at upload (v1.16.0): none on a take from before them.
          flags: parseSpeakingFlags(flags),
          micSettings: parseMicSettings(micSettings),
          sameFileAs: matches.get(r.id)?.sameFileAs ?? null,
          copiedFrom: matches.get(r.id)?.copiedFrom ?? null,
        })),
      };
    }),

  /** Students this task is for who have not recorded it. */
  missing: adminProcedure
    .input(z.object({ taskId: z.number().int() }))
    .query(async ({ input }) => {
      const task = await db.query.speakingTasks.findFirst({ where: eq(schema.speakingTasks.id, input.taskId) });
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found' });
      const expected = await expectedStudents(task, (await groupIdsByTask([task.id])).get(task.id) ?? []);
      const submitted = new Set((await db.query.speakingSubmissions.findMany({
        where: eq(schema.speakingSubmissions.taskId, task.id),
        columns: { userId: true },
      })).map((s) => s.userId));
      return expected.filter((u) => !submitted.has(u.id)).sort((a, b) => a.name.localeCompare(b.name));
    }),

  /** Records (or clears) a grade: from the teacher's review, or from a grading agent. */
  grade: adminProcedure
    .input(gradeInput)
    .mutation(async ({ input }) => {
      const cleared = input.score === null;
      if (!cleared && !input.gradedBy) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Say who graded it (gradedBy).' });
      }
      if (input.details) {
        try { JSON.parse(input.details); } catch {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Grade details must be JSON' });
        }
      }
      const before = db.select({ gradedBy: schema.speakingSubmissions.gradedBy, gradeDetails: schema.speakingSubmissions.gradeDetails })
        .from(schema.speakingSubmissions)
        .where(eq(schema.speakingSubmissions.id, input.submissionId))
        .get();
      if (!before) throw new TRPCError({ code: 'NOT_FOUND', message: 'Recording not found' });
      // Saving without details keeps the grader's; a teacher releasing an agent's grade keeps its name in them.
      const releasedFrom = !cleared && input.gradedBy === TEACHER_GRADER && before.gradedBy && before.gradedBy !== TEACHER_GRADER
        ? before.gradedBy : null;
      const details = cleared ? null
        : input.details === undefined ? keptDetails(before.gradeDetails, releasedFrom)
          // '' is not JSON; store it as no details.
          : (input.details || null);
      const updated = await db.update(schema.speakingSubmissions)
        .set({
          gradeScore: input.score,
          gradeDetails: details,
          gradeFeedback: cleared ? null : (input.feedback?.trim() || null),
          // Never null with a score: checked above.
          gradedBy: cleared ? null : (input.gradedBy ?? null),
          gradedAt: cleared ? null : new Date(),
        })
        .where(eq(schema.speakingSubmissions.id, input.submissionId))
        .returning({ id: schema.speakingSubmissions.id });
      if (updated.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Recording not found' });
      logger.info({
        event: 'speaking.graded', submissionId: input.submissionId, gradedBy: input.gradedBy ?? null, cleared, releasedFrom,
      }, 'Speaking submission graded');
      return { success: true };
    }),

  /**
   * What a grader needs: each recording with the exact text it should match.
   * Ungraded ones by default; the recording itself is at `audioUrl` (admin only).
   */
  forGrading: adminProcedure
    .input(z.object({
      taskId: z.number().int().optional(),
      includeGraded: z.boolean().default(false),
      limit: z.number().int().min(1).max(500).default(100),
    }).default({ includeGraded: false, limit: 100 }))
    .query(async ({ input }) => {
      const rows = await db
        .select({
          submissionId: schema.speakingSubmissions.id,
          taskId: schema.speakingSubmissions.taskId,
          taskTitle: schema.speakingTasks.title,
          studentName: schema.users.name,
          studentEmail: schema.users.email,
          audioUrl: schema.speakingSubmissions.audioUrl,
          mimeType: schema.speakingSubmissions.mimeType,
          durationMs: schema.speakingSubmissions.durationMs,
          referenceText: schema.speakingSubmissions.referenceText,
          submittedAt: schema.speakingSubmissions.submittedAt,
          gradeScore: schema.speakingSubmissions.gradeScore,
          gradedBy: schema.speakingSubmissions.gradedBy,
        })
        .from(schema.speakingSubmissions)
        .innerJoin(schema.speakingTasks, eq(schema.speakingSubmissions.taskId, schema.speakingTasks.id))
        .innerJoin(schema.users, eq(schema.speakingSubmissions.userId, schema.users.id))
        .where(and(
          input.taskId === undefined ? undefined : eq(schema.speakingSubmissions.taskId, input.taskId),
          input.includeGraded ? undefined : isNull(schema.speakingSubmissions.gradedAt),
          ne(schema.users.role, 'admin'),
        ))
        .orderBy(schema.speakingSubmissions.submittedAt)
        .limit(input.limit);
      return rows;
    }),
});
