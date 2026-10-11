// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ThemeToggle from './ThemeToggle';

// Mock i18n
vi.mock('../i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe('ThemeToggle', () => {
  let originalMatchMedia: typeof window.matchMedia;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    originalMatchMedia = window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  function mockMatchMedia(prefersDark: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' && prefersDark,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  }

  it('defaults to light theme when no stored preference and system is light', () => {
    mockMatchMedia(false);
    render(<ThemeToggle />);

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('libresrs.theme')).toBe('light');
  });

  it('uses system dark preference when no stored preference', () => {
    mockMatchMedia(true);
    render(<ThemeToggle />);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('libresrs.theme')).toBe('dark');
  });

  it('restores stored dark preference from localStorage', () => {
    mockMatchMedia(false);
    localStorage.setItem('libresrs.theme', 'dark');
    render(<ThemeToggle />);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('restores stored light preference from localStorage', () => {
    mockMatchMedia(true);
    localStorage.setItem('libresrs.theme', 'light');
    render(<ThemeToggle />);

    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('toggles from light to dark on click', () => {
    mockMatchMedia(false);
    render(<ThemeToggle />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('libresrs.theme')).toBe('dark');
  });

  it('toggles from dark to light on click', () => {
    mockMatchMedia(false);
    localStorage.setItem('libresrs.theme', 'dark');
    render(<ThemeToggle />);

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('libresrs.theme')).toBe('light');
  });

  it('shows correct aria-label for light mode', () => {
    mockMatchMedia(false);
    render(<ThemeToggle />);

    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Switch to dark mode');
  });

  it('shows correct aria-label for dark mode', () => {
    mockMatchMedia(false);
    localStorage.setItem('libresrs.theme', 'dark');
    render(<ThemeToggle />);

    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Switch to light mode');
  });
});
