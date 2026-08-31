import { useEffect, useRef, useState } from 'react';
import {
  getPrayerTimes,
  selectNextPrayer,
  selectCurrentPrayer,
  getWindowCloseTime,
  PRAYER_NAMES,
  PrayerTimes,
  Prayer,
  PrayerName,
} from '../../domain/services/prayerTimesService';
import { resolveCurrentCity } from '../../domain/services/locationService';
import {
  logPrayer,
  getHistory,
  toDateISO,
  computeStatus,
  PrayerLogStatus,
} from '../../domain/services/prayerLogService';
import { getCoachingResponse } from '../../domain/services/coachingService';
import {
  detectNewCoachingTriggers,
  seedTriggeredKeys,
  triggerKey,
  CoachingTrigger,
} from '../../domain/services/coachingTriggerService';

export interface CoachingReply {
  prayerName: PrayerName;
  status: CoachingTrigger['status'];
  text: string;
}

export interface PrayerTimesScreenState {
  prayerTimes: PrayerTimes | null;
  nextPrayer: Prayer | null;
  secondsRemaining: number | null;
  countdownLabel: string | null;
  cityLabel: string | null;
  currentPrayer: Prayer | null;
  statusByPrayer: Partial<Record<PrayerName, PrayerLogStatus>>;
  isCurrentPrayerConfirmed: boolean;
  confirming: boolean;
  confirmError: string | null;
  confirmCurrentPrayer: () => Promise<void>;
  loading: boolean;
  error: string | null;
  coachingReply: CoachingReply | null;
  coachingSending: boolean;
  coachingError: string | null;
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

function tomorrowOf(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

/**
 * Owns no prayer-selection, window-boundary, or status-classification logic of
 * its own — it fetches getPrayerTimes() (today and tomorrow, for Isha's window
 * close) and today's getHistory() once, then re-derives the next/current prayer,
 * the live countdown, and EVERY prayer's status every second via the pure,
 * synchronous selectNextPrayer/selectCurrentPrayer/getWindowCloseTime/
 * computeStatus. statusByPrayer is the single source of truth for status — the
 * "I prayed" button just reads statusByPrayer[currentPrayer.name] rather than
 * computing its own separate status.
 */
export function usePrayerTimesScreen(): PrayerTimesScreenState {
  const [prayerTimes, setPrayerTimes] = useState<PrayerTimes | null>(null);
  const [tomorrowFajr, setTomorrowFajr] = useState<Date | null>(null);
  const [nextPrayer, setNextPrayer] = useState<Prayer | null>(null);
  const [currentPrayer, setCurrentPrayer] = useState<Prayer | null>(null);
  const [statusByPrayer, setStatusByPrayer] = useState<Partial<Record<PrayerName, PrayerLogStatus>>>({});
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [cityLabel, setCityLabel] = useState<string | null>(null);
  const [confirmedAtByPrayer, setConfirmedAtByPrayer] = useState<Partial<Record<PrayerName, Date>>>({});
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [coachingReply, setCoachingReply] = useState<CoachingReply | null>(null);
  const [coachingSending, setCoachingSending] = useState(false);
  const [coachingError, setCoachingError] = useState<string | null>(null);

  const triggeredKeysRef = useRef<Set<string>>(new Set());
  const hasSeededTriggeredKeysRef = useRef(false);
  const coachingQueueRef = useRef<CoachingTrigger[]>([]);
  const processingCoachingRef = useRef(false);

  function enqueueCoachingTriggers(triggers: CoachingTrigger[]) {
    if (triggers.length === 0) return;
    coachingQueueRef.current.push(...triggers);
    processCoachingQueue();
  }

  async function processCoachingQueue() {
    if (processingCoachingRef.current) return;
    processingCoachingRef.current = true;
    setCoachingSending(true);

    try {
      while (coachingQueueRef.current.length > 0) {
        const next = coachingQueueRef.current.shift()!;
        try {
          const text = await getCoachingResponse({
            type: 'status',
            prayerName: next.prayerName,
            status: next.status,
          });
          setCoachingReply({ prayerName: next.prayerName, status: next.status, text });
          setCoachingError(null);
        } catch (e) {
          setCoachingError(describeError(e, "Failed to get Nafy's coaching reply"));
        }
      }
    } finally {
      processingCoachingRef.current = false;
      setCoachingSending(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    resolveCurrentCity()
      .then(({ city, country }) => {
        if (cancelled) return undefined;
        setCityLabel(city);
        return Promise.all([
          getPrayerTimes(city, undefined, undefined, country),
          getPrayerTimes(city, tomorrowOf(new Date()), undefined, country),
        ]);
      })
      .then(async (result) => {
        if (cancelled || !result) return;
        const [times, tomorrowTimes] = result;
        setPrayerTimes(times);
        setTomorrowFajr(tomorrowTimes.Fajr);

        const todayISO = toDateISO(new Date());
        const todaysLog = await getHistory({ startDateISO: todayISO, endDateISO: todayISO });
        if (cancelled) return;
        const byPrayer: Partial<Record<PrayerName, Date>> = {};
        for (const entry of todaysLog) {
          byPrayer[entry.prayerName] = entry.confirmedAt;
        }
        setConfirmedAtByPrayer(byPrayer);
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
    if (!prayerTimes || !tomorrowFajr) return;
    const times = prayerTimes;
    const fajrTomorrow = tomorrowFajr;

    function tick() {
      const now = new Date();
      const next = selectNextPrayer(times, now);
      setNextPrayer(next);
      setSecondsRemaining(next ? secondsUntil(next.time, now) : null);
      setCurrentPrayer(selectCurrentPrayer(times, now));

      const statuses: Partial<Record<PrayerName, PrayerLogStatus>> = {};
      for (const name of PRAYER_NAMES) {
        statuses[name] = computeStatus(
          times[name],
          getWindowCloseTime(name, times, fajrTomorrow),
          confirmedAtByPrayer[name] ?? null,
          now
        );
      }
      setStatusByPrayer(statuses);

      const dateISO = toDateISO(now);
      if (!hasSeededTriggeredKeysRef.current) {
        // First status snapshot of the session: record whatever is already
        // late/qada/missed as triggered without firing coaching for it, so only
        // transitions that happen from here on auto-trigger.
        hasSeededTriggeredKeysRef.current = true;
        triggeredKeysRef.current = seedTriggeredKeys(dateISO, statuses);
      } else {
        const newTriggers = detectNewCoachingTriggers(dateISO, statuses, triggeredKeysRef.current);
        for (const t of newTriggers) {
          triggeredKeysRef.current.add(triggerKey(dateISO, t.prayerName, t.status));
        }
        enqueueCoachingTriggers(newTriggers);
      }
    }

    tick();
    const intervalId = setInterval(tick, 1000);
    return () => clearInterval(intervalId);
  }, [prayerTimes, tomorrowFajr, confirmedAtByPrayer]);

  async function confirmCurrentPrayer() {
    if (!currentPrayer || confirming || confirmedAtByPrayer[currentPrayer.name]) {
      return;
    }

    setConfirming(true);
    setConfirmError(null);

    try {
      const entry = await logPrayer(currentPrayer.name, new Date());
      setConfirmedAtByPrayer((prev) => ({ ...prev, [currentPrayer.name]: entry.confirmedAt }));
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
    statusByPrayer,
    isCurrentPrayerConfirmed: currentPrayer ? confirmedAtByPrayer[currentPrayer.name] != null : false,
    confirming,
    confirmError,
    confirmCurrentPrayer,
    loading,
    error,
    coachingReply,
    coachingSending,
    coachingError,
  };
}
