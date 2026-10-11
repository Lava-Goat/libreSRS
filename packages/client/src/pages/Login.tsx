import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { trpc } from '../api/trpc';
import { useI18n } from '../i18n';
import { usePageTitle } from '../hooks/usePageTitle';
import { safeReturnTo } from '../utils/returnTo';
import PinSignIn from '../components/login/PinSignIn';
import { LOGO_SRC } from '../brand';

export default function Login() {
  const { isAuthenticated, isLoading, loginWithGoogle, loginWithClever } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');
  const returnTo = safeReturnTo(searchParams.get('returnTo'));
  const setupStatus = trpc.setup.getStatus.useQuery();
  // v1.22.0: whether to offer "Sign in with a PIN" (Admin > Access: Auto, On or Off). Asked often:
  // in Auto it comes and goes with Google's refusals, and a student comes back here from Google's
  // error page with Back, which restores this page as it was (the pageshow below asks again).
  const pinOptions = trpc.pins.loginOptions.useQuery(undefined, {
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
  // Once opened, the form stays even if the offer ends (the server still takes PINs a while after).
  const [pinOpened, setPinOpened] = useState(false);
  usePageTitle('Login');

  const { refetch: refetchPinOptions } = pinOptions;
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void refetchPinOptions();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, [refetchPinOptions]);

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      navigate(returnTo ?? '/', { replace: true });
    }
  }, [isAuthenticated, isLoading, navigate, returnTo]);

  useEffect(() => {
    if (setupStatus.data?.needsSetup) {
      navigate('/setup', { replace: true });
    }
  }, [setupStatus.data, navigate]);

  const getErrorMessage = () => {
    switch (error) {
      case 'not_authorized':
        return t('Your email is not authorized to access this application. Please contact an administrator.');
      case 'auth_failed':
        return t('Authentication failed. Please try again.');
      case 'oauth_not_configured':
        return t('OAuth is not configured. Redirecting to setup...');
      default:
        return null;
    }
  };

  const errorMessage = getErrorMessage();
  const pinOffer = pinOptions.data ?? null;
  const showPin = pinOffer?.pin === true || pinOpened;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-label="Loading">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <main id="main-content" className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl dark:shadow-gray-900/30 p-8">
          <div className="text-center mb-8">
            {/* Decorative: the heading below says the name. */}
            <img src={LOGO_SRC} alt="" className="mx-auto mb-4 h-20 w-20" />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">libreSRS</h1>
            <p className="text-gray-600 dark:text-gray-400">{t('When you are SRS about learning.')}</p>
          </div>

          {errorMessage && (
            <div role="alert" className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-red-700 dark:text-red-400 text-sm">{errorMessage}</p>
            </div>
          )}

          {pinOffer?.reason === 'auto' && (
            <div role="status" className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-blue-800 dark:text-blue-300 text-sm">{t("Google sign-in isn't letting students in right now. Use your PIN.")}</p>
            </div>
          )}

          <button
            onClick={() => loginWithGoogle(returnTo)}
            className="w-full flex items-center justify-center gap-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg px-6 py-3 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-400 transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            {t('Sign in with Google')}
          </button>

          {setupStatus.data?.cleverEnabled && (
            <button
              onClick={() => loginWithClever(returnTo)}
              className="mt-3 w-full flex items-center justify-center gap-3 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg px-6 py-3 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-400 transition-colors"
            >
              {t('Sign in with Clever')}
            </button>
          )}

          {showPin && (
            <PinSignIn
              returnTo={returnTo}
              open={pinOpened}
              onOpenChange={setPinOpened}
              onUnavailable={() => { void refetchPinOptions(); }}
            />
          )}

          <div className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
            {/* Students are not parties to the site's terms: no "by signing in you agree". */}
            <p>{t('Your school set up this site for your class. Read how we handle your information:')}</p>
            <p className="mt-1">
              <Link to="/privacy/summary" className="text-blue-700 dark:text-blue-300 underline hover:no-underline">
                {t('Privacy summary')}
              </Link>
              <span aria-hidden="true"> · </span>
              <Link to="/privacy" className="text-blue-700 dark:text-blue-300 underline hover:no-underline">
                {t('Full privacy policy')}
              </Link>
              <span aria-hidden="true"> · </span>
              <Link to="/terms#aup" className="text-blue-700 dark:text-blue-300 underline hover:no-underline">
                {t('Rules for using the site')}
              </Link>
            </p>
            <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
              &copy; {new Date().getFullYear()} Lava Goat Software
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
