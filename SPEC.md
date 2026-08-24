# azan-buddy — Architecture Spec

`azan-buddy` is a voice-first Islamic prayer companion built with Expo (SDK 54) + TypeScript.
The project ships in three checkpoints, **voice-last**:

1. **Checkpoint 1** (tap-and-type) — prayer times, countdown, confirmation, reminders, history.
   No voice.
2. **Checkpoint 2** (text coaching) — Gemini text chat coaching, auto-triggered on
   late/qada/missed prayers. No voice yet.
3. **Checkpoint 3** (voice) — a Gemini Live persistent session over LiveKit, with function tools
   that wrap the services built in Checkpoints 1–2. Arabic + English.

**Governing mandate:** the Gemini Live session is not the app — it's a thin function-calling
layer over data, storage, notifications, status computation, and the coaching prompt that already
exist by Checkpoint 2. Checkpoint 1's service functions are shaped, from day one, so they can
become Gemini function-calling tools in Checkpoint 3 unchanged. If Checkpoint 3 needs a refactor
of Checkpoint 1/2 code, the Checkpoint 1 design was wrong.

Four design decisions are locked in for this spec:

1. **UI state management:** React Context + hooks (no extra dependency; the service layer stays
   framework-agnostic underneath it).
2. **Reminder model:** per-prayer, user-editable offsets (not one global offset) — matches how
   people actually want reminders, and matches how a voice command like "remind me before
   Maghrib" naturally names one prayer.
3. **Notification tap behavior:** tapping a reminder opens the app to the confirm screen (not an
   interactive "Mark Done" notification button) — one confirmation code path, less native setup.
4. **Dev workflow:** Expo Go for Checkpoints 1–2 (expo-notifications and expo-sqlite both work
   in Expo Go); switch to an EAS development build only when Checkpoint 3 starts, since LiveKit
   and Gemini Live's audio streaming are native capabilities Expo Go can't run.

Key facts verified against the live Expo v54 docs:

- **expo-notifications:** `scheduleNotificationAsync({content, trigger})`, trigger types include
  `TIME_INTERVAL` and `DATE`; `cancelScheduledNotificationAsync(id)` /
  `cancelAllScheduledNotificationsAsync()`; `addNotificationResponseReceivedListener()` for taps;
  Android needs notification channels; local notifications work fine in Expo Go.
- **expo-sqlite:** `openDatabaseAsync(name)`; query via `runAsync`/`getAllAsync`/`getFirstAsync`;
  transactions via `withTransactionAsync()`; migrations via a `PRAGMA user_version` check-and-apply
  pattern.

---

## 1. Domain Services Architecture (Checkpoint 1)

**Governing principle.** Every Checkpoint‑1 service function is a plain async TypeScript
function: JSON-serializable primitive/object parameters in, JSON-serializable plain object/array
out. No React hooks, no component state, inside a service function. Because Gemini Live's
function-calling tools run **in-process** in the same JS runtime as the app (no backend server —
the "tool executor" is just another caller of the same service module the UI calls), a
Checkpoint‑3 tool wrapper is always "declare a JSON schema → call the Checkpoint‑1 function →
return its result" — never a rewrite.

**Source layout:**

```
src/
  domain/
    time.ts                       # todayISO(), epoch helpers, timezone-aware "today"
    types.ts                      # PrayerName, PrayerEntry, PrayerStatusRecord, ...
    status/computeStatus.ts       # pure status computation, no I/O
    events/domainEvents.ts        # plain-JS pub/sub (not React Context — see Risks)
    db/client.ts                  # openDatabaseAsync singleton + migration runner
    db/migrations/001_init.ts, 002_coaching.ts
    services/
      settingsService.ts
      prayerTimesService.ts
      prayerStatusService.ts
      reminderService.ts
      historyService.ts
      coachingTriggerService.ts   # Checkpoint 2
      coachingService.ts          # Checkpoint 2 (Gemini text via Cloudflare AI Gateway)
  integrations/
    aladhan.ts                    # raw Aladhan API client
    gemini/gatewayConfig.ts       # single Cloudflare AI Gateway base URL/model config
    gemini/textClient.ts          # Checkpoint 2
    gemini/liveClient.ts          # Checkpoint 3 (Gemini Live + LiveKit)
    gemini/tools/*.ts             # Checkpoint 3 — thin wrappers only, no logic
  ui/
    context/                      # React Context providers (state-mgmt decision #1)
    screens/  components/  hooks/ # useNextPrayer, useDailyStatus, etc.
```

