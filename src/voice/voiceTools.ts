// Voice tool wrappers — the device side of the Gemini Live function tools. The
// LiveKit agent forwards each tool call here over RPC; every handler validates
// its args, calls the SAME domain service the normal UI calls, and turns the
// result into one short spoken sentence. Spoken phrasing lives here only, never
// in the domain services.

import {
  getPrayerTimes,
  getTimeUntil,
  getWindowCloseTime,
  selectNextPrayer,
  PRAYER_NAMES,
  PrayerName,
} from '../domain/services/prayerTimesService';
import { resolveCurrentCity, CityLocation } from '../domain/services/locationService';
import { createReminder } from '../domain/services/reminderService';
import { computeStatus, logPrayer } from '../domain/services/prayerLogService';
import { getCoachingResponse, CoachingTriggerStatus } from '../domain/services/coachingService';

export type VoiceToolName = 'getPrayerTimes' | 'createReminder' | 'logPrayer' | 'getCoachingAdvice';
type Args = Record<string, unknown>;

/** Tools that write to SQLite, so open screens should refresh after them. */
export const MUTATING_TOOLS: VoiceToolName[] = ['createReminder', 'logPrayer'];

// Resolved once per voice session (GPS + reverse geocode is slow), reset on connect.
let cityPromise: Promise<CityLocation> | null = null;
export function resetVoiceToolSession(): void {
  cityPromise = null;
}
const currentCity = () => (cityPromise ??= resolveCurrentCity());

const dayOffset = (now: Date, days: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);

async function timesFor(daysFromToday: number, now: Date) {
  const { city, country } = await currentCity();
  return getPrayerTimes(city, dayOffset(now, daysFromToday), undefined, country);
}

export function formatClock(date: Date): string {
  const h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

export function formatDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (h === 0) return part(m, 'minute');
  return m === 0 ? part(h, 'hour') : `${part(h, 'hour')} and ${part(m, 'minute')}`;
}

function parsePrayer(value: unknown): PrayerName | null {
  if (typeof value !== 'string') return null;
  return PRAYER_NAMES.find((p) => p.toLowerCase() === value.trim().toLowerCase()) ?? null;
}

const ASK_PRAYER = 'Which prayer do you mean: Fajr, Dhuhr, Asr, Maghrib, or Isha?';

async function getPrayerTimesTool(args: Args): Promise<string> {
  const now = new Date();
  const tomorrow = args.day === 'tomorrow';
  const prayer = args.prayer == null ? null : parsePrayer(args.prayer);
  if (args.prayer != null && !prayer) return ASK_PRAYER;
  const times = await timesFor(tomorrow ? 1 : 0, now);

  if (!prayer) {
    const list = PRAYER_NAMES.map((p) => `${p} at ${formatClock(times[p])}`);
    const all = `${tomorrow ? "Tomorrow's" : "Today's"} prayer times are ${list.slice(0, -1).join(', ')}, and ${list[4]}.`;
    const next = tomorrow ? null : selectNextPrayer(times, now);
    return next ? `${all} Next is ${next.name}, in ${formatDuration(getTimeUntil(next, now))}.` : all;
  }

  const time = times[prayer];
  if (tomorrow) return `${prayer} tomorrow is at ${formatClock(time)}.`;
  const minutes = getTimeUntil({ name: prayer, time }, now);
  if (minutes <= 0) return `${prayer} was at ${formatClock(time)} today, so it has already started.`;
  return `You have ${formatDuration(minutes)} until ${prayer}. It's at ${formatClock(time)} today.`;
}

async function createReminderTool(args: Args): Promise<string> {
  const prayer = parsePrayer(args.prayer);
  if (!prayer) return ASK_PRAYER;
  const offset = Number(args.offsetMinutes);
  // Same rule as the Reminders screen form: a positive whole number of minutes.
  if (!Number.isInteger(offset) || offset <= 0) return `How many minutes before ${prayer} should I remind you?`;
  const scope = args.scope === 'always' ? 'always' : 'today';

  await createReminder(prayer, offset, scope);
  const when = scope === 'always' ? 'every day' : 'today';
  return `Done. I'll remind you ${formatDuration(offset)} before ${prayer} ${when}.`;
}

const STATUS_PHRASES = { on_time: 'on time, alhamdulillah', late: 'as late', qada: 'as qada' } as const;

async function logPrayerTool(args: Args): Promise<string> {
  const prayer = parsePrayer(args.prayer);
  if (!prayer) return ASK_PRAYER;
  const now = new Date();
  const [times, tomorrowTimes] = await Promise.all([timesFor(0, now), timesFor(1, now)]);
  if (times[prayer].getTime() > now.getTime()) {
    return `${prayer} hasn't started yet. It's at ${formatClock(times[prayer])} today.`;
  }

  try {
    const entry = await logPrayer(prayer, now);
    const close = getWindowCloseTime(prayer, times, tomorrowTimes.Fajr);
    // A confirmed prayer always classifies as on_time, late, or qada.
    const status = computeStatus(times[prayer], close, entry.confirmedAt, now) as keyof typeof STATUS_PHRASES;
    return `Logged ${prayer} ${STATUS_PHRASES[status]}.`;
  } catch (e) {
    if (e instanceof Error && e.message.includes('already been confirmed')) {
      return `You've already logged ${prayer} today.`;
    }
    throw e;
  }
}

const COACHING_STATUSES: CoachingTriggerStatus[] = ['late', 'qada', 'missed'];

async function getCoachingAdviceTool(args: Args): Promise<string> {
  const prayer = parsePrayer(args.prayer);
  const status = COACHING_STATUSES.find((s) => s === args.status);
  if (prayer && status) {
    return getCoachingResponse({ type: 'status', prayerName: prayer, status });
  }
  const question = typeof args.question === 'string' ? args.question.trim() : '';
  if (!question) return 'What would you like some encouragement or advice about?';
  return getCoachingResponse({ type: 'reflection', question });
}

export const VOICE_TOOLS: Record<VoiceToolName, (args: Args) => Promise<string>> = {
  getPrayerTimes: getPrayerTimesTool,
  createReminder: createReminderTool,
  logPrayer: logPrayerTool,
  getCoachingAdvice: getCoachingAdviceTool,
};

/** RPC entry point: never throws, so the model always gets something speakable. */
export async function runVoiceTool(name: VoiceToolName, payload: string): Promise<string> {
  try {
    const args = payload ? (JSON.parse(payload) as Args) : {};
    return await VOICE_TOOLS[name](args);
  } catch (e) {
    console.warn(`[voice] ${name} failed`, e);
    return "Sorry, I couldn't do that right now. Please try again in the app.";
  }
}
