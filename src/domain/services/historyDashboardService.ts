// Plain TypeScript domain service — no React or UI imports. Orchestrates
// prayerTimesService, prayerLogService, and locationService to produce the data
// the History Dashboard needs, without duplicating any of their logic: status
// classification is entirely delegated to prayerLogService.computeStatus, and
// window boundaries to prayerTimesService.getWindowCloseTime.

import { getPrayerTimes, getWindowCloseTime, PRAYER_NAMES, PrayerName, PrayerTimes } from './prayerTimesService';
import { getHistory, computeStatus, toDateISO, PrayerLogStatus } from './prayerLogService';
import { resolveCurrentCity } from './locationService';

export interface DayPrayerStatus {
  dateISO: string;
  prayerName: PrayerName;
  azanTime: Date;
  confirmedAt: Date | null;
  status: PrayerLogStatus;
  deltaMinutes: number | null;
}

export interface StatusBreakdown {
  onTime: number;
  late: number;
  qada: number;
  missed: number;
  total: number;
}

export type PrayerFilter = PrayerName | 'All';

export interface CalendarDay {
  dateISO: string;
  statuses: Partial<Record<PrayerName, PrayerLogStatus>>;
}

function addDays(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta);
}

function historyKey(dateISO: string, prayerName: PrayerName): string {
  return `${dateISO}-${prayerName}`;
}

// Conservative on purpose: a cold History load needs ~31 distinct-date requests
// (getPrayerTimes's own cache can't help there — every date is a genuine miss the
// first time), and Aladhan has rate-limited a full burst with 429. Small batches
// with a real pause between them bound both concurrency AND rate — this is
// spacing out our own request rate, not retrying failed requests.
export const FETCH_BATCH_SIZE = 2;
export const FETCH_BATCH_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchInBatches<T, R>(
  items: T[],
  batchSize: number,
  delayMs: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    if (i > 0) {
      await sleep(delayMs);
    }
    const batch = items.slice(i, i + batchSize);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}

/**
 * Builds one DayPrayerStatus per (day, prayer) pair for the trailing `days`-day
 * window ending on now's calendar day (inclusive). Fetches one extra day beyond
 * the window (for the last day's Isha window-close) and calls getHistory exactly
 * once for the whole range, rather than once per day.
 */
export async function getDashboardEntries(days: number, now: Date): Promise<DayPrayerStatus[]> {
  const { city, country } = await resolveCurrentCity();

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateList: Date[] = [];
  for (let i = days - 1; i >= 0; i--) {
    dateList.push(addDays(today, -i));
  }
  const extraDay = addDays(dateList[dateList.length - 1], 1);
  const allDatesToFetch = [...dateList, extraDay];

  const allTimes = await fetchInBatches(allDatesToFetch, FETCH_BATCH_SIZE, FETCH_BATCH_DELAY_MS, (date) =>
    getPrayerTimes(city, date, undefined, country)
  );
  const timesByDateISO = new Map<string, PrayerTimes>();
  allDatesToFetch.forEach((date, i) => {
    timesByDateISO.set(toDateISO(date), allTimes[i]);
  });

  const startISO = toDateISO(dateList[0]);
  const endISO = toDateISO(dateList[dateList.length - 1]);
  const history = await getHistory({ startDateISO: startISO, endDateISO: endISO });
  const confirmedAtByKey = new Map<string, Date>();
  for (const logEntry of history) {
    confirmedAtByKey.set(historyKey(logEntry.dateISO, logEntry.prayerName), logEntry.confirmedAt);
  }

  const entries: DayPrayerStatus[] = [];
  for (const date of dateList) {
    const dateISO = toDateISO(date);
    const times = timesByDateISO.get(dateISO)!;
    const nextDayISO = toDateISO(addDays(date, 1));
    const nextDayTimes = timesByDateISO.get(nextDayISO)!;

    for (const prayerName of PRAYER_NAMES) {
      const azanTime = times[prayerName];
      const windowCloseTime = getWindowCloseTime(prayerName, times, nextDayTimes.Fajr);
      const confirmedAt = confirmedAtByKey.get(historyKey(dateISO, prayerName)) ?? null;
      const status = computeStatus(azanTime, windowCloseTime, confirmedAt, now);
      const deltaMinutes = confirmedAt ? Math.round((confirmedAt.getTime() - azanTime.getTime()) / 60000) : null;

      entries.push({ dateISO, prayerName, azanTime, confirmedAt, status, deltaMinutes });
    }
  }

  return entries;
}

/** Pure. Tallies on_time/late/qada/missed; not_yet is excluded (nothing has happened yet). */
export function summarizeStatuses(entries: DayPrayerStatus[]): StatusBreakdown {
  const summary: StatusBreakdown = { onTime: 0, late: 0, qada: 0, missed: 0, total: 0 };
  for (const entry of entries) {
    if (entry.status === 'on_time') summary.onTime++;
    else if (entry.status === 'late') summary.late++;
    else if (entry.status === 'qada') summary.qada++;
    else if (entry.status === 'missed') summary.missed++;
    else continue;
    summary.total++;
  }
  return summary;
}

/** Pure. */
export function filterByPrayer(entries: DayPrayerStatus[], prayer: PrayerFilter): DayPrayerStatus[] {
  if (prayer === 'All') return entries;
  return entries.filter((entry) => entry.prayerName === prayer);
}

/** Pure. Both bounds inclusive, compared as ISO date strings. */
export function filterByDateRange(entries: DayPrayerStatus[], startISO: string, endISO: string): DayPrayerStatus[] {
  return entries.filter((entry) => entry.dateISO >= startISO && entry.dateISO <= endISO);
}

/** Pure. Groups a flat entry list into one row per calendar day, oldest first. */
export function groupByDay(entries: DayPrayerStatus[]): CalendarDay[] {
  const byDate = new Map<string, CalendarDay>();
  for (const entry of entries) {
    let day = byDate.get(entry.dateISO);
    if (!day) {
      day = { dateISO: entry.dateISO, statuses: {} };
      byDate.set(entry.dateISO, day);
    }
    day.statuses[entry.prayerName] = entry.status;
  }
  return Array.from(byDate.values()).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

/** Pure. A rolling 7-day trailing window ending on now (inclusive) — "this week". */
export function getWeekRange(now: Date): { startISO: string; endISO: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { startISO: toDateISO(addDays(today, -6)), endISO: toDateISO(today) };
}

/** Pure. The current calendar month, from day 1 through now (inclusive) — "this month". */
export function getMonthRange(now: Date): { startISO: string; endISO: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { startISO: toDateISO(start), endISO: toDateISO(today) };
}
