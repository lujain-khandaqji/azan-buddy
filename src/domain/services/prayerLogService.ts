// Plain TypeScript domain service — no React or UI imports. Day 3 scope only:
// persistent prayer confirmations and reading history back. The table already
// includes scheduled_at/completed_at/completion_type/updated_at so Day 4's
// on_time/late/qada/missed classification can populate them without a schema
// redesign — no classification logic is implemented here yet.

import * as SQLite from 'expo-sqlite';

import { PrayerName } from './prayerTimesService';

export interface PrayerLogEntry {
  id: string;
  dateISO: string;
  prayerName: PrayerName;
  confirmedAt: Date;
}

export interface DateRange {
  startDateISO: string;
  endDateISO: string;
}

const DB_NAME = 'azan-buddy.db';

interface PrayerLogRow {
  id: string;
  date_iso: string;
  prayer_name: PrayerName;
  confirmed_at: number;
  created_at: number;
}

// No module-level connection cache on purpose: opening the same-named database is
// cheap and expo-sqlite handles repeated opens safely, and calling
// openDatabaseAsync fresh each time keeps this service simple to reason about (and
// to test) instead of coordinating a shared singleton's lifecycle.
async function getDb() {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS prayer_log (
      id TEXT PRIMARY KEY,
      date_iso TEXT NOT NULL,
      prayer_name TEXT NOT NULL,
      scheduled_at INTEGER,
      completed_at INTEGER,
      completion_type TEXT CHECK(completion_type IN ('on_time', 'late', 'qada')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(date_iso, prayer_name)
    );
  `);
  return db;
}

export function toDateISO(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toEntry(row: PrayerLogRow): PrayerLogEntry {
  return {
    id: row.id,
    dateISO: row.date_iso,
    prayerName: row.prayer_name,
    confirmedAt: new Date(row.confirmed_at),
  };
}

/**
 * Logs a prayer as confirmed (Day 3 scope — no on_time/late/qada/missed
 * classification yet; scheduled_at and completion_type are left unset here and
 * belong to Day 4). The id is deterministically derived from the confirmation's
 * calendar day and prayer name (e.g. "2026-08-26-Fajr"); combined with the
 * table's UNIQUE(date_iso, prayer_name) constraint, this reliably prevents a
 * second confirmation of the same prayer on the same date.
 */
export async function logPrayer(prayer: PrayerName, confirmedAt: Date): Promise<PrayerLogEntry> {
  const db = await getDb();
  const dateISO = toDateISO(confirmedAt);
  const id = `${dateISO}-${prayer}`;
  const completedAt = confirmedAt.getTime();
  const now = Date.now();

  try {
    await db.runAsync(
      'INSERT INTO prayer_log (id, date_iso, prayer_name, completed_at, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?)',
      [id, dateISO, prayer, completedAt, now, now]
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes('UNIQUE constraint failed') || message.includes('PRIMARY KEY')) {
      throw new Error(`${prayer} has already been confirmed for ${dateISO}`);
    }
    throw e;
  }

  return { id, dateISO, prayerName: prayer, confirmedAt };
}

export async function getHistory(range: DateRange): Promise<PrayerLogEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<PrayerLogRow>(
    'SELECT id, date_iso, prayer_name, completed_at AS confirmed_at, created_at FROM prayer_log ' +
      'WHERE date_iso >= ? AND date_iso <= ? ORDER BY date_iso ASC, completed_at ASC',
    [range.startDateISO, range.endDateISO]
  );

  return rows.map(toEntry);
}

const ON_TIME_GRACE_MS = 30 * 60 * 1000;

export type PrayerLogStatus = 'on_time' | 'late' | 'qada' | 'missed' | 'not_yet';

/**
 * Pure, synchronous status derivation (Day 4). Only 'on_time'/'late'/'qada' are
 * ever persisted to completion_type — 'missed' and 'not_yet' are never written,
 * only computed live from confirmedAt/now, matching the SPEC principle that a
 * prayer's status is always correct whenever it's read, with no background job
 * needed to mark something missed.
 */
export function computeStatus(
  azanTime: Date,
  windowCloseTime: Date,
  confirmedAt: Date | null,
  now: Date
): PrayerLogStatus {
  if (confirmedAt) {
    if (confirmedAt.getTime() >= windowCloseTime.getTime()) {
      return 'qada';
    }
    const msAfterAzan = confirmedAt.getTime() - azanTime.getTime();
    return msAfterAzan <= ON_TIME_GRACE_MS ? 'on_time' : 'late';
  }

  return now.getTime() >= windowCloseTime.getTime() ? 'missed' : 'not_yet';
}
