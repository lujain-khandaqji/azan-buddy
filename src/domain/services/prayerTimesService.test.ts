import {
  getPrayerTimes,
  getNextPrayer,
  getTimeUntil,
  selectNextPrayer,
  PrayerTimes,
  Prayer,
} from './prayerTimesService';

// Aladhan's timingsByCity endpoint returns "HH:MM" strings that are already local
// wall-clock time for the requested city (Amman here) — they carry no UTC offset.
// Every fixture below is built with the *local* Date constructor (new Date(y, m, d, h, min))
// rather than an ISO 'Z' string, so a bug that treats "04:32" as UTC and shifts it by a
// few hours would surface as a mismatch here regardless of which timezone the test
// machine happens to run in.

function mockAladhanResponse(overrides: Partial<Record<string, string>> = {}) {
  return {
    code: 200,
    status: 'OK',
    data: {
      timings: {
        Fajr: '04:32',
        Sunrise: '05:58',
        Dhuhr: '12:22',
        Asr: '15:46',
        Sunset: '18:45',
        Maghrib: '18:45',
        Isha: '20:11',
        Imsak: '04:22',
        Midnight: '00:15',
        ...overrides,
      },
      date: {
        readable: '24 Aug 2026',
        timestamp: '1787616000',
        gregorian: { date: '24-08-2026' },
      },
    },
  };
}

function mockFetchOnce(body: unknown, ok = true) {
  (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  });
}

describe('getPrayerTimes', () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches from Aladhan timingsByCity using Amman and method 4 as defaults', async () => {
    mockFetchOnce(mockAladhanResponse());

    await getPrayerTimes();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const calledUrl = String((globalThis.fetch as jest.Mock).mock.calls[0][0]);
    expect(calledUrl).toContain('timingsByCity');
    expect(calledUrl).toContain('city=Amman');
    expect(calledUrl).toContain('method=4');
  });

  it('uses the provided city, date, and method instead of the defaults', async () => {
    mockFetchOnce(mockAladhanResponse());
    // Built with the local constructor (month is 0-indexed: 8 = September) so this
    // resolves to "01-09-2026" regardless of the test machine's timezone.
    const date = new Date(2026, 8, 1);

    await getPrayerTimes('Cairo', date, 5);

    const calledUrl = String((globalThis.fetch as jest.Mock).mock.calls[0][0]);
    expect(calledUrl).toContain('city=Cairo');
    expect(calledUrl).toContain('method=5');
    expect(calledUrl).toContain('01-09-2026');
  });

  it('uses the provided country instead of the default when given a 4th argument', async () => {
    mockFetchOnce(mockAladhanResponse());
    const date = new Date(2026, 8, 1);

    await getPrayerTimes('Cairo', date, 5, 'Egypt');

    const calledUrl = String((globalThis.fetch as jest.Mock).mock.calls[0][0]);
    expect(calledUrl).toContain('country=Egypt');
    expect(calledUrl).not.toContain('country=Jordan');
  });

  it('defaults country to Jordan when the 4th argument is omitted', async () => {
    mockFetchOnce(mockAladhanResponse());

    await getPrayerTimes();

    const calledUrl = String((globalThis.fetch as jest.Mock).mock.calls[0][0]);
    expect(calledUrl).toContain('country=Jordan');
  });

  it('returns Fajr, Dhuhr, Asr, Maghrib, and Isha as Date objects', async () => {
    mockFetchOnce(mockAladhanResponse());

    const times = await getPrayerTimes();

    expect(times.Fajr).toBeInstanceOf(Date);
    expect(times.Dhuhr).toBeInstanceOf(Date);
    expect(times.Asr).toBeInstanceOf(Date);
    expect(times.Maghrib).toBeInstanceOf(Date);
    expect(times.Isha).toBeInstanceOf(Date);
  });

  it('parses each "HH:MM" timing as local wall-clock time, not UTC', async () => {
    const date = new Date(2026, 7, 24); // 24 Aug 2026, local
    mockFetchOnce(mockAladhanResponse());

    const times = await getPrayerTimes('Amman', date, 4);

    // Read back with the *local* getters (not getUTCHours/getUTCDate). If the
    // implementation parsed "04:32" by appending 'Z' (UTC) instead of building a
    // local Date, these would be off by the local UTC offset and this test would
    // fail on any machine not already sitting at UTC+0.
    expect(times.Fajr.getHours()).toBe(4);
    expect(times.Fajr.getMinutes()).toBe(32);
    expect(times.Dhuhr.getHours()).toBe(12);
    expect(times.Dhuhr.getMinutes()).toBe(22);
    expect(times.Isha.getHours()).toBe(20);
    expect(times.Isha.getMinutes()).toBe(11);

    // And the calendar day itself must stay the requested day, not roll to the
    // previous/next day the way `date.toISOString()`-style UTC conversion can
    // near midnight in non-UTC timezones.
    expect(times.Fajr.getFullYear()).toBe(2026);
    expect(times.Fajr.getMonth()).toBe(7); // August, 0-indexed
    expect(times.Fajr.getDate()).toBe(24);
  });

  it('does not include Sunrise, Sunset, Imsak, or Midnight in the result', async () => {
    mockFetchOnce(mockAladhanResponse());

    const times = await getPrayerTimes();

    expect(times).not.toHaveProperty('Sunrise');
    expect(times).not.toHaveProperty('Sunset');
    expect(times).not.toHaveProperty('Imsak');
    expect(times).not.toHaveProperty('Midnight');
  });

  it('throws when Aladhan responds with a non-OK HTTP status', async () => {
    mockFetchOnce({}, false);

    await expect(getPrayerTimes()).rejects.toThrow();
  });
});

