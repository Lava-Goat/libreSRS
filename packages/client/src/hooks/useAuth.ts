// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
import { trpc } from '../api/trpc';

export function useAuth() {
  const { data: user, isLoading, refetch } = trpc.auth.me.useQuery(undefined, {
    staleTime: 0,
  });
  const logoutMutation = trpc.auth.logout.useMutation();

  // `returnTo`: the page to reopen once signed in (the server checks it again).
  const withReturnTo = (path: string, returnTo?: string | null) =>
    returnTo ? `${path}?returnTo=${encodeURIComponent(returnTo)}` : path;

  const loginWithGoogle = (returnTo?: string | null) => {
    window.location.href = withReturnTo('/auth/google', returnTo);
  };

  const loginWithClever = (returnTo?: string | null) => {
    window.location.href = withReturnTo('/auth/clever', returnTo);
  };

  const logout = async () => {
    await logoutMutation.mutateAsync();
    await refetch();
  };

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    login: loginWithGoogle,
    loginWithGoogle,
    loginWithClever,
    logout,
  };
}
