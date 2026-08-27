import { useCallback, useEffect, useState } from 'react';
import {
  createReminder as createReminderService,
  listReminders,
  cancelReminder as cancelReminderService,
  updateReminder as updateReminderService,
  ReminderRule,
  ReminderScope,
} from '../../domain/services/reminderService';
import { PrayerName } from '../../domain/services/prayerTimesService';

export interface RemindersState {
  reminders: ReminderRule[];
  loading: boolean;
  error: string | null;
  saving: boolean;
  saveError: string | null;
  createReminder: (prayer: PrayerName, offsetMinutes: number, scope: ReminderScope) => Promise<void>;
  updateReminder: (id: string, prayer: PrayerName, offsetMinutes: number, scope: ReminderScope) => Promise<void>;
  cancelReminder: (id: string) => Promise<void>;
}

function describeError(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/**
 * Owns no reminder logic of its own — createReminder/listReminders/cancelReminder
 * are called directly from reminderService; this hook only tracks loading/error
 * state and refreshes the list after a mutation.
 */
export function useReminders(): RemindersState {
  const [reminders, setReminders] = useState<ReminderRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await listReminders();
    setReminders(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    refresh()
      .catch((e) => {
        if (!cancelled) setError(describeError(e, 'Failed to load reminders'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  async function createReminder(prayer: PrayerName, offsetMinutes: number, scope: ReminderScope) {
    setSaving(true);
    setSaveError(null);
    try {
      await createReminderService(prayer, offsetMinutes, scope);
      await refresh();
    } catch (e) {
      setSaveError(describeError(e, 'Failed to save reminder'));
    } finally {
      setSaving(false);
    }
  }

  async function updateReminder(id: string, prayer: PrayerName, offsetMinutes: number, scope: ReminderScope) {
    setSaving(true);
    setSaveError(null);
    try {
      await updateReminderService(id, prayer, offsetMinutes, scope);
      await refresh();
    } catch (e) {
      setSaveError(describeError(e, 'Failed to update reminder'));
    } finally {
      setSaving(false);
    }
  }

  async function cancelReminder(id: string) {
    try {
      await cancelReminderService(id);
      await refresh();
    } catch (e) {
      setError(describeError(e, 'Failed to cancel reminder'));
    }
  }

  return { reminders, loading, error, saving, saveError, createReminder, updateReminder, cancelReminder };
}
