// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LanguageSelector from './LanguageSelector';

// Mock i18n
const mockSetLocale = vi.fn();
vi.mock('../i18n', () => ({
  useI18n: () => ({
    locale: 'en',
    setLocale: mockSetLocale,
    t: (key: string) => key,
  }),
}));

// Mock trpc (LanguageSelector syncs the locale via the signed-in user's settings)
const h = vi.hoisted(() => ({
  isAuthenticated: false,
  settingsQuery: vi.fn((_input: unknown, _opts: { enabled?: boolean }) => ({ data: null as unknown })),
  updateSettings: vi.fn(),
}));
vi.mock('../api/trpc', () => ({
  trpc: {
    settings: {
      get: { useQuery: (input: unknown, opts: { enabled?: boolean }) => h.settingsQuery(input, opts) },
      update: { useMutation: () => ({ mutate: h.updateSettings }) },
    },
  },
}));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: h.isAuthenticated }),
}));

describe('LanguageSelector', () => {
  beforeEach(() => {
    mockSetLocale.mockClear();
    h.settingsQuery.mockClear();
    h.settingsQuery.mockImplementation(() => ({ data: null }));
    h.updateSettings.mockClear();
    h.isAuthenticated = false;
  });

  it('does not ask for settings before anyone has signed in (the login page)', () => {
    render(<LanguageSelector />);
    expect(h.settingsQuery).toHaveBeenCalled();
    for (const [, opts] of h.settingsQuery.mock.calls) expect(opts.enabled).toBe(false);
  });

  it('syncs the locale from a signed-in user’s settings and saves a new choice there', () => {
    h.isAuthenticated = true;
    const settings = { newCardsPerDay: 20, reviewsPerDay: 100, aiEnabled: true, locale: 'es' };
    h.settingsQuery.mockImplementation(() => ({ data: settings }));
    render(<LanguageSelector />);

    for (const [, opts] of h.settingsQuery.mock.calls) expect(opts.enabled).toBe(true);
    expect(mockSetLocale).toHaveBeenCalledWith('es');

    fireEvent.click(screen.getByRole('button', { name: 'Language' }));
    fireEvent.click(screen.getByText('English'));
    expect(h.updateSettings).toHaveBeenCalledWith({ newCardsPerDay: 20, reviewsPerDay: 100, aiEnabled: true, locale: 'en' });
  });

  it('is closed by default and shows only the trigger button', () => {
    render(<LanguageSelector />);
    
    // The trigger button should be visible (found by aria-label or title)
    const button = screen.getByRole('button', { name: 'Language' });
    expect(button).toBeInTheDocument();
    
    // Options should not be visible
    expect(screen.queryByText('Español')).not.toBeInTheDocument();
  });

  it('opens when clicked and shows language options', () => {
    render(<LanguageSelector />);
    
    const button = screen.getByRole('button', { name: 'Language' });
    fireEvent.click(button);
    
    // Now options should be visible
    expect(screen.getByText('Español')).toBeInTheDocument();
    expect(screen.getByText('English')).toBeInTheDocument();
  });

  it('calls setLocale and closes when an option is selected', () => {
    render(<LanguageSelector />);
    
    const button = screen.getByRole('button', { name: 'Language' });
    fireEvent.click(button);
    
    const spanishOption = screen.getByText('Español');
    fireEvent.click(spanishOption);
    
    expect(mockSetLocale).toHaveBeenCalledWith('es');
    // It should close after selection
    expect(screen.queryByText('Español')).not.toBeInTheDocument();
  });

  it('closes when clicking outside', () => {
    render(<LanguageSelector />);
    
    const button = screen.getByRole('button', { name: 'Language' });
    fireEvent.click(button);
    expect(screen.getByText('Español')).toBeInTheDocument();
    
    // Click outside
    fireEvent.mouseDown(document.body);
    
    expect(screen.queryByText('Español')).not.toBeInTheDocument();
  });
});
