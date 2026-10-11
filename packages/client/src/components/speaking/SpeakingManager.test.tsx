// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SpeakingManager from './SpeakingManager';

// Shared with the mocks below (vi.mock factories are hoisted).
const h = vi.hoisted(() => ({
  tasks: [] as unknown[],
  create: vi.fn(async (_input: unknown) => ({ id: 99 })),
  update: vi.fn(async (_input: unknown) => ({ success: true })),
  remove: vi.fn(),
  invalidateList: vi.fn(async () => {}),
  upload: vi.fn(async (..._args: unknown[]) => ({ audioUrl: '/api/assets/model.mp3', mimeType: 'audio/mpeg', sizeBytes: 3 })),
  /** Admin › Labs' exam sets (labs.examSets), answered only while the query is enabled. */
  labSets: [] as { examSet: string }[],
  labSetsEnabled: [] as unknown[],
}));

vi.mock('../../api/rawUpload', () => ({ uploadRaw: (...args: unknown[]) => h.upload(...args) }));

vi.mock('../../api/trpc', () => ({
  trpc: {
    useUtils: () => ({ speaking: { adminList: { invalidate: h.invalidateList } } }),
    admin: {
      getGroups: { useQuery: () => ({ data: [{ id: 1, name: 'Español 1' }, { id: 2, name: 'Español 2' }] }) },
    },
    labs: {
      examSets: {
        useQuery: (_input: unknown, options?: { enabled?: boolean }) => {
          h.labSetsEnabled.push(options?.enabled);
          return { data: options?.enabled === false ? undefined : h.labSets };
        },
      },
    },
    speaking: {
      adminList: { useQuery: () => ({ data: h.tasks, isLoading: false, error: null }) },
      create: { useMutation: () => ({ mutateAsync: h.create }) },
      update: { useMutation: () => ({ mutateAsync: h.update }) },
      remove: { useMutation: () => ({ mutate: h.remove, isPending: false }) },
    },
  },
}));

const task = (overrides: Record<string, unknown>) => ({
  id: 1,
  title: 'Task',
  instructions: null,
  referenceText: null,
  showReference: true,
  modelAudioUrl: null,
  targetSeconds: null,
  forEveryone: true,
  active: true,
  createdBy: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
  groupIds: [],
  studentCount: 0,
  ungraded: 0,
  lastSubmittedAt: null,
  examSet: null,
  ...overrides,
});

const renderManager = (onBusyChange?: (busy: boolean) => void) => render(
  <MemoryRouter><SpeakingManager onBusyChange={onBusyChange} /></MemoryRouter>,
);
const taskRow = (title: string) => screen.getByText(title).closest('tr')!;
/** The cell of `row` under the column headed `heading`. */
const cellIn = (row: HTMLElement, heading: string) => {
  const column = screen.getAllByRole('columnheader').findIndex((th) => th.textContent === heading);
  return within(row).getAllByRole('cell')[column];
};

