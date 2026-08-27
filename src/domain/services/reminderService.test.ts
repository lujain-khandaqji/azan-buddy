import * as Notifications from 'expo-notifications';
import * as SQLite from 'expo-sqlite';

import { PrayerTimes } from './prayerTimesService';
import { toDateISO } from './prayerLogService';
import {
  createReminder,
  listReminders,
  cancelReminder,
  updateReminder,
  materializeReminderForDate,
} from './reminderService';

// expo-sqlite and expo-notifications are native modules and can't run inside
// Jest, so both are mocked. The fake DB below implements the same
// insert/select/delete contract the service relies on for its two tables
// (reminder_rules, reminder_instances) — it sniffs the table name out of the SQL
// text just enough to route to the right in-memory array; it does not validate
// real SQL syntax. prayerTimesService.getPrayerTimes is mocked directly (rather
// than mocking fetch) since this service only needs a controlled PrayerTimes
// value, not Aladhan's HTTP contract.
//
// The test clock is frozen to 2026-08-26T00:00:00 (local, before any of that
// day's prayers) via Jest fake timers, so every new Date() inside the service —
// not just the explicitly-passed dates in these tests — consistently resolves to
// that day, matching FIXTURE_TIMES.

interface RuleRow {
  id: string;
  prayer_name: string;
  offset_minutes: number;
  scope: string;
  created_at: number;
}

interface InstanceRow {
  id: string;
  rule_id: string;
  date_iso: string;
  fire_at: number;
  notification_id: string;
}

function createFakeDb() {
  let rules: RuleRow[] = [];
  let instances: InstanceRow[] = [];

  const isRules = (sql: string) => sql.includes('reminder_rules');
  const isInstances = (sql: string) => sql.includes('reminder_instances');

  return {
    execAsync: jest.fn(async () => undefined),
    runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      const op = sql.trim().split(/\s+/)[0].toUpperCase();

      if (isRules(sql)) {
        if (op === 'INSERT') {
          const [id, prayerName, offsetMinutes, scope, createdAt] = params as [
            string,
            string,
            number,
            string,
            number
          ];
          rules.push({ id, prayer_name: prayerName, offset_minutes: offsetMinutes, scope, created_at: createdAt });
        } else if (op === 'DELETE') {
          const [id] = params as [string];
          rules = rules.filter((r) => r.id !== id);
        } else if (op === 'UPDATE') {
          const [prayerName, offsetMinutes, scope, id] = params as [string, number, string, string];
          rules = rules.map((r) =>
            r.id === id ? { ...r, prayer_name: prayerName, offset_minutes: offsetMinutes, scope } : r
          );
        }
      } else if (isInstances(sql)) {
        if (op === 'INSERT') {
          const [id, ruleId, dateISO, fireAt, notificationId] = params as [
            string,
            string,
            string,
            number,
            string
          ];
          if (instances.some((i) => i.id === id)) {
            throw new Error('UNIQUE constraint failed: reminder_instances.id');
          }
          instances.push({ id, rule_id: ruleId, date_iso: dateISO, fire_at: fireAt, notification_id: notificationId });
        } else if (op === 'DELETE') {
          const [ruleId] = params as [string];
          instances = instances.filter((i) => i.rule_id !== ruleId);
        }
      }

      return { lastInsertRowId: 0, changes: 1 };
    }),
    getFirstAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (isInstances(sql)) {
        const [ruleId, dateISO] = params as [string, string];
        return instances.find((i) => i.rule_id === ruleId && i.date_iso === dateISO) ?? null;
      }
      return null;
    }),
    getAllAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (isRules(sql)) {
        return rules.map((r) => ({ ...r }));
      }
      if (isInstances(sql)) {
        const [ruleId] = params as [string?];
        return instances.filter((i) => !ruleId || i.rule_id === ruleId).map((i) => ({ ...i }));
      }
      return [];
    }),
  };
}

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));

jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

jest.mock('./prayerTimesService', () => ({
  ...jest.requireActual('./prayerTimesService'),
  getPrayerTimes: jest.fn(),
}));

jest.mock('./locationService', () => ({
  resolveCurrentCity: jest.fn(),
}));

const mockedSQLite = SQLite as jest.Mocked<typeof SQLite>;
const mockedNotifications = Notifications as jest.Mocked<typeof Notifications>;
const mockedGetPrayerTimes = require('./prayerTimesService').getPrayerTimes as jest.Mock;
const mockedResolveCurrentCity = require('./locationService').resolveCurrentCity as jest.Mock;

const FIXTURE_TIMES: PrayerTimes = {
  Fajr: new Date(2026, 7, 26, 4, 38),
  Dhuhr: new Date(2026, 7, 26, 12, 22),
  Asr: new Date(2026, 7, 26, 15, 46),
  Maghrib: new Date(2026, 7, 26, 18, 45),
  Isha: new Date(2026, 7, 26, 20, 11),
};

