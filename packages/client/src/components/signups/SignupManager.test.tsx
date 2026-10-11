// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SignupManager from './SignupManager';

// Shared with the mocks below (vi.mock factories are hoisted).
const h = vi.hoisted(() => ({
  sheets: [] as unknown[],
  detail: null as unknown,
  create: vi.fn(async (_input: unknown) => ({ id: 7 })),
  update: vi.fn(async (_input: unknown) => ({ success: true })),
  remove: vi.fn(),
  assign: vi.fn(),
  unassign: vi.fn(),
  removeDate: vi.fn(),
  saveDates: vi.fn(async (_input: unknown) => ({ added: 1, updated: 0 })),
  invalidate: vi.fn(async () => {}),
}));

vi.mock('../../api/trpc', () => ({
  trpc: {
    useUtils: () => ({ signups: { adminList: { invalidate: h.invalidate }, adminGet: { invalidate: h.invalidate } } }),
    admin: {
      getGroups: { useQuery: () => ({ data: [{ id: 1, name: 'Year 1 Theatre' }, { id: 2, name: 'Year 1 Spanish' }] }) },
    },
    signups: {
      adminList: { useQuery: () => ({ data: h.sheets, isLoading: false, error: null }) },
      adminGet: { useQuery: () => ({ data: h.detail, isLoading: false, error: null }) },
      create: { useMutation: () => ({ mutateAsync: h.create }) },
      update: { useMutation: () => ({ mutateAsync: h.update, mutate: h.update, isPending: false }) },
      remove: { useMutation: () => ({ mutate: h.remove, isPending: false }) },
      assign: { useMutation: () => ({ mutate: h.assign, isPending: false }) },
      unassign: { useMutation: () => ({ mutate: h.unassign, isPending: false }) },
      removeDate: { useMutation: () => ({ mutate: h.removeDate, isPending: false }) },
      saveDates: { useMutation: () => ({ mutateAsync: h.saveDates, isPending: false }) },
    },
  },
}));

const baseSheet = {
  id: 3, title: 'Show and tell', description: null, slotsPerDate: 2, picksPerStudent: 2, showNames: true, open: true,
  timeZone: 'America/Los_Angeles', forEveryone: false, active: true, createdBy: 1, createdAt: '2026-09-25T00:00:00.000Z', groupIds: [1],
};

const renderManager = () => render(<MemoryRouter><SignupManager /></MemoryRouter>);

