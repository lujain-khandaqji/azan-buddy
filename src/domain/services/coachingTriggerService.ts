// Plain TypeScript domain logic — no React, no I/O. Consumes an already-computed
// statusByPrayer map (from prayerLogService.computeStatus, via the UI's tick loop)
// and decides which coachable statuses are new. It never re-derives on_time/late/
// qada/missed itself, so status rules stay defined in exactly one place.

import { PrayerName, PRAYER_NAMES } from './prayerTimesService';
import { PrayerLogStatus } from './prayerLogService';

export type CoachingTriggerStatus = Extract<PrayerLogStatus, 'late' | 'qada' | 'missed'>;

export interface CoachingTrigger {
  prayerName: PrayerName;
  status: CoachingTriggerStatus;
}

const COACHABLE_STATUSES: readonly PrayerLogStatus[] = ['late', 'qada', 'missed'];

function isCoachable(status: PrayerLogStatus | undefined): status is CoachingTriggerStatus {
  return status != null && COACHABLE_STATUSES.includes(status);
}

/**
 * dateISO is folded into the key so dedupe is per-day: a prayer/status pair that
 * already triggered today is free to trigger again once the calendar date rolls
 * over, without any separate "reset at midnight" step.
 */
export function triggerKey(dateISO: string, prayerName: PrayerName, status: PrayerLogStatus): string {
  return `${dateISO}:${prayerName}:${status}`;
}

export function detectNewCoachingTriggers(
  dateISO: string,
  statusByPrayer: Partial<Record<PrayerName, PrayerLogStatus>>,
  alreadyTriggeredKeys: ReadonlySet<string>
): CoachingTrigger[] {
  const triggers: CoachingTrigger[] = [];

  for (const prayerName of PRAYER_NAMES) {
    const status = statusByPrayer[prayerName];
    if (!isCoachable(status)) continue;
    if (alreadyTriggeredKeys.has(triggerKey(dateISO, prayerName, status))) continue;
    triggers.push({ prayerName, status });
  }

  return triggers;
}

/**
 * Marks every currently coachable status in an initial snapshot as already
 * triggered, without producing any trigger events for them. Callers should seed
 * with this exactly once, from the first status snapshot of a session, before
 * calling detectNewCoachingTriggers on later snapshots — so a prayer that was
 * already late/qada/missed before the session started does not fire retroactive
 * coaching, while a prayer that newly transitions into a coachable status during
 * the session still does.
 */
export function seedTriggeredKeys(
  dateISO: string,
  statusByPrayer: Partial<Record<PrayerName, PrayerLogStatus>>
): Set<string> {
  const keys = new Set<string>();
  for (const trigger of detectNewCoachingTriggers(dateISO, statusByPrayer, new Set())) {
    keys.add(triggerKey(dateISO, trigger.prayerName, trigger.status));
  }
  return keys;
}
