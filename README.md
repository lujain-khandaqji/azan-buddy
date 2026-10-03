# azan-buddy

A voice-enabled Islamic prayer companion ("Nafy") built with Expo SDK 57, React Native and TypeScript.

- **Checkpoint 1**: prayer times (Aladhan API, location with an Amman fallback), next-prayer countdown, SQLite prayer confirmation with `on_time` / `late` / `qada` / `missed` statuses, local reminders, and a History dashboard.
- **Checkpoint 2**: Gemini text coaching through the Cloudflare AI Gateway, triggered automatically on late/qada/missed prayers, plus a reflective chat.
- **Checkpoint 3** (branch `feat/voice-hello-world`, **implemented in code but not yet tested on a real device**): push-to-talk voice in English and Arabic using LiveKit and Gemini Live.

## Architecture

```
Phone (Expo dev client)                         PC / server                Google
┌───────────────────────────────┐   LiveKit    ┌───────────────────┐       ┌────────────┐
│ MicButton → useVoiceSession   │◄────audio───►│ agent/ (Node)     │◄─────►│ Gemini Live│
│   voiceTransport (LiveKit)    │◄────RPC─────►│ Nafy voice.Agent  │       └────────────┘
│   voiceTools ──► domain/services (unchanged) │  tool declarations│
│     SQLite · notifications · CoachingService ─► Cloudflare AI Gateway ─► Gemini text
└───────────────────────────────┘              └───────────────────┘
```

- **Domain and voice are kept separate.** `src/domain/services/*` was not changed for voice. The voice tools in `src/voice/voiceTools.ts` validate their arguments, call the same service functions the screens call, and phrase the result as one spoken English sentence. Gemini Live then says it in the user's language.
- **Function tools.** `getPrayerTimes`, `createReminder`, `logPrayer` and `getCoachingAdvice` are declared (as Zod schemas) in `agent/src/agent.ts`. The agent forwards each call to the phone over LiveKit RPC, because SQLite, notifications and location live on the phone.
- **Coaching** reuses the existing `CoachingService` and the unchanged Checkpoint 2 system prompt (`src/prompts/coachingSystemPrompt.ts`), routed through the Cloudflare AI Gateway exactly as before.
- **Arabic and English.** No language is pinned. The agent instructions tell Gemini Live to reply in the language the user just spoke, so switching languages mid-session needs no restart. No Arabic replies are hard-coded.
- **Voice selection** is set in one place: `agent/src/config.ts` (`VOICE`, with an `NAFY_VOICE` env override). The temporary default is Aoede.

### Voice session state machine (`src/voice/voiceSessionMachine.ts`)

| From | Event | To |
|---|---|---|
| disconnected | app foreground/start, or mic tap (retry) | connecting |
| connecting | room joined | connected_muted |
| connected_muted | mic tap | connected_listening |
| connected_listening | mic tap, or end of turn (agent starts thinking/speaking) | connected_muted |
| any | app background, or LiveKit gives up reconnecting | disconnected |

- **Between turns** the room stays connected and muted. A mic tap only toggles the published mic track.
- **Backgrounding** the app disconnects the room. Foregrounding joins a fresh, uniquely named room, so the agent is always freshly dispatched.
- **Network blips** are handled by LiveKit's built-in reconnect. There is no custom retry loop.

## Running

### Checkpoints 1–2 (no voice)
```
npm install
npx expo start
```

### Checkpoint 3 (voice): requires a custom Android development build
LiveKit uses native WebRTC code, so voice **does not work in Expo Go**.

1. **Credentials** (none are committed):
   - Root `.env`: `EXPO_PUBLIC_GEMINI_API_KEY` and `EXPO_PUBLIC_LIVEKIT_SANDBOX_ID`. See `.env.example`.
   - `agent/.env.local`: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `GOOGLE_API_KEY`. See `agent/.env.example`.
2. **Build and install the dev client** (Android only; no iOS signing is configured):
   ```
   npm install -g eas-cli   # or use npx eas-cli
   eas login
   eas build --profile development --platform android
   ```
   Install the APK from the link EAS prints.
3. **Run the agent and Metro:**
   ```
   cd agent && npm install && npm run dev
   npx expo start --dev-client
   ```
4. Use `NAFY_MODE=hello` in `agent/.env.local` for the hello-world loop, where every reply is a fixed greeting.

The step-by-step device checklist, latency table, leak test and demo script are in [`docs/CHECKPOINT3_TESTING.md`](docs/CHECKPOINT3_TESTING.md).

## Tests
```
npx jest          # 10 suites, 151 tests (Checkpoints 1–3)
npx tsc --noEmit
cd agent && npm run typecheck
```

## Status of Checkpoint 3

| Area | Code | Automated tests | Tested on a real device |
|---|---|---|---|
| Android dev client config + EAS profile | ✅ | Expo Doctor 21/21, Android JS bundle builds | ☐ build + install |
| Session state machine + hook | ✅ | ✅ | ☐ |
| Push-to-talk mic with state label | ✅ | — | ☐ |
| Hello-world loop (`NAFY_MODE=hello`) | ✅ | — | ☐ |
| getPrayerTimes / createReminder / logPrayer / getCoachingAdvice | ✅ | ✅ (formatting + service calls) | ☐ |
| Arabic + English, mid-session switching | ✅ (agent instructions) | — | ☐ |
| Latency < 2 s | — | — | ☐ |
| No leaked LiveKit sessions | ✅ (cleanup in code) | ✅ (hook cleanup) | ☐ dashboard |
| Gemini Live through Cloudflare AI Gateway | Optional (`GEMINI_LIVE_GATEWAY_URL`), unverified | — | ☐ |
