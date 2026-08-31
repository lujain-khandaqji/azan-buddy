import { PrayerName } from './prayerTimesService';
import { PrayerLogStatus } from './prayerLogService';
import { detectNewCoachingTriggers, seedTriggeredKeys, triggerKey } from './coachingTriggerService';

const TODAY = '2026-08-31';
const TOMORROW = '2026-09-01';

describe('triggerKey', () => {
  it('combines date, prayer name, and status into a stable string key', () => {
    expect(triggerKey(TODAY, 'Dhuhr', 'late')).toBe('2026-08-31:Dhuhr:late');
  });
});

describe('detectNewCoachingTriggers', () => {
  function statuses(overrides: Partial<Record<PrayerName, PrayerLogStatus>>) {
    return overrides;
  }

  it('returns no triggers when nothing is coachable', () => {
    const result = detectNewCoachingTriggers(TODAY, statuses({ Fajr: 'on_time', Dhuhr: 'not_yet' }), new Set());
    expect(result).toEqual([]);
  });

  it('returns a trigger for a late status', () => {
    const result = detectNewCoachingTriggers(TODAY, statuses({ Dhuhr: 'late' }), new Set());
    expect(result).toEqual([{ prayerName: 'Dhuhr', status: 'late' }]);
  });

  it('returns a trigger for a qada status', () => {
    const result = detectNewCoachingTriggers(TODAY, statuses({ Asr: 'qada' }), new Set());
    expect(result).toEqual([{ prayerName: 'Asr', status: 'qada' }]);
  });

  it('returns a trigger for a missed status', () => {
    const result = detectNewCoachingTriggers(TODAY, statuses({ Fajr: 'missed' }), new Set());
    expect(result).toEqual([{ prayerName: 'Fajr', status: 'missed' }]);
  });

  it('returns multiple triggers in PRAYER_NAMES order when several prayers are coachable at once', () => {
    const result = detectNewCoachingTriggers(
      TODAY,
      statuses({ Isha: 'late', Fajr: 'missed', Dhuhr: 'qada' }),
      new Set()
    );
    expect(result).toEqual([
      { prayerName: 'Fajr', status: 'missed' },
      { prayerName: 'Dhuhr', status: 'qada' },
      { prayerName: 'Isha', status: 'late' },
    ]);
  });

  it('does not trigger the same prayer/status twice on the same date', () => {
    const alreadyTriggered = new Set([triggerKey(TODAY, 'Fajr', 'missed')]);
    const result = detectNewCoachingTriggers(TODAY, statuses({ Fajr: 'missed' }), alreadyTriggered);
    expect(result).toEqual([]);
  });

  it('allows the same prayer/status to trigger again on a different date', () => {
    const alreadyTriggered = new Set([triggerKey(TODAY, 'Fajr', 'missed')]);
    const result = detectNewCoachingTriggers(TOMORROW, statuses({ Fajr: 'missed' }), alreadyTriggered);
    expect(result).toEqual([{ prayerName: 'Fajr', status: 'missed' }]);
  });

  it('allows missed then later qada for the same prayer on the same date to trigger separately', () => {
    const alreadyTriggered = new Set([triggerKey(TODAY, 'Fajr', 'missed')]);
    const result = detectNewCoachingTriggers(TODAY, statuses({ Fajr: 'qada' }), alreadyTriggered);
    expect(result).toEqual([{ prayerName: 'Fajr', status: 'qada' }]);
  });
});

describe('seedTriggeredKeys', () => {
  function statuses(overrides: Partial<Record<PrayerName, PrayerLogStatus>>) {
    return overrides;
  }

  it('captures every currently coachable status as already-triggered', () => {
    const seeded = seedTriggeredKeys(TODAY, statuses({ Fajr: 'missed', Dhuhr: 'qada', Asr: 'late' }));
    expect(seeded).toEqual(
      new Set([
        triggerKey(TODAY, 'Fajr', 'missed'),
        triggerKey(TODAY, 'Dhuhr', 'qada'),
        triggerKey(TODAY, 'Asr', 'late'),
      ])
    );
  });

  it('does not seed anything for on_time/not_yet statuses', () => {
    const seeded = seedTriggeredKeys(TODAY, statuses({ Fajr: 'on_time', Dhuhr: 'not_yet' }));
    expect(seeded).toEqual(new Set());
  });
});

describe('session-based auto-trigger transitions (seedTriggeredKeys + detectNewCoachingTriggers)', () => {
  function statuses(overrides: Partial<Record<PrayerName, PrayerLogStatus>>) {
    return overrides;
  }

  it('does not auto-trigger prayers that are already late/qada/missed at the initial snapshot', () => {
    const initialStatuses = statuses({ Fajr: 'missed', Dhuhr: 'qada', Asr: 'late' });
    const seeded = seedTriggeredKeys(TODAY, initialStatuses);

    const result = detectNewCoachingTriggers(TODAY, initialStatuses, seeded);

    expect(result).toEqual([]);
  });

  it('triggers when a prayer newly transitions from not_yet to missed after the initial snapshot', () => {
    const seeded = seedTriggeredKeys(TODAY, statuses({ Isha: 'not_yet' }));

    const result = detectNewCoachingTriggers(TODAY, statuses({ Isha: 'missed' }), seeded);

    expect(result).toEqual([{ prayerName: 'Isha', status: 'missed' }]);
  });

  it('triggers when a prayer newly transitions to late after confirmation', () => {
    const seeded = seedTriggeredKeys(TODAY, statuses({ Dhuhr: 'not_yet' }));

    const result = detectNewCoachingTriggers(TODAY, statuses({ Dhuhr: 'late' }), seeded);

    expect(result).toEqual([{ prayerName: 'Dhuhr', status: 'late' }]);
  });

  it('triggers when a prayer newly transitions to qada after confirmation', () => {
    const seeded = seedTriggeredKeys(TODAY, statuses({ Asr: 'missed' }));

    const result = detectNewCoachingTriggers(TODAY, statuses({ Asr: 'qada' }), seeded);

    expect(result).toEqual([{ prayerName: 'Asr', status: 'qada' }]);
  });

  it('does not trigger the same transition twice once its key has been recorded', () => {
    const seeded = seedTriggeredKeys(TODAY, statuses({ Fajr: 'not_yet' }));
    const afterFirstTick = statuses({ Fajr: 'missed' });

    const firstResult = detectNewCoachingTriggers(TODAY, afterFirstTick, seeded);
    expect(firstResult).toEqual([{ prayerName: 'Fajr', status: 'missed' }]);

    const afterRecording = new Set(seeded);
    afterRecording.add(triggerKey(TODAY, 'Fajr', 'missed'));
    const secondResult = detectNewCoachingTriggers(TODAY, afterFirstTick, afterRecording);

    expect(secondResult).toEqual([]);
  });
});
