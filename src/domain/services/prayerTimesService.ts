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

export async function getPrayerTimes(
  city: string = DEFAULT_CITY,
  date: Date = new Date(),
  method: number = DEFAULT_METHOD,
  country: string = DEFAULT_COUNTRY
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
