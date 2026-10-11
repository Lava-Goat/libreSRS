import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Study from './pages/Study';
import StudyAll from './pages/StudyAll';
import VirtualStudy from './pages/VirtualStudy';
import Admin from './pages/Admin';
import LegalPage from './pages/LegalPage';
import Readme from './pages/Readme';
import Setup from './pages/Setup';
import { loginPathFor } from './utils/returnTo';

// Lazy: carries the ~100KB Vocabulómetro word-frequency dataset
const Vocabulometro = lazy(() => import('./pages/Vocabulometro'));
// Lazy: microphone and audio-analysis code only lab-takers and speakers need
const Labs = lazy(() => import('./pages/Labs'));
const Speaking = lazy(() => import('./pages/Speaking'));
// Lazy: tests (v1.21.0) open the same lab and speaking runners
const Tests = lazy(() => import('./pages/Tests'));
const Signups = lazy(() => import('./pages/Signups'));
// Lazy: the conjugation quiz is only for decks a teacher turned it on for
const Conjugation = lazy(() => import('./pages/Conjugation'));
const ConjugationAll = lazy(() => import('./pages/ConjugationAll'));
import LanguageSelector from './components/LanguageSelector';
import ThemeToggle from './components/ThemeToggle';

/** /privacy/v1, /terms/v1: a prior version of a legal page. */
function PriorLegalVersion({ document }: { document: 'privacy' | 'terms' }) {
  const { slug = '' } = useParams();
  return <LegalPage key={`${document}/${slug}`} prior={{ document, slug }} />;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-label="Loading">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    // Come back here after signing in: a sign-up link from Canvas should open the sheet.
    return <Navigate to={loginPathFor(`${location.pathname}${location.search}${location.hash}`)} replace />;
  }

  return <>{children}</>;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAdmin, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-label="Loading">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

/**
 * Moves focus to the page's main content without following the link: a
 * #main-content history entry would read as Back to a page's leave guard.
 */
function skipToMain(e: React.MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
  const main = document.getElementById('main-content');
  if (!main) return;
  // Focusable by script only, so it stays out of the Tab order.
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  main.focus();
  main.scrollIntoView();
}

export default function App() {
  return (
    <>
      <a
        href="#main-content"
        onClick={skipToMain}
        className="sr-only focus:not-sr-only focus:absolute focus:z-[60] focus:p-4 focus:bg-white focus:text-blue-600 focus:underline"
      >
        Skip to main content
      </a>
      <div className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2">
        <LanguageSelector />
        <ThemeToggle />
      </div>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/privacy" element={<LegalPage key="privacy" name="privacy" />} />
        <Route path="/privacy/summary" element={<LegalPage key="privacy-summary" name="privacy-summary" />} />
        <Route path="/privacy/coppa-notice" element={<LegalPage key="coppa-notice" name="coppa-notice" />} />
        <Route path="/privacy/:slug" element={<PriorLegalVersion document="privacy" />} />
        <Route path="/terms" element={<LegalPage key="terms" name="terms" />} />
        <Route path="/terms/:slug" element={<PriorLegalVersion document="terms" />} />
        <Route path="/subprocessors" element={<LegalPage key="subprocessors" name="subprocessors" />} />
        <Route path="/readme" element={<Readme />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        {/* "Study all" (v1.18.0): a static path, ranked above /study/:deckId. */}
        <Route
          path="/study/all"
          element={
            <ProtectedRoute>
              <StudyAll />
            </ProtectedRoute>
          }
        />
        <Route
          path="/study/:deckId"
          element={
            <ProtectedRoute>
              <Study />
            </ProtectedRoute>
          }
        />
        <Route
          path="/study/virtual/:virtualDeckId"
          element={
            <ProtectedRoute>
              <VirtualStudy />
            </ProtectedRoute>
          }
        />
        <Route
          path="/vocabulometro"
          element={
            <ProtectedRoute>
              <Suspense fallback={
                <div className="min-h-screen flex items-center justify-center" role="status" aria-label="Loading">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                </div>
              }>
                <Vocabulometro />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/labs"
          element={
            <ProtectedRoute>
              <Suspense fallback={
                <div className="min-h-screen flex items-center justify-center" role="status" aria-label="Loading">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                </div>
              }>
                <Labs />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/speaking"
          element={
            <ProtectedRoute>
              <Suspense fallback={
                <div className="min-h-screen flex items-center justify-center" role="status" aria-label="Loading">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                </div>
              }>
                <Speaking />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/tests"
          element={
            <ProtectedRoute>
              <Suspense fallback={
                <div className="min-h-screen flex items-center justify-center" role="status" aria-label="Loading">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                </div>
              }>
                <Tests />
              </Suspense>
            </ProtectedRoute>
          }
        />
        {/* "Study all" (v1.18.0): a static path, ranked above /conjugation/:deckId. */}
        <Route
          path="/conjugation/all"
          element={
            <ProtectedRoute>
              <Suspense fallback={
                <div className="min-h-screen flex items-center justify-center" role="status" aria-label="Loading">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                </div>
              }>
                <ConjugationAll />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/conjugation/:deckId"
          element={
            <ProtectedRoute>
              <Suspense fallback={
                <div className="min-h-screen flex items-center justify-center" role="status" aria-label="Loading">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                </div>
              }>
                <Conjugation />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="/signups"
          element={
            <ProtectedRoute>
              <Suspense fallback={
                <div className="min-h-screen flex items-center justify-center" role="status" aria-label="Loading">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                </div>
              }>
                <Signups />
              </Suspense>
            </ProtectedRoute>
          }
        />
        {/* /admin/users/:userId is a page of the admin page (a user's detail view): one route, so the
            page (and a lab upload running in it) stays mounted between the Users list and a user. */}
        <Route
          path="/admin/*"
          element={
            <ProtectedRoute>
              <AdminRoute>
                <Admin />
              </AdminRoute>
            </ProtectedRoute>
          }
        />
      </Routes>
    </>
  );
}
