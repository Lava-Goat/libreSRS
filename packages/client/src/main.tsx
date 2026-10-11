import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { trpc, trpcClient, isUnauthorizedError } from './api/trpc';
import App from './App';
import { I18nProvider, registerMessages } from './i18n';
import { clientExtensions } from './extensions';
import './index.css';

function loadOptionalStylesheet(href: string) {
  if (typeof document === 'undefined') {
    return;
  }

  const existing = document.querySelector(`link[data-libresrs="optional-stylesheet"][href="${href}"]`);
  if (existing) {
    return;
  }

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute('data-libresrs', 'optional-stylesheet');
  link.onerror = () => {
    link.remove();
  };

  document.head.appendChild(link);
}

// Allow local/proprietary font overrides without bundling or committing font files.
loadOptionalStylesheet('/fonts/override.css');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry(failureCount, error) {
        if (isUnauthorizedError(error)) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
  },
});

// The strings this build's extensions bring (none without extensions).
registerMessages(clientExtensions.messages);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </I18nProvider>
      </QueryClientProvider>
    </trpc.Provider>
  </React.StrictMode>
);