The `ui/` vs `domain/` split is the structural proof of the "no refactor later" rule: in
Checkpoint 3, `integrations/gemini/tools/*` files import `domain/services/*` directly and do
nothing but declare a schema and shape the return value — they never touch `ui/`.

**Services and their signatures:**

- `settingsService`: `getSettings()`, `updateSettings(patch)`. A single-row settings table seeded
  with Amman + calculation method 4 as defaults, including a `language: 'ar' | 'en'` field added
  now even though it's unused until Checkpoint 3 (avoids a schema migration later).
- `prayerTimesService`: `getPrayerTimesForDate(dateISO, location?)` (cache-first, falls back to
  the Aladhan API), `getNextPrayer(now?)` (countdown math), `prefetchMonth(yearMonth)` (seeds
  ~30 days from Aladhan's calendar endpoint for offline resilience). All prayer times are
  normalized to epoch milliseconds (UTC) the moment they're fetched — never carried as local-time
  strings — so status logic never has to reason about timezones directly.
- `status/computeStatus.ts` (pure, zero I/O): `computeDailyStatus(prayers, nextDayFajr, log, now,
  graceMs)` → labeled records (`upcoming | on_time | late | missed | qada`). Takes `now` as a
  parameter rather than reading the clock itself, which is what lets the exact same function back
  the Checkpoint‑1 dashboard, Checkpoint‑2's auto-trigger check, and a Checkpoint‑3 voice "what's
  my status" tool call — they cannot disagree, because they run the same code.
- `prayerStatusService` (DB-backed): `getDailyStatus(dateISO?)`, `confirmPrayer(dateISO,
  prayerName, completedAt?)`, `confirmQada(dateISO, prayerName, completedAt?)`,
  `markMissed(dateISO, prayerName)`. Three distinct verbs instead of one generic `setStatus(...)`
  because on-time/late classification is derived math, not something a caller should set directly
  — only the actions a person actually takes are exposed. This maps 1:1 onto three buttons in the
  Checkpoint‑1 UI and three natural voice intents in Checkpoint 3.
- `reminderService`: `createReminderRule({prayerName, offsetMinutes, enabled, label?})`,
  `updateReminderRule(id, patch)`, `materializeRemindersForDate(dateISO)` (expands rules into
  actual scheduled notifications, idempotent), `cancelReminderInstance(id)`,
  `cancelAllForDate(dateISO)`, `listReminders(dateISO?)`. The Checkpoint‑1 reminder **form**
  UI only ever produces a plain object and calls `createReminderRule` — matching decision #2
  (per-prayer offsets) exactly.
- `historyService`: `getHistoryRange(startISO, endISO)` (dashboard grid), `getComplianceSummary
  (startISO, endISO)` (used by Checkpoint 2's coaching context), `getQadaBacklog()` (missed
  prayers not yet made up).

**SQLite schema** (migrations tracked via `PRAGMA user_version`):

- `app_settings` — single row: `latitude, longitude, city, country, calculation_method,
  grace_minutes_late, language`. Seeded with Amman/method-4 defaults.
- `prayer_times_cache` — `date_iso, location_key, fajr, sunrise, dhuhr, asr, maghrib, isha
  (all epoch ms), fetched_at, source`, unique per `(date_iso, location_key)`.
- `prayer_log` — `date_iso, prayer_name, scheduled_at, completed_at, completion_type
  ('on_time'|'late'|'qada'), created_at, updated_at`, unique per `(date_iso, prayer_name)`.
  Rows are created **lazily** only on confirm/qada/missed — there is no row and no persisted
  "missed" state for an untouched slot. "Missed" and "upcoming" are always derived live by
  `computeDailyStatus`, which is what makes the "one true status function" guarantee hold
  without needing a background job.
- `reminder_rules` — `prayer_name, offset_minutes, enabled, label, created_at`.
- `reminder_instances` — `rule_id, date_iso, prayer_name, fire_at, notification_id, status
  ('scheduled'|'fired'|'cancelled')`, unique per `(rule_id, date_iso)`. `notification_id` is
  required to later cancel via `cancelScheduledNotificationAsync`.
- `coaching_events` (added in Checkpoint 2's migration) — `date_iso, prayer_name, trigger_type
  ('late'|'qada'|'missed'), created_at, gemini_response, acknowledged`. Prevents re-coaching the
  same event repeatedly and becomes the grounding data for a Checkpoint‑3 "what did you tell me
  earlier" tool.

**UI state management (decision #1).** React Context providers in `ui/context/` wrap the app and
expose hooks (`usePrayerStatus()`, `useNextPrayer()`, `useReminders()`, etc.) that call the
services above and hold the re-render-triggering state. Because mutations in the service layer
emit on a plain-JS event bus (`domainEvents`, not a React Context) rather than only updating
whichever component called them, a mutation triggered later by a Checkpoint‑3 voice tool call —
which has no component tree to reach into — can still notify any open UI to refresh, through the
same event bus the Context hooks already subscribe to.

**Notification behavior (decision #3).** `addNotificationResponseReceivedListener()` handles taps
by navigating to the confirm screen; there is no interactive notification action/category
registered. Confirming a prayer always flows through one path: the in-app button →
`prayerStatusService.confirmPrayer`.

**Dev workflow (decision #4).** Checkpoints 1–2 run entirely in Expo Go — no EAS build needed.
The switch to a development build is scoped explicitly to the start of Checkpoint 3, when
LiveKit's native SDK and Gemini Live's audio streaming require it.

**Risks and constraints to design around now:**

- **Offline first run.** Aladhan requires connectivity initially; mitigated by `prefetchMonth`
  (one call seeds ~30 days), cache-first reads, and non-blocking background refresh on foreground.
- **Timezone handling.** Convert to epoch ms at the network boundary immediately; never hardcode
  Amman's UTC offset — rely on Aladhan's own timezone-aware calculation so a future location
  change needs no code change.
- **iOS's ~64 pending local-notification cap.** `materializeRemindersForDate` is only called for
  today (and optionally tomorrow), refreshed on app foreground — reminders are never
  pre-scheduled weeks ahead. This is a hard constraint on how many reminder rules can be enabled
  at once and must be stated plainly in the spec.
- **No reliable background "missed" detection.** Expo's managed workflow has no dependable
  background cron on iOS. Because "missed" is derived on read rather than written by a job, status
  is always correct whenever the app or a voice query reads it — but Checkpoint 2's proactive
  "you just missed a prayer" nudge is inherently best-effort (fires on next foreground), not
  real-time. State this expectation explicitly rather than promising instant detection.
- **Concurrent SQLite access (UI vs. a later voice tool call).** Both run in the same
  single-threaded JS process — expo-sqlite's internal async queue serializes access, so there's
  no race condition to solve. The real hazard is stale UI after a voice-triggered mutation, which
  the `domainEvents` bus (above) solves.
- **Cloudflare AI Gateway indirection.** Isolate the actual model ID / base URL behind one
  `integrations/gemini/gatewayConfig.ts`, used by both the Checkpoint‑2 text client and the
  Checkpoint‑3 Live client, so gateway/model changes are a one-line edit.
- **Testability as insurance.** `computeStatus.ts` is pure — write unit tests for its edge cases
  (midnight rollover, the Isha→next‑Fajr missed-window boundary) during Checkpoint 1, since
  Checkpoint 3 will silently depend on this function being exactly correct.

---

## 2. Coaching Prompt Design (Checkpoint 2)

**System prompt v1:**

> You are a gentle, supportive companion helping the user stay consistent with their five daily
> prayers. Your tone is warm, encouraging, and non-judgmental — never preachy, never
> guilt-inducing. When a prayer is completed late, acknowledge it went later than intended
> without shaming, and gently encourage adjusting next time. When a prayer is logged as qada
> (made up after being missed), affirm that making it up matters and shows commitment — don't
> dwell on why it was missed. When a prayer is marked missed, respond with warmth and a concrete
> next step (e.g. suggest logging it as qada), never judgment. Keep responses concise (2–4
> sentences) — you are a companion, not a lecture. Never issue religious rulings (fatwas) or
> quote extended scripture — you support the *habit*, not religious interpretation; for
> religious questions, gently suggest a knowledgeable source instead. When recent history
> (streaks, this week's compliance) is provided in context, reference it specifically — generic
> encouragement is less useful than "you kept a 4-day streak before this."

**Trigger logic.** `coachingTriggerService.evaluateAndTrigger(dateISO?)` calls
`prayerStatusService.getDailyStatus`, diffs against `coaching_events` to find newly
late/qada/missed slots not yet coached, and for each calls
`coachingService.generateCoachingMessage(context)` — a single non-streaming call to Gemini
(regular, non-Live) through the Cloudflare AI Gateway — writing a `coaching_events` row so the
same event is never re-coached. This function is called from three places without modification:
a UI effect on app foreground, immediately after `confirmPrayer`/`confirmQada` return (since
late/qada are known synchronously then), and — unmodified — later from the Checkpoint‑3 voice
screen's foreground hook.

**Sample interactions (target tone):**

- *Late* (Dhuhr confirmed 25 min after the grace window; prior 4-day on-time streak) —
  "Dhuhr got in a little later than usual today — no worries, it's counted. You'd kept a solid
  4-day streak before this, so it's just one late one, not a pattern. Maybe nudge your Dhuhr
  reminder a bit earlier tomorrow?"
- *Qada logged* (yesterday's Asr made up today) —
  "Good on you for making up yesterday's Asr — that's exactly the right move when a prayer
  slips. Nothing to dwell on here, you're staying on top of it."
- *Missed* (Fajr marked missed, no qada logged yet) —
  "Looks like Fajr didn't happen today — it happens. Whenever you're ready, you can log it as
  qada from the History screen. Want a reminder about it tomorrow morning too?"

---

## 3. Voice Wrapping Strategy (Checkpoint 3)

**Principle.** The Gemini Live session is not where the app's logic lives — it's a thin
function-calling layer over the same services built in Checkpoints 1–2. Checkpoint 2's tuned
system prompt (Section 2) is folded directly into the Live session's system instructions, so the
Live model *is* the coach in voice mode — `coachingService.generateCoachingMessage` itself is
**not** exposed as a tool (that would mean one Gemini call talking to another).

**Tool table** (near 1:1 wrappers, declared with JSON schemas, each calling one existing function):

| Gemini Live tool | Wraps |
|---|---|
| `get_next_prayer` | `prayerTimesService.getNextPrayer` |
| `get_today_status` | `prayerStatusService.getDailyStatus` |
| `get_compliance_summary` | `historyService.getComplianceSummary` |
| `get_qada_backlog` | `historyService.getQadaBacklog` |
| `confirm_prayer` | `prayerStatusService.confirmPrayer` |
| `log_qada` | `prayerStatusService.confirmQada` |
| `mark_missed` | `prayerStatusService.markMissed` |
| `set_reminder` | `reminderService.createReminderRule` |
| `cancel_reminder` | `reminderService.cancelReminderInstance` / `cancelAllForDate` |
| `get_recent_coaching_context` | thin read of `coaching_events` |

**What stays app-side vs. what the Live session owns.** The app owns: all data (SQLite), all
notification scheduling, all status computation, and the coaching prompt content. The Live
session owns: turn-taking, audio capture/playback, language understanding, and deciding *when*
to call a tool. LiveKit is the audio/data transport between the device and Gemini Live; the
Cloudflare AI Gateway sits in front of the Live API connection exactly as it does for the
Checkpoint‑2 text calls, via the same `gatewayConfig.ts`.

**Arabic + English.** The `language` field already added to `app_settings` in Checkpoint 1
configures the Live session's expected input/output language at connect time — no schema change
needed in Checkpoint 3.

---

## 4. Voice Session Lifecycle State Machine (Checkpoint 3)

States:

- **Idle** — no LiveKit room, no Gemini Live session; entry point, and where the app returns to
  after every session ends.
- **Connecting** — mic permission confirmed, LiveKit room join + Gemini Live handshake in
  progress; `app_settings.language` is read here to configure the session.
- **Active** — persistent duplex audio session is live. Not modeled as separate top-level states,
  but surfaced to the UI as sub-indicators: *Listening*, *Model speaking*, *Tool executing*
  (a tool call/response happens over the data channel without leaving Active).
- **Reconnecting** — a network drop occurred while Active; the app attempts to resume the same
  logical session.
- **Error** — an unrecoverable failure (permission denied, gateway/auth error, reconnect
  exhausted); surfaced to the user with a retry action.
- **Ending** — user stopped the session, or the app lost foreground/background; LiveKit room and
  Live session are closed gracefully.

Transitions:

| From | Event | To |
|---|---|---|
| Idle | user taps "start conversation" | Connecting |
| Connecting | handshake succeeds | Active |
| Connecting | handshake fails | Error |
| Active | network drop detected | Reconnecting |
| Reconnecting | resume succeeds | Active |
| Reconnecting | resume fails / times out | Error |
| Active | user taps "end" / app backgrounds | Ending |
| Ending | cleanup complete | Idle |
| Error | user taps "retry" | Connecting |
| Error | user dismisses | Idle |

A tool call/response (e.g. `confirm_prayer` invoked mid-conversation) is an event *within*
Active, not a state transition — the underlying service call and its `domainEvents` emit (Section
1) happen exactly as they would from a UI button tap.

---

## 5. Open Questions (for you to answer before the plan phase)

1. Should the voice session in Checkpoint 3 auto-start when its screen opens, or always require
   an explicit tap-to-start (mic-privacy consideration)?
2. Is Arabic/English a manual settings toggle, or should the app attempt to auto-detect spoken
   language? (Manual toggle is assumed above via `app_settings.language`.)
3. What should `grace_minutes_late` default to — i.e., how many minutes after a prayer's start
   still count as "on time" rather than "late"?
4. Checkpoint 2's proactive coaching nudge is best-effort (fires on next app foreground, not the
   instant a prayer becomes late/missed, per the Risks note in Section 1) — is that acceptable,
   or is a more real-time mechanism required?
5. Is a bundled static fallback (e.g. a pre-packaged Amman/method-4 prayer-times JSON) worth
   building for the case where Checkpoint 1 is opened offline before any cache exists, or is
   "requires connectivity on first run" acceptable?
6. Do you already have Cloudflare AI Gateway + Gemini API credentials, or does that account/API
   key setup need to happen as part of Checkpoint 1 (even though it's not used until Checkpoint 2)?
7. Any minimum iOS/Android OS version to target, given LiveKit's native requirements in
   Checkpoint 3?
