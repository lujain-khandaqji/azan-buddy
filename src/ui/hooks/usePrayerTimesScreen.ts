import { useEffect, useState } from 'react';
import {
  getPrayerTimes,
  selectNextPrayer,
  PrayerTimes,
  Prayer,
} from '../../domain/services/prayerTimesService';
import { resolveCurrentCity } from '../../domain/services/locationService';

export interface PrayerTimesScreenState {
  prayerTimes: PrayerTimes | null;
  nextPrayer: Prayer | null;
  secondsRemaining: number | null;
  countdownLabel: string | null;
  cityLabel: string | null;
  loading: boolean;
  error: string | null;
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : 'Failed to load prayer times';
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
 * Owns no prayer-selection logic of its own — it fetches getPrayerTimes() exactly
 * once, then re-derives the next prayer and the live countdown every second via
 * the pure, synchronous selectNextPrayer. No network call happens in the interval.
 */
export function usePrayerTimesScreen(): PrayerTimesScreenState {
  const [prayerTimes, setPrayerTimes] = useState<PrayerTimes | null>(null);
  const [nextPrayer, setNextPrayer] = useState<Prayer | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [cityLabel, setCityLabel] = useState<string | null>(null);
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
      .then((times) => {
        if (cancelled || !times) return;
        setPrayerTimes(times);
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
    }

    tick();
    const intervalId = setInterval(tick, 1000);
    return () => clearInterval(intervalId);
  }, [prayerTimes]);

  return {
    prayerTimes,
    nextPrayer,
    secondsRemaining,
    countdownLabel: secondsRemaining !== null ? formatCountdown(secondsRemaining) : null,
    cityLabel,
    loading,
    error,
  };
}
