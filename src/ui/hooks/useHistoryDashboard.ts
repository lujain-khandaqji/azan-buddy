import { useEffect, useMemo, useState } from 'react';
import {
  getDashboardEntries,
  summarizeStatuses,
  filterByPrayer,
  filterByDateRange,
  groupByDay,
  getWeekRange,
  getMonthRange,
  DayPrayerStatus,
  StatusBreakdown,
  CalendarDay,
  PrayerFilter,
} from '../../domain/services/historyDashboardService';

const DASHBOARD_DAYS = 30;

export interface HistoryDashboardState {
  loading: boolean;
  error: string | null;
  filter: PrayerFilter;
  setFilter: (filter: PrayerFilter) => void;
  calendarDays: CalendarDay[];
  filteredEntries: DayPrayerStatus[];
  weeklyStats: StatusBreakdown;
  monthlyStats: StatusBreakdown;
}

function describeError(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/**
 * Owns no dashboard aggregation logic of its own — getDashboardEntries fetches
 * the raw 30-day data once, and every derived view (calendar grid, filtered
 * list, weekly/monthly totals) comes from historyDashboardService's pure
 * functions. The calendar always shows all 5 prayers per day regardless of the
 * filter (that's the point of an at-a-glance overview); the filter instead
 * scopes the list and the weekly/monthly stats.
 */
export function useHistoryDashboard(): HistoryDashboardState {
  const [entries, setEntries] = useState<DayPrayerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<PrayerFilter>('All');

  useEffect(() => {
    let cancelled = false;
    getDashboardEntries(DASHBOARD_DAYS, new Date())
      .then((result) => {
        if (!cancelled) setEntries(result);
      })
      .catch((e) => {
        if (!cancelled) setError(describeError(e, 'Failed to load history'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const calendarDays = useMemo(() => groupByDay(entries), [entries]);

  const filteredEntries = useMemo(() => {
    const filtered = filterByPrayer(entries, filter);
    return [...filtered].sort((a, b) => {
      if (a.dateISO !== b.dateISO) return b.dateISO.localeCompare(a.dateISO);
      return b.azanTime.getTime() - a.azanTime.getTime();
    });
  }, [entries, filter]);

  const weeklyStats = useMemo(() => {
    const { startISO, endISO } = getWeekRange(new Date());
    return summarizeStatuses(filterByDateRange(filterByPrayer(entries, filter), startISO, endISO));
  }, [entries, filter]);

  const monthlyStats = useMemo(() => {
    const { startISO, endISO } = getMonthRange(new Date());
    return summarizeStatuses(filterByDateRange(filterByPrayer(entries, filter), startISO, endISO));
  }, [entries, filter]);

  return { loading, error, filter, setFilter, calendarDays, filteredEntries, weeklyStats, monthlyStats };
}
