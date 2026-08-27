import { PrayerTimes, PrayerName } from './prayerTimesService';
import { PrayerLogEntry } from './prayerLogService';
import {
  getDashboardEntries,
  summarizeStatuses,
  filterByPrayer,
  filterByDateRange,
  groupByDay,
  getWeekRange,
  getMonthRange,
  DayPrayerStatus,
  FETCH_BATCH_SIZE,
  FETCH_BATCH_DELAY_MS,
} from './historyDashboardService';

// getDashboardEntries orchestrates three existing services (prayerTimesService,
// prayerLogService, locationService) — all three are mocked directly rather than
// mocking fetch/expo-sqlite/expo-location transitively, since this service only
// needs controlled return values from each, not their own internal correctness
// (already covered by their own test files).

jest.mock('./prayerTimesService', () => ({
  ...jest.requireActual('./prayerTimesService'),
  getPrayerTimes: jest.fn(),
}));

jest.mock('./prayerLogService', () => ({
  ...jest.requireActual('./prayerLogService'),
  getHistory: jest.fn(),
}));

jest.mock('./locationService', () => ({
  resolveCurrentCity: jest.fn(),
}));

// prayerLogService.ts imports expo-sqlite at module scope; jest.requireActual
// above loads that real module (we only want its real toDateISO/computeStatus),
// so expo-sqlite must be mocked here too even though this file never calls it
// directly — otherwise its own expo-asset transitive import fails to resolve.
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));

const mockedGetPrayerTimes = require('./prayerTimesService').getPrayerTimes as jest.Mock;
const mockedGetHistory = require('./prayerLogService').getHistory as jest.Mock;
const mockedResolveCurrentCity = require('./locationService').resolveCurrentCity as jest.Mock;

function buildTimesForDate(date: Date): PrayerTimes {
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();
  return {
    Fajr: new Date(y, m, d, 4, 38),
    Dhuhr: new Date(y, m, d, 12, 22),
    Asr: new Date(y, m, d, 15, 46),
    Maghrib: new Date(y, m, d, 18, 45),
    Isha: new Date(y, m, d, 20, 11),
  };
}

function findEntry(entries: DayPrayerStatus[], dateISO: string, prayerName: PrayerName): DayPrayerStatus {
  const entry = entries.find((e) => e.dateISO === dateISO && e.prayerName === prayerName);
  if (!entry) throw new Error(`No entry found for ${dateISO} ${prayerName}`);
  return entry;
}

