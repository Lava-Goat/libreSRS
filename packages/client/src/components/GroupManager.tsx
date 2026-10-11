import { useEffect, useRef, useState } from 'react';
import { useMatch, useSearchParams } from 'react-router-dom';
import { trpc } from '../api/trpc';
import { useI18n } from '../i18n';
import { downloadCsv } from '../utils/downloadCsv';
import { SUPPORTED_LOCALES, type Locale } from '../i18n/messages';
import GroupFlashcardsDay from './groups/GroupFlashcardsDay';
import GroupList from './groups/GroupList';
import GroupMembersTable from './groups/GroupMembersTable';
import GroupDecksTable from './groups/GroupDecksTable';
import AddStudentsPicker from './groups/AddStudentsPicker';
import ImportStudentPicker, { CLASSROOM_IMPORT_STORAGE_KEY, CLEVER_IMPORT_STORAGE_KEY } from './groups/ImportStudentPicker';
import GroupPinsButton from './groups/GroupPinsButton';
import { INITIAL_TABLE_VIEW, type TableViewState } from './admin/useTableView';

const LOCALE_DISPLAY_NAMES: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  ar: 'العربية',
  zh: '中文',
  vi: 'Tiếng Việt',
  'pt-BR': 'Português (BR)',
  ru: 'Русский',
  fa: 'فارسی',
  he: 'עברית',
};

type MnemonicMode = 'manual' | 'disabled';

interface GroupSettingsState {
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
  mnemonicMode: MnemonicMode;
  mnemonicModeLocked: boolean;
  locale: string | null;
  localeLocked: boolean;
}

function LockButton({ locked, onToggle }: { locked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={locked ? 'Locked — users cannot change this' : 'Unlocked — users can change this'}
      className={`ml-2 p-1 rounded transition-colors ${
        locked
          ? 'text-orange-500 hover:text-orange-700'
          : 'text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400'
      }`}
    >
      {locked ? (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 0 1 4.5-4.5 4.5 4.5 0 0 1 4.5 4.5v3.75M3.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H3.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
      )}
    </button>
  );
}

