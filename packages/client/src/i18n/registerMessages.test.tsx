// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider, registerMessages, useI18n } from './index';
import { LOCALE_STORAGE_KEY, MESSAGES } from './messages';

function Says({ text, params }: { text: string; params?: Record<string, string | number> }) {
  const { t } = useI18n();
  return <p>{t(text, params)}</p>;
}

describe('registerMessages', () => {
  beforeEach(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'es');
  });

  it('adds an extension\'s strings after core\'s own: core wins a shared key, and an unknown key is itself', () => {
    expect(MESSAGES.es['Dashboard']).toBeTruthy();
    registerMessages({ es: { 'Sample extension line {{n}}': 'Línea de ejemplo {{n}}', Dashboard: 'never shown' } });
    registerMessages({ es: { 'Another sample line': 'Otra línea' }, en: { 'Sample in English': 'Sample, in English' } });
    render(
      <I18nProvider>
        <Says text="Sample extension line {{n}}" params={{ n: 3 }} />
        <Says text="Another sample line" />
        <Says text="Dashboard" />
        <Says text="Not in any catalog" />
      </I18nProvider>,
    );
    expect(screen.getByText('Línea de ejemplo 3')).toBeInTheDocument();
    expect(screen.getByText('Otra línea')).toBeInTheDocument();
    expect(screen.getByText(MESSAGES.es['Dashboard'])).toBeInTheDocument();
    expect(screen.queryByText('never shown')).toBeNull();
    expect(screen.getByText('Not in any catalog')).toBeInTheDocument();
  });
});