describe('getDashboardEntries', () => {
  const now = new Date(2026, 7, 26, 13, 0); // today = 2026-08-26, 13:00 (after Dhuhr, before Asr)

  const historyFixture: PrayerLogEntry[] = [
    // on_time: Fajr azan 04:38, confirmed 04:45 → 7 min after
    { id: '1', dateISO: '2026-08-24', prayerName: 'Fajr', confirmedAt: new Date(2026, 7, 24, 4, 45) },
    // late: Dhuhr azan 12:22, confirmed 13:00 → 38 min after, but before window close (Asr 15:46)
    { id: '2', dateISO: '2026-08-24', prayerName: 'Dhuhr', confirmedAt: new Date(2026, 7, 24, 13, 0) },
    // qada: Fajr azan 04:38, confirmed 13:00 → after window close (Dhuhr 12:22)
    { id: '3', dateISO: '2026-08-25', prayerName: 'Fajr', confirmedAt: new Date(2026, 7, 25, 13, 0) },
  ];

  beforeEach(() => {
    mockedGetPrayerTimes.mockImplementation((_city: string, date: Date) => Promise.resolve(buildTimesForDate(date)));
    mockedResolveCurrentCity.mockResolvedValue({ city: 'Amman', country: 'Jordan' });
    mockedGetHistory.mockResolvedValue(historyFixture);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('returns 5 entries per day for the requested number of days', async () => {
    const entries = await getDashboardEntries(3, now);
    expect(entries).toHaveLength(15);
  });

  it('classifies a confirmation within 30 minutes of azan as on_time, with the correct delta', async () => {
    const entries = await getDashboardEntries(3, now);
    const entry = findEntry(entries, '2026-08-24', 'Fajr');
    expect(entry.status).toBe('on_time');
    expect(entry.deltaMinutes).toBe(7);
  });

  it('classifies a confirmation more than 30 minutes after azan but before window close as late', async () => {
    const entries = await getDashboardEntries(3, now);
    const entry = findEntry(entries, '2026-08-24', 'Dhuhr');
    expect(entry.status).toBe('late');
    expect(entry.deltaMinutes).toBe(38);
  });

  it('classifies a confirmation after window close as qada', async () => {
    const entries = await getDashboardEntries(3, now);
    const entry = findEntry(entries, '2026-08-25', 'Fajr');
    expect(entry.status).toBe('qada');
  });

  it('classifies an unconfirmed prayer on a past day as missed', async () => {
    const entries = await getDashboardEntries(3, now);
    expect(findEntry(entries, '2026-08-24', 'Asr').status).toBe('missed');
    expect(findEntry(entries, '2026-08-25', 'Dhuhr').status).toBe('missed');
    expect(findEntry(entries, '2026-08-25', 'Isha').status).toBe('missed');
  });

  it("classifies today's unconfirmed prayers correctly: missed once the window has closed, not_yet otherwise", async () => {
    const entries = await getDashboardEntries(3, now);
    // Fajr's window (Dhuhr 12:22) has already closed by now (13:00).
    expect(findEntry(entries, '2026-08-26', 'Fajr').status).toBe('missed');
    // Dhuhr has started but its window (Asr 15:46) hasn't closed yet.
    expect(findEntry(entries, '2026-08-26', 'Dhuhr').status).toBe('not_yet');
    // Asr/Maghrib/Isha haven't started yet at all.
    expect(findEntry(entries, '2026-08-26', 'Asr').status).toBe('not_yet');
    expect(findEntry(entries, '2026-08-26', 'Maghrib').status).toBe('not_yet');
    expect(findEntry(entries, '2026-08-26', 'Isha').status).toBe('not_yet');
  });

  it('leaves deltaMinutes null for unconfirmed prayers', async () => {
    const entries = await getDashboardEntries(3, now);
    expect(findEntry(entries, '2026-08-26', 'Asr').deltaMinutes).toBeNull();
  });

  it("fetches prayer times for the requested range plus one extra day (for the last day's Isha window close)", async () => {
    await getDashboardEntries(3, now);

    expect(mockedGetPrayerTimes).toHaveBeenCalledTimes(4);
    const calledDates = mockedGetPrayerTimes.mock.calls.map(
      (call: unknown[]) => (call[1] as Date).toISOString().slice(0, 10)
    );
    // Just confirming 4 distinct calendar days were requested (24, 25, 26, 27 Aug).
    expect(new Set(calledDates).size).toBe(4);
  });

  it('resolves the current city/country once and uses it for every prayer-times fetch', async () => {
    await getDashboardEntries(3, now);

    expect(mockedResolveCurrentCity).toHaveBeenCalledTimes(1);
    for (const call of mockedGetPrayerTimes.mock.calls) {
      expect(call[0]).toBe('Amman');
      expect(call[3]).toBe('Jordan');
    }
  });

  it('calls getHistory once for the whole requested date range', async () => {
    await getDashboardEntries(3, now);

    expect(mockedGetHistory).toHaveBeenCalledTimes(1);
    expect(mockedGetHistory).toHaveBeenCalledWith({ startDateISO: '2026-08-24', endDateISO: '2026-08-26' });
  });

  it('never fetches more than FETCH_BATCH_SIZE prayer-times requests concurrently', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    mockedGetPrayerTimes.mockImplementation(async (_city: string, date: Date) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return buildTimesForDate(date);
    });

    // days=2 -> 3 distinct dates -> batches of [2, 1] with FETCH_BATCH_SIZE=2,
    // enough to prove the cap without paying for a long chain of real delays.
    await getDashboardEntries(2, now);

    expect(maxInFlight).toBeLessThanOrEqual(FETCH_BATCH_SIZE);
    expect(maxInFlight).toBeGreaterThan(1); // confirms it's actually batching, not fully sequential
  });

  it('waits at least FETCH_BATCH_DELAY_MS before starting the second batch', async () => {
    const callTimestamps: number[] = [];

    mockedGetPrayerTimes.mockImplementation(async (_city: string, date: Date) => {
      callTimestamps.push(Date.now());
      return buildTimesForDate(date);
    });

    // days=2 -> 3 distinct dates -> exactly one inter-batch gap to observe.
    await getDashboardEntries(2, now);

    const firstBatchStart = callTimestamps[0];
    const secondBatchStart = callTimestamps[FETCH_BATCH_SIZE];
    expect(secondBatchStart - firstBatchStart).toBeGreaterThanOrEqual(FETCH_BATCH_DELAY_MS);
  });
});

