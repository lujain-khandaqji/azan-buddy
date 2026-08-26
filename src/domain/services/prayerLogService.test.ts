import * as SQLite from 'expo-sqlite';
import { logPrayer, getHistory, computeStatus } from './prayerLogService';

// expo-sqlite is a native module and can't run inside Jest, so it's mocked with a
// small in-memory fake that implements the same insert/select contract the service
// relies on (an id collision throws like a real UNIQUE/PRIMARY KEY violation would).
// It does not parse the SQL text — this proves the service's own logic (id
// derivation, duplicate handling, date-range filtering), not the literal SQL string.

interface FakeRow {
  id: string;
  date_iso: string;
  prayer_name: string;
  confirmed_at: number;
  created_at: number;
}

function createFakeDb() {
  const rows: FakeRow[] = [];

  return {
    execAsync: jest.fn(async () => undefined),
    runAsync: jest.fn(async (_sql: string, params: unknown[]) => {
      const [id, dateISO, prayerName, confirmedAt, createdAt] = params as [
        string,
        string,
        string,
        number,
        number
      ];
      const isDuplicate = rows.some((r) => r.id === id);
      if (isDuplicate) {
        throw new Error('UNIQUE constraint failed: prayer_log.id');
      }
      rows.push({
        id,
        date_iso: dateISO,
        prayer_name: prayerName,
        confirmed_at: confirmedAt,
        created_at: createdAt,
      });
      return { lastInsertRowId: rows.length, changes: 1 };
    }),
    getAllAsync: jest.fn(async (_sql: string, params: unknown[]) => {
      const [startDateISO, endDateISO] = params as [string, string];
      return rows
        .filter((r) => r.date_iso >= startDateISO && r.date_iso <= endDateISO)
        .map((r) => ({ ...r }));
    }),
  };
}

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));

const mockedSQLite = SQLite as jest.Mocked<typeof SQLite>;

describe('prayerLogService', () => {
  beforeEach(() => {
    // A fresh fake (and its own empty rows array) per test, so tests never share
    // state — logPrayer and getHistory within the SAME test still see the same
    // data, since openDatabaseAsync resolves to this one instance either way.
    mockedSQLite.openDatabaseAsync.mockResolvedValue(createFakeDb() as any);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('inserts a prayer log entry and returns it', async () => {
    const confirmedAt = new Date(2026, 7, 26, 4, 40);

    const entry = await logPrayer('Fajr', confirmedAt);

    expect(entry.prayerName).toBe('Fajr');
    expect(entry.dateISO).toBe('2026-08-26');
    expect(entry.confirmedAt.getTime()).toBe(confirmedAt.getTime());
  });

  it('reads back an inserted log entry via getHistory', async () => {
    const confirmedAt = new Date(2026, 7, 26, 4, 40);
    await logPrayer('Fajr', confirmedAt);

    const history = await getHistory({ startDateISO: '2026-08-26', endDateISO: '2026-08-26' });

    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      prayerName: 'Fajr',
      dateISO: '2026-08-26',
    });
    expect(history[0].confirmedAt.getTime()).toBe(confirmedAt.getTime());
  });

  it('prevents a duplicate confirmation for the same prayer on the same date', async () => {
    const firstConfirmedAt = new Date(2026, 7, 26, 4, 40);
    const secondConfirmedAt = new Date(2026, 7, 26, 4, 45);

    await logPrayer('Fajr', firstConfirmedAt);

    await expect(logPrayer('Fajr', secondConfirmedAt)).rejects.toThrow();

    const history = await getHistory({ startDateISO: '2026-08-26', endDateISO: '2026-08-26' });
    expect(history).toHaveLength(1);
  });
});

describe('computeStatus', () => {
  // Pure, synchronous, no I/O — this is Day 4's status derivation, not persisted
  // anywhere (matches the SPEC principle that only on_time/late/qada ever get
  // written to completion_type; "missed" and "not_yet" are always computed live).
  // azanTime stands in for a prayer's scheduled start (e.g. Dhuhr); windowCloseTime
  // stands in for when its window closes (e.g. Asr's start).
  const azanTime = new Date(2026, 7, 24, 12, 22);
  const windowCloseTime = new Date(2026, 7, 24, 15, 46);

  it('returns on_time when confirmed within 30 minutes of azan', () => {
    const confirmedAt = new Date(2026, 7, 24, 12, 37); // 15 min after azan
    expect(computeStatus(azanTime, windowCloseTime, confirmedAt, confirmedAt)).toBe('on_time');
  });

  it('returns on_time when confirmed at exactly 30 minutes after azan (boundary is inclusive)', () => {
    const confirmedAt = new Date(2026, 7, 24, 12, 52); // exactly 30 min after azan
    expect(computeStatus(azanTime, windowCloseTime, confirmedAt, confirmedAt)).toBe('on_time');
  });

  it('returns late when confirmed more than 30 minutes after azan but before window close', () => {
    const confirmedAt = new Date(2026, 7, 24, 13, 7); // 45 min after azan, well before window close
    expect(computeStatus(azanTime, windowCloseTime, confirmedAt, confirmedAt)).toBe('late');
  });

  it('returns qada when confirmed exactly at window close', () => {
    const confirmedAt = new Date(windowCloseTime);
    expect(computeStatus(azanTime, windowCloseTime, confirmedAt, confirmedAt)).toBe('qada');
  });

  it('returns qada when confirmed after window close', () => {
    const confirmedAt = new Date(2026, 7, 24, 16, 0); // after window close
    expect(computeStatus(azanTime, windowCloseTime, confirmedAt, confirmedAt)).toBe('qada');
  });

  it('returns missed when there is no confirmation and the window has closed', () => {
    const now = new Date(2026, 7, 24, 16, 0); // after window close
    expect(computeStatus(azanTime, windowCloseTime, null, now)).toBe('missed');
  });

  it('returns not_yet when there is no confirmation and the window has not closed yet', () => {
    const now = new Date(2026, 7, 24, 13, 0); // before window close
    expect(computeStatus(azanTime, windowCloseTime, null, now)).toBe('not_yet');
  });
});
