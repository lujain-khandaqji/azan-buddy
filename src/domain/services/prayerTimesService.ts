// Plain TypeScript domain service — no React or UI imports. Everything here takes
// explicit primitive/Date parameters and returns plain objects so it can be called
// directly from a UI hook today and from a Gemini function-calling tool later,
// without any reshaping.

export type PrayerName = 'Fajr' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha';

export interface PrayerTimes {
  Fajr: Date;
  Dhuhr: Date;
  Asr: Date;
  Maghrib: Date;
  Isha: Date;
}

export interface Prayer {
  name: PrayerName;
  time: Date;
}

interface AladhanTimingsResponse {
  data?: {
    timings?: Record<string, string>;
  };
}

// Exported so other domain code (e.g. locationService's fallback) shares this
// single source of truth instead of redeclaring "Amman"/"Jordan" separately.
export const DEFAULT_CITY = 'Amman';
export const DEFAULT_COUNTRY = 'Jordan';
const DEFAULT_METHOD = 4;

// Exported so UI code can enumerate the day's five prayers in order without
// redeclaring this list itself.
export const PRAYER_NAMES: PrayerName[] = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

function formatDateForAladhan(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * Aladhan returns "HH:MM" (occasionally with a trailing "(TZ)" annotation) as the
 * local wall-clock time for the requested city — it carries no UTC offset. Building
 * the result with the local Date constructor (rather than parsing as an ISO/UTC
 * string) keeps that wall-clock value intact instead of shifting it by whatever the
 * device's UTC offset happens to be.
 */
function parseLocalTime(hhmm: string, referenceDate: Date): Date {
  const [time] = hhmm.split(' ');
  const [hoursStr, minutesStr] = time.split(':');
  const hours = Number(hoursStr);
  const minutes = Number(minutesStr);

  return new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
    hours,
    minutes,
    0,
    0
  );
}

// Keyed by city|date|method|country. Caches the in-flight Promise (not just the
// resolved value) so both concurrent and repeated requests for the same key
// reuse the same fetch — this is what a burst of getDashboardEntries's ~31
// same-city requests, or simply revisiting a screen, needs to avoid re-hitting
// Aladhan. Caching indefinitely is correct: a given date's prayer times are a
// fixed calculation that never changes. A failed request is evicted so a later
// call can still retry — no automatic retry is performed here.
const prayerTimesCache = new Map<string, Promise<PrayerTimes>>();

function cacheKey(city: string, date: Date, method: number, country: string): string {
  return `${city}|${formatDateForAladhan(date)}|${method}|${country}`;
}

/** Test-only: clears the cache so each test starts isolated. */
export function __resetPrayerTimesCacheForTests(): void {
  prayerTimesCache.clear();
}

async function fetchPrayerTimesFromAladhan(
  city: string,
  date: Date,
  method: number,
  country: string
): Promise<PrayerTimes> {
  const dateSegment = formatDateForAladhan(date);
  const url =
    `https://api.aladhan.com/v1/timingsByCity/${dateSegment}` +
    `?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=${method}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Aladhan request failed with status ${response.status}`);
  }

  const body = (await response.json()) as AladhanTimingsResponse;
  const timings = body?.data?.timings;

  if (!timings) {
    throw new Error('Aladhan response did not include prayer timings');
  }

  const result = {} as PrayerTimes;
  for (const name of PRAYER_NAMES) {
    const raw = timings[name];
    if (!raw) {
      throw new Error(`Aladhan response is missing the ${name} timing`);
    }
    result[name] = parseLocalTime(raw, date);
  }

  return result;
}

export async function getPrayerTimes(
  city: string = DEFAULT_CITY,
  date: Date = new Date(),
  method: number = DEFAULT_METHOD,
  country: string = DEFAULT_COUNTRY
): Promise<PrayerTimes> {
  const key = cacheKey(city, date, method, country);
  const cached = prayerTimesCache.get(key);
  if (cached) {
    return cached;
  }

  const promise = fetchPrayerTimesFromAladhan(city, date, method, country);
  prayerTimesCache.set(key, promise);

  try {
    return await promise;
  } catch (e) {
    prayerTimesCache.delete(key);
    throw e;
  }
}

/**
 * Pure, synchronous companion to getNextPrayer: given an already-fetched
 * PrayerTimes object, picks the next unpassed prayer without doing any I/O. This
 * is what lets a caller fetch getPrayerTimes() once and re-derive "what's next"
 * on every countdown tick without re-hitting the Aladhan API.
 */
export function selectNextPrayer(times: PrayerTimes, now: Date): Prayer | null {
  for (const name of PRAYER_NAMES) {
    const time = times[name];
    if (time.getTime() > now.getTime()) {
      return { name, time };
    }
  }

  return null;
}

/**
 * Pure, synchronous complement to selectNextPrayer: returns the most recent
 * prayer whose scheduled time has already started (or null if none of today's
 * prayers have started yet). This is what the "I prayed" button targets — the
 * prayer a person would plausibly be confirming right now, never the next
 * (not-yet-started) one.
 */
export function selectCurrentPrayer(times: PrayerTimes, now: Date): Prayer | null {
  let current: Prayer | null = null;
  for (const name of PRAYER_NAMES) {
    const time = times[name];
    if (time.getTime() > now.getTime()) {
      break;
    }
    current = { name, time };
  }
  return current;
}

/**
 * Pure, synchronous lookup of when a prayer's confirmation window closes — the
 * next prayer's scheduled time, or tomorrow's Fajr for Isha (there is no "next"
 * prayer within today's PrayerTimes). Feeds directly into
 * prayerLogService.computeStatus's windowCloseTime parameter.
 */
export function getWindowCloseTime(prayerName: PrayerName, times: PrayerTimes, tomorrowFajr: Date): Date {
  const index = PRAYER_NAMES.indexOf(prayerName);
  const nextName = PRAYER_NAMES[index + 1];
  return nextName ? times[nextName] : tomorrowFajr;
}

export async function getNextPrayer(now: Date): Promise<Prayer | null> {
  const times = await getPrayerTimes(DEFAULT_CITY, now, DEFAULT_METHOD);
  return selectNextPrayer(times, now);
}

export function getTimeUntil(prayer: Prayer, now: Date): number {
  const diffMs = prayer.time.getTime() - now.getTime();
  if (diffMs <= 0) {
    return 0;
  }
  return Math.floor(diffMs / 60000);
}