describe('summarizeStatuses', () => {
  function entry(status: DayPrayerStatus['status']): DayPrayerStatus {
    return {
      dateISO: '2026-08-24',
      prayerName: 'Fajr',
      azanTime: new Date(2026, 7, 24, 4, 38),
      confirmedAt: null,
      status,
      deltaMinutes: null,
    };
  }

  it('tallies on_time, late, qada, and missed, excluding not_yet from the total', () => {
    const entries = [
      entry('on_time'),
      entry('on_time'),
      entry('late'),
      entry('qada'),
      entry('missed'),
      entry('not_yet'),
      entry('not_yet'),
    ];

    const summary = summarizeStatuses(entries);

    expect(summary).toEqual({ onTime: 2, late: 1, qada: 1, missed: 1, total: 5 });
  });
});

describe('filterByPrayer', () => {
  function entry(prayerName: PrayerName): DayPrayerStatus {
    return {
      dateISO: '2026-08-24',
      prayerName,
      azanTime: new Date(2026, 7, 24, 4, 38),
      confirmedAt: null,
      status: 'not_yet',
      deltaMinutes: null,
    };
  }

  const entries = [entry('Fajr'), entry('Dhuhr'), entry('Fajr'), entry('Asr')];

  it("returns everything when the filter is 'All'", () => {
    expect(filterByPrayer(entries, 'All')).toHaveLength(4);
  });

  it('returns only entries matching a specific prayer', () => {
    const filtered = filterByPrayer(entries, 'Fajr');
    expect(filtered).toHaveLength(2);
    expect(filtered.every((e) => e.prayerName === 'Fajr')).toBe(true);
  });
});

describe('filterByDateRange', () => {
  function entry(dateISO: string): DayPrayerStatus {
    return {
      dateISO,
      prayerName: 'Fajr',
      azanTime: new Date(2026, 7, 24, 4, 38),
      confirmedAt: null,
      status: 'not_yet',
      deltaMinutes: null,
    };
  }

  it('keeps only entries within the inclusive date range', () => {
    const entries = [entry('2026-08-20'), entry('2026-08-24'), entry('2026-08-26'), entry('2026-08-30')];

    const filtered = filterByDateRange(entries, '2026-08-24', '2026-08-26');

    expect(filtered.map((e) => e.dateISO)).toEqual(['2026-08-24', '2026-08-26']);
  });
});

describe('groupByDay', () => {
  it('groups entries by date, ascending, with each prayer keyed by name', () => {
    const entries: DayPrayerStatus[] = [
      {
        dateISO: '2026-08-25',
        prayerName: 'Dhuhr',
        azanTime: new Date(2026, 7, 25, 12, 22),
        confirmedAt: null,
        status: 'missed',
        deltaMinutes: null,
      },
      {
        dateISO: '2026-08-24',
        prayerName: 'Fajr',
        azanTime: new Date(2026, 7, 24, 4, 38),
        confirmedAt: new Date(2026, 7, 24, 4, 45),
        status: 'on_time',
        deltaMinutes: 7,
      },
    ];

    const days = groupByDay(entries);

    expect(days.map((d) => d.dateISO)).toEqual(['2026-08-24', '2026-08-25']);
    expect(days[0].statuses.Fajr).toBe('on_time');
    expect(days[1].statuses.Dhuhr).toBe('missed');
  });
});

describe('getWeekRange', () => {
  it('returns a 7-day trailing window ending on now (inclusive)', () => {
    const now = new Date(2026, 7, 26);
    expect(getWeekRange(now)).toEqual({ startISO: '2026-08-20', endISO: '2026-08-26' });
  });
});

describe('getMonthRange', () => {
  it('returns the current calendar month from day 1 through now', () => {
    const now = new Date(2026, 7, 26);
    expect(getMonthRange(now)).toEqual({ startISO: '2026-08-01', endISO: '2026-08-26' });
  });
});
