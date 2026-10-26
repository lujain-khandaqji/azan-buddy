import { getPrayerTimes, PrayerTimes } from '../domain/services/prayerTimesService';
import { createReminder } from '../domain/services/reminderService';
import { logPrayer } from '../domain/services/prayerLogService';
import { getCoachingResponse } from '../domain/services/coachingService';
import { resolveCurrentCity } from '../domain/services/locationService';
import { formatClock, formatDuration, resetVoiceToolSession, runVoiceTool, VOICE_TOOLS } from './voiceTools';

// Only the I/O-bound service calls are mocked; the pure helpers (selectNextPrayer,
// getTimeUntil, getWindowCloseTime, computeStatus) run for real.
jest.mock('../domain/services/prayerTimesService', () => ({
  ...jest.requireActual('../domain/services/prayerTimesService'),
  getPrayerTimes: jest.fn(),
}));
jest.mock('../domain/services/prayerLogService', () => ({
  ...jest.requireActual('../domain/services/prayerLogService'),
  logPrayer: jest.fn(),
}));
jest.mock('../domain/services/reminderService', () => ({ createReminder: jest.fn() }));
jest.mock('../domain/services/coachingService', () => ({ getCoachingResponse: jest.fn() }));
jest.mock('../domain/services/locationService', () => ({
  resolveCurrentCity: jest.fn(() => Promise.resolve({ city: 'Amman', country: 'Jordan' })),
}));

const mockGetPrayerTimes = getPrayerTimes as jest.Mock;
const mockCreateReminder = createReminder as jest.Mock;
const mockLogPrayer = logPrayer as jest.Mock;
const mockCoaching = getCoachingResponse as jest.Mock;

function timesOn(day: number): PrayerTimes {
  const at = (h: number, m: number) => new Date(2026, 9, day, h, m);
  return { Fajr: at(4, 51), Dhuhr: at(11, 38), Asr: at(15, 0), Maghrib: at(17, 41), Isha: at(19, 0) };
}

const NOW = new Date(2026, 9, 3, 14, 18); // 2:18 PM, 3 Oct 2026

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  resetVoiceToolSession();
  mockGetPrayerTimes.mockImplementation((_city: string, date: Date) => Promise.resolve(timesOn(date.getDate())));
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe('formatting', () => {
  it('formats clock times as spoken 12-hour times', () => {
    expect(formatClock(new Date(2026, 0, 1, 15, 22))).toBe('3:22 PM');
    expect(formatClock(new Date(2026, 0, 1, 0, 5))).toBe('12:05 AM');
    expect(formatClock(new Date(2026, 0, 1, 12, 0))).toBe('12:00 PM');
  });

  it('formats durations in natural units', () => {
    expect(formatDuration(1)).toBe('1 minute');
    expect(formatDuration(42)).toBe('42 minutes');
    expect(formatDuration(60)).toBe('1 hour');
    expect(formatDuration(125)).toBe('2 hours and 5 minutes');
  });
});

describe('getPrayerTimes tool', () => {
  it('answers "How long until Asr?" from the prayer-times service', async () => {
    const reply = await VOICE_TOOLS.getPrayerTimes({ prayer: 'Asr' });
    expect(reply).toBe("You have 42 minutes until Asr. It's at 3:00 PM today.");
    expect(mockGetPrayerTimes).toHaveBeenCalledWith('Amman', new Date(2026, 9, 3), undefined, 'Jordan');
  });

  it('answers "What time is Fajr tomorrow?" using tomorrow\'s date', async () => {
    const reply = await VOICE_TOOLS.getPrayerTimes({ prayer: 'fajr', day: 'tomorrow' });
    expect(reply).toBe('Fajr tomorrow is at 4:51 AM.');
    expect(mockGetPrayerTimes).toHaveBeenCalledWith('Amman', new Date(2026, 9, 4), undefined, 'Jordan');
  });

  it('says when a prayer has already started today', async () => {
    expect(await VOICE_TOOLS.getPrayerTimes({ prayer: 'Dhuhr' })).toBe(
      'Dhuhr was at 11:38 AM today, so it has already started.'
    );
  });

  it('lists all five prayers and the next one when no prayer is named', async () => {
    expect(await VOICE_TOOLS.getPrayerTimes({})).toBe(
      "Today's prayer times are Fajr at 4:51 AM, Dhuhr at 11:38 AM, Asr at 3:00 PM, Maghrib at 5:41 PM, and Isha at 7:00 PM. Next is Asr, in 42 minutes."
    );
  });

  it('asks which prayer for an unknown prayer name', async () => {
    expect(await VOICE_TOOLS.getPrayerTimes({ prayer: 'Duha' })).toMatch(/Which prayer/);
    expect(mockGetPrayerTimes).not.toHaveBeenCalled();
  });

  it('resolves the location only once per voice session', async () => {
    await VOICE_TOOLS.getPrayerTimes({ prayer: 'Asr' });
    await VOICE_TOOLS.getPrayerTimes({ prayer: 'Isha' });
    expect(resolveCurrentCity).toHaveBeenCalledTimes(1);
  });
});

