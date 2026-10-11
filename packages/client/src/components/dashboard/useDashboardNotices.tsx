// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/**
 * The dashboard's notices, in the order their cards have always shown:
 * vocabulary tests open, tests (v1.21.0: the Tests page's exam sets, their
 * listening forms and speaking tests, never counted with the practice labs or
 * tasks), audio labs, speaking tasks, sign-up sheets (a student's only: the
 * teacher's sheets live under Admin → Sign-ups). Each one shows only once
 * there is something of its kind; each says how many are left to do, which
 * its chip shows when the cards are folded (DashboardNotices).
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { trpc } from '../../api/trpc';
import { useI18n } from '../../i18n';
import { testSets, testsToDo } from '../tests/testSets';
import type { DashboardNotice } from './DashboardNotices';

const CARD = 'block bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-5 border-t-4 hover:shadow-md transition-shadow';

/** A notice's full card: its heading and line, and what pressing it does. */
function NoticeCard({ to, border, heading, status, action, actionClass }: {
  to: string;
  border: string;
  heading: ReactNode;
  status: string;
  action: string;
  actionClass: string;
}) {
  return (
    <Link to={to} className={`${CARD} ${border}`}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-gray-900 dark:text-gray-100">{heading}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{status}</p>
        </div>
        <span className={`${actionClass} font-medium`}>{action} →</span>
      </div>
    </Link>
  );
}

export function useDashboardNotices(isAdmin: boolean): DashboardNotice[] {
  const { t } = useI18n();
  const { data: vocabTests } = trpc.vocab.listOpenTests.useQuery();
  // With the exam labs and the speaking tests, which get the Tests notice: the practice counts leave them out.
  const { data: labItems } = trpc.labs.list.useQuery({ exams: true });
  const labs = labItems?.filter((lab) => !lab.exam);
  const { data: speakingItems } = trpc.speaking.list.useQuery();
  // Falsy, not null: a list cached before v1.21.0 has no examSet.
  const speakingTasks = speakingItems?.filter((task) => !task.examSet);
  const sets = testSets(labItems, speakingItems);
  const { data: signupSheets } = trpc.signups.list.useQuery(undefined, { enabled: !isAdmin });

  const notices: DashboardNotice[] = [];

  if (vocabTests && vocabTests.length > 0) {
    const status = t('{{count}} vocabulary test(s) open for you', { count: vocabTests.length });
    notices.push({
      id: 'vocab',
      to: '/vocabulometro',
      label: 'Vocabulómetro',
      toDo: vocabTests.length,
      status,
      tone: 'red',
      card: (
        <NoticeCard
          to="/vocabulometro"
          border="border-red-800 dark:border-red-500"
          heading={<>Vocabu<span className="text-red-800 dark:text-red-400">lómetro</span></>}
          status={status}
          action={t('Take test')}
          actionClass="text-red-800 dark:text-red-400"
        />
      ),
    });
  }

  if (sets.length > 0) {
    // To do: a set whose listening part is not started (any form of it), and each speaking test not turned in.
    const toDo = testsToDo(sets);
    const status = toDo > 0 ? t('{{count}} test(s) to take', { count: toDo }) : t('Tests started');
    notices.push({
      id: 'tests',
      to: '/tests',
      label: t('Tests'),
      toDo,
      status,
      tone: 'amber',
      card: (
        <NoticeCard
          to="/tests"
          border="border-amber-600 dark:border-amber-400"
          heading={t('Tests')}
          status={status}
          action={toDo > 0 ? t('Start') : t('Open')}
          actionClass="text-amber-800 dark:text-amber-300"
        />
      ),
    });
  }

  if (labs && labs.length > 0) {
    // To do: never turned in, or turned in without counting. A lab waiting for the teacher to check it is not.
    const toDo = labs.filter((lab) => {
      const status = lab.status ?? (lab.submittedAt ? 'done' : 'todo');
      return status === 'todo' || status === 'redo';
    }).length;
    const status = toDo > 0 ? t('{{count}} lab(s) to do', { count: toDo }) : t('All labs turned in');
    notices.push({
      id: 'labs',
      to: '/labs',
      label: t('Audio labs'),
      toDo,
      status,
      tone: 'blue',
      card: (
        <NoticeCard
          to="/labs"
          border="border-blue-600 dark:border-blue-400"
          heading={t('Audio labs')}
          status={status}
          action={toDo > 0 ? t('Start') : t('Open')}
          actionClass="text-blue-600 dark:text-blue-400"
        />
      ),
    });
  }

  if (speakingTasks && speakingTasks.length > 0) {
    const toDo = speakingTasks.filter((task) => !task.submittedAt).length;
    const status = toDo > 0 ? t('{{count}} recording(s) to do', { count: toDo }) : t('All recordings turned in');
    notices.push({
      id: 'speaking',
      to: '/speaking',
      label: t('Speaking'),
      toDo,
      status,
      tone: 'emerald',
      card: (
        <NoticeCard
          to="/speaking"
          border="border-emerald-600 dark:border-emerald-400"
          heading={t('Speaking')}
          status={status}
          action={toDo > 0 ? t('Start') : t('Open')}
          actionClass="text-emerald-700 dark:text-emerald-400"
        />
      ),
    });
  }

  if (!isAdmin && signupSheets && signupSheets.length > 0) {
    const toPick = signupSheets.filter((sheet) => sheet.open && sheet.myDates.length < sheet.picksPerStudent);
    // One sheet: straight to it, the way the teacher's link goes.
    const to = signupSheets.length === 1 ? `/signups?sheet=${signupSheets[0].id}` : '/signups';
    const status = toPick.length > 0
      ? t('Pick your days: {{title}}', { title: toPick.map((sheet) => sheet.title).join(', ') })
      : t('Your days are picked');
    notices.push({
      id: 'signups',
      to,
      label: t('Sign-ups'),
      toDo: toPick.length,
      status,
      tone: 'violet',
      card: (
        <NoticeCard
          to={to}
          border="border-violet-600 dark:border-violet-400"
          heading={t('Sign-ups')}
          status={status}
          action={toPick.length > 0 ? t('Pick days') : t('Open')}
          actionClass="text-violet-700 dark:text-violet-400"
        />
      ),
    });
  }

  return notices;
}
