import type { UserStats as UserStatsType } from '@libresrs/shared';
import { useI18n } from '../i18n';

interface Props {
  stats: UserStatsType;
}

export default function UserStats({ stats }: Props) {
  const { t } = useI18n();

  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    return `${minutes}m`;
  };

  const statItems = [
    {
      label: t('Cards Due'),
      value: stats.cardsDue,
      color: stats.cardsDue > 0 ? 'text-blue-600' : 'text-gray-900 dark:text-gray-100',
    },
    {
      label: t('Cards Learned'),
      value: stats.cardsLearned,
      color: 'text-green-600',
    },
    {
      label: t('Total Cards'),
      value: stats.totalCards,
      color: 'text-gray-900 dark:text-gray-100',
    },
    {
      label: t('Retention Rate'),
      value: `${(stats.retentionRate * 100).toFixed(0)}%`,
      color: stats.retentionRate >= 0.8 ? 'text-green-600' : 'text-orange-600',
    },
    {
      label: t("Today's Reviews"),
      value: stats.reviewsToday,
      color: 'text-gray-900 dark:text-gray-100',
    },
    {
      label: t('Time Studying'),
      value: formatTime(stats.totalTimeSpentMs),
      color: 'text-gray-900 dark:text-gray-100',
    },
  ];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-900/20 p-6">
      <div className="grid grid-cols-2 gap-6">
        {statItems.map((item) => (
          <div key={item.label}>
            <p className="text-sm text-gray-500 dark:text-gray-400">{item.label}</p>
            <p className={`text-2xl font-semibold ${item.color}`}>{item.value}</p>
          </div>
        ))}
      </div>

      {stats.streakDays > 0 && (
        <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🔥</span>
            <div>
              <p className="font-semibold text-gray-900 dark:text-gray-100">{t('{{count}} day streak', { count: stats.streakDays })}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('Keep it up!')}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