describe('getNextPrayer', () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches Amman/method-4 prayer times for now\'s calendar day and returns the next unpassed prayer', async () => {
    mockFetchOnce(mockAladhanResponse());
    const now = new Date(2026, 7, 24, 0, 0); // midnight local, before every prayer

    const next = await getNextPrayer(now);

    const calledUrl = String((globalThis.fetch as jest.Mock).mock.calls[0][0]);
    expect(calledUrl).toContain('city=Amman');
    expect(calledUrl).toContain('method=4');
    expect(calledUrl).toContain('24-08-2026');

    expect(next).not.toBeNull();
    expect(next!.name).toBe('Fajr');
    expect(next!.time.getHours()).toBe(4);
    expect(next!.time.getMinutes()).toBe(32);
  });

  it('returns Maghrib when now is between Asr and Maghrib', async () => {
    mockFetchOnce(mockAladhanResponse());
    const now = new Date(2026, 7, 24, 17, 0); // 17:00 local

    const next = await getNextPrayer(now);

    expect(next).toEqual<Prayer>({
      name: 'Maghrib',
      time: new Date(2026, 7, 24, 18, 45),
    });
  });

  it('returns Isha when now is exactly at Maghrib\'s scheduled time', async () => {
    mockFetchOnce(mockAladhanResponse());
    const now = new Date(2026, 7, 24, 18, 45);

    const next = await getNextPrayer(now);

    expect(next).toEqual<Prayer>({
      name: 'Isha',
      time: new Date(2026, 7, 24, 20, 11),
    });
  });

  it('returns null once all of today\'s prayers have passed', async () => {
    mockFetchOnce(mockAladhanResponse());
    const now = new Date(2026, 7, 24, 23, 0);

    const next = await getNextPrayer(now);

    expect(next).toBeNull();
  });
});

describe('selectNextPrayer', () => {
  // Pure, synchronous companion to getNextPrayer: given an already-fetched
  // PrayerTimes object, picks the next unpassed prayer without doing any I/O.
  // This is what lets a caller fetch getPrayerTimes() once and re-derive "what's
  // next" on every countdown tick without re-hitting the Aladhan API.
  const times: PrayerTimes = {
    Fajr: new Date(2026, 7, 24, 4, 32),
    Dhuhr: new Date(2026, 7, 24, 12, 22),
    Asr: new Date(2026, 7, 24, 15, 46),
    Maghrib: new Date(2026, 7, 24, 18, 45),
    Isha: new Date(2026, 7, 24, 20, 11),
  };

  it('returns Fajr when now is before all of today\'s prayers', () => {
    const now = new Date(2026, 7, 24, 0, 0);
    expect(selectNextPrayer(times, now)).toEqual<Prayer>({ name: 'Fajr', time: times.Fajr });
  });

  it('returns Maghrib when now is between Asr and Maghrib', () => {
    const now = new Date(2026, 7, 24, 17, 0);
    expect(selectNextPrayer(times, now)).toEqual<Prayer>({ name: 'Maghrib', time: times.Maghrib });
  });

  it('returns Isha when now is exactly at Maghrib\'s scheduled time', () => {
    const now = new Date(times.Maghrib);
    expect(selectNextPrayer(times, now)).toEqual<Prayer>({ name: 'Isha', time: times.Isha });
  });

  it('returns null once all of today\'s prayers have already passed', () => {
    const now = new Date(2026, 7, 24, 23, 0);
    expect(selectNextPrayer(times, now)).toBeNull();
  });

  it('performs no I/O — it is a plain synchronous function, not a Promise', () => {
    const now = new Date(2026, 7, 24, 0, 0);
    const result = selectNextPrayer(times, now);
    expect(result).not.toBeInstanceOf(Promise);
  });
});

describe('getTimeUntil', () => {
  it('returns the whole minutes remaining until the prayer', () => {
    const prayer: Prayer = { name: 'Dhuhr', time: new Date(2026, 7, 24, 12, 22) };
    const now = new Date(2026, 7, 24, 11, 52);

    expect(getTimeUntil(prayer, now)).toBe(30);
  });

  it('rounds down to the nearest whole minute', () => {
    const prayer: Prayer = { name: 'Asr', time: new Date(2026, 7, 24, 15, 46, 0) };
    const now = new Date(2026, 7, 24, 15, 44, 30);

    expect(getTimeUntil(prayer, now)).toBe(1);
  });

  it('returns 0 once the prayer time has passed, rather than a negative number', () => {
    const prayer: Prayer = { name: 'Fajr', time: new Date(2026, 7, 24, 4, 32) };
    const now = new Date(2026, 7, 24, 5, 0);

    expect(getTimeUntil(prayer, now)).toBe(0);
  });
});
