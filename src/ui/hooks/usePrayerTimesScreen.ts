import { useEffect, useState } from 'react';
import {
  getPrayerTimes,
  selectNextPrayer,
  selectCurrentPrayer,
  PrayerTimes,
  Prayer,
  PrayerName,
} from '../../domain/services/prayerTimesService';
import { resolveCurrentCity } from '../../domain/services/locationService';
import { logPrayer, getHistory, toDateISO } from '../../domain/services/prayerLogService';

export interface PrayerTimesScreenState {
  prayerTimes: PrayerTimes | null;
  nextPrayer: Prayer | null;
  secondsRemaining: number | null;
  countdownLabel: string | null;
  cityLabel: string | null;
  currentPrayer: Prayer | null;
  isCurrentPrayerConfirmed: boolean;
  confirming: boolean;
  confirmError: string | null;
  confirmCurrentPrayer: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

function describeError(e: unknown, fallback = 'Failed to load prayer times'): string {
  return e instanceof Error ? e.message : fallback;
}

function secondsUntil(target: Date, now: Date): number {
  const diffMs = target.getTime() - now.getTime();
  return diffMs > 0 ? Math.floor(diffMs / 1000) : 0;
}

function formatCountdown(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Owns no prayer-selection or confirmation logic of its own — it fetches
 * getPrayerTimes() and today's getHistory() once, then re-derives the next/current
 * prayer and the live countdown every second via the pure, synchronous
 * selectNextPrayer/selectCurrentPrayer. confirmCurrentPrayer just calls logPrayer
 * with whatever selectCurrentPrayer already computed. No Day 4 status
 * classification (on_time/late/qada/missed) happens here.
 */
export function usePrayerTimesScreen(): PrayerTimesScreenState {
  const [prayerTimes, setPrayerTimes] = useState<PrayerTimes | null>(null);
  const [nextPrayer, setNextPrayer] = useState<Prayer | null>(null);
  const [currentPrayer, setCurrentPrayer] = useState<Prayer | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [cityLabel, setCityLabel] = useState<string | null>(null);
  const [confirmedPrayerNames, setConfirmedPrayerNames] = useState<Set<PrayerName>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    resolveCurrentCity()
      .then(({ city, country }) => {
        if (cancelled) return undefined;
        setCityLabel(city);
        return getPrayerTimes(city, undefined, undefined, country);
      })
      .then(async (times) => {
        if (cancelled || !times) return;
        setPrayerTimes(times);

        const todayISO = toDateISO(new Date());
        const todaysLog = await getHistory({ startDateISO: todayISO, endDateISO: todayISO });
        if (cancelled) return;
        setConfirmedPrayerNames(new Set(todaysLog.map((entry) => entry.prayerName)));
      })
      .catch((e) => {
        if (!cancelled) setError(describeError(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!prayerTimes) return;
    const times = prayerTimes;

    function tick() {
      const now = new Date();
      const next = selectNextPrayer(times, now);
      setNextPrayer(next);
      setSecondsRemaining(next ? secondsUntil(next.time, now) : null);
      setCurrentPrayer(selectCurrentPrayer(times, now));
    }

    tick();
    const intervalId = setInterval(tick, 1000);
    return () => clearInterval(intervalId);
  }, [prayerTimes]);

  async function confirmCurrentPrayer() {
    if (!currentPrayer || confirming || confirmedPrayerNames.has(currentPrayer.name)) {
      return;
    }

    setConfirming(true);
    setConfirmError(null);

    try {
      await logPrayer(currentPrayer.name, new Date());
      setConfirmedPrayerNames((prev) => new Set(prev).add(currentPrayer.name));
    } catch (e) {
      setConfirmError(describeError(e, 'Failed to confirm prayer'));
    } finally {
      setConfirming(false);
    }
  }

  return {
    prayerTimes,
    nextPrayer,
    secondsRemaining,
    countdownLabel: secondsRemaining !== null ? formatCountdown(secondsRemaining) : null,
    cityLabel,
    currentPrayer,
    isCurrentPrayerConfirmed: currentPrayer ? confirmedPrayerNames.has(currentPrayer.name) : false,
    confirming,
    confirmError,
    confirmCurrentPrayer,
    loading,
    error,
  };
}