describe('SpeakingManager', () => {
  beforeEach(() => {
    h.tasks = [
      task({
        id: 1,
        title: 'El cuento de la semana',
        referenceText: 'Había una vez…',
        showReference: false,
        targetSeconds: 90,
        studentCount: 3,
        ungraded: 2,
        lastSubmittedAt: '2026-09-21T15:00:00.000Z',
      }),
      task({ id: 2, title: 'Escalera oral, peldaño 1', active: false, forEveryone: false, groupIds: [1, 2], referenceText: 'Me llamo…' }),
      task({ id: 3, title: 'Orphan', forEveryone: false, groupIds: [] }),
    ];
    h.create.mockClear();
    h.update.mockClear();
    h.remove.mockClear();
    h.invalidateList.mockClear();
    h.upload.mockClear();
    h.labSets = [];
    h.labSetsEnabled.length = 0;
  });

  afterEach(() => vi.restoreAllMocks());

  it('lists each task with its status, groups, text mode, target and counts', () => {
    renderManager();

    const cuento = taskRow('El cuento de la semana');
    expect(cuento).toHaveTextContent('Active');
    expect(cuento).toHaveTextContent('Everyone');
    expect(cuento).toHaveTextContent('Recited from memory');
    expect(cellIn(cuento, 'Target')).toHaveTextContent(/^1:30$/);
    // The count first, then the date of the latest recording.
    expect(cellIn(cuento, 'Turned in')).toHaveTextContent(/^3 · \S/);
    expect(cellIn(cuento, 'Ungraded')).toHaveTextContent(/^2$/);
    expect(within(cuento).getByText('2')).toBeInTheDocument();

    const escalera = taskRow('Escalera oral, peldaño 1');
    expect(escalera).toHaveTextContent('Draft');
    expect(escalera).toHaveTextContent('Español 1, Español 2');
    expect(escalera).toHaveTextContent('Text shown');

    const orphan = taskRow('Orphan');
    expect(orphan).toHaveTextContent('No groups — hidden from students');
    expect(orphan).toHaveTextContent('No reference text');
  });

  it('checks the form before creating a task', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByRole('button', { name: 'New speaking task' }));
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Give the task a title.');

    await user.type(screen.getByLabelText('Title'), 'Cuento 3');
    await user.click(screen.getByLabelText('Students see the text while recording'));
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Add the text students should recite');

    await user.type(screen.getByLabelText('Reference text (optional)'), 'Había una vez');
    await user.type(screen.getByLabelText('Target length (optional)'), '2');
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    expect(screen.getByRole('alert')).toHaveTextContent('between 5 seconds and 60 minutes');
    expect(h.create).not.toHaveBeenCalled();
  });

  it('creates a task with the target in seconds and the chosen groups', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByRole('button', { name: 'New speaking task' }));
    await user.type(screen.getByLabelText('Title'), '  Cuento 3  ');
    await user.type(screen.getByLabelText('Reference text (optional)'), 'Había una vez');
    await user.click(screen.getByLabelText('Students see the text while recording'));
    await user.type(screen.getByLabelText('Target length (optional)'), '1,5');
    await user.selectOptions(screen.getByLabelText('Unit for the target length'), 'minutes');
    await user.click(screen.getByLabelText('Español 2'));
    await user.click(screen.getByLabelText(/Released to students/));
    await user.click(screen.getByRole('button', { name: 'Create task' }));

    expect(h.create).toHaveBeenCalledWith({
      title: 'Cuento 3',
      instructions: null,
      referenceText: 'Había una vez',
      showReference: false,
      modelAudioUrl: null,
      targetSeconds: 90,
      active: true,
      examSet: null,
      groupIds: [2],
    });
    expect(h.invalidateList).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Create task' })).toBeNull();
  });

  it('shows the server’s error when saving fails', async () => {
    const user = userEvent.setup();
    h.create.mockRejectedValueOnce(new Error('One of the chosen groups no longer exists. Reload and try again.'));
    renderManager();

    await user.click(screen.getByRole('button', { name: 'New speaking task' }));
    await user.type(screen.getByLabelText('Title'), 'Cuento 3');
    await user.click(screen.getByRole('button', { name: 'Create task' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('One of the chosen groups no longer exists');
    expect(screen.getByRole('button', { name: 'Create task' })).toBeEnabled();
  });

  it('uploads a model recording, reports busy meanwhile, and can remove it', async () => {
    const user = userEvent.setup();
    let finish: (value: { audioUrl: string; mimeType: string; sizeBytes: number }) => void = () => {};
    h.upload.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const onBusyChange = vi.fn();
    renderManager(onBusyChange);

    await user.click(screen.getByRole('button', { name: 'New speaking task' }));
    await user.upload(screen.getByLabelText('Upload an audio file'), new File(['abc'], 'modelo.mp3', { type: 'audio/mpeg' }));

    expect(h.upload.mock.calls[0][0]).toBe('/api/media');
    expect(screen.getByRole('status')).toHaveTextContent('Uploading… 0%');
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole('button', { name: 'Create task' })).toBeDisabled();

    await act(async () => finish({ audioUrl: '/api/assets/model.mp3', mimeType: 'audio/mpeg', sizeBytes: 3 }));

    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByLabelText('Model recording')).toHaveAttribute('src', '/api/assets/model.mp3');

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByLabelText('Model recording')).toBeNull();
  });

  // The admin page turns busy into its leave guard (pages/Admin.tsx).
  it('reports busy while a save is in flight, so the page can guard Back and reload', async () => {
    const user = userEvent.setup();
    let finish: (value: { id: number }) => void = () => {};
    h.create.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const onBusyChange = vi.fn();
    renderManager(onBusyChange);

    await user.click(screen.getByRole('button', { name: 'New speaking task' }));
    await user.type(screen.getByLabelText('Title'), 'Cuento U1 A');
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole('button', { name: 'Create task' }));

    expect(h.create).toHaveBeenCalledTimes(1);
    expect(onBusyChange).toHaveBeenLastCalledWith(true);

    await act(async () => finish({ id: 99 }));
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it('frees the list when the task being edited is deleted elsewhere', async () => {
    const user = userEvent.setup();
    const view = renderManager();
    await user.click(within(taskRow('Orphan')).getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('button', { name: 'New speaking task' })).toBeDisabled();

    h.tasks = h.tasks.filter((t) => (t as { id: number }).id !== 3);
    view.rerender(<MemoryRouter><SpeakingManager /></MemoryRouter>);

    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'New speaking task' })).toBeEnabled();
    expect(within(taskRow('El cuento de la semana')).getByRole('button', { name: 'Review' })).toBeEnabled();
  });

  it('keeps an open form’s draft: Review, Edit and New wait for its Save or Cancel', async () => {
    const user = userEvent.setup();
    renderManager();
    const waitMessage = 'Save or cancel the task you are editing first.';

    await user.click(within(taskRow('Orphan')).getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByLabelText('Title'), ' (draft)');

    const cuento = taskRow('El cuento de la semana');
    for (const button of [
      within(cuento).getByRole('button', { name: 'Review' }),
      within(cuento).getByRole('button', { name: 'Edit' }),
      screen.getByRole('button', { name: 'New speaking task' }),
    ]) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', waitMessage);
    }
    expect(screen.getByLabelText('Title')).toHaveValue('Orphan (draft)');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const review = within(taskRow('El cuento de la semana')).getByRole('button', { name: 'Review' });
    expect(review).toBeEnabled();
    expect(review).not.toHaveAttribute('title');
    expect(screen.getByRole('button', { name: 'New speaking task' })).toBeEnabled();
  });

  it('refuses a file that is not audio before uploading it', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderManager();

    await user.click(screen.getByRole('button', { name: 'New speaking task' }));
    await user.upload(screen.getByLabelText('Upload an audio file'), new File(['abc'], 'cuento.pdf', { type: 'application/pdf' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Not a supported audio file');
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('edits a task, sending groups only when they changed', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(within(taskRow('Escalera oral, peldaño 1')).getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Title')).toHaveValue('Escalera oral, peldaño 1');
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Peldaño 1');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(h.update).toHaveBeenCalledWith(expect.not.objectContaining({ groupIds: expect.anything() }));
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ id: 2, title: 'Peldaño 1', referenceText: 'Me llamo…' }));

    await user.click(within(taskRow('Escalera oral, peldaño 1')).getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByLabelText('Español 1'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(h.update).toHaveBeenLastCalledWith(expect.objectContaining({ id: 2, groupIds: [2] }));
  });

  it('makes a task a speaking test: the exam set as the server stores it, trimmed', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByRole('button', { name: 'New speaking task' }));
    const field = screen.getByLabelText('Exam set');
    expect(field).toHaveAttribute('maxLength', '40');
    expect(field).toHaveAttribute('placeholder', 'for example U3');
    expect(field).toHaveAccessibleDescription(/^Leave it empty for a practice task\. A name such as U2 makes it a test/);
    await user.type(screen.getByLabelText('Title'), 'Examen U2 · Expresión oral');
    await user.type(field, ' U2 ');
    await user.click(screen.getByRole('button', { name: 'Create task' }));

    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Examen U2 · Expresión oral', examSet: 'U2' }));
  });

  it('refuses an exam set name that is too long, and sends nothing', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getByRole('button', { name: 'New speaking task' }));
    await user.type(screen.getByLabelText('Title'), 'Examen U2');
    // Past the field's own limit (a paste some browsers let through).
    fireEvent.change(screen.getByLabelText('Exam set'), { target: { value: 'U'.repeat(41) } });
    await user.click(screen.getByRole('button', { name: 'Create task' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Name the exam set (for example U3).');
    expect(h.create).not.toHaveBeenCalled();
  });

  it('shows a speaking test’s set in the list and in its form, and clearing it makes it practice again', async () => {
    const user = userEvent.setup();
    h.tasks = [...h.tasks, task({ id: 4, title: 'Examen U2 · Expresión oral', examSet: 'U2' })];
    renderManager();

    expect(within(taskRow('Examen U2 · Expresión oral')).getByText('Test · U2')).toHaveClass('bg-amber-100');
    expect(within(taskRow('El cuento de la semana')).queryByText(/^Test · /)).toBeNull();
    // The sets already in use are offered.
    await user.click(within(taskRow('Examen U2 · Expresión oral')).getByRole('button', { name: 'Edit' }));
    const field = screen.getByLabelText('Exam set');
    expect(field).toHaveValue('U2');
    const options = document.getElementById(field.getAttribute('list')!)!.querySelectorAll('option');
    expect([...options].map((option) => option.value)).toEqual(['U2']);

    // Saved unchanged: the set is sent as it is (the server changes nothing).
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.update).toHaveBeenLastCalledWith(expect.objectContaining({ id: 4, examSet: 'U2' }));

    await user.click(within(taskRow('Examen U2 · Expresión oral')).getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Exam set'));
    await user.type(screen.getByLabelText('Exam set'), '   ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.update).toHaveBeenLastCalledWith(expect.objectContaining({ id: 4, examSet: null }));
  });

  it('offers the sets of the listening forms too, each once, in natural order', async () => {
    const user = userEvent.setup();
    // Admin › Labs has forms in U2 and U10; speaking tests use U3 and (another spelling) u2.
    h.labSets = [{ examSet: 'U10' }, { examSet: 'U2' }];
    h.tasks = [
      ...h.tasks,
      task({ id: 4, title: 'Examen U3 · Expresión oral', examSet: 'U3' }),
      task({ id: 5, title: 'Examen U2 · Expresión oral', examSet: 'u2' }),
    ];
    renderManager();
    // Not asked for until a form is open.
    expect(h.labSetsEnabled).not.toContain(true);

    // A practice task the teacher makes a test of the forms' set.
    await user.click(within(taskRow('Orphan')).getByRole('button', { name: 'Edit' }));
    const field = screen.getByLabelText('Exam set');
    const options = document.getElementById(field.getAttribute('list')!)!.querySelectorAll('option');
    // A lab's spelling first, as the server keeps it.
    expect([...options].map((option) => option.value)).toEqual(['U2', 'U3', 'U10']);
  });

  it('a practice task is saved as practice', async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(within(taskRow('Orphan')).getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Exam set')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.update).toHaveBeenLastCalledWith(expect.objectContaining({ id: 3, examSet: null }));
  });

  it('warns that deleting a task deletes the students’ recordings', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderManager();

    const deleteButton = within(taskRow('El cuento de la semana')).getByRole('button', { name: 'Delete' });
    await user.click(deleteButton);
    expect(confirm.mock.calls[0][0]).toMatch(/recordings 3 student\(s\) turned in/);
    expect(h.remove).not.toHaveBeenCalled();

    await user.click(deleteButton);
    expect(h.remove).toHaveBeenCalledWith({ id: 1 });
  });
});
