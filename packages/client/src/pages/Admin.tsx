// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useMatch, useNavigate, useSearchParams } from 'react-router-dom';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../../../server/src/routers/index.ts';
import { useAuth } from '../hooks/useAuth';
import { trpc } from '../api/trpc';
import { TTS_ACCENTS } from '@libresrs/shared';
import AdminDashboard from '../components/AdminDashboard';
import GroupManager from '../components/GroupManager';
import CSVUpload from '../components/CSVUpload';
import UserDetail from '../components/admin/UserDetail';
import PinLoginSettings from '../components/admin/PinLoginSettings';
import { SortHeader, TablePager } from '../components/admin/TablePager';
import { INITIAL_TABLE_VIEW, plainText, useTableView, type TableViewState } from '../components/admin/useTableView';

// Lazy: carries the ~100KB Vocabulómetro word-frequency dataset
const VocabManager = lazy(() => import('../components/VocabManager'));
// Lazy: the audio uploaders and players only matter on the Labs and Speaking tabs
const LabManager = lazy(() => import('../components/labs/LabManager'));
const SpeakingManager = lazy(() => import('../components/speaking/SpeakingManager'));
const SignupManager = lazy(() => import('../components/signups/SignupManager'));
import { getTimezoneOffsetMinutes } from '../utils/time';
import { useI18n } from '../i18n';
import { aiSettingsErrorMessage } from '../utils/aiErrors';
import { usePageTitle } from '../hooks/usePageTitle';
import { useLeaveGuard } from '../hooks/useLeaveGuard';
import { extensionTabs, tabIdsWith, tabsWith } from '../extensions';
import { LOGO_SRC } from '../brand';

const CORE_TABS = ['dashboard', 'groups', 'decks', 'labs', 'speaking', 'signups', 'users', 'access', 'ai', 'vocab'] as const;
/** Core's tabs with each extension's tab after the one it names (the URL's ?tab=, the saved tab and Back/Forward check against it). */
const TABS: readonly string[] = tabIdsWith(CORE_TABS);
type Tab = string;

/**
 * The tab a reload brings back. The tab buttons leave the URL as it is (see the URL-tab
 * effect below), so the URL alone would reopen whichever tab it last named. Kept for this
 * browser tab only (sessionStorage), with the history entry it was shown on (its address
 * and the router's key): a reload, or Back to that entry, shows the tab again; any other
 * visit, even to the same address (the Study page's Admin link), shows the URL's tab.
 */
const TAB_STORAGE_KEY = 'libresrs.admin.tab';

function savedTabFor(url: string, key: string): Tab | null {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(TAB_STORAGE_KEY) ?? 'null') as { tab?: unknown; url?: unknown; key?: unknown } | null;
    if (!saved || saved.url !== url || saved.key !== key || typeof saved.tab !== 'string') return null;
    return TABS.includes(saved.tab) ? (saved.tab as Tab) : null;
  } catch {
    // Storage off (a private window) or a damaged value: the URL decides.
    return null;
  }
}

/** The Dashboard's User Activity search and page as a URL carries them (?q=…&page=…). */
function activityViewFrom(params: URLSearchParams): TableViewState {
  return { search: params.get('q') ?? '', page: Math.max(1, Math.floor(Number(params.get('page'))) || 1) };
}