function SettingRow({
  label,
  locked,
  onLockChange,
  children,
}: {
  label: string;
  locked: boolean;
  onLockChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300 flex-1">{label}</span>
      <div className="flex items-center gap-1">
        {children}
        <LockButton locked={locked} onToggle={() => onLockChange(!locked)} />
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
        checked ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

/** The group a URL names (?group=12), or null. */
function groupFromParams(params: URLSearchParams): number | null {
  const value = params.get('group') ?? '';
  return /^\d+$/.test(value) ? Number(value) : null;
}

export interface GroupManagerProps {
  /**
   * A student whose page the teacher just came back from (opened from this
   * group's Members or its "Flashcards by day"): their name takes focus, once,
   * and then onReturnFocusDone.
   */
  returnFocusUserId?: number | null;
  /** A deck the teacher just came back from (opened from Assigned Decks): its name takes focus, once. */
  returnFocusDeckId?: number | null;
  onReturnFocusDone?: () => void;
  /** Told when an assigned deck's link is followed, so Back from the Decks tab can find it here again. */
  onOpenDeck?: (deckId: number) => void;
}

/**
 * Admin → Groups. The group picked is in the URL (?tab=groups&group=12), so a
 * reload, a link, and Back from a student's page opened here find it again.
 */
export default function GroupManager({
  returnFocusUserId = null,
  returnFocusDeckId = null,
  onReturnFocusDone,
  onOpenDeck,
}: GroupManagerProps = {}) {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const groupParam = groupFromParams(searchParams);
  /** Kept (hidden) under a student's page opened from a group: the URL is that page's, not this tab's. */
  const underUserPage = useMatch('/admin/users/:userId') !== null;
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showImportForm, setShowImportForm] = useState(false);
  const [importMethod, setImportMethod] = useState<'csv' | 'google' | 'clever'>('csv');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [importGroupName, setImportGroupName] = useState('');
  const [importGroupDescription, setImportGroupDescription] = useState('');
  const [classroomFile, setClassroomFile] = useState<File | null>(null);
  const [importStatus, setImportStatus] = useState<{ success: boolean; message: string } | null>(null);

  // Google Classroom browse state
  const [gcConnected, setGcConnected] = useState(false);
  const [gcSelectedCourse, setGcSelectedCourse] = useState<{ id: string; name: string; section: string | null; description: string | null } | null>(null);
  const [gcSelectedEmails, setGcSelectedEmails] = useState<Set<string>>(new Set());
  const [gcGroupName, setGcGroupName] = useState('');
  const [gcGroupDescription, setGcGroupDescription] = useState('');

  // Clever browse state
  const [cleverConnected, setCleverConnected] = useState(false);
  const [cleverSelectedSection, setCleverSelectedSection] = useState<{ id: string; name: string; subject: string | null; grade: string | null; period: string | null } | null>(null);
  const [cleverSelectedEmails, setCleverSelectedEmails] = useState<Set<string>>(new Set());
  const [cleverGroupName, setCleverGroupName] = useState('');
  const [cleverGroupDescription, setCleverGroupDescription] = useState('');
  const [memberStatus, setMemberStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(groupParam);
  /**
   * Picks a group (or none), and says so in the URL (replacing the entry: picking is not history).
   * Under a student's page (an import finishing there) the URL is left alone: it is that page's.
   */
  const selectGroup = (groupId: number | null) => {
    setSelectedGroupId(groupId);
    if (underUserPage) return;
    const next = new URLSearchParams({ tab: 'groups' });
    if (groupId !== null) next.set('group', String(groupId));
    setSearchParams(next, { replace: true });
  };
  // A URL that names another group (a link to it, Back or Forward) picks it, and so does
  // the one Back from a student's page returns to: the screen shows what the URL says.
  useEffect(() => {
    if (groupParam !== null && !underUserPage) setSelectedGroupId(groupParam);
  }, [groupParam, underUserPage]);
  /** The list a student's page was last opened from, where Back puts focus on their name. */
  const [openedFrom, setOpenedFrom] = useState<'members' | 'flashcards'>('members');
  const classroomFileRef = useRef<HTMLInputElement>(null);

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [editingGroupSettings, setEditingGroupSettings] = useState<GroupSettingsState | null>(null);
  const [applyStatus, setApplyStatus] = useState<{ success: boolean; message: string } | null>(null);

  const { data: setupStatus } = trpc.setup.getStatus.useQuery();
  const cleverEnabled = setupStatus?.cleverEnabled ?? false;

  const { data: groups, refetch: refetchGroups } = trpc.admin.getGroups.useQuery();
  const { data: users } = trpc.admin.getUsers.useQuery();
  const { data: decks } = trpc.admin.getDecks.useQuery();
  const { data: groupMembers, refetch: refetchGroupMembers } = trpc.admin.getGroupMembers.useQuery(
    { groupId: selectedGroupId! },
    { enabled: selectedGroupId !== null }
  );
  const { data: groupDecks, refetch: refetchGroupDecks } = trpc.admin.getGroupDecks.useQuery(
    { groupId: selectedGroupId! },
    { enabled: selectedGroupId !== null }
  );
  const { data: fetchedGroupSettings, refetch: refetchGroupSettings } = trpc.admin.getGroupSettings.useQuery(
    { groupId: selectedGroupId! },
    { enabled: selectedGroupId !== null }
  );

  const gcCoursesQuery = trpc.admin.listGoogleClassroomCourses.useQuery(undefined, {
    enabled: gcConnected,
    retry: false,
  });
  const gcStudentsQuery = trpc.admin.previewGoogleClassroomStudents.useQuery(
    { courseId: gcSelectedCourse?.id ?? '' },
    { enabled: !!gcSelectedCourse, staleTime: 5 * 60 * 1000, retry: false }
  );
  const cleverSectionsQuery = trpc.admin.listCleverSections.useQuery(undefined, {
    enabled: cleverConnected,
    retry: false,
  });
  const cleverStudentsQuery = trpc.admin.previewCleverStudents.useQuery(
    { sectionId: cleverSelectedSection?.id ?? '' },
    { enabled: !!cleverSelectedSection, staleTime: 5 * 60 * 1000, retry: false }
  );

  const createGroup = trpc.admin.createGroup.useMutation({
    onSuccess: () => {
      refetchGroups();
      setShowCreateForm(false);
      setNewGroupName('');
      setNewGroupDescription('');
      setImportStatus(null);
    },
  });

  useEffect(() => {
    const classroomParam = searchParams.get('classroom');
    const cleverParam = searchParams.get('clever');

    if (!classroomParam && !cleverParam) return;

    if (classroomParam === 'connected') {
      setGcConnected(true);
      setGcSelectedCourse(null);
      setImportMethod('google');
      setShowImportForm(true);
      setShowCreateForm(false);
    } else if (classroomParam === 'oauth_not_configured') {
      setImportStatus({ success: false, message: t('Google OAuth is not configured on the server.') });
    } else if (classroomParam) {
      setImportStatus({ success: false, message: t('Google Classroom connection failed. Please try again.') });
    }

    if (cleverParam === 'connected') {
      setCleverConnected(true);
      setCleverSelectedSection(null);
      setImportMethod('clever');
      setShowImportForm(true);
      setShowCreateForm(false);
    } else if (cleverParam === 'oauth_not_configured') {
      setImportStatus({ success: false, message: t('Clever OAuth is not configured on the server.') });
    } else if (cleverParam === 'auth_failed') {
      setImportStatus({ success: false, message: t('Clever connection failed. Please try again.') });
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('classroom');
    nextParams.delete('clever');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams, t]);

  // Initialize all GC student emails as selected when the student list loads
  useEffect(() => {
    if (gcStudentsQuery.data) {
      setGcSelectedEmails(new Set(gcStudentsQuery.data.map((s) => s.email)));
      if (gcSelectedCourse && !gcGroupName) {
        const name = gcSelectedCourse.section
          ? `${gcSelectedCourse.name} — ${gcSelectedCourse.section}`
          : gcSelectedCourse.name;
        setGcGroupName(name);
      }
    }
  }, [gcStudentsQuery.data]);

  // Initialize all Clever student emails as selected when the student list loads
  useEffect(() => {
    if (cleverStudentsQuery.data) {
      setCleverSelectedEmails(new Set(cleverStudentsQuery.data.map((s) => s.email)));
      if (cleverSelectedSection && !cleverGroupName) {
        setCleverGroupName(cleverSelectedSection.name);
      }
    }
  }, [cleverStudentsQuery.data]);

  useEffect(() => {
    setMemberStatus(null);
    setApplyStatus(null);
    setShowSettingsModal(false);
    setEditingGroupSettings(null);
    // Another group's "Add students" starts again: no search, nothing ticked.
    setAddView(INITIAL_TABLE_VIEW);
    setSelectedAddIds(new Set());
  }, [selectedGroupId]);

  const importGoogleClassroomGroup = trpc.admin.importGoogleClassroomGroup.useMutation({
    onSuccess: (result) => {
      refetchGroups();
      selectGroup(result.group.id);
      setShowImportForm(false);
      setImportGroupName('');
      setImportGroupDescription('');
      setClassroomFile(null);
      if (classroomFileRef.current) {
        classroomFileRef.current.value = '';
      }
      setGcSelectedCourse(null);
      setGcSelectedEmails(new Set());
      setGcGroupName('');
      setImportStatus({
        success: true,
        message: `Created "${result.group.name}". Parsed ${result.summary.studentsParsed} students, assigned ${result.summary.usersAssignedToGroup} users.`,
      });
    },
    onError: (error) => {
      setImportStatus({
        success: false,
        message: error.message,
      });
    },
  });

  const importGoogleClassroomCourse = trpc.admin.importGoogleClassroomCourse.useMutation({
    onSuccess: (result) => {
      refetchGroups();
      selectGroup(result.group.id);
      setShowImportForm(false);
      setGcSelectedCourse(null);
      setGcSelectedEmails(new Set());
      setGcGroupName('');
      setGcGroupDescription('');
      setImportStatus({
        success: true,
        message: `Created "${result.group.name}" from Classroom "${result.course.name}". Assigned ${result.summary.usersAssignedToGroup} users.`,
      });
    },
    onError: (error) => {
      setImportStatus({
        success: false,
        message: error.message,
      });
    },
  });

  const importCleverSection = trpc.admin.importCleverSection.useMutation({
    onSuccess: (result) => {
      refetchGroups();
      selectGroup(result.group.id);
      setShowImportForm(false);
      setCleverSelectedSection(null);
      setCleverSelectedEmails(new Set());
      setCleverGroupName('');
      setCleverGroupDescription('');
      setImportStatus({
        success: true,
        message: `Created "${result.group.name}". Assigned ${result.summary.usersAssignedToGroup} users.`,
      });
    },
    onError: (error) => {
      setImportStatus({
        success: false,
        message: error.message,
      });
    },
  });

  const deleteGroup = trpc.admin.deleteGroup.useMutation({
    onSuccess: () => {
      refetchGroups();
      selectGroup(null);
    },
  });

  /** "Add students": its search and page, and who is ticked (a successful add clears both). */
  const [addView, setAddView] = useState<TableViewState>(INITIAL_TABLE_VIEW);
  const [selectedAddIds, setSelectedAddIds] = useState<Set<number>>(new Set());
  const addUsersToGroup = trpc.admin.addUsersToGroup.useMutation({
    onSuccess: async (result) => {
      await Promise.all([refetchGroups(), refetchGroupMembers()]);
      setSelectedAddIds(new Set());
      setAddView(INITIAL_TABLE_VIEW);
      // With the group's Override on, the students who joined now have its settings.
      const applied = result.settingsApplied ?? 0;
      setMemberStatus({
        success: true,
        message: applied > 0
          ? `${t('Added {{count}} user(s) to the group.', { count: result.requested })} ${t("The group's settings were applied to {{count}} of them.", { count: applied })}`
          : t('Added {{count}} user(s) to the group.', { count: result.requested }),
      });
    },
    onError: () => {
      setMemberStatus({ success: false, message: t('Could not add the selected users.') });
    },
  });
  const [exportDataset, setExportDataset] = useState<'summary' | 'reviews' | 'vocab' | 'completions' | 'labs' | 'speaking' | 'conjugation'>('summary');
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const exportGroupQuery = trpc.admin.exportGroupData.useQuery(
    { groupId: selectedGroupId!, dataset: exportDataset },
    { enabled: false }
  );
  const removeUserFromGroup = trpc.admin.removeUserFromGroup.useMutation({
    onSuccess: () => {
      refetchGroups();
      refetchGroupMembers();
      setMemberStatus(null);
    },
    onError: (error) => {
      setMemberStatus({
        success: false,
        message: error.message || t('Failed to remove user from the group.'),
      });
    },
  });

  const assignDeckToGroup = trpc.admin.assignDeckToGroup.useMutation({
    onSuccess: () => {
      refetchGroups();
      refetchGroupDecks();
    },
  });

  const removeDeckFromGroup = trpc.admin.removeDeckFromGroup.useMutation({
    onSuccess: () => {
      refetchGroups();
      refetchGroupDecks();
    },
  });

  const updateGroupSettings = trpc.admin.updateGroupSettings.useMutation({
    onSuccess: () => {
      void refetchGroupSettings();
      setShowSettingsModal(false);
      setEditingGroupSettings(null);
    },
  });

  const applyGroupSettingsToMembers = trpc.admin.applyGroupSettingsToMembers.useMutation({
    onSuccess: (result) => {
      setApplyStatus({
        success: true,
        message: t('Settings applied to {{count}} member(s).', { count: result.membersUpdated }),
      });
    },
    onError: (error) => {
      setApplyStatus({
        success: false,
        message: error.message || t('Failed to apply settings.'),
      });
    },
  });

  const handleOpenSettingsModal = () => {
    if (!fetchedGroupSettings) return;
    setEditingGroupSettings({
      newCardsPerDay: fetchedGroupSettings.newCardsPerDay,
      reviewsPerDay: fetchedGroupSettings.reviewsPerDay,
      isOverride: fetchedGroupSettings.isOverride,
      allowHigher: fetchedGroupSettings.allowHigher,
      allowLower: fetchedGroupSettings.allowLower,
      aiEnabled: fetchedGroupSettings.aiEnabled,
      aiEnabledLocked: fetchedGroupSettings.aiEnabledLocked,
      autoPlayAudio: fetchedGroupSettings.autoPlayAudio,
      autoPlayAudioLocked: fetchedGroupSettings.autoPlayAudioLocked,
      autoPlayAudioFront: fetchedGroupSettings.autoPlayAudioFront,
      autoPlayAudioFrontLocked: fetchedGroupSettings.autoPlayAudioFrontLocked,
      mnemonicMode: fetchedGroupSettings.mnemonicMode,
      mnemonicModeLocked: fetchedGroupSettings.mnemonicModeLocked,
      locale: fetchedGroupSettings.locale,
      localeLocked: fetchedGroupSettings.localeLocked,
    });
    setShowSettingsModal(true);
    setApplyStatus(null);
  };

  const handleSaveGroupSettings = () => {
    if (!selectedGroupId || !editingGroupSettings) return;
    updateGroupSettings.mutate({
      groupId: selectedGroupId,
      ...editingGroupSettings,
    });
  };

  const selectedGroup = groups?.find((g) => g.id === selectedGroupId);
  const isAllGroup = selectedGroup?.name === 'All';
  const memberIds = new Set(groupMembers?.map((m) => m.id) ?? []);
  const assignedDeckIds = new Set(groupDecks?.map((deck) => deck.id) ?? []);
  // Back from a student's page to a group that is not there (deleted, or never was): no name to focus.
  const groupsLoaded = !!groups;
  const groupShown = !!selectedGroup;
  const returnFocusPending = returnFocusUserId !== null || returnFocusDeckId !== null;
  useEffect(() => {
    if (returnFocusPending && groupsLoaded && !groupShown) onReturnFocusDone?.();
    // Primitives only: the callback is new on every render.
  }, [returnFocusPending, groupsLoaded, groupShown]);
  /** Who could join: everyone not in the group (nobody until both lists are in). */
  const addCandidates = users && groupMembers ? users.filter((u) => !memberIds.has(u.id)) : [];

  const handleClassroomImport = async () => {
    if (!classroomFile || !importGroupName.trim()) {
      return;
    }

    const csvContent = await classroomFile.text();
    importGoogleClassroomGroup.mutate({
      name: importGroupName.trim(),
      description: importGroupDescription.trim() || undefined,
      csvContent,
    });
  };

  const handleGcImport = () => {
    if (!gcSelectedCourse || gcSelectedEmails.size === 0) return;
    importGoogleClassroomCourse.mutate({
      courseId: gcSelectedCourse.id,
      selectedStudentEmails: [...gcSelectedEmails],
      name: gcGroupName.trim() || undefined,
      description: gcGroupDescription.trim() || undefined,
    });
  };

  const handleCleverImport = () => {
    if (!cleverSelectedSection || cleverSelectedEmails.size === 0 || !cleverGroupName.trim()) return;
    importCleverSection.mutate({
      sectionId: cleverSelectedSection.id,
      selectedStudentEmails: [...cleverSelectedEmails],
      name: cleverGroupName.trim(),
      description: cleverGroupDescription.trim() || undefined,
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
            <h2 id="groups-title" className="font-semibold text-gray-900 dark:text-gray-100">{t('Groups')}</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setShowImportForm((current) => !current);
                  setShowCreateForm(false);
                  setImportMethod('csv');
                  setImportStatus(null);
                  setGcSelectedCourse(null);
                  setCleverSelectedSection(null);
                }}
                className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-sm font-medium"
              >
                {t('Import from Classroom')}
              </button>
              <button
                onClick={() => {
                  setShowCreateForm(true);
                  setShowImportForm(false);
                  setImportStatus(null);
                }}
                className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-sm font-medium"
              >
                {t('+ New Group')}
              </button>
            </div>
          </div>

          {showCreateForm && (
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder={t('Group name')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg mb-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-gray-100"
              />
              <textarea
                value={newGroupDescription}
                onChange={(e) => setNewGroupDescription(e.target.value)}
                placeholder={t('Description (optional)')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg mb-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-gray-100"
                rows={2}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => createGroup.mutate({ name: newGroupName, description: newGroupDescription })}
                  disabled={!newGroupName.trim()}
                  className="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {t('Create')}
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  {t('Cancel')}
                </button>
              </div>
            </div>
          )}

          {showImportForm && (
            <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 space-y-3">
              {/* Tab strip */}
              <div className="flex gap-2">
                <button
                  onClick={() => { setImportMethod('csv'); setGcSelectedCourse(null); setCleverSelectedSection(null); }}
                  className={`px-2 py-1 rounded text-xs font-medium ${importMethod === 'csv' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
                >
                  {t('CSV')}
                </button>
                <button
                  onClick={() => { setImportMethod('google'); setCleverSelectedSection(null); }}
                  className={`px-2 py-1 rounded text-xs font-medium ${importMethod === 'google' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
                >
                  {t('Google Classroom')}
                </button>
                {cleverEnabled && (
                  <button
                    onClick={() => { setImportMethod('clever'); setGcSelectedCourse(null); }}
                    className={`px-2 py-1 rounded text-xs font-medium ${importMethod === 'clever' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
                  >
                    {t('Clever')}
                  </button>
                )}
              </div>

              {/* CSV tab */}
              {importMethod === 'csv' && (
                <>
                  <input
                    type="text"
                    value={importGroupName}
                    onChange={(e) => setImportGroupName(e.target.value)}
                    placeholder={t('Group name')}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-gray-100"
                  />
                  <textarea
                    value={importGroupDescription}
                    onChange={(e) => setImportGroupDescription(e.target.value)}
                    placeholder={t('Description (optional)')}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-gray-100"
                    rows={2}
                  />
                  <input
                    ref={classroomFileRef}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => setClassroomFile(e.target.files?.[0] ?? null)}
                    className="w-full text-sm text-gray-700 dark:text-gray-300"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => { void handleClassroomImport(); }}
                      disabled={!importGroupName.trim() || !classroomFile || importGoogleClassroomGroup.isPending}
                      className="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                    >
                      {importGoogleClassroomGroup.isPending ? t('Uploading...') : t('Import CSV')}
                    </button>
                    <button
                      onClick={() => setShowImportForm(false)}
                      className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-600"
                    >
                      {t('Cancel')}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t('Expected columns include Email Address, First Name, Last Name, and optional Role.')}
                  </p>
                </>
              )}

              {/* Google Classroom tab */}
              {importMethod === 'google' && (
                <>
                  {!gcConnected ? (
                    <div className="space-y-2">
                      <a
                        href="/auth/google/classroom"
                        className="inline-flex items-center px-3 py-1 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                      >
                        {t('Connect Google Classroom')}
                      </a>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t('Connect to browse and select your courses.')}
                      </p>
                      <button
                        onClick={() => setShowImportForm(false)}
                        className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-600"
                      >
                        {t('Cancel')}
                      </button>
                    </div>
                  ) : !gcSelectedCourse ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('Your Google Classroom courses:')}</p>
                        <a href="/auth/google/classroom" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">{t('Reconnect')}</a>
                      </div>
                      {gcCoursesQuery.isLoading && (
                        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
                          {t('Loading courses...')}
                        </div>
                      )}
                      {gcCoursesQuery.error && (
                        <p className="text-xs text-red-600 dark:text-red-400">{gcCoursesQuery.error.message}</p>
                      )}
                      {gcCoursesQuery.data && gcCoursesQuery.data.length === 0 && (
                        <p className="text-sm text-gray-500 dark:text-gray-400">{t('No active courses found.')}</p>
                      )}
                      <div className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                        {gcCoursesQuery.data?.map((course) => (
                          <button
                            key={course.id}
                            onClick={() => {
                              setGcSelectedCourse(course);
                              setGcGroupName(course.section ? `${course.name} — ${course.section}` : course.name);
                              setGcGroupDescription('');
                            }}
                            className="w-full px-3 py-2 text-left hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                          >
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{course.name}</span>
                            {course.section && (
                              <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">— {course.section}</span>
                            )}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => setShowImportForm(false)}
                        className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-600"
                      >
                        {t('Cancel')}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <button
                        onClick={() => { setGcSelectedCourse(null); setGcSelectedEmails(new Set()); setGcGroupName(''); }}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        ← {t('Back to courses')}
                      </button>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {gcSelectedCourse.name}{gcSelectedCourse.section ? ` — ${gcSelectedCourse.section}` : ''}
                      </p>
                      <input
                        type="text"
                        value={gcGroupName}
                        onChange={(e) => setGcGroupName(e.target.value)}
                        placeholder={t('Group name')}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-gray-100"
                      />
                      <textarea
                        value={gcGroupDescription}
                        onChange={(e) => setGcGroupDescription(e.target.value)}
                        placeholder={t('Description (optional)')}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-gray-100"
                        rows={2}
                      />
                      {gcStudentsQuery.isLoading && (
                        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
                          {t('Loading students...')}
                        </div>
                      )}
                      {gcStudentsQuery.error && (
                        <p className="text-xs text-red-600 dark:text-red-400">{gcStudentsQuery.error.message}</p>
                      )}
                      {gcStudentsQuery.data && gcStudentsQuery.data.length > 0 && (
                        <ImportStudentPicker
                          idPrefix="classroom"
                          storageKey={CLASSROOM_IMPORT_STORAGE_KEY}
                          students={gcStudentsQuery.data}
                          selected={gcSelectedEmails}
                          onSelectedChange={setGcSelectedEmails}
                        />
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={handleGcImport}
                          disabled={gcSelectedEmails.size === 0 || !gcGroupName.trim() || importGoogleClassroomCourse.isPending || gcStudentsQuery.isLoading}
                          className="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                        >
                          {importGoogleClassroomCourse.isPending
                            ? t('Importing...')
                            : t('Import {{n}} students', { n: gcSelectedEmails.size })}
                        </button>
                        <button
                          onClick={() => setShowImportForm(false)}
                          className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-600"
                        >
                          {t('Cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Clever tab */}
              {importMethod === 'clever' && cleverEnabled && (
                <>
                  {!cleverConnected ? (
                    <div className="space-y-2">
                      <a
                        href="/auth/clever/roster"
                        className="inline-flex items-center px-3 py-1 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                      >
                        {t('Connect Clever')}
                      </a>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t('Connect to browse and select your sections.')}
                      </p>
                      <button
                        onClick={() => setShowImportForm(false)}
                        className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-600"
                      >
                        {t('Cancel')}
                      </button>
                    </div>
                  ) : !cleverSelectedSection ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('Your Clever sections:')}</p>
                        <a href="/auth/clever/roster" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">{t('Reconnect')}</a>
                      </div>
                      {cleverSectionsQuery.isLoading && (
                        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
                          {t('Loading sections...')}
                        </div>
                      )}
                      {cleverSectionsQuery.error && (
                        <p className="text-xs text-red-600 dark:text-red-400">{cleverSectionsQuery.error.message}</p>
                      )}
                      {cleverSectionsQuery.data && cleverSectionsQuery.data.length === 0 && (
                        <p className="text-sm text-gray-500 dark:text-gray-400">{t('No sections found.')}</p>
                      )}
                      <div className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                        {cleverSectionsQuery.data?.map((section) => (
                          <button
                            key={section.id}
                            onClick={() => {
                              setCleverSelectedSection(section);
                              setCleverGroupName(section.name);
                              setCleverGroupDescription('');
                            }}
                            className="w-full px-3 py-2 text-left hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                          >
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{section.name}</span>
                            {(section.subject || section.grade || section.period) && (
                              <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                                {[section.subject, section.grade && `Grade ${section.grade}`, section.period && `Period ${section.period}`].filter(Boolean).join(' · ')}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => setShowImportForm(false)}
                        className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-600"
                      >
                        {t('Cancel')}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <button
                        onClick={() => { setCleverSelectedSection(null); setCleverSelectedEmails(new Set()); setCleverGroupName(''); }}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        ← {t('Back to sections')}
                      </button>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{cleverSelectedSection.name}</p>
                      <input
                        type="text"
                        value={cleverGroupName}
                        onChange={(e) => setCleverGroupName(e.target.value)}
                        placeholder={t('Group name')}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-gray-100"
                      />
                      <textarea
                        value={cleverGroupDescription}
                        onChange={(e) => setCleverGroupDescription(e.target.value)}
                        placeholder={t('Description (optional)')}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-gray-100"
                        rows={2}
                      />
                      {cleverStudentsQuery.isLoading && (
                        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
                          {t('Loading students...')}
                        </div>
                      )}
                      {cleverStudentsQuery.error && (
                        <p className="text-xs text-red-600 dark:text-red-400">{cleverStudentsQuery.error.message}</p>
                      )}
                      {cleverStudentsQuery.data && cleverStudentsQuery.data.length > 0 && (
                        <ImportStudentPicker
                          idPrefix="clever"
                          storageKey={CLEVER_IMPORT_STORAGE_KEY}
                          students={cleverStudentsQuery.data}
                          selected={cleverSelectedEmails}
                          onSelectedChange={setCleverSelectedEmails}
                        />
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={handleCleverImport}
                          disabled={cleverSelectedEmails.size === 0 || !cleverGroupName.trim() || importCleverSection.isPending || cleverStudentsQuery.isLoading}
                          className="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                        >
                          {importCleverSection.isPending
                            ? t('Importing...')
                            : t('Import {{n}} students', { n: cleverSelectedEmails.size })}
                        </button>
                        <button
                          onClick={() => setShowImportForm(false)}
                          className="px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-600"
                        >
                          {t('Cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {importStatus && (
            <div
              className={`mx-4 mt-3 mb-2 p-3 rounded-lg text-sm ${
                importStatus.success ? 'bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-300'
              }`}
            >
              {importStatus.message}
            </div>
          )}

          {groups && groups.length > 0 && (
            <GroupList titleId="groups-title" groups={groups} selectedGroupId={selectedGroupId} onSelect={selectGroup} />
          )}
          <div>
            {(!groups || groups.length === 0) && (
              <div className="px-4 py-8 text-center">
                <div className="flex justify-center mb-3 text-gray-300 dark:text-gray-500">
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
                  </svg>
                </div>
                <p className="text-gray-500 dark:text-gray-400">{t('No groups yet')}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="lg:col-span-2">
        {/* Group Settings Modal */}
        {showSettingsModal && editingGroupSettings && selectedGroup && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl dark:shadow-gray-900/30 p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
                {t('Group Settings: {{name}}', { name: selectedGroup.name })}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                {t('Configure default settings for this group. Use "Apply to All Members" to push these to every member\'s settings.')}
              </p>

              <div className="space-y-5">
                {/* Study Limits */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{t('Study Limits')}</p>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t('New Cards per Day')}
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={500}
                        value={editingGroupSettings.newCardsPerDay}
                        onChange={(e) => setEditingGroupSettings({ ...editingGroupSettings, newCardsPerDay: parseInt(e.target.value || '0', 10) })}
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {t('Reviews per Day')}
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={500}
                        value={editingGroupSettings.reviewsPerDay}
                        onChange={(e) => setEditingGroupSettings({ ...editingGroupSettings, reviewsPerDay: parseInt(e.target.value || '0', 10) })}
                        className="w-full rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingGroupSettings.isOverride}
                        onChange={(e) => setEditingGroupSettings({ ...editingGroupSettings, isOverride: e.target.checked })}
                        className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {t('Enforce these limits (override user settings)')}
                      </span>
                    </label>
                    {editingGroupSettings.isOverride && (
                      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 space-y-2 ml-6">
                        <p className="text-xs font-medium text-gray-600 dark:text-gray-400">{t('Allow user to adjust:')}</p>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editingGroupSettings.allowHigher}
                            onChange={(e) => setEditingGroupSettings({ ...editingGroupSettings, allowHigher: e.target.checked })}
                            className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-600 dark:text-gray-400">{t('Allow higher limits')}</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editingGroupSettings.allowLower}
                            onChange={(e) => setEditingGroupSettings({ ...editingGroupSettings, allowLower: e.target.checked })}
                            className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-600 dark:text-gray-400">{t('Allow lower limits')}</span>
                        </label>
                      </div>
                    )}
                  </div>
                </div>

                {/* AI & Audio */}
                <div className="border-t dark:border-gray-700 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{t('AI & Audio')}</p>
                  <div className="space-y-3">
                    <SettingRow
                      label={t('AI Features')}
                      locked={editingGroupSettings.aiEnabledLocked}
                      onLockChange={(v) => setEditingGroupSettings({ ...editingGroupSettings, aiEnabledLocked: v })}
                    >
                      <Toggle
                        checked={editingGroupSettings.aiEnabled}
                        onChange={(v) => setEditingGroupSettings({ ...editingGroupSettings, aiEnabled: v })}
                      />
                    </SettingRow>
                    <SettingRow
                      label={t('Auto-play answer audio')}
                      locked={editingGroupSettings.autoPlayAudioLocked}
                      onLockChange={(v) => setEditingGroupSettings({ ...editingGroupSettings, autoPlayAudioLocked: v })}
                    >
                      <Toggle
                        checked={editingGroupSettings.autoPlayAudio}
                        onChange={(v) => setEditingGroupSettings({ ...editingGroupSettings, autoPlayAudio: v })}
                      />
                    </SettingRow>
                    <SettingRow
                      label={t('Auto-play question audio')}
                      locked={editingGroupSettings.autoPlayAudioFrontLocked}
                      onLockChange={(v) => setEditingGroupSettings({ ...editingGroupSettings, autoPlayAudioFrontLocked: v })}
                    >
                      <Toggle
                        checked={editingGroupSettings.autoPlayAudioFront}
                        onChange={(v) => setEditingGroupSettings({ ...editingGroupSettings, autoPlayAudioFront: v })}
                      />
                    </SettingRow>
                    <SettingRow
                      label={t('Mnemonic generation')}
                      locked={editingGroupSettings.mnemonicModeLocked}
                      onLockChange={(v) => setEditingGroupSettings({ ...editingGroupSettings, mnemonicModeLocked: v })}
                    >
                      <select
                        value={editingGroupSettings.mnemonicMode}
                        onChange={(e) => setEditingGroupSettings({ ...editingGroupSettings, mnemonicMode: e.target.value as MnemonicMode })}
                        className="rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="manual">{t('Manual only')}</option>
                        <option value="disabled">{t('Disabled')}</option>
                      </select>
                    </SettingRow>
                  </div>
                </div>

                {/* Language */}
                <div className="border-t dark:border-gray-700 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{t('Language')}</p>
                  <SettingRow
                    label={t('Interface language')}
                    locked={editingGroupSettings.localeLocked}
                    onLockChange={(v) => setEditingGroupSettings({ ...editingGroupSettings, localeLocked: v })}
                  >
                    <select
                      aria-label={t('Interface language')}
                      value={editingGroupSettings.locale ?? ''}
                      onChange={(e) => setEditingGroupSettings({ ...editingGroupSettings, locale: e.target.value || null })}
                      className="rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">{t('None (use user preference)')}</option>
                      {SUPPORTED_LOCALES.map((loc) => (
                        <option key={loc} value={loc}>
                          {LOCALE_DISPLAY_NAMES[loc]}
                        </option>
                      ))}
                    </select>
                  </SettingRow>
                </div>
              </div>

              {/* Apply status */}
              {applyStatus && (
                <div className={`mt-4 p-3 rounded-lg text-sm ${applyStatus.success ? 'bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-300'}`}>
                  {applyStatus.message}
                </div>
              )}

              <div className="flex flex-wrap gap-2 mt-6">
                <button
                  onClick={handleSaveGroupSettings}
                  disabled={updateGroupSettings.isPending}
                  className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {updateGroupSettings.isPending ? t('Saving...') : t('Save')}
                </button>
                <button
                  onClick={() => {
                    if (!selectedGroupId) return;
                    setApplyStatus(null);
                    applyGroupSettingsToMembers.mutate({ groupId: selectedGroupId });
                  }}
                  disabled={applyGroupSettingsToMembers.isPending}
                  className="flex-1 py-2 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 transition-colors disabled:opacity-50"
                >
                  {applyGroupSettingsToMembers.isPending ? t('Applying...') : t('Apply to All Members')}
                </button>
                <button
                  onClick={() => {
                    setShowSettingsModal(false);
                    setEditingGroupSettings(null);
                    setApplyStatus(null);
                  }}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                >
                  {t('Close')}
                </button>
              </div>
            </div>
          </div>
        )}

        {selectedGroup ? (
          <div className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
              {/* Wraps on a phone: in one row, the export controls ran off the right edge of the screen. */}
              <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">{selectedGroup.name}</h2>
                  {selectedGroup.description && (
                    <p className="text-gray-600 dark:text-gray-400 mt-1">{selectedGroup.description}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleOpenSettingsModal}
                    disabled={!fetchedGroupSettings}
                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-sm disabled:opacity-50"
                  >
                    {t('Settings')}
                  </button>
                  <GroupPinsButton key={`pins-${selectedGroup.id}`} groupId={selectedGroup.id} groupName={selectedGroup.name} />
                  {selectedGroup.name !== 'All' && (
                    <button
                      onClick={() => {
                        if (confirm(t('Are you sure you want to delete this group?'))) {
                          deleteGroup.mutate({ id: selectedGroup.id });
                        }
                      }}
                      className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 text-sm"
                    >
                      {t('Delete Group')}
                    </button>
                  )}
                  <select
                    aria-label={t('Data to export')}
                    value={exportDataset}
                    onChange={(e) => {
                      setExportDataset(e.target.value as 'summary' | 'reviews' | 'vocab' | 'completions' | 'labs' | 'speaking' | 'conjugation');
                      setExportNotice(null);
                    }}
                    className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-gray-100"
                  >
                    <option value="summary">{t('Student summary')}</option>
                    <option value="reviews">{t('Review history')}</option>
                    <option value="vocab">{t('Vocabulómetro results')}</option>
                    <option value="completions">{t('Study sessions finished')}</option>
                    <option value="labs">{t('Audio labs')}</option>
                    <option value="speaking">{t('Speaking tasks')}</option>
                    <option value="conjugation">{t('Conjugation')}</option>
                  </select>
                  <button
                    onClick={async () => {
                      setExportNotice(null);
                      const result = await exportGroupQuery.refetch();
                      if (!result.data) {
                        setExportNotice(t('Export failed — please try again.'));
                        return;
                      }
                      // Never hand back a header-only file: say so instead.
                      if (result.data.rowCount === 0) {
                        setExportNotice(t('No data of this type for this group yet — nothing was downloaded.'));
                        return;
                      }
                      const slug = selectedGroup.name.replace(/[^\w.-]+/g, '_');
                      downloadCsv(result.data.csv, `${slug}-${exportDataset}.csv`);
                      setExportNotice(t('Exported {{count}} row(s).', { count: result.data.rowCount }));
                    }}
                    disabled={exportGroupQuery.isFetching}
                    className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 text-sm disabled:opacity-50"
                  >
                    {exportGroupQuery.isFetching ? t('Exporting...') : t('Export data (CSV)')}
                  </button>
                </div>
              </div>
            </div>

            <section aria-labelledby="group-members-title" className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <h3 id="group-members-title" className="font-semibold text-gray-900 dark:text-gray-100">{t('Members')}</h3>
              </div>
              <div className="p-4">
                {/* Keys unique among siblings: two children with one key and React keeps the old one (another group's ticks). */}
                <AddStudentsPicker
                  key={`add-${selectedGroup.id}`}
                  groupId={selectedGroup.id}
                  candidates={addCandidates}
                  loaded={!!users && !!groupMembers}
                  selected={selectedAddIds}
                  onSelectedChange={setSelectedAddIds}
                  view={addView}
                  onViewChange={setAddView}
                  onAdd={() => {
                    setMemberStatus(null);
                    addUsersToGroup.mutate({ groupId: selectedGroup.id, userIds: [...selectedAddIds] });
                  }}
                  adding={addUsersToGroup.isPending}
                />

                {memberStatus && (
                  <div className={'mb-4 rounded-lg px-3 py-2 text-sm ' + (memberStatus.success ? 'bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-300')}>
                    {memberStatus.message}
                  </div>
                )}

                {exportNotice && (
                  <div className="mb-4 rounded-lg px-3 py-2 text-sm bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300">
                    {exportNotice}
                  </div>
                )}

                {isAllGroup && (
                  <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
                    {t('Members cannot be removed from the All group.')}
                  </p>
                )}

                {/* Keyed by group: another group's list starts again from its first page, with no search. */}
                <GroupMembersTable
                  key={`members-${selectedGroup.id}`}
                  groupId={selectedGroup.id}
                  titleId="group-members-title"
                  members={groupMembers}
                  canRemove={!isAllGroup}
                  onRemove={(member) => removeUserFromGroup.mutate({ userId: member.id, groupId: selectedGroup.id })}
                  onOpenUser={() => setOpenedFrom('members')}
                  returnFocusUserId={openedFrom === 'members' ? returnFocusUserId : null}
                  onReturnFocusDone={onReturnFocusDone}
                />
              </div>
            </section>

            {/* Keyed by group: another group starts again at today. */}
            <GroupFlashcardsDay
              key={`flashcards-${selectedGroup.id}`}
              groupId={selectedGroup.id}
              onOpenUser={() => setOpenedFrom('flashcards')}
              returnFocusUserId={openedFrom === 'flashcards' ? returnFocusUserId : null}
              onReturnFocusDone={onReturnFocusDone}
            />

            <section aria-labelledby="group-decks-title" className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <h3 id="group-decks-title" className="font-semibold text-gray-900 dark:text-gray-100">{t('Assigned Decks')}</h3>
              </div>
              <div className="p-4">
                <select
                  aria-label={t('Assign deck to group...')}
                  onChange={(e) => {
                    const deckId = parseInt(e.target.value, 10);
                    if (deckId) {
                      assignDeckToGroup.mutate({ deckId, groupId: selectedGroup.id });
                    }
                  }}
                  value=""
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg mb-4 dark:bg-gray-700 dark:text-gray-100"
                >
                  <option value="">{t('Assign deck to group...')}</option>
                  {decks
                    ?.filter((deck) => !assignedDeckIds.has(deck.id))
                    .map((deck) => (
                    <option key={deck.id} value={deck.id}>
                      {deck.name} ({t('{{count}} cards', { count: deck.cardCount })})
                    </option>
                    ))}
                </select>

                {/* Keyed by group: another group's list starts again from its first page, with no search. */}
                <GroupDecksTable
                  key={`decks-${selectedGroup.id}`}
                  groupId={selectedGroup.id}
                  titleId="group-decks-title"
                  decks={groupDecks}
                  onRemove={(deck) => removeDeckFromGroup.mutate({ deckId: deck.id, groupId: selectedGroup.id })}
                  onOpenDeck={onOpenDeck}
                  returnFocusDeckId={returnFocusDeckId}
                  onReturnFocusDone={onReturnFocusDone}
                />
              </div>
            </section>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-8 text-center">
            <p className="text-gray-500 dark:text-gray-400">{t('Select a group to manage its members and decks')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
