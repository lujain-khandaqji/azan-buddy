// Plain TypeScript domain service — no React or UI imports. Limited to
// createReminder/listReminders/cancelReminder/materializeReminderForDate,
// expo-notifications scheduling, persistence, and duplicate-prevention/'always'
// next-day materialization. No form UI here.

import * as Notifications from 'expo-notifications';
import * as SQLite from 'expo-sqlite';

import { getPrayerTimes, PrayerName } from './prayerTimesService';
import { toDateISO } from './prayerLogService';
import { resolveCurrentCity } from './locationService';

export type ReminderScope = 'today' | 'always';

export interface ReminderRule {
  id: string;
  prayerName: PrayerName;
  offsetMinutes: number;
  scope: ReminderScope;
}

export interface ReminderInstance {
  id: string;
  ruleId: string;
  dateISO: string;
  fireAt: Date;
  notificationId: string;
}

// Same database file as prayerLogService — one shared local DB, different tables.
const DB_NAME = 'azan-buddy.db';

interface ReminderRuleRow {
  id: string;
  prayer_name: PrayerName;
  offset_minutes: number;
  scope: ReminderScope;
  created_at: number;
}

interface ReminderInstanceRow {
  id: string;
  rule_id: string;
  date_iso: string;
  fire_at: number;
  notification_id: string;
}

// No module-level connection cache, matching prayerLogService's approach: opening
// the same-named database repeatedly is cheap, and this keeps the service simple
// to test without coordinating a shared singleton's lifecycle.
async function getDb() {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS reminder_rules (
      id TEXT PRIMARY KEY,
      prayer_name TEXT NOT NULL,
      offset_minutes INTEGER NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('today', 'always')),
      created_at INTEGER NOT NULL
    );
  `);
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS reminder_instances (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      date_iso TEXT NOT NULL,
      fire_at INTEGER NOT NULL,
      notification_id TEXT NOT NULL,
      UNIQUE(rule_id, date_iso)
    );
  `);
  return db;
}

function generateRuleId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// "YYYY-MM-DD" parsed via new Date(string) is UTC per the ISO 8601 spec — the
// same trap avoided elsewhere in this codebase. Split and use the local
// constructor instead, so a date string always means that calendar day locally.
function parseDateISO(dateISO: string): Date {
  const [year, month, day] = dateISO.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toRule(row: ReminderRuleRow): ReminderRule {
  return { id: row.id, prayerName: row.prayer_name, offsetMinutes: row.offset_minutes, scope: row.scope };
}

function toInstance(row: ReminderInstanceRow): ReminderInstance {
  return {
    id: row.id,
    ruleId: row.rule_id,
    dateISO: row.date_iso,
    fireAt: new Date(row.fire_at),
    notificationId: row.notification_id,
  };
}

/**
 * Schedules (or reuses) the notification for one rule on one calendar day. If an
 * instance already exists for this (ruleId, dateISO) pair, returns it without
 * scheduling anything new — this is what lets 'always' reminders be
 * re-materialized for future days (a different dateISO) without ever duplicating
 * an already-scheduled day.
 */
export async function materializeReminderForDate(
  rule: ReminderRule,
  dateISO: string
): Promise<ReminderInstance | null> {
  const db = await getDb();

  const existing = await db.getFirstAsync<ReminderInstanceRow>(
    'SELECT id, rule_id, date_iso, fire_at, notification_id FROM reminder_instances WHERE rule_id = ? AND date_iso = ?',
    [rule.id, dateISO]
  );
  if (existing) {
    return toInstance(existing);
  }

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    return null;
  }

  const { city, country } = await resolveCurrentCity();
  const times = await getPrayerTimes(city, parseDateISO(dateISO), undefined, country);
  const azanTime = times[rule.prayerName];
  const fireAt = new Date(azanTime.getTime() - rule.offsetMinutes * 60000);

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Prayer reminder',
      body: `${rule.prayerName} in ${rule.offsetMinutes} minute${rule.offsetMinutes === 1 ? '' : 's'}`,
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fireAt },
  });

  const instanceId = `${rule.id}-${dateISO}`;
  await db.runAsync(
    'INSERT INTO reminder_instances (id, rule_id, date_iso, fire_at, notification_id) VALUES (?, ?, ?, ?, ?)',
    [instanceId, rule.id, dateISO, fireAt.getTime(), notificationId]
  );

  return { id: instanceId, ruleId: rule.id, dateISO, fireAt, notificationId };
}

export async function createReminder(
  prayer: PrayerName,
  offsetMinutes: number,
  scope: ReminderScope
): Promise<ReminderRule> {
  const db = await getDb();
  const id = generateRuleId();
  const createdAt = Date.now();

  await db.runAsync(
    'INSERT INTO reminder_rules (id, prayer_name, offset_minutes, scope, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, prayer, offsetMinutes, scope, createdAt]
  );

  const rule: ReminderRule = { id, prayerName: prayer, offsetMinutes, scope };
  await materializeReminderForDate(rule, toDateISO(new Date()));

  return rule;
}

export async function listReminders(): Promise<ReminderRule[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ReminderRuleRow>(
    'SELECT id, prayer_name, offset_minutes, scope FROM reminder_rules'
  );
  return rows.map(toRule);
}

export async function cancelReminder(id: string): Promise<void> {
  const db = await getDb();

  const instances = await db.getAllAsync<ReminderInstanceRow>(
    'SELECT id, rule_id, date_iso, fire_at, notification_id FROM reminder_instances WHERE rule_id = ?',
    [id]
  );

  for (const instance of instances) {
    await Notifications.cancelScheduledNotificationAsync(instance.notification_id);
  }

  await db.runAsync('DELETE FROM reminder_instances WHERE rule_id = ?', [id]);
  await db.runAsync('DELETE FROM reminder_rules WHERE id = ?', [id]);
}
