// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { createTRPCReact, httpBatchLink, TRPCClientError } from '@trpc/react-query';
import { observable } from '@trpc/server/observable';
import type { TRPCLink } from '@trpc/client';
import type { AppRouter } from '../../../server/src/routers/index.ts';
import { loginPathFor } from '../utils/returnTo';

export const trpc = createTRPCReact<AppRouter>();

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof TRPCClientError && error.data?.code === 'UNAUTHORIZED';
}

const unauthorizedRedirectLink: TRPCLink<AppRouter> = () => {
  return ({ next, op }) => {
    return observable((observer) => {
      const unsubscribe = next(op).subscribe({
        next(value) {
          observer.next(value);
        },
        error(err) {
          observer.error(err);
          const publicPaths = new Set(['/login', '/privacy', '/terms', '/readme']);
          if (isUnauthorizedError(err) && !publicPaths.has(window.location.pathname)) {
            window.location.href = loginPathFor(`${window.location.pathname}${window.location.search}${window.location.hash}`);
          }
        },
        complete() {
          observer.complete();
        },
      });
      return unsubscribe;
    });
  };
};

export function getCsrfToken(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('libresrs_csrf='));
  return match ? match.slice('libresrs_csrf='.length) : '';
}

export const trpcClient = trpc.createClient({
  links: [
    unauthorizedRedirectLink,
    httpBatchLink({
      url: '/api/trpc',
      headers() {
        return { 'x-csrf-token': getCsrfToken() };
      },
      fetch(url, options) {
        return fetch(url, {
          ...options,
          credentials: 'include',
        });
      },
    }),
  ],
});