describe('SignupManager', () => {
  beforeEach(() => {
    h.sheets = [
      { ...baseSheet, dateCount: 40, firstDate: '2026-09-28', lastDate: '2026-12-18', slots: 80, claimCount: 12 },
      { ...baseSheet, id: 4, title: 'Orphan', active: false, open: false, groupIds: [], dateCount: 0, firstDate: null, lastDate: null, slots: 0, claimCount: 0 },
    ];
    h.detail = {
      sheet: baseSheet,
      today: '2026-09-25',
      dates: [
        {
          id: 11, sheetId: 3, date: '2026-09-28', label: 'Day 31', capacity: null, effectiveCapacity: 2,
          claims: [{ id: 101, userId: 2, name: 'Ana Ruiz', email: '100002@students.school.test', assigned: false, createdAt: '2026-09-25T00:00:00.000Z' }],
        },
      ],
      roster: [
        { id: 2, name: 'Ana Ruiz', email: '100002@students.school.test', dates: ['2026-09-28', '2026-10-01'] },
        { id: 3, name: 'Beto Soto', email: '100003@students.school.test', dates: [] },
      ],
    };
    for (const fn of [h.create, h.update, h.remove, h.assign, h.unassign, h.removeDate, h.saveDates]) fn.mockClear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => vi.restoreAllMocks());

  it('lists each sheet with its days, how full it is, and who it is for', () => {
    renderManager();
    const row = screen.getByText('Show and tell').closest('tr')!;
    expect(within(row).getByText('40 · Mon, Sep 28 – Fri, Dec 18')).toBeInTheDocument();
    expect(within(row).getByText('12 / 80')).toBeInTheDocument();
    expect(within(row).getByText('Year 1 Theatre')).toBeInTheDocument();
    const orphan = screen.getByText('Orphan').closest('tr')!;
    expect(within(orphan).getByText('Nobody (its groups were deleted)')).toBeInTheDocument();
    expect(within(orphan).getByText('Hidden')).toBeInTheDocument();
  });

  it('creates a sheet from pasted days, in date order', async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(screen.getByRole('button', { name: 'New sign-up sheet' }));
    await user.type(screen.getByLabelText('Title'), 'Show and tell');
    await user.clear(screen.getByLabelText('Days per student'));
    await user.type(screen.getByLabelText('Days per student'), '2');
    await user.click(screen.getByLabelText('Year 1 Theatre'));
    await user.type(screen.getByLabelText('Days'), '2026-09-29, Day 32{enter}9/28/2026, Day 31');
    expect(screen.getByText(/^2 day\(s\): Mon, Sep 28 to Tue, Sep 29/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create sheet' }));

    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Show and tell',
      slotsPerDate: 2,
      picksPerStudent: 2,
      showNames: true,
      open: true,
      active: false,
      groupIds: [1],
      dates: [{ date: '2026-09-28', label: 'Day 31' }, { date: '2026-09-29', label: 'Day 32' }],
    }));
    // On to the new sheet's roster.
    expect(await screen.findByText('Not done picking (1 of 2)')).toBeInTheDocument();
  });

  it('leaves a sheet’s groups alone when an edit does not touch them', async () => {
    const user = userEvent.setup();
    renderManager();
    // "Orphan" lost its groups: saving a new title must not open it to everyone.
    await user.click(within(screen.getByText('Orphan').closest('tr')!).getByRole('button', { name: 'Edit' }));
    expect(screen.getByText(/groups were deleted, so no student sees it/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'Orphan, renamed');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ id: 4, title: 'Orphan, renamed', groupIds: undefined }));

    await user.click(within(screen.getByText('Show and tell').closest('tr')!).getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByLabelText('Year 1 Spanish'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.update).toHaveBeenLastCalledWith(expect.objectContaining({ id: 3, groupIds: [1, 2] }));
  });

  it('will not create a sheet from a line it cannot read', async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(screen.getByRole('button', { name: 'New sign-up sheet' }));
    await user.type(screen.getByLabelText('Title'), 'Show and tell');
    await user.type(screen.getByLabelText('Days'), '2026-09-28{enter}Monday the 29th');
    await user.click(screen.getByRole('button', { name: 'Create sheet' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Line 2 does not start with a date: Monday the 29th');
    expect(h.create).not.toHaveBeenCalled();
  });

  it('shows the roster, and moves students on and off days', async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(within(screen.getByText('Show and tell').closest('tr')!).getByRole('button', { name: 'Roster' }));

    expect(screen.getByText('Not done picking (1 of 2)')).toBeInTheDocument();
    expect(screen.getByText('Beto Soto')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Put a student on Monday, September 28, 2026'), '3');
    expect(h.assign).toHaveBeenCalledWith({ dateId: 11, userId: 3 });
    await user.click(screen.getByRole('button', { name: 'Take Ana Ruiz off Monday, September 28, 2026' }));
    expect(h.unassign).toHaveBeenCalledWith({ claimId: 101 });
    await user.click(screen.getByRole('button', { name: 'Remove day' }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('1 student(s) on it will lose it'));
    expect(h.removeDate).toHaveBeenCalledWith({ dateId: 11 });

    await user.type(screen.getByLabelText('Add days'), '2026-12-18, Day 90');
    await user.click(screen.getByRole('button', { name: 'Add 1 day(s)' }));
    expect(h.saveDates).toHaveBeenCalledWith({ sheetId: 3, dates: [{ date: '2026-12-18', label: 'Day 90' }] });
  });
});