export default function Admin() {
  const { user, logout } = useAuth();
  const { t } = useI18n();
  usePageTitle('Admin');
  const [searchParams, setSearchParams] = useSearchParams();
  const queryTab = searchParams.get('tab');
  const urlTab = queryTab && TABS.includes(queryTab) ? (queryTab as Tab) : null;
  const location = useLocation();
  const here = location.pathname + location.search;
  // A user's page (/admin/users/:userId) belongs to the tab it was opened from:
  // the Dashboard's User Activity (?from=dashboard), a group (?from=group&group=12)
  // or the Users tab.
  const detailUserId = useMatch('/admin/users/:userId')?.params.userId ?? null;
  const fromParam = searchParams.get('from');
  const detailFrom: Tab = fromParam === 'dashboard' ? 'dashboard' : fromParam === 'group' ? 'groups' : 'users';
  // Read once: the page's first tab (storage is not read again on every render).
  const [initialTab] = useState<Tab>(() => (detailUserId !== null
    ? detailFrom
    : savedTabFor(here, location.key) ?? urlTab ?? 'dashboard'));
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  useEffect(() => {
    // A user's page comes back by its own address.
    if (detailUserId !== null) return;
    try {
      window.sessionStorage.setItem(TAB_STORAGE_KEY, JSON.stringify({ tab: activeTab, url: here, key: location.key }));
    } catch {
      // Storage off: a reload shows the tab the URL names.
    }
  }, [activeTab, here, location.key, detailUserId]);
  /** The deck a link opens on the Decks tab (?tab=decks&deck=5). */
  const deckValue = searchParams.get('deck') ?? '';
  const deckParam = /^\d+$/.test(deckValue) ? Number(deckValue) : null;
  /**
   * Whether the URL opened the Decks tab (a load, or a deck's link): only then is its
   * deck opened. The tab button leaves an older ?deck= behind, and opens no deck.
   */
  const [decksFromUrl, setDecksFromUrl] = useState(initialTab === 'decks' && urlTab === 'decks');
  // Back or Forward onto a user's page shows the tab it came from again.
  useEffect(() => {
    if (detailUserId !== null) setActiveTab(detailFrom);
  }, [detailUserId, detailFrom]);
  /** The tab marked in the bar: a user's page marks the tab it came from, even before the effect above runs. */
  const shownTab: Tab = detailUserId !== null ? detailFrom : activeTab;
  // The Dashboard's User Activity search and page live here, on the page that stays
  // mounted, so a user's page and Back (the link or the browser's) find them as they were.
  // A page loaded on its own (a new tab, a reload) brings them in its URL: a user's page
  // opened from the Dashboard, or the Dashboard its "Back to dashboard" link leads to.
  const [activityView, setActivityView] = useState<TableViewState>(() => (
    // Whenever the URL is the Dashboard's, whichever tab a reload brings back; never another tab's ?q=.
    (detailUserId !== null && detailFrom === 'dashboard') || (detailUserId === null && (urlTab ?? 'dashboard') === 'dashboard')
      ? activityViewFrom(searchParams)
      : INITIAL_TABLE_VIEW
  ));
  const changeActivityView = (view: TableViewState) => {
    setActivityView(view);
    // Once the teacher changes the panel, the search and page a Back link brought are
    // the panel's own: the URL lets them go, so a reload never finds an older search.
    const dashboardUrl = detailUserId === null && (queryTab ?? 'dashboard') === 'dashboard';
    if (dashboardUrl && (searchParams.has('q') || searchParams.has('page'))) {
      const next = new URLSearchParams(searchParams);
      next.delete('q');
      next.delete('page');
      setSearchParams(next, { replace: true });
    }
  };
  // Back from a user's page (its link or the browser's) puts focus on their name in
  // the list it was opened from; Back from a deck opened from a group's Assigned Decks,
  // on the deck's name there. A request, answered once: a later switch of tabs
  // must not pull focus into the table again.
  const [returnFocus, setReturnFocus] = useState<{ tab: Tab; userId?: number; deckId?: number } | null>(null);
  /** The deck last opened from a group's Assigned Decks, which Back from the Decks tab returns to. */
  const openedDeckRef = useRef<number | null>(null);
  const openDetailRef = useRef<{ userId: string; from: Tab } | null>(null);
  /** Set when a tab button leaves a user's page: the teacher is on that button, and focus stays there. */
  const leftByTabRef = useRef(false);
  useEffect(() => {
    const was = openDetailRef.current;
    openDetailRef.current = detailUserId !== null ? { userId: detailUserId, from: detailFrom } : null;
    const byTab = leftByTabRef.current;
    leftByTabRef.current = false;
    if (was && detailUserId === null && !byTab && /^\d+$/.test(was.userId)) {
      setReturnFocus({ tab: was.from, userId: Number(was.userId) });
    }
  }, [detailUserId, detailFrom]);
  const returnFocusTo = (tab: Tab) => (returnFocus?.tab === tab ? returnFocus.userId ?? null : null);
  const returnFocusDeck = returnFocus?.tab === 'groups' ? returnFocus.deckId ?? null : null;
  const returnFocusDone = () => setReturnFocus(null);
  // The Labs and Speaking tabs stay mounted once opened, so an upload keeps
  // going (and its progress stays on screen) when the teacher looks at another tab.
  const [labsOpened, setLabsOpened] = useState(initialTab === 'labs');
  const [labsBusy, setLabsBusy] = useState(false);
  const labsRef = useRef<HTMLDivElement>(null);
  const [speakingOpened, setSpeakingOpened] = useState(initialTab === 'speaking');
  const [speakingBusy, setSpeakingBusy] = useState(false);
  const speakingRef = useRef<HTMLDivElement>(null);
  const busy = labsBusy || speakingBusy;
  // The Decks tab's Conjugation draft: lost when the tab closes or the page is left.
  const [conjugationDirty, setConjugationDirty] = useState(false);
  const dropDraftMessage = t('Leave without saving? Your unsaved Conjugation changes will be lost.');
  // One guard for the page: two guards would each ask on the same Back, and
  // the second would swallow the navigation the first had allowed.
  const { leave } = useLeaveGuard(busy || conjugationDirty, labsBusy
    ? t('Uploads are still running. Leave anyway? The rest of the batch will not be uploaded.')
    : speakingBusy
      ? t('A speaking task is still uploading or saving. Leave anyway? It may not be saved.')
      : dropDraftMessage);
  const navigate = useNavigate();
  // A link to another tab (a deck from a group: ?tab=decks&deck=5), and Back or Forward
  // between two tabs' URLs, show the tab the URL names. Only a change of it counts: the
  // tab buttons leave the URL as it is, so it can name a tab the teacher has since left,
  // and a user's page left for such a URL shows the tab the page came from instead.
  const seenUrlTabRef = useRef<{ tab: string | null; onDetail: boolean }>({ tab: queryTab, onDetail: detailUserId !== null });
  useEffect(() => {
    const seen = seenUrlTabRef.current;
    seenUrlTabRef.current = { tab: queryTab, onDetail: detailUserId !== null };
    if (detailUserId !== null || seen.onDetail || queryTab === seen.tab) return;
    if (!queryTab || !TABS.includes(queryTab)) return;
    // The Decks tab's draft goes with it (the guard has asked already, on Back).
    if (queryTab !== 'decks') setConjugationDirty(false);
    // Back from a deck a group's Assigned Decks opened: focus goes to its name there.
    const deckId = openedDeckRef.current;
    if (queryTab !== 'decks') openedDeckRef.current = null;
    if (queryTab === 'groups' && seen.tab === 'decks' && deckId !== null) setReturnFocus({ tab: 'groups', deckId });
    setDecksFromUrl(queryTab === 'decks');
    setActiveTab(queryTab as Tab);
  }, [queryTab, detailUserId]);
  /** Whether the teacher agrees to lose an unsaved Conjugation draft (true when there is none). */
  const dropDraft = () => !conjugationDirty || window.confirm(dropDraftMessage);
  /** Leaves the page through its own buttons, stepping over the guard's history entry when one stands. */
  const leavePage = (go: () => void | Promise<unknown>) => {
    if (!dropDraft()) return;
    if (conjugationDirty) leave(go);
    else void go();
  };
  useEffect(() => {
    if (activeTab === 'labs') setLabsOpened(true);
    if (activeTab === 'speaking') setSpeakingOpened(true);
    // Hidden, not unmounted: audio left playing would carry on under another tab.
    if (activeTab !== 'labs') labsRef.current?.querySelectorAll('audio').forEach((audio) => audio.pause());
    if (activeTab !== 'speaking') speakingRef.current?.querySelectorAll('audio').forEach((audio) => audio.pause());
  }, [activeTab]);

  const coreTabs: { id: Tab; label: string }[] = [
    { id: 'dashboard', label: t('Dashboard') },
    { id: 'groups', label: t('Groups') },
    { id: 'decks', label: t('Decks') },
    { id: 'labs', label: t('Labs') },
    { id: 'speaking', label: t('Speaking') },
    { id: 'signups', label: t('Sign-ups') },
    { id: 'users', label: t('Users') },
    { id: 'access', label: t('Access') },
    { id: 'ai', label: t('AI') },
    { id: 'vocab', label: t('Vocabulómetro') },
  ];
  const tabs = tabsWith(coreTabs, t);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow-sm dark:shadow-gray-900/20">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-4">
            {/* Hidden while an upload runs: leaving the admin page would strand it. */}
            {!busy && (
              <Link
                to="/"
                className="text-blue-600 dark:text-blue-400 hover:text-blue-800"
                onClick={(e) => {
                  // A new-tab click keeps this page, and its draft, open.
                  if (!conjugationDirty || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                  e.preventDefault();
                  leavePage(() => navigate('/'));
                }}
              >
                ← {t('Back to Study')}
              </Link>
            )}
            <div className="flex items-center gap-2">
              {/* Decorative: the heading beside it says the name. */}
              <img src={LOGO_SRC} alt="" className="h-8 w-8 shrink-0" />
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                <span className="text-gray-500 dark:text-gray-400 font-normal">libreSRS</span> {t('Admin')}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {user?.picture && (
                <img
                  src={user.picture}
                  alt={user.name}
                  className="w-8 h-8 rounded-full"
                />
              )}
              <span className="text-gray-700 dark:text-gray-300">{user?.name}</span>
            </div>
            {!busy && (
              <button
                onClick={() => {
                  // Rejects when the sign-out is refused: the teacher stays, and Back asks again.
                  leavePage(logout);
                }}
                className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
              >
                {t('Sign out')}
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="border-b border-gray-200 dark:border-gray-700 mt-4">
          {/* The tabs are wider than a phone: the row scrolls on its own, or the whole page would slide sideways
              (and Android Chrome would widen the layout, pushing the fixed buttons off screen). */}
          <nav className="-mb-px flex space-x-8 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  // Only the Decks tab holds a draft, and closing it unmounts the draft.
                  if (tab.id !== activeTab && !dropDraft()) return;
                  if (tab.id !== activeTab) setConjugationDirty(false);
                  // From a user's page, a tab (the one it came from too) leaves it for the tab's own page:
                  // for the group the page was opened from, that group's (the Groups tab still shows it).
                  if (detailUserId !== null) {
                    leftByTabRef.current = true;
                    const group = searchParams.get('group') ?? '';
                    navigate(tab.id === 'groups' && detailFrom === 'groups' && /^\d+$/.test(group)
                      ? `/admin?tab=groups&group=${group}`
                      : `/admin?tab=${tab.id}`);
                  }
                  // Focus stays on this button: a name still waiting for it (its list loading) gives up.
                  setReturnFocus(null);
                  openedDeckRef.current = null;
                  setDecksFromUrl(false);
                  setActiveTab(tab.id);
                }}
                aria-current={shownTab === tab.id ? 'page' : undefined}
                className={`shrink-0 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${
                  shownTab === tab.id
                    ? 'border-blue-500 dark:border-blue-400 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main id="main-content" className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {shownTab === 'dashboard' && detailUserId === null && (
          <AdminDashboard
            activityView={activityView}
            onActivityViewChange={changeActivityView}
            returnFocusUserId={returnFocusTo('dashboard')}
            onReturnFocusDone={returnFocusDone}
          />
        )}
        {/* Kept (hidden) under a student's page opened from a group, so Back finds the group as the teacher left it. */}
        {shownTab === 'groups' && (
          <div hidden={detailUserId !== null}>
            <GroupManager
              returnFocusUserId={returnFocusTo('groups')}
              returnFocusDeckId={returnFocusDeck}
              onReturnFocusDone={returnFocusDone}
              onOpenDeck={(deckId) => { openedDeckRef.current = deckId; }}
            />
          </div>
        )}
        {shownTab === 'decks' && <CSVUpload initialDeckId={decksFromUrl ? deckParam : null} onConjugationDirtyChange={setConjugationDirty} />}
        {labsOpened && (
          <div hidden={shownTab !== 'labs'} ref={labsRef}>
            <Suspense fallback={<div className="animate-pulse">{t('Loading...')}</div>}>
              <LabManager onBusyChange={setLabsBusy} />
            </Suspense>
          </div>
        )}
        {speakingOpened && (
          <div hidden={shownTab !== 'speaking'} ref={speakingRef}>
            <Suspense fallback={<div className="animate-pulse">{t('Loading...')}</div>}>
              <SpeakingManager onBusyChange={setSpeakingBusy} />
            </Suspense>
          </div>
        )}
        {shownTab === 'signups' && (
          <Suspense fallback={<div className="animate-pulse">{t('Loading...')}</div>}>
            <SignupManager />
          </Suspense>
        )}
        {/* Extensions' tabs (each its own lazy chunk), after Sign-ups as their tab buttons are. */}
        {extensionTabs.map((tab) => shownTab === tab.id && (
          <Suspense key={tab.id} fallback={<div className="animate-pulse">{t('Loading...')}</div>}>
            <tab.Component />
          </Suspense>
        ))}
        {/* The Users tab, and a user's page (from either tab: it keeps the Users tab's actions). */}
        {(shownTab === 'users' || detailUserId !== null) && (
          <UserManager returnFocusUserId={returnFocusTo('users')} onReturnFocusDone={returnFocusDone} />
        )}
        {shownTab === 'access' && <AccessManager />}
        {shownTab === 'ai' && <AiConfigManager />}
        {shownTab === 'vocab' && (
          <Suspense fallback={<div className="animate-pulse">{t('Loading...')}</div>}>
            <VocabManager />
          </Suspense>
        )}
      </main>
    </div>
  );
}

/** The Users tab's sortable columns, as they appear in the URL (?sort=…&dir=…). */
const USER_SORTS = ['name', 'role', 'today', 'joined', 'active'] as const;
type UserSort = typeof USER_SORTS[number];
type SortDir = 'asc' | 'desc';
/** The way a column sorts first: names A to Z, numbers and dates biggest or newest first. */
const FIRST_DIR: Record<UserSort, SortDir> = { name: 'asc', role: 'asc', today: 'desc', joined: 'desc', active: 'desc' };
/** Newest first, as the list has always been. */
const DEFAULT_SORT: UserSort = 'joined';

/** Where this device remembers the Users tab's page size (its search and sort are in the URL). */
const USERS_STORAGE_KEY = 'libresrs.admin.users';

/** What the search box matches: name, email or school ID (no accents, no case: "lopez" finds "López"). */
function userMatches(user: { name: string; email: string; studentNumber?: string | null }, query: string): boolean {
  const needle = plainText(query.trim());
  if (!needle) return true;
  return plainText(user.name).includes(needle)
    || plainText(user.email).includes(needle)
    || plainText(user.studentNumber ?? '').includes(needle);
}

/** No list state: what the Users tab reads from a URL that belongs to the Dashboard. */
const NO_PARAMS = new URLSearchParams();

function UserManager({ returnFocusUserId = null, onReturnFocusDone }: {
  /** A user whose page the teacher just came back from: their name takes focus, once. */
  returnFocusUserId?: number | null;
  onReturnFocusDone?: () => void;
}) {
  const { t, formatDate } = useI18n();
  const utils = trpc.useUtils();
  const { data: users, refetch } = trpc.admin.getUsers.useQuery();
  const { data: allUserSettings, refetch: refetchSettings } = trpc.admin.getAllUserSettings.useQuery({
    timezoneOffsetMinutes: getTimezoneOffsetMinutes(),
  });
  const detailParam = useMatch('/admin/users/:userId')?.params.userId;
  const detailUserId = detailParam && /^\d+$/.test(detailParam) ? Number(detailParam) : null;
  const [searchParams, setSearchParams] = useSearchParams();
  // A URL of the Dashboard's (?tab=dashboard&q=…, or a user's page opened from it) holds the
  // Dashboard's search, and one of the Groups tab's names a group: this list takes neither
  // (the tab bar leaves the URL as it is).
  const urlTab = searchParams.get('tab');
  const urlFrom = searchParams.get('from');
  const otherTabsUrl = urlTab === 'dashboard' || urlTab === 'groups' || urlFrom === 'dashboard' || urlFrom === 'group';
  const listParams = otherTabsUrl ? NO_PARAMS : searchParams;
  const query = listParams.get('q') ?? '';
  // The box keeps its own text: the URL follows it, but React Router updates the URL in a
  // transition, and a text box shown from it would drop keys and jump the cursor to the end.
  const [searchText, setSearchText] = useState(query);
  /** Values this page wrote to ?q= that the URL has not caught up with yet. */
  const writtenQueriesRef = useRef<string[]>([]);
  useEffect(() => {
    const written = writtenQueriesRef.current.indexOf(query);
    if (written >= 0) {
      writtenQueriesRef.current = writtenQueriesRef.current.slice(written + 1);
      return;
    }
    // Changed from outside (Back, or the "Back to users" link): show what the URL holds.
    writtenQueriesRef.current = [];
    setSearchText(query);
  }, [query]);
  const sortParam = listParams.get('sort');
  const sortKey: UserSort = (USER_SORTS as readonly string[]).includes(sortParam ?? '') ? (sortParam as UserSort) : DEFAULT_SORT;
  const dirParam = listParams.get('dir');
  const sortDir: SortDir = dirParam === 'asc' || dirParam === 'desc' ? dirParam : FIRST_DIR[sortKey];
  // The list as the URL asks for it (search and sort), then a page of it.
  type UserRow = NonNullable<typeof users>[number];
  const settingsById = new Map((allUserSettings ?? []).map((s) => [s.userId, s]));
  const studiedToday = (userId: number) => {
    const s = settingsById.get(userId);
    // An older server sends no total: the most in one deck is the next best thing.
    return s ? (s.studiedToday ?? s.newCardsDoneToday + s.reviewsDoneToday) : -1;
  };
  const time = (value: Date | string | number | null | undefined) => (value == null ? null : new Date(value).getTime());
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const compare: Record<UserSort, (a: UserRow, b: UserRow) => number> = {
    name: byName,
    role: (a, b) => a.role.localeCompare(b.role),
    today: (a, b) => studiedToday(a.id) - studiedToday(b.id),
    joined: (a, b) => (time(a.createdAt) ?? 0) - (time(b.createdAt) ?? 0),
    active: (a, b) => (time(a.lastActiveAt) ?? 0) - (time(b.lastActiveAt) ?? 0),
  };
  const shown = (users ?? [])
    .filter((user) => userMatches(user, query))
    .sort((a, b) => {
      // Never active sorts last either way; ties go by name.
      if (sortKey === 'active' && (a.lastActiveAt == null) !== (b.lastActiveAt == null)) return a.lastActiveAt == null ? 1 : -1;
      const order = compare[sortKey](a, b);
      return (sortDir === 'asc' ? order : -order) || byName(a, b);
    });
  const pager = useTableView<UserRow>({ storageKey: USERS_STORAGE_KEY, rows: shown });
  /** Writes the list's state into the URL (replacing the entry: typing is not history). */
  const setListParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(listParams);
    next.set('tab', 'users');
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key); else next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  };
  const sortBy = (key: UserSort) => {
    const dir = key === sortKey ? (sortDir === 'asc' ? 'desc' : 'asc') : FIRST_DIR[key];
    setListParams({ sort: key, dir });
    pager.setPage(1);
  };
  // Back from a user's page puts focus on their name in the list, once. The page that
  // holds them is shown first: a user's page reloaded, or opened in a new tab, comes
  // back to the first page (the page number is not in the URL).
  const usersLoaded = !!users;
  const focusPage = returnFocusUserId === null ? null : pager.pageOf((user) => user.id === returnFocusUserId);
  const shownPage = pager.page;
  useEffect(() => {
    if (detailUserId !== null || !usersLoaded || returnFocusUserId === null) return;
    if (focusPage !== null && focusPage !== shownPage) {
      pager.setPage(focusPage);
      return;
    }
    document.getElementById(`user-link-${returnFocusUserId}`)?.focus();
    onReturnFocusDone?.();
    // Primitives only: the pager and the callback are new on every render.
  }, [detailUserId, usersLoaded, returnFocusUserId, focusPage, shownPage]);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [viewingHistoryUserId, setViewingHistoryUserId] = useState<number | null>(null);
  const settingsModalRef = useRef<HTMLDivElement>(null);
  const [editingSettings, setEditingSettings] = useState<{
    newCardsPerDay: number;
    reviewsPerDay: number;
    isOverride: boolean;
    allowHigher: boolean;
    allowLower: boolean;
    aiEnabled: boolean;
    aiEnabledLocked: boolean;
    autoPlayAudio: boolean;
    autoPlayAudioLocked: boolean;
    autoPlayAudioFront: boolean;
    autoPlayAudioFrontLocked: boolean;
    mnemonicMode: 'manual' | 'disabled';
    mnemonicModeLocked: boolean;
    locale: string | null;
    localeLocked: boolean;
  } | null>(null);

  const updateRole = trpc.admin.updateUserRole.useMutation({
    onSuccess: () => {
      refetch();
      void utils.admin.userDetail.invalidate();
    },
  });

  const updateUserSettings = trpc.admin.updateUserSettings.useMutation({
    onSuccess: () => {
      refetchSettings();
      void utils.admin.userDetail.invalidate();
      setSelectedUserId(null);
      setEditingSettings(null);
    },
  });

  // Focus management: auto-focus modal on open
  useEffect(() => {
    if (selectedUserId && editingSettings) {
      settingsModalRef.current?.focus();
    }
  }, [selectedUserId, editingSettings]);

  const getUserSettings = (userId: number) => {
    return allUserSettings?.find(s => s.userId === userId);
  };

  const handleEditSettings = (userId: number) => {
    const settings = getUserSettings(userId);
    if (settings) {
      setSelectedUserId(userId);
      setEditingSettings({
        newCardsPerDay: settings.newCardsPerDay,
        reviewsPerDay: settings.reviewsPerDay,
        isOverride: settings.isOverride,
        allowHigher: settings.allowHigher,
        allowLower: settings.allowLower,
        aiEnabled: settings.aiEnabled,
        aiEnabledLocked: settings.aiEnabledLocked,
        autoPlayAudio: settings.autoPlayAudio,
        autoPlayAudioLocked: settings.autoPlayAudioLocked,
        autoPlayAudioFront: settings.autoPlayAudioFront,
        autoPlayAudioFrontLocked: settings.autoPlayAudioFrontLocked,
        mnemonicMode: settings.mnemonicMode,
        mnemonicModeLocked: settings.mnemonicModeLocked,
        locale: settings.locale,
        localeLocked: settings.localeLocked,
      });
    }
  };

  const handleSaveSettings = () => {
    if (selectedUserId && editingSettings) {
      updateUserSettings.mutate({
        userId: selectedUserId,
        newCardsPerDay: editingSettings.newCardsPerDay,
        reviewsPerDay: editingSettings.reviewsPerDay,
        isOverride: editingSettings.isOverride,
        allowHigher: editingSettings.allowHigher,
        allowLower: editingSettings.allowLower,
        aiEnabled: editingSettings.aiEnabled,
        aiEnabledLocked: editingSettings.aiEnabledLocked,
        autoPlayAudio: editingSettings.autoPlayAudio,
        autoPlayAudioLocked: editingSettings.autoPlayAudioLocked,
        autoPlayAudioFront: editingSettings.autoPlayAudioFront,
        autoPlayAudioFrontLocked: editingSettings.autoPlayAudioFrontLocked,
        mnemonicMode: editingSettings.mnemonicMode,
        mnemonicModeLocked: editingSettings.mnemonicModeLocked,
        locale: editingSettings.locale,
        localeLocked: editingSettings.localeLocked,
      });
    }
  };

  const handleRoleToggle = (target: { id: number; name: string; role: 'admin' | 'user' }) => {
    const nextRole = target.role === 'admin' ? 'user' : 'admin';
    const confirmationMessage = nextRole === 'admin'
      ? t('Are you sure you want to promote {{name}} to admin?', { name: target.name })
      : t('Are you sure you want to demote {{name}} to user?', { name: target.name });

    if (!window.confirm(confirmationMessage)) {
      return;
    }

    updateRole.mutate({
      userId: target.id,
      role: nextRole,
    });
  };

  const modals = (
    <>
      {/* Settings Edit Modal */}
      {selectedUserId && editingSettings && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="user-settings-title">
          <div ref={settingsModalRef} tabIndex={-1} className="bg-white dark:bg-gray-800 rounded-lg shadow-xl dark:shadow-gray-900/30 p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto focus:outline-none">
            <h2 id="user-settings-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
              {t('Edit Settings for {{name}}', { name: users?.find(u => u.id === selectedUserId)?.name ?? '' })}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
              {t('Lock a setting to prevent the user from changing it.')}
            </p>
            <div className="space-y-5">

              {/* Study Limits */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{t('Study Limits')}</p>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="user-settings-new-cards" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('New Cards per Day')}
                    </label>
                    <input
                      id="user-settings-new-cards"
                      type="number"
                      min={0}
                      max={500}
                      value={editingSettings.newCardsPerDay}
                      onChange={(e) => setEditingSettings({
                        ...editingSettings,
                        newCardsPerDay: parseInt(e.target.value || '0', 10),
                      })}
                      className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label htmlFor="user-settings-reviews" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('Reviews per Day')}
                    </label>
                    <input
                      id="user-settings-reviews"
                      type="number"
                      min={0}
                      max={500}
                      value={editingSettings.reviewsPerDay}
                      onChange={(e) => setEditingSettings({
                        ...editingSettings,
                        reviewsPerDay: parseInt(e.target.value || '0', 10),
                      })}
                      className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingSettings.isOverride}
                      onChange={(e) => setEditingSettings({ ...editingSettings, isOverride: e.target.checked })}
                      className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t('Enforce these limits (override user settings)')}
                    </span>
                  </label>
                  {editingSettings.isOverride && (
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 space-y-2 ml-6">
                      <p className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('Allow user to adjust:')}</p>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editingSettings.allowHigher}
                          onChange={(e) => setEditingSettings({ ...editingSettings, allowHigher: e.target.checked })}
                          className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-600 dark:text-gray-400">{t('Allow higher limits')}</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editingSettings.allowLower}
                          onChange={(e) => setEditingSettings({ ...editingSettings, allowLower: e.target.checked })}
                          className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-600 dark:text-gray-400">{t('Allow lower limits')}</span>
                      </label>
                    </div>
                  )}
                </div>
              </div>

              {/* AI & Audio Settings */}
              <div className="border-t dark:border-gray-700 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{t('AI & Audio')}</p>
                <div className="space-y-3">
                  <AdminSettingRow
                    label={t('AI Features')}
                    locked={editingSettings.aiEnabledLocked}
                    onLockChange={(v) => setEditingSettings({ ...editingSettings, aiEnabledLocked: v })}
                  >
                    <AdminToggle
                      label={t('AI Features')}
                      checked={editingSettings.aiEnabled}
                      onChange={(v) => setEditingSettings({ ...editingSettings, aiEnabled: v })}
                    />
                  </AdminSettingRow>
                  <AdminSettingRow
                    label={t('Auto-play answer audio')}
                    locked={editingSettings.autoPlayAudioLocked}
                    onLockChange={(v) => setEditingSettings({ ...editingSettings, autoPlayAudioLocked: v })}
                  >
                    <AdminToggle
                      label={t('Auto-play answer audio')}
                      checked={editingSettings.autoPlayAudio}
                      onChange={(v) => setEditingSettings({ ...editingSettings, autoPlayAudio: v })}
                    />
                  </AdminSettingRow>
                  <AdminSettingRow
                    label={t('Auto-play question audio')}
                    locked={editingSettings.autoPlayAudioFrontLocked}
                    onLockChange={(v) => setEditingSettings({ ...editingSettings, autoPlayAudioFrontLocked: v })}
                  >
                    <AdminToggle
                      label={t('Auto-play question audio')}
                      checked={editingSettings.autoPlayAudioFront}
                      onChange={(v) => setEditingSettings({ ...editingSettings, autoPlayAudioFront: v })}
                    />
                  </AdminSettingRow>
                  <AdminSettingRow
                    label={t('Mnemonic generation')}
                    locked={editingSettings.mnemonicModeLocked}
                    onLockChange={(v) => setEditingSettings({ ...editingSettings, mnemonicModeLocked: v })}
                  >
                    <select
                      aria-label={t('Mnemonic generation')}
                      value={editingSettings.mnemonicMode}
                      onChange={(e) => setEditingSettings({ ...editingSettings, mnemonicMode: e.target.value === 'disabled' ? 'disabled' : 'manual' })}
                      className="rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="manual">{t('Manual only')}</option>
                      <option value="disabled">{t('Disabled')}</option>
                    </select>
                  </AdminSettingRow>
                </div>
              </div>

              {/* Language */}
              <div className="border-t dark:border-gray-700 pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{t('Language')}</p>
                <AdminSettingRow
                  label={t('Interface language')}
                  locked={editingSettings.localeLocked}
                  onLockChange={(v) => setEditingSettings({ ...editingSettings, localeLocked: v })}
                >
                  <input
                    type="text"
                    value={editingSettings.locale ?? ''}
                    onChange={(e) => setEditingSettings({ ...editingSettings, locale: e.target.value || null })}
                    placeholder="en, es, zh, ..."
                    className="w-24 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </AdminSettingRow>
              </div>

            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleSaveSettings}
                disabled={updateUserSettings.isPending}
                className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {updateUserSettings.isPending ? t('Saving...') : t('Save')}
              </button>
              <button
                onClick={() => {
                  setSelectedUserId(null);
                  setEditingSettings(null);
                }}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
              >
                {t('Cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review History Modal */}
      {viewingHistoryUserId && (
        <UserReviewHistoryModal
          userId={viewingHistoryUserId}
          userName={users?.find(u => u.id === viewingHistoryUserId)?.name ?? ''}
          onClose={() => setViewingHistoryUserId(null)}
        />
      )}

    </>
  );

  // A user's page does not wait for the list: it loads its own data (and from the
  // Dashboard, the list was never asked for). Only the list's modals need it.
  if (detailUserId !== null) {
    return (
      <div className="space-y-6">
        {modals}
        <UserDetail
          userId={detailUserId}
          onShowHistory={setViewingHistoryUserId}
          onEditSettings={handleEditSettings}
          onToggleRole={handleRoleToggle}
        />
      </div>
    );
  }

  if (!users) {
    return <div className="animate-pulse">{t('Loading users...')}</div>;
  }

  /** The query string a user's page keeps, so Back returns to this list as it is. */
  const listQuery = (() => {
    const params = new URLSearchParams(listParams);
    params.delete('tab');
    const text = params.toString();
    return text ? `?${text}` : '';
  })();
  const sortHeader = (key: UserSort, label: string, className = '') => (
    <SortHeader label={label} sort={sortKey === key ? sortDir : null} onSort={() => sortBy(key)} className={className} />
  );

  return (
    <div className="space-y-6">
      {modals}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full sm:w-80">
          <label htmlFor="user-search" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('Search users')}
          </label>
          <input
            id="user-search"
            type="search"
            value={searchText}
            onChange={(e) => {
              const text = e.target.value;
              setSearchText(text);
              writtenQueriesRef.current.push(text);
              setListParams({ q: text });
              pager.setPage(1);
            }}
            placeholder={t('Name, email or school ID')}
            className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400" aria-live="polite">
          {t('{{count}} of {{total}} users', { count: shown.length, total: users.length })}
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                {sortHeader('name', t('User'))}
                {sortHeader('role', t('Role'))}
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {t('Study Limits')}
                </th>
                {sortHeader('today', t("Today's Progress"), 'hidden lg:table-cell')}
                {sortHeader('active', t('Last Active'), 'hidden md:table-cell')}
                {sortHeader('joined', t('Joined'), 'hidden lg:table-cell')}
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  {t('Actions')}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">{t('No matching users.')}</td>
                </tr>
              )}
              {pager.rows.map((user) => {
                const settings = getUserSettings(user.id);
                return (
                  <tr key={user.id}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center">
                        {user.picture && (
                          <img
                            src={user.picture}
                            alt=""
                            className="w-8 h-8 rounded-full mr-3 flex-shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <Link
                            id={`user-link-${user.id}`}
                            to={`/admin/users/${user.id}${listQuery}`}
                            className="font-medium text-blue-700 dark:text-blue-300 hover:underline block truncate max-w-[140px] md:max-w-[200px]"
                          >
                            {user.name}
                          </Link>
                          <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[140px] md:max-w-[200px]">{user.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded-full ${
                          user.role === 'admin'
                            ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                        }`}
                      >
                        {user.role === 'admin' ? t('Admin') : t('Student')}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {settings ? (
                        <div className="text-sm">
                          <div className="text-gray-900 dark:text-gray-100">
                            {t('{{newLimit}} new / {{reviewLimit}} reviews', {
                              newLimit: settings.newCardsPerDay,
                              reviewLimit: settings.reviewsPerDay,
                            })}
                          </div>
                          {settings.isOverride && (
                            <div className="text-xs mt-1 flex flex-wrap gap-0.5">
                              <span className="bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 px-1.5 py-0.5 rounded">
                                {t('Override')}
                              </span>
                              {settings.allowHigher && (
                                <span className="text-gray-500 dark:text-gray-400" title={t('User can set higher')}>+</span>
                              )}
                              {settings.allowLower && (
                                <span className="text-gray-500 dark:text-gray-400" title={t('User can set lower')}>-</span>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400 text-sm">{t('Loading...')}</span>
                      )}
                    </td>
                    <td className="hidden lg:table-cell px-4 py-3 whitespace-nowrap">
                      {settings ? (
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {t('{{newDone}}/{{newLimit}} new, {{reviewDone}}/{{reviewLimit}} reviews', {
                            newDone: settings.newCardsDoneToday,
                            newLimit: settings.newCardsPerDay,
                            reviewDone: settings.reviewsDoneToday,
                            reviewLimit: settings.reviewsPerDay,
                          })}
                          {/* The counts are the most in one deck: the limits are per deck. */}
                          {(settings.decksToday ?? 0) > 1 && (
                            <span title={t('The most in any one deck. Limits are per deck.')}>
                              {' · '}{t('in {{count}} deck(s)', { count: settings.decksToday })}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400 text-sm">-</span>
                      )}
                    </td>
                    <td className="hidden md:table-cell px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400 text-sm">
                      {user.lastActiveAt != null ? formatDate(user.lastActiveAt) : t('Never')}
                    </td>
                    <td className="hidden lg:table-cell px-4 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400 text-sm">
                      {formatDate(user.createdAt)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => setViewingHistoryUserId(user.id)}
                          className="text-green-700 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300 text-sm"
                          title={t('View review history')}
                        >
                          {t('History')}
                        </button>
                        <button
                          onClick={() => handleEditSettings(user.id)}
                          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-sm"
                          title={t('Edit user settings')}
                        >
                          {t('Settings')}
                        </button>
                        <button
                          onClick={() => handleRoleToggle(user)}
                          className="text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200 text-sm"
                        >
                          {user.role === 'admin' ? t('Demote') : t('Promote')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* The count above is announced as the search changes it; the range, as Next and Previous do. */}
        <TablePager view={pager} announce className="border-t border-gray-200 dark:border-gray-700" />
      </div>
    </div>
  );
}

function AccessManager() {
  const { t } = useI18n();
  const { data: allowedEmails, refetch } = trpc.admin.getAllowedEmails.useQuery();
  const [newPattern, setNewPattern] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [testEmail, setTestEmail] = useState('');

  const addMutation = trpc.admin.addAllowedEmail.useMutation({
    onSuccess: () => {
      refetch();
      setNewPattern('');
      setIsRegex(false);
    },
  });

  const deleteMutation = trpc.admin.deleteAllowedEmail.useMutation({
    onSuccess: () => refetch(),
  });

  const { data: testResult } = trpc.admin.testEmailPattern.useQuery(
    { pattern: newPattern, isRegex, testEmail },
    { enabled: newPattern.length > 0 && testEmail.length > 0 && testEmail.includes('@') }
  );

  const handleAdd = () => {
    if (!newPattern.trim()) return;
    addMutation.mutate({ pattern: newPattern.trim(), isRegex });
  };

  return (
    <div className="space-y-6">
      <PinLoginSettings />
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{t('Add Allowed Email')}</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {t('Add email addresses or patterns to allow users to sign in. Only users whose email matches an entry here (or who already exist) can access the application.')}
        </p>

        <div className="space-y-4">
          <div>
            <label htmlFor="access-email-pattern" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('Email or Pattern')}
            </label>
            <input
              id="access-email-pattern"
              type="text"
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              placeholder={isRegex ? ".*@company\\.com$" : "user@example.com"}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isRegex}
              onChange={(e) => setIsRegex(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {t('Use as regular expression (for matching multiple emails)')}
            </span>
          </label>

          {isRegex && (
            <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-3 text-sm text-blue-800 dark:text-blue-300">
              <p className="font-medium mb-1">{t('Regex Examples:')}</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li><code>.*@company\.com$</code> - {t('All @company.com emails')}</li>
                <li><code>.*@(company|partner)\.com$</code> - {t('Multiple domains')}</li>
                <li><code>^(alice|bob)@.*$</code> - {t('Specific usernames at any domain')}</li>
              </ul>
            </div>
          )}

          {newPattern && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('Test Email (optional)')}
              </label>
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="test@example.com"
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {testResult && (
                <p className={`mt-1 text-sm ${testResult.matches ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  {testResult.matches ? t('✓ Pattern matches this email') : t('✗ Pattern does not match')}
                  {'error' in testResult && testResult.error && ` (${testResult.error})`}
                </p>
              )}
            </div>
          )}

          <button
            onClick={handleAdd}
            disabled={!newPattern.trim() || addMutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {addMutation.isPending ? t('Adding...') : t('Add Email/Pattern')}
          </button>

          {addMutation.error && (
            <p className="text-sm text-red-600 dark:text-red-400">{addMutation.error.message}</p>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">{t('Allowed Emails & Patterns')}</h2>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {allowedEmails?.map((entry) => (
            <div key={entry.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <code className="text-sm bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">{entry.pattern}</code>
                {entry.isRegex && (
                  <span className="ml-2 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded">
                    {t('Regex')}
                  </span>
                )}
              </div>
              <button
                onClick={() => deleteMutation.mutate({ id: entry.id })}
                disabled={deleteMutation.isPending}
                className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-sm"
              >
                {t('Remove')}
              </button>
            </div>
          ))}
          {(!allowedEmails || allowedEmails.length === 0) && (
            <div className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
              {t('No email patterns configured. Add patterns above to control who can sign in.')}
            </div>
          )}
        </div>
      </div>

      <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
        <h3 className="font-medium text-yellow-800 dark:text-yellow-300 mb-2">{t('Note')}</h3>
        <ul className="text-sm text-yellow-700 dark:text-yellow-400 space-y-1">
          <li>• {t('The first sign-in must match ADMIN_EMAIL')}</li>
          <li>• {t('Users set in ADMIN_EMAIL environment variable are always allowed')}</li>
          <li>• {t('Existing users can always sign in regardless of patterns')}</li>
        </ul>
      </div>
    </div>
  );
}

/** What ai.testAnthropicKey answers: every model answered, or the first refusal and why. */
type AnthropicKeyTest = inferRouterOutputs<AppRouter>['ai']['testAnthropicKey'];

/** The paused banner names providers as the teacher knows them (not translated: they are names). */
const AI_PROVIDER_NAMES: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic (Claude)', elevenlabs: 'ElevenLabs' };

function AiConfigManager() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const configQuery = trpc.ai.getAdminConfig.useQuery();
  const allScansQuery = trpc.ai.getAllScanProgress.useQuery(undefined, {
    refetchInterval: (q) => {
      const active = q.state.data?.some(s => s.progress.status === 'scanning');
      return active ? 2000 : 10000;
    },
  });

  const [aiEnabled, setAiEnabled] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyChanged, setApiKeyChanged] = useState(false);
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [pronunciation, setPronunciation] = useState(true);
  const [image, setImage] = useState(true);
  const [mnemonic, setMnemonic] = useState(true);
  // The "repeat the sentence" test's transcription: its own switch, off on a new install.
  const [transcription, setTranscription] = useState(false);
  const [mnemonicModel, setMnemonicModel] = useState('gpt-5.2');
  const [imageModel, setImageModel] = useState('gpt-image-1.5');
  const [imageQuality, setImageQuality] = useState('low');
  const [ttsModel, setTtsModel] = useState('gpt-4o-mini-tts-2025-12-15');
  const [ttsCustom, setTtsCustom] = useState(false);
  const [ttsProvider, setTtsProvider] = useState<'openai' | 'elevenlabs'>('openai');
  const [elevenLabsKey, setElevenLabsKey] = useState('');
  const [elevenLabsKeyChanged, setElevenLabsKeyChanged] = useState(false);
  // Who writes mnemonic suggestions. The Claude model is a column of its own, so a switch never
  // overwrites the OpenAI one; images, speech and transcription never move.
  const [textProvider, setTextProvider] = useState<'openai' | 'anthropic'>('openai');
  // The Anthropic key as typed. An empty (or blank) field keeps the saved key; only “Remove key”
  // removes it, and “Keep saved key” takes that back.
  const [anthropicKey, setAnthropicKey] = useState('');
  const [anthropicKeyRemoved, setAnthropicKeyRemoved] = useState(false);
  const [anthropicMnemonicModel, setAnthropicMnemonicModel] = useState('claude-opus-5-5');
  // A test with the saved key passed, which closes the server's 'anthropic' breaker. The paused
  // list is from the last load: drop Claude from it here rather than refetch, because a changed
  // config re-runs the load effect below and that would wipe unsaved edits.
  const [anthropicResumed, setAnthropicResumed] = useState(false);
  // "Resume now": the pause each provider was resumed from (its `since`), so that pause drops out
  // of the banner without a refetch (which would wipe unsaved edits), while a newer pause shows.
  const [resumedFrom, setResumedFrom] = useState<Record<string, number>>({});
  const [resumeNote, setResumeNote] = useState<{ ok: boolean; provider: string } | null>(null);
  const [voiceMap, setVoiceMap] = useState<Record<string, string>>({});
  const [modelSettingsExpanded, setModelSettingsExpanded] = useState(false);
  const resumeMutation = trpc.ai.resumeProvider.useMutation({
    onSuccess: (_result, variables) => setResumeNote({ ok: true, provider: variables.provider }),
    onError: (_error, variables) => setResumeNote({ ok: false, provider: variables.provider }),
  });
  const resumeProvider = (provider: 'openai' | 'anthropic' | 'elevenlabs', since: string | number | Date) => {
    setResumeNote(null);
    resumeMutation.mutate({ provider }, {
      onSuccess: () => setResumedFrom((prev) => ({ ...prev, [provider]: new Date(since).getTime() })),
    });
  };
  const testMutation = trpc.ai.testAnthropicKey.useMutation({
    // Only the saved key's outcome moves the breaker: a pass closes it, an empty balance trips it.
    onSuccess: (result, variables) => {
      if (variables.apiKey !== undefined) return;
      if (result.ok) setAnthropicResumed(true);
      else if (result.kind === 'billing') setAnthropicResumed(false);
    },
  });
  const saveMutation = trpc.ai.saveAdminConfig.useMutation({
    // Typed keys are cleared here, once the server has them, not when Save is pressed: a refused
    // save (no Anthropic key, a model for the wrong provider) keeps them. Nor is the load effect
    // below enough: when the refetch answers what was already there, React Query keeps the same
    // object and the effect does not run again. They are cleared after the refetch, so a key
    // that was just saved never reads as missing in between (Save stays pending until then).
    onSuccess: async () => {
      // The test editor's "transcription is switched off" warning reads this (VocabManager).
      void utils.vocab.transcriptionStatus.invalidate();
      await configQuery.refetch();
      setApiKey(''); setApiKeyChanged(false);
      setElevenLabsKey(''); setElevenLabsKeyChanged(false);
      setAnthropicKey(''); setAnthropicKeyRemoved(false);
    },
  });
  const refreshModelsMutation = trpc.ai.refreshAvailableModels.useMutation({
    onSuccess: () => configQuery.refetch(),
  });
  const [previewingAccent, setPreviewingAccent] = useState<string | null>(null);
  const previewVoiceMutation = trpc.ai.previewTtsVoice.useMutation();
  const playVoicePreview = async (accent: string) => {
    // Mirror runtime behavior: an unmapped accent falls back to the default voice.
    const voiceId = voiceMap[accent] || voiceMap[''];
    if (!voiceId || previewingAccent !== null) return;
    setPreviewingAccent(accent);
    try {
      const r = await previewVoiceMutation.mutateAsync({ voiceId });
      const bytes = Uint8Array.from(atob(r.audioBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: r.mimeType }));
      const a = new Audio(url);
      a.onended = () => URL.revokeObjectURL(url);
      await a.play();
    } catch {
      // surfaced via previewVoiceMutation.isError below
    } finally {
      setPreviewingAccent(null);
    }
  };
  const voicesQuery = trpc.ai.listTtsVoices.useQuery(undefined, {
    enabled: modelSettingsExpanded && ttsProvider === 'elevenlabs' && Boolean(configQuery.data?.hasElevenLabsKey),
    retry: false,
  });

  useEffect(() => {
    if (!configQuery.data) {
      return;
    }

    setAiEnabled(configQuery.data.aiEnabled);
    setBaseUrl(configQuery.data.baseUrl);
    setPronunciation(configQuery.data.pronunciation);
    setImage(configQuery.data.image);
    setMnemonic(configQuery.data.mnemonic);
    setTranscription(configQuery.data.transcription ?? false);
    setMnemonicModel(configQuery.data.mnemonicModel);
    setImageModel(configQuery.data.imageModel);
    setImageQuality(configQuery.data.imageQuality);
    setTtsModel(configQuery.data.ttsModel);
    // Only treat the model as "custom" when we actually have the model list and
    // it doesn't contain the configured model. If the list is missing (e.g. an
    // older/partial config response) fall back to the dropdown rather than
    // letting an undefined access white-screen the whole AI tab.
    const ttsModels = configQuery.data.availableModels?.tts;
    setTtsCustom(Array.isArray(ttsModels) && !ttsModels.includes(configQuery.data.ttsModel));
    setTtsProvider(configQuery.data.ttsProvider === 'elevenlabs' ? 'elevenlabs' : 'openai');
    setVoiceMap(configQuery.data.ttsVoiceMap ?? {});
    // Defaults for every Claude field: an older or partial response must not white-screen the tab.
    setTextProvider(configQuery.data.textProvider === 'anthropic' ? 'anthropic' : 'openai');
    setAnthropicMnemonicModel(configQuery.data.anthropicMnemonicModel ?? 'claude-opus-5-5');
    setApiKey('');
    setApiKeyChanged(false);
    setElevenLabsKey('');
    setElevenLabsKeyChanged(false);
    setAnthropicKey('');
    setAnthropicKeyRemoved(false);
    setAnthropicResumed(false);
  }, [configQuery.data]);

  const hasAnthropicKey = Boolean(configQuery.data?.hasAnthropicKey);
  // Shown while Claude is chosen, or while a key is saved (so it can be removed).
  const anthropicKeyShown = textProvider === 'anthropic' || hasAnthropicKey;
  const typedAnthropicKey = anthropicKey.trim();
  const keepsSavedAnthropicKey = hasAnthropicKey && !anthropicKeyRemoved && typedAnthropicKey === '';
  // Whether a key will be saved once Save is pressed: Claude without one is refused.
  const anthropicKeyAfterSave = typedAnthropicKey !== '' || keepsSavedAnthropicKey;
  const removingAnthropicKey = hasAnthropicKey && anthropicKeyRemoved && typedAnthropicKey === '';

  const handleSave = () => {
    saveMutation.mutate({
      aiEnabled,
      openaiApiKey: apiKeyChanged ? apiKey : undefined,
      baseUrl: baseUrl.trim() || 'https://api.openai.com/v1',
      pronunciation,
      image,
      mnemonic,
      transcription,
      mnemonicModel: mnemonicModel.trim() || 'gpt-4.1',
      imageModel: imageModel.trim() || 'gpt-image-1',
      imageQuality: imageQuality.trim() || 'low',
      ttsModel: ttsModel.trim() || (ttsProvider === 'elevenlabs' ? 'eleven_multilingual_v2' : 'gpt-4o-mini-tts'),
      ttsProvider,
      elevenlabsApiKey: elevenLabsKeyChanged ? elevenLabsKey : undefined,
      ttsVoiceMap: voiceMap,
      textProvider,
      // undefined keeps the saved key, '' removes it. A key typed into the field and then hidden
      // (Claude chosen, then OpenAI again, with no key saved) is not saved.
      anthropicApiKey: anthropicKeyShown && typedAnthropicKey ? typedAnthropicKey : (anthropicKeyRemoved ? '' : undefined),
      anthropicMnemonicModel: anthropicMnemonicModel.trim() || 'claude-opus-5-5',
    });
  };

  const testAnthropicKey = () => {
    testMutation.mutate({
      apiKey: typedAnthropicKey || undefined, // undefined tests the saved key
      mnemonicModel: anthropicMnemonicModel.trim() || 'claude-opus-5-5',
    });
  };

  // The server's model catalog reflects the SAVED TTS provider. While the admin
  // is switching providers locally (unsaved), the catalog's tts list belongs to
  // the OTHER provider — the select could then neither display the new default
  // nor offer valid choices ("can't switch back"). Serve a static list for the
  // locally-chosen provider until the switch is saved.
  const OPENAI_TTS_FALLBACK = ['gpt-4o-mini-tts-2025-12-15', 'gpt-4o-mini-tts-2025-03-20', 'gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'];
  const ELEVENLABS_TTS_FALLBACK = ['eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_flash_v2_5', 'eleven_v3'];
  const savedTtsProvider = configQuery.data?.ttsProvider === 'elevenlabs' ? 'elevenlabs' : 'openai';
  const ttsProviderSaved = ttsProvider === savedTtsProvider;
  const ttsModelOptions = ttsProviderSaved
    ? (configQuery.data?.availableModels?.tts ?? OPENAI_TTS_FALLBACK)
    : (ttsProvider === 'elevenlabs' ? ELEVENLABS_TTS_FALLBACK : OPENAI_TTS_FALLBACK);
  // The Claude list never depends on a saved setting (the server sends the same static list), so
  // it serves whichever provider is chosen locally; the fields take any claude-* id.
  const ANTHROPIC_TEXT_FALLBACK = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
  const claudeModelOptions = configQuery.data?.anthropicModels ?? ANTHROPIC_TEXT_FALLBACK;
  const keyTest = testMutation.data;
  const pausedProviders = (configQuery.data?.pausedProviders ?? [])
    .filter((p) => !(p.provider === 'anthropic' && anthropicResumed))
    .filter((p) => resumedFrom[p.provider] !== new Date(p.since).getTime());
  const anthropicPaused = pausedProviders.some((p) => p.provider === 'anthropic');

  if (!configQuery.data) {
    return <div className="animate-pulse">{t('Loading...')}</div>;
  }

  return (
    <div className="space-y-6">
      {allScansQuery.data && allScansQuery.data.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">{t('Active AI Tasks')}</h2>
          <div className="space-y-3">
            {allScansQuery.data.map((scan, i) => (
              <div key={i} className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm text-gray-900 dark:text-gray-100">{scan.deckName}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    scan.progress.status === 'scanning'
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      : scan.progress.status === 'done'
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                        : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                  }`}>
                    {scan.progress.status === 'scanning' ? t('Scanning') : scan.progress.status === 'done' ? t('Done') : t('Failed')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all duration-300 ${scan.progress.status === 'failed' ? 'bg-red-500' : 'bg-blue-600'}`}
                      style={{
                        width: scan.progress.total > 0
                          ? `${Math.round((scan.progress.processed / scan.progress.total) * 100)}%`
                          : '0%'
                      }}
                    />
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {scan.progress.processed} / {scan.progress.total}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">{t('AI Configuration')}</h2>

              {pausedProviders.length > 0 && (
                <div className="mt-3 rounded-lg border border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/30 px-3 py-2">
                  <p className="text-sm font-semibold text-red-800 dark:text-red-300">
                    {t('AI is paused — the provider account is out of credit.')}
                  </p>
                  {pausedProviders.map((p) => (
                    <div key={p.provider}>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs text-red-700 dark:text-red-400">
                          {AI_PROVIDER_NAMES[p.provider] ?? p.provider} — {t('paused since')} {new Date(p.since).toLocaleString()}
                        </p>
                        {(p.provider === 'openai' || p.provider === 'anthropic' || p.provider === 'elevenlabs') && (
                          <button
                            type="button"
                            onClick={() => resumeProvider(p.provider as 'openai' | 'anthropic' | 'elevenlabs', p.since)}
                            disabled={resumeMutation.isPending}
                            aria-label={t('Resume {{provider}} now', { provider: AI_PROVIDER_NAMES[p.provider] ?? p.provider })}
                            className="rounded border border-red-400 bg-white px-2 py-0.5 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-50 dark:border-red-600 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-900/40"
                          >
                            {resumeMutation.isPending && resumeMutation.variables?.provider === p.provider ? t('Resuming…') : t('Resume now')}
                          </button>
                        )}
                      </div>
                      {p.provider === 'anthropic' && (
                        <p className="text-xs text-red-700 dark:text-red-400">
                          {t('Mnemonic suggestions are paused until the Anthropic account has credit. Add credit in the Claude Console, then press “Test key” to resume right away.')}
                        </p>
                      )}
                      {p.provider === 'openai' && configQuery.data?.textProvider === 'anthropic' && !anthropicPaused && (
                        <p className="text-xs text-red-700 dark:text-red-400">
                          {t('Mnemonic suggestions use Claude and keep working.')}
                        </p>
                      )}
                    </div>
                  ))}
                  <p className="text-xs text-red-700 dark:text-red-400 mt-1">
                    {t('Requests stop automatically so students are not left retrying. Add credit, then it resumes on its own.')}
                  </p>
                  <p className="text-xs text-red-700 dark:text-red-400">
                    {t('Just added credit? Press “Resume now” to try again right away.')}
                  </p>
                </div>
              )}
              <div aria-live="polite">
                {resumeNote && (
                  <p className={`mt-2 text-xs ${resumeNote.ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                    {resumeNote.ok
                      ? t('{{provider}} resumed. If the account still has no credit, the next request pauses it again.', { provider: AI_PROVIDER_NAMES[resumeNote.provider] ?? resumeNote.provider })
                      : t('Could not resume {{provider}}. Try again.', { provider: AI_PROVIDER_NAMES[resumeNote.provider] ?? resumeNote.provider })}
                  </p>
                )}
              </div>        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          {t('Configure AI-powered features like pronunciation, image generation, and mnemonics.')}
        </p>

        <div className="space-y-6">
          {/* Master toggle */}
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
            <div>
              <p className="font-medium text-gray-900 dark:text-gray-100">{t('Enable AI Features')}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('Master switch for all AI features')}</p>
            </div>
            <label htmlFor="ai-master-toggle" className="relative inline-flex items-center cursor-pointer">
              <input
                id="ai-master-toggle"
                type="checkbox"
                checked={aiEnabled}
                onChange={(e) => setAiEnabled(e.target.checked)}
                className="sr-only peer"
                aria-label={t('Enable AI Features')}
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {/* OpenAI-compatible endpoint */}
          <div>
            <label htmlFor="ai-base-url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('OpenAI-compatible API base URL')}
            </label>
            <input
              id="ai-base-url"
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://model-server:11434/v1"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('Use the OpenAI URL above for OpenAI, or the /v1 URL of an OpenAI-compatible server such as Ollama, LM Studio, or vLLM. It may run on any machine reachable by the libreSRS server.')}
            </p>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('API Key (optional for custom endpoints)')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={apiKeyChanged ? apiKey : ''}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setApiKeyChanged(true);
                }}
                placeholder={configQuery.data.hasApiKey ? 'sk-••••••••••••••••' : 'sk-...'}
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              {configQuery.data.hasApiKey && !apiKeyChanged && (
                <span className="text-xs text-green-700 dark:text-green-400 font-medium">{t('Configured')}</span>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('OpenAI requires a key. For a custom endpoint, leave this blank unless that server requires one. Get an OpenAI key from')}{' '}
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 underline hover:no-underline"
              >
                platform.openai.com
              </a>
            </p>
          </div>

          {/* Who writes mnemonic suggestions (v1.20.0). OpenAI unless the teacher switches. */}
          <div>
            <label htmlFor="ai-text-provider" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('Mnemonic suggestions use')}
            </label>
            <select
              id="ai-text-provider"
              value={textProvider}
              // Local only: the Claude model is its own field, so nothing else needs resetting.
              // Not disabled with AI off, like the key fields: removing a saved key while Claude is
              // selected needs a switch back to OpenAI too.
              onChange={(e) => setTextProvider(e.target.value === 'anthropic' ? 'anthropic' : 'openai')}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:text-gray-500"
            >
              <option value="openai">{t('OpenAI (or the compatible endpoint above)')}</option>
              <option value="anthropic">{t('Anthropic (Claude)')}</option>
            </select>
            {textProvider === 'anthropic' && (
              <>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('Only mnemonic suggestions move to Claude. Images, transcription and moderation stay on the endpoint above, and speech stays on the TTS provider.')}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('Your OpenAI model ({{model}}) stays saved and comes back if you switch back.', {
                    model: configQuery.data.mnemonicModel,
                  })}
                </p>
                {!anthropicKeyAfterSave && (
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mt-1">
                    {t('Paste an Anthropic API key to use Claude — saving is refused without one.')}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Anthropic API key: shown while Claude is chosen, or while one is saved (so it can be removed) */}
          {anthropicKeyShown && (
            <div>
              <label htmlFor="ai-anthropic-key" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('Anthropic API Key')}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="ai-anthropic-key"
                  type="password"
                  autoComplete="off"
                  value={anthropicKey}
                  onChange={(e) => {
                    setAnthropicKey(e.target.value);
                    testMutation.reset();
                  }}
                  placeholder={keepsSavedAnthropicKey ? '••••••••  ' + t('(saved)') : 'sk-ant-...'}
                  className="flex-1 min-w-48 px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
                {keepsSavedAnthropicKey && (
                  <span className="text-xs text-green-700 dark:text-green-400 font-medium">{t('Configured')}</span>
                )}
                <button
                  type="button"
                  onClick={testAnthropicKey}
                  disabled={testMutation.isPending || !anthropicKeyAfterSave}
                  className="shrink-0 px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                >
                  {testMutation.isPending ? t('Testing…') : t('Test key')}
                </button>
                {hasAnthropicKey && (removingAnthropicKey ? (
                  <button
                    type="button"
                    onClick={() => setAnthropicKeyRemoved(false)}
                    className="shrink-0 px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    {t('Keep saved key')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setAnthropicKey('');
                      setAnthropicKeyRemoved(true);
                      testMutation.reset();
                    }}
                    className="shrink-0 px-3 py-2 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-red-700 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    {t('Remove key')}
                  </button>
                ))}
              </div>
              {removingAnthropicKey && (
                <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mt-1">
                  {t('The saved key will be removed when you save.')}
                </p>
              )}
              <p
                role="status"
                className={`text-xs font-medium ${keyTest || testMutation.isError ? 'mt-2' : ''} ${keyTest?.ok ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}`}
              >
                {keyTest
                  ? anthropicKeyTestMessage(keyTest, t)
                  : testMutation.isError
                    // A BAD_REQUEST with no code of its own is zod's: a field longer than any key or model id.
                    ? aiSettingsErrorMessage(testMutation.error, t)
                      ?? (testMutation.error.data?.code === 'BAD_REQUEST'
                        ? t('The key or a Claude model name is too long to be real. Check both, then test again.')
                        : testMutation.error.message)
                    : null}
              </p>
              {keyTest && !keyTest.ok && (keyTest.detail || keyTest.requestId) && (
                <details className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                  <summary className="cursor-pointer">{t('Technical details')}</summary>
                  {keyTest.detail && <p className="mt-1 font-mono break-words">{keyTest.detail}</p>}
                  {keyTest.requestId && <p className="mt-1 font-mono">{t('Request ID: {{id}}', { id: keyTest.requestId })}</p>}
                </details>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('Stored encrypted, like the OpenAI key. The Anthropic account needs prepaid credit. Create a key at')}{' '}
                <a
                  href="https://platform.claude.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 underline hover:no-underline"
                >
                  platform.claude.com
                </a>
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('Claude-written suggestions still wait for your approval before students see them.')}
              </p>
            </div>
          )}

          {/* Feature toggles */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">{t('Features')}</h3>
            <div className="space-y-3">
              <FeatureToggle
                label={t('Pronunciation (Text-to-Speech)')}
                description={t('Generate audio pronunciation for card answers')}
                checked={pronunciation}
                onChange={setPronunciation}
                disabled={!aiEnabled}
              />
              <FeatureToggle
                label={t('Image Generation')}
                description={t('Generate AI illustrations for flashcards')}
                checked={image}
                onChange={setImage}
                disabled={!aiEnabled}
              />
              <FeatureToggle
                label={t('Mnemonic Suggestions')}
                description={t('Suggest memory aids for any card you ask about; students see only the one you approve')}
                checked={mnemonic}
                onChange={setMnemonic}
                disabled={!aiEnabled}
              />
              <FeatureToggle
                label={t('Speech transcription (“repeat the sentence” test)')}
                description={t('Sends each student recording in the Vocabulómetro “repeat the sentence” test to OpenAI to be turned into text and scored. Off by default: turn it on only if your school has agreed to it.')}
                checked={transcription}
                onChange={setTranscription}
                disabled={!aiEnabled}
              />
            </div>
          </div>

          {/* Model settings */}
          <div className="border-t pt-4">
            <button
              type="button"
              onClick={() => setModelSettingsExpanded((open) => !open)}
              className="w-full flex items-center justify-between text-left"
              aria-expanded={modelSettingsExpanded}
            >
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('Model Settings')}</span>
              <span className="text-xs text-gray-600 dark:text-gray-300">
                {modelSettingsExpanded ? t('Hide') : t('Show')}
              </span>
            </button>

            {modelSettingsExpanded && (
              <div className="space-y-4 mt-3">
                <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 dark:border-yellow-700 dark:bg-yellow-900/30">
                  <p className="text-xs font-medium text-yellow-800 dark:text-yellow-300">
                    {t('WARNING changing these values can radically change your API spend.')}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {configQuery.data.modelsFetchedAt
                      ? t('Model list fetched from the provider on {{date}}. Auto-refreshes weekly.', {
                          date: new Date(configQuery.data.modelsFetchedAt).toLocaleDateString(),
                        })
                      : t('Model list is the built-in fallback (live fetch unavailable).')}
                  </p>
                  <button
                    type="button"
                    onClick={() => refreshModelsMutation.mutate()}
                    disabled={refreshModelsMutation.isPending}
                    className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                  >
                    {refreshModelsMutation.isPending ? t('Refreshing…') : t('Refresh model list')}
                  </button>
                </div>

                {textProvider === 'anthropic' ? (
                  <>
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('Claude model')}</h3>
                    <div>
                      <label htmlFor="ai-mnemonic-model" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t('Mnemonic model')}
                      </label>
                      <input
                        id="ai-mnemonic-model"
                        type="text"
                        list="ai-anthropic-mnemonic-models"
                        value={anthropicMnemonicModel}
                        onChange={(e) => setAnthropicMnemonicModel(e.target.value)}
                        disabled={!aiEnabled}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:text-gray-500"
                      />
                      <datalist id="ai-anthropic-mnemonic-models">
                        {claudeModelOptions.map((model) => (
                          <option key={model} value={model}>{model}</option>
                        ))}
                      </datalist>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {t('claude-opus-5-5 writes the strongest suggestions. claude-haiku-5-5 is faster and about a fortieth of the price.')}
                      </p>
                    </div>
                  </>
                ) : (
                  <div>
                    <label htmlFor="ai-mnemonic-model" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('Mnemonic model')}
                    </label>
                    <input
                      id="ai-mnemonic-model"
                      type="text"
                      list="ai-mnemonic-models"
                      value={mnemonicModel}
                      onChange={(e) => setMnemonicModel(e.target.value)}
                      disabled={!aiEnabled}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:text-gray-500"
                    />
                    <datalist id="ai-mnemonic-models">
                      {configQuery.data.availableModels.mnemonic.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </datalist>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('Image model')}
                  </label>
                  <input
                    type="text"
                    list="ai-image-models"
                    value={imageModel}
                    onChange={(e) => setImageModel(e.target.value)}
                    disabled={!aiEnabled}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:text-gray-500"
                  />
                  <datalist id="ai-image-models">
                    {configQuery.data.availableModels.image.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('Image quality')}
                  </label>
                  <select
                    value={imageQuality}
                    onChange={(e) => setImageQuality(e.target.value)}
                    disabled={!aiEnabled}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:text-gray-500"
                  >
                    {!configQuery.data.availableModels.imageQuality.includes(imageQuality) && (
                      <option value={imageQuality}>{imageQuality}</option>
                    )}
                    {configQuery.data.availableModels.imageQuality.map((q) => (
                      <option key={q} value={q}>{q}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('TTS provider')}
                  </label>
                  <select
                    value={ttsProvider}
                    onChange={(e) => {
                      const next = e.target.value === 'elevenlabs' ? 'elevenlabs' : 'openai';
                      setTtsProvider(next);
                      // Switch the model field to the new provider's default so an
                      // OpenAI model id never gets sent to ElevenLabs (or vice versa).
                      setTtsCustom(false);
                      setTtsModel(next === 'elevenlabs' ? 'eleven_multilingual_v2' : 'gpt-4o-mini-tts-2025-12-15');
                    }}
                    disabled={!aiEnabled}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:text-gray-500"
                  >
                    <option value="openai">{t('OpenAI (accent by instructions)')}</option>
                    <option value="elevenlabs">{t('ElevenLabs (accent by native voice)')}</option>
                  </select>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t('Affects speech only — images and transcription stay on the endpoint above.')}
                  </p>
                </div>

                {ttsProvider === 'elevenlabs' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('ElevenLabs API Key')}
                    </label>
                    <input
                      type="password"
                      value={elevenLabsKeyChanged ? elevenLabsKey : ''}
                      onChange={(e) => {
                        setElevenLabsKey(e.target.value);
                        setElevenLabsKeyChanged(true);
                      }}
                      disabled={!aiEnabled}
                      placeholder={configQuery.data.hasElevenLabsKey ? '••••••••  ' + t('(saved)') : 'xi-...'}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:text-gray-500"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t('Stored encrypted, like the OpenAI key. Save the key first, then assign voices below.')}
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('TTS model')}
                  </label>
                  <select
                    value={ttsCustom ? '__custom__' : ttsModel}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setTtsCustom(true);
                      } else {
                        setTtsCustom(false);
                        setTtsModel(e.target.value);
                      }
                    }}
                    disabled={!aiEnabled}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:text-gray-500"
                  >
                    {ttsModelOptions.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                    {/* Keep the select displayable even if the current value is
                        somehow not in the list (e.g. stale saved state). */}
                    {!ttsCustom && ttsModel && !ttsModelOptions.includes(ttsModel) && (
                      <option value={ttsModel}>{ttsModel}</option>
                    )}
                    <option value="__custom__">{t('Custom (type a model ID)…')}</option>
                  </select>
                  {ttsCustom && (
                    <>
                      <input
                        type="text"
                        value={ttsModel}
                        onChange={(e) => setTtsModel(e.target.value)}
                        disabled={!aiEnabled}
                        placeholder="e.g. gpt-4o-mini-tts-2025-12-15"
                        className="w-full mt-2 px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:text-gray-500"
                      />
                      {/* Typo guard: a mistyped custom model ID silently breaks ALL
                          audio generation (it 404s at the provider) — warn when the
                          ID is not in the live-fetched list. */}
                      {ttsProviderSaved
                        && configQuery.data.modelsFetchedAt != null
                        && ttsModel.trim() !== ''
                        && !ttsModelOptions.includes(ttsModel.trim()) && (
                        <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mt-1">
                          {t('This ID is not in the provider’s current model list — double-check it before saving (a typo breaks all audio generation).')}
                        </p>
                      )}
                    </>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {ttsProvider === 'elevenlabs'
                      ? t('eleven_multilingual_v2 has the best quality for single words; flash/turbo are cheaper and can enforce Spanish via language code.')
                      : t('Must be a model on OpenAI’s /v1/audio/speech endpoint (the gpt-4o-mini-tts family or tts-1/tts-1-hd). Only gpt-4o-mini-tts models honor the pronunciation instructions.')}
                  </p>
                </div>

                {ttsProvider === 'elevenlabs' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('Accent voices')}
                    </label>
                    {!configQuery.data.hasElevenLabsKey ? (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t('Save an ElevenLabs API key first — then your account’s voices appear here for mapping.')}
                      </p>
                    ) : voicesQuery.isLoading ? (
                      <p className="text-xs text-gray-500 dark:text-gray-400">{t('Loading voices…')}</p>
                    ) : voicesQuery.isError ? (
                      <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                        {t('Could not load voices from ElevenLabs — check the API key.')}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {t('Map each accent your decks use to a voice from your ElevenLabs account (add voices to “My Voices” in ElevenLabs first). An unmapped accent falls back to the default voice — so if your default is a Spanish voice, an English side will be read by that Spanish voice.')}
                        </p>
                        {['', ...TTS_ACCENTS.map((a) => a.value)].map((accent) => (
                          <div key={accent || '__default__'} className="flex items-center gap-2">
                            <span className="w-40 shrink-0 text-xs text-gray-600 dark:text-gray-300">
                              {accent === ''
                                ? t('Default voice')
                                : TTS_ACCENTS.find((a) => a.value === accent)?.label ?? accent}
                            </span>
                            <select
                              value={voiceMap[accent] ?? ''}
                              onChange={(e) => {
                                setVoiceMap((prev) => {
                                  const next = { ...prev };
                                  if (e.target.value) next[accent] = e.target.value;
                                  else delete next[accent];
                                  return next;
                                });
                              }}
                              disabled={!aiEnabled}
                              className="flex-1 px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-gray-100 dark:disabled:bg-gray-800"
                            >
                              <option value="">{accent === '' ? t('— required —') : t('— use default voice —')}</option>
                              {(voicesQuery.data?.voices ?? []).map((v) => (
                                <option key={v.voiceId} value={v.voiceId}>
                                  {v.name}{v.labels.accent ? ` (${v.labels.accent})` : ''}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => { void playVoicePreview(accent); }}
                              disabled={!aiEnabled || previewingAccent !== null || !(voiceMap[accent] || voiceMap[''])}
                              title={t('Play a short sample with this voice')}
                              className="shrink-0 px-2 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
                            >
                              {previewingAccent === accent ? '…' : '▶'}
                            </button>
                          </div>
                        ))}
                        {previewVoiceMutation.isError && (
                          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                            {t('Voice preview failed — the voice may be broken or removed from your account.')}
                          </p>
                        )}
                        {!voiceMap[''] && (
                          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                            {t('A default voice is required — speech generation fails without one.')}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Save */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {saveMutation.isPending ? t('Saving...') : t('Save Configuration')}
            </button>
            {saveMutation.isSuccess && (
              <span className="text-sm text-green-700 dark:text-green-400">{t('Saved successfully')}</span>
            )}
            {saveMutation.isError && (
              <span className="text-sm text-red-600 dark:text-red-400">{aiSettingsErrorMessage(saveMutation.error, t) ?? saveMutation.error.message}</span>
            )}
          </div>
        </div>
      </div>

      {!aiEnabled && (
        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <p className="text-sm text-blue-800 dark:text-blue-300">
            {t('AI features are currently disabled. Enable the master switch and configure an OpenAI-compatible endpoint, with an API key if required, to use pronunciation, images, and mnemonics during flashcard review.')}
          </p>
        </div>
      )}
    </div>
  );
}

/** The Test key line: the models that answered, or what went wrong and what to do about it. */
function anthropicKeyTestMessage(result: AnthropicKeyTest, t: ReturnType<typeof useI18n>['t']): string {
  if (result.ok) return t('Key works. Claude answered with {{models}}.', { models: result.checks.map((c) => c.model).join(', ') });
  switch (result.kind) {
    case 'no_key': return t('Paste a key first, or save one.');
    case 'auth': return t('Anthropic didn’t accept this key, or the key isn’t allowed to use this model. Copy it again from the Claude Console, or create a new one.');
    case 'billing': return t('The key works, but the Anthropic account has no credit or reached its spending limit. Add credit or raise the limit in the Claude Console, then test again.');
    case 'model': return t('This account can’t use the model {{model}}. Pick another one under “Model Settings”.', { model: result.model ?? '' });
    case 'busy': return t('Anthropic is busy or could not be reached. Test again in a minute.');
    default: return t('Anthropic returned an error: {{detail}}', { detail: result.detail ?? '' });
  }
}

/** A switch has no text of its own: `label` names it (the row's label sits beside it, not in a <label>). */
function AdminToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function AdminSettingRow({
  label,
  locked,
  onLockChange,
  children,
}: {
  label: string;
  locked: boolean;
  onLockChange: (v: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-gray-700 dark:text-gray-300 flex-1">{label}</span>
      <div className="flex items-center gap-2">
        {children}
        <button
          type="button"
          title={locked ? t('Locked — user cannot change') : t('Unlocked — user can change')}
          onClick={() => onLockChange(!locked)}
          className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${
            locked
              ? 'bg-orange-100 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300'
              : 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-orange-300'
          }`}
        >
          {locked ? t('Locked') : t('Lock')}
        </button>
      </div>
    </div>
  );
}

function FeatureToggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className={`flex items-center justify-between p-3 rounded-lg border ${disabled ? 'bg-gray-50 dark:bg-gray-900 border-gray-100 dark:border-gray-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'} cursor-pointer`}>
      <div className={disabled ? 'opacity-50' : ''}>
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
      </div>
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 h-4 w-4"
      />
    </label>
  );
}

const RATING_LABELS = ['Again', 'Hard', 'Good', 'Easy'];
const STATE_LABELS = ['New', 'Learning', 'Review', 'Relearning'];

function UserReviewHistoryModal({
  userId,
  userName,
  onClose,
}: {
  userId: number;
  userName: string;
  onClose: () => void;
}) {
  const { t, formatDate } = useI18n();
  const [page, setPage] = useState(0);
  const limit = 25;
  const { data, isLoading } = trpc.admin.getUserReviewHistory.useQuery({
    userId,
    limit,
    offset: page * limit,
  });

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };

  const formatTimestamp = (date: Date | string | number) => {
    const d = new Date(date);
    return `${formatDate(d)} ${d.toLocaleTimeString()}`;
  };

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl dark:shadow-gray-900/30 max-w-4xl w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('Review History for {{name}}', { name: userName })}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl leading-none"
          >
            &times;
          </button>
        </div>
        <div className="overflow-auto flex-1">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">{t('Loading...')}</div>
          ) : data && data.reviews.length > 0 ? (
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('Time')}</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('Card')}</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('Rating')}</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('Duration')}</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">{t('State')}</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {data.reviews.map((review) => (
                  <tr key={review.id}>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {formatTimestamp(review.reviewedAt)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 max-w-xs truncate">
                      <span dangerouslySetInnerHTML={{ __html: review.front }} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        review.rating >= 3 ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' :
                        review.rating >= 2 ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300' :
                        'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                      }`}>
                        {RATING_LABELS[review.rating - 1] ?? review.rating}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {formatTime(review.timeSpentMs)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {STATE_LABELS[review.previousState] ?? review.previousState}
                      {' → '}
                      {STATE_LABELS[review.newState] ?? review.newState}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">{t('No reviews yet')}</div>
          )}
        </div>
        {totalPages > 1 && (
          <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              {t('Previous')}
            </button>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t('Page {{page}} of {{total}}', { page: page + 1, total: totalPages })}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1 text-sm bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              {t('Next')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
