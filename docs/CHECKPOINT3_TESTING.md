# Checkpoint 3 — Android manual testing

Nothing in this file has passed yet. Fill in each result only after testing it yourself on the phone.

## 0. One-time setup

1. LiveKit Cloud project (https://cloud.livekit.io):
   - **Settings → API Keys**: copy `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` into `agent/.env.local`.
   - **Sandbox → Token server**: create one and copy its ID into the root `.env` as `EXPO_PUBLIC_LIVEKIT_SANDBOX_ID`.
2. Google AI Studio API key with Gemini Live access → `GOOGLE_API_KEY` in `agent/.env.local`.
3. `eas login`, then `eas build --profile development --platform android`. Install the APK on the phone.
4. Every test session, start both of these on the PC (phone and PC on the same Wi-Fi):
   - `cd agent && npm run dev` (the Nafy agent)
   - `npx expo start --dev-client` (Metro), then open the app on the phone from the dev client.

## 1. Feature checklist

| # | Test | Steps | Expected | Result |
|---|---|---|---|---|
| 1 | Hello world | Start the agent with `NAFY_MODE=hello` in `agent/.env.local`. Open the app. The label goes `connecting` → `muted`. Tap **Talk to Nafy** and say anything. | The label switches to `listening`, then back to `muted` when you stop talking. You hear "Assalamu alaikum! I'm Nafy, your prayer companion." | ☐ |
| 2 | Q&A (EN) | Remove `NAFY_MODE` and restart the agent. Ask "How long until Asr?" | You hear the real minutes and time, matching the Prayer Times screen. | ☐ |
| 3 | Q&A (EN) | "What time is Fajr tomorrow?" | You hear tomorrow's Fajr time. | ☐ |
| 4 | Voice reminder | "Remind me 10 minutes before Asr." Open the **Reminders** tab. | You hear a spoken confirmation, and "Asr, 10 min before • Today" appears in the list. | ☐ |
| 5 | Voice confirmation | After Asr has started, say "I prayed Asr." | You hear a confirmation with its status. Prayer Times shows Asr as confirmed, and the History tab shows it. | ☐ |
| 6 | Arabic | "متى المغرب اليوم؟" | Nafy understands the question and replies in Arabic with the correct Maghrib time. | ☐ |
| 7 | Coaching | "I keep missing Fajr, any advice?" | You hear a short, gentle reply. The agent terminal logs a `getCoachingAdvice` call, and the Cloudflare AI Gateway logs show a request. | ☐ |
| 8 | Bilingual session | Ask one question in English, then one in Arabic, without restarting. | Each reply comes back in the language you asked in, on the same connection (the label never shows `connecting`). | ☐ |
| 9 | General question | "How many rakats is Maghrib?" | You hear a short, correct answer. | ☐ |
| 10 | Mic toggle | Tap to listen, then tap again before speaking. | The label goes `listening` → `muted`, and no reconnect happens. | ☐ |

## 2. Latency (target: consistently < 2 s)

Measure from the end of your speech to the start of Nafy's voice. A screen recording with audio works well: scrub to both points and note the timestamps.

| # | Question / action | Speech ends (s) | Nafy starts (s) | Latency (s) |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |
| 7 | | | | |
| 8 | | | | |
| 9 | | | | |
| 10 | | | | |
| | **Average** | | | |
| | **Worst case** | | | |

Mix the attempts: plain Q&A, `getPrayerTimes`, `createReminder`, `logPrayer`, coaching, and Arabic. Tool calls add an RPC round trip, and coaching adds a second Gemini call, so expect those to be the slowest.

If results are consistently over 2 s, check:
- **The first tap after connecting.** It publishes the mic track and may show the permission prompt. Later taps only unmute.
- **The `connecting` label.** It should appear only on app start or return to the foreground, never on a mic tap.
- **Location lookup.** It is cached per voice session, so only the first prayer-time question pays the GPS cost.
- **Agent location.** The agent runs on your PC. If your network is slow, consider `lk agent deploy` to LiveKit Cloud.
- **Gemini model.** Try `GEMINI_LIVE_MODEL` alternatives listed in `agent/src/config.ts`.

## 3. LiveKit session leak test

1. Open the app and wait for `muted`.
2. Press Home. The label should go to `disconnected` (check it when you return).
3. Wait about 5 seconds, then reopen the app. It should go `connecting` → `muted`.
4. Repeat steps 2–3 three or four times.
5. Open the LiveKit Cloud dashboard → **Sessions / Rooms**.

Expected: at most one active `azan-buddy-*` room (the current one). Earlier rooms close once their only user leaves, and they do not pile up. Result: ☐

## 4. Voices to compare (Arabic)

The default voice is set in `agent/src/config.ts` (`VOICE`) or with `NAFY_VOICE` in `agent/.env.local`. Restart the agent after each change. Ask each voice the same question, "متى المغرب اليوم؟", and listen for clarity and natural Arabic pronunciation:

**Aoede** (current default) · **Kore** · **Charon** · **Puck** · **Fenrir**. Other options are listed in `@livekit/agents-plugin-google`, for example Zephyr and Leda.

## 5. Two-minute bilingual demo script

Keep the state label visible. Start on the Prayer Times tab.

1. (EN, Q&A) "How long until Asr?" — point out that the reply matches the countdown on screen.
2. (AR, Q&A) "متى المغرب اليوم؟" — the reply is in Arabic.
3. (EN, reminder) "Remind me 10 minutes before Maghrib." → open the Reminders tab and show the new entry.
4. (AR, confirmation) "صليت العصر" ("I prayed Asr") → the Prayer Times / History tab updates.
5. (EN, coaching) "I've been struggling to wake up for Fajr, any advice?"
6. (AR, general) "كم ركعة صلاة المغرب؟" ("How many rakats is Maghrib?")
7. Press Home, reopen, and show the session reconnecting cleanly (optional).

## 6. Items to remove after physical testing (final polish)

- The `voice: …` state label in `src/ui/components/MicButton.tsx`. It is a debugging aid, so keep it until all tests pass.
- `console.warn('[voice] …')` in `src/voice/voiceTools.ts` and `src/voice/useVoiceSession.ts`. It is fine to keep these as error logs.
- `NAFY_MODE=hello` in `agent/.env.local`, if you set it.
- For anything beyond the demo, replace the sandbox token server with a real token endpoint.

## 7. Checkpoint 3 success criteria (each one verified by you)

- [ ] Voice Q&A latency is consistently under 2 s (table above)
- [ ] Voice works in English
- [ ] Voice works in Arabic
- [ ] The voice layer is under 500 lines (code count: 480 lines across 7 files, including blank lines)
- [ ] All 5 core features are reachable by voice: Q&A, reminder, confirmation, coaching, general question
- [ ] All automated tests pass (`npx jest`)
- [ ] SPEC.md and README.md are up to date
- [ ] Git history is clean and the PR is reviewed before merging
- [ ] The Cloudflare AI Gateway dashboard shows Gemini traffic
- [ ] The LiveKit dashboard shows no accumulating leaked sessions
- [ ] The ~2-minute bilingual demo is recorded