describe('createReminder tool', () => {
  it('creates a real reminder through reminderService and confirms it', async () => {
    const reply = await VOICE_TOOLS.createReminder({ prayer: 'Asr', offsetMinutes: 10 });
    expect(mockCreateReminder).toHaveBeenCalledWith('Asr', 10, 'today');
    expect(reply).toBe("Done. I'll remind you 10 minutes before Asr today.");
  });

  it('supports daily reminders', async () => {
    expect(await VOICE_TOOLS.createReminder({ prayer: 'Fajr', offsetMinutes: 15, scope: 'always' })).toBe(
      "Done. I'll remind you 15 minutes before Fajr every day."
    );
    expect(mockCreateReminder).toHaveBeenCalledWith('Fajr', 15, 'always');
  });

  it.each([0, -5, 2.5, 'ten', undefined])('rejects an invalid offset (%p) without creating anything', async (offset) => {
    expect(await VOICE_TOOLS.createReminder({ prayer: 'Asr', offsetMinutes: offset })).toMatch(/How many minutes/);
    expect(mockCreateReminder).not.toHaveBeenCalled();
  });

  it('requires a valid prayer', async () => {
    expect(await VOICE_TOOLS.createReminder({ offsetMinutes: 10 })).toMatch(/Which prayer/);
    expect(mockCreateReminder).not.toHaveBeenCalled();
  });
});

describe('logPrayer tool', () => {
  it('logs through prayerLogService and reports the computed status', async () => {
    mockLogPrayer.mockImplementation((prayer, at: Date) => Promise.resolve({ prayerName: prayer, confirmedAt: at }));
    const reply = await VOICE_TOOLS.logPrayer({ prayer: 'Dhuhr' });
    expect(mockLogPrayer).toHaveBeenCalledWith('Dhuhr', NOW);
    expect(reply).toBe('Logged Dhuhr as late.');
  });

  it('reports on time when logged within the grace window', async () => {
    jest.setSystemTime(new Date(2026, 9, 3, 15, 10));
    mockLogPrayer.mockImplementation((prayer, at: Date) => Promise.resolve({ prayerName: prayer, confirmedAt: at }));
    expect(await VOICE_TOOLS.logPrayer({ prayer: 'Asr' })).toBe('Logged Asr on time, alhamdulillah.');
  });

  it('refuses a prayer that has not started yet', async () => {
    expect(await VOICE_TOOLS.logPrayer({ prayer: 'Asr' })).toBe("Asr hasn't started yet. It's at 3:00 PM today.");
    expect(mockLogPrayer).not.toHaveBeenCalled();
  });

  it('turns the duplicate-confirmation error into a spoken reply', async () => {
    mockLogPrayer.mockRejectedValue(new Error('Dhuhr has already been confirmed for 2026-10-03'));
    expect(await VOICE_TOOLS.logPrayer({ prayer: 'Dhuhr' })).toBe("You've already logged Dhuhr today.");
  });
});

describe('getCoachingAdvice tool', () => {
  it('passes a reflective question to the existing CoachingService unchanged', async () => {
    mockCoaching.mockResolvedValue('Take it one prayer at a time.');
    const reply = await VOICE_TOOLS.getCoachingAdvice({ question: 'كيف أحافظ على صلاة الفجر؟' });
    expect(mockCoaching).toHaveBeenCalledWith({ type: 'reflection', question: 'كيف أحافظ على صلاة الفجر؟' });
    expect(reply).toBe('Take it one prayer at a time.');
  });

  it('uses the status context when a prayer and late/qada/missed status are given', async () => {
    mockCoaching.mockResolvedValue('You made it up, alhamdulillah.');
    await VOICE_TOOLS.getCoachingAdvice({ prayer: 'Asr', status: 'qada' });
    expect(mockCoaching).toHaveBeenCalledWith({ type: 'status', prayerName: 'Asr', status: 'qada' });
  });

  it('asks for a topic instead of calling Gemini with nothing', async () => {
    expect(await VOICE_TOOLS.getCoachingAdvice({})).toMatch(/What would you like/);
    expect(mockCoaching).not.toHaveBeenCalled();
  });
});

describe('runVoiceTool', () => {
  it('parses the RPC payload and dispatches to the tool', async () => {
    expect(await runVoiceTool('getPrayerTimes', JSON.stringify({ prayer: 'Asr' }))).toMatch(/42 minutes until Asr/);
  });

  it('never throws: service failures become a speakable apology', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockCreateReminder.mockRejectedValue(new Error('db locked'));
    expect(await runVoiceTool('createReminder', JSON.stringify({ prayer: 'Asr', offsetMinutes: 10 }))).toMatch(
      /Sorry/
    );
    expect(await runVoiceTool('logPrayer', 'not json')).toMatch(/Sorry/);
  });
});