describe('reminderService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 7, 26, 0, 0, 0));

    mockedSQLite.openDatabaseAsync.mockResolvedValue(createFakeDb() as any);
    mockedGetPrayerTimes.mockResolvedValue(FIXTURE_TIMES);
    mockedResolveCurrentCity.mockResolvedValue({ city: 'Amman', country: 'Jordan' });
    mockedNotifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' } as any);
    mockedNotifications.scheduleNotificationAsync.mockResolvedValue('notif-1');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
  });

  it('creates a reminder and schedules a notification for it', async () => {
    const rule = await createReminder('Dhuhr', 15, 'today');

    expect(rule.prayerName).toBe('Dhuhr');
    expect(rule.offsetMinutes).toBe(15);
    expect(rule.scope).toBe('today');
    expect(rule.id).toEqual(expect.any(String));
    expect(mockedNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('schedules the notification at azan time minus offsetMinutes', async () => {
    await createReminder('Dhuhr', 15, 'today');

    const call = mockedNotifications.scheduleNotificationAsync.mock.calls[0][0] as any;
    const expectedFireAt = new Date(2026, 7, 26, 12, 7); // Dhuhr 12:22 - 15 min

    expect(call.trigger.type).toBe(Notifications.SchedulableTriggerInputTypes.DATE);
    expect(call.trigger.date.getTime()).toBe(expectedFireAt.getTime());
  });

  it('lists created reminders', async () => {
    const rule = await createReminder('Fajr', 20, 'always');

    const reminders = await listReminders();

    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({
      id: rule.id,
      prayerName: 'Fajr',
      offsetMinutes: 20,
      scope: 'always',
    });
  });

  it('cancels a reminder: cancels its scheduled notification and removes it from the list', async () => {
    const rule = await createReminder('Asr', 10, 'today');

    await cancelReminder(rule.id);

    expect(mockedNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notif-1');
    const reminders = await listReminders();
    expect(reminders).toHaveLength(0);
  });

  it('does not schedule a duplicate notification for the same rule and date', async () => {
    const rule = await createReminder('Maghrib', 5, 'always');
    // createReminder already materialized today's instance once; materializing
    // the same rule for the same date again must not schedule a second one.
    const todayISO = toDateISO(new Date());

    await materializeReminderForDate(rule, todayISO);

    expect(mockedNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it("materializes an 'always' reminder for the next day without duplicating today's instance", async () => {
    const rule = await createReminder('Fajr', 10, 'always');
    // createReminder already scheduled today's instance — 1 call so far.

    const todayISO = toDateISO(new Date());
    const tomorrowISO = toDateISO(new Date(2026, 7, 27));

    mockedNotifications.scheduleNotificationAsync.mockResolvedValueOnce('notif-2');
    const tomorrowInstance = await materializeReminderForDate(rule, tomorrowISO);

    expect(tomorrowInstance?.dateISO).toBe(tomorrowISO);
    expect(mockedNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);

    // Re-materializing today must still not create a second instance for today.
    await materializeReminderForDate(rule, todayISO);
    expect(mockedNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it('updates a reminder rule: preserves its id, cancels the old scheduled notification, and schedules a new one', async () => {
    const rule = await createReminder('Dhuhr', 15, 'today'); // schedules 'notif-1'

    mockedNotifications.scheduleNotificationAsync.mockResolvedValueOnce('notif-2');
    const updated = await updateReminder(rule.id, 'Asr', 20, 'always');

    expect(updated.id).toBe(rule.id);
    expect(updated.prayerName).toBe('Asr');
    expect(updated.offsetMinutes).toBe(20);
    expect(updated.scope).toBe('always');
    expect(mockedNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notif-1');
    expect(mockedNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it("schedules the updated reminder at the new prayer's azan time minus the new offset", async () => {
    const rule = await createReminder('Dhuhr', 15, 'today');
    mockedNotifications.scheduleNotificationAsync.mockResolvedValueOnce('notif-2');

    await updateReminder(rule.id, 'Asr', 20, 'always');

    const secondCall = mockedNotifications.scheduleNotificationAsync.mock.calls[1][0] as any;
    const expectedFireAt = new Date(2026, 7, 26, 15, 26); // Asr 15:46 - 20 min
    expect(secondCall.trigger.date.getTime()).toBe(expectedFireAt.getTime());
  });

  it('reflects the update in listReminders, still as a single entry for the same id', async () => {
    const rule = await createReminder('Dhuhr', 15, 'today');
    mockedNotifications.scheduleNotificationAsync.mockResolvedValueOnce('notif-2');

    await updateReminder(rule.id, 'Asr', 20, 'always');
    const reminders = await listReminders();

    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toEqual({ id: rule.id, prayerName: 'Asr', offsetMinutes: 20, scope: 'always' });
  });
});
