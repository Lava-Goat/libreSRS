// (c) 2026 Jon-Erik G. Storm, Inc., a California Corporation, doing business as LAVA GOAT SOFTWARE
/** The privacy and terms links at the foot of the app's pages (the legal pages: pages/LegalPage.tsx). */
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';

const LINKS = [
  { to: '/privacy/summary', label: 'Privacy summary' },
  { to: '/privacy', label: 'Full privacy policy' },
  { to: '/terms', label: 'Terms of Service' },
] as const;

export default function LegalLinks({ className = '' }: { className?: string }) {
  const { t } = useI18n();
  return (
    <nav aria-label={t('Privacy and terms')} className={`text-xs text-gray-500 dark:text-gray-400 ${className}`}>
      <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1">
        {LINKS.map((link) => (
          <li key={link.to}>
            <Link to={link.to} className="underline hover:no-underline">{t(link.label)}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
