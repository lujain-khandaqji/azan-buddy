# azan-buddy

A voice-enabled Islamic prayer companion ("Nafy") built with Expo SDK 57, React Native and TypeScript.

- **Checkpoint 1**: prayer times (Aladhan API, location with an Amman fallback), next-prayer countdown, SQLite prayer confirmation with `on_time` / `late` / `qada` / `missed` statuses, local reminders, and a History dashboard.
- **Checkpoint 2**: Gemini text coaching through the Cloudflare AI Gateway, triggered automatically on late/qada/missed prayers, plus a reflective chat.
- **Checkpoint 3** (branch `feat/voice-hello-world`): push-to-talk voice in English and Arabic using LiveKit and Gemini Live. It has been **verified end to end on a real Android device**, including the LiveKit session-leak test (see [Status](#status-of-checkpoint-3)). The 2-minute demo recording is still to do.

## Architecture

```
Phone (Expo dev client)                         PC / server                Google (direct)
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
- **Cloudflare AI Gateway.**
  - **Through the gateway:** Checkpoint 2 Gemini text coaching, and therefore voice `getCoachingAdvice`, goes through the gateway (`src/domain/services/coachingService.ts`).
  - **Direct to Google:** the production **Gemini Live** connection.
  - **Gemini Live can work through Cloudflare.** A standalone probe reached Gemini Live `setupComplete` through Cloudflare's documented realtime endpoint (`wss://gateway.ai.cloudflare.com/v1/<account>/<gateway>/google?api_key=…`, authenticated with a `cf-aig-authorization` header).
  - **Our SDK can't use that endpoint.** The LiveKit Google plugin's `@google/genai` client always builds `<baseUrl>/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=…`, and the gateway rejects that URL:
    - base URL ending `/google-ai-studio`: error 2029 "Unsupported websocket provider/model"
    - base URL ending `/google`: error 2009 "Unauthorized"
  - **Why Live stays direct:** supporting the gateway would need a more invasive change to the Live transport, which would put the verified latency and bilingual behaviour at risk.
  - The Cloudflare dashboard therefore shows the Gemini text/coaching calls, **not** the production Gemini Live calls.
- **Arabic and English.** No language is pinned. The agent instructions tell Gemini Live to reply in the language of the user's most recent utterance. `agent/src/language.ts` also detects that language from Gemini's input transcript and attaches it to every tool result, because the model otherwise drifts toward the language of earlier turns or of the English tool result. Switching languages mid-session needs no restart. No Arabic replies are hard-coded.
- **Voice selection** is set in one place: `agent/src/config.ts` (`VOICE`, with an `NAFY_VOICE` env override). Aoede, Kore, Charon, Puck and Fenrir were compared in Arabic on the device. **Fenrir** is the selected voice.
- **Latency.** For the Gemini 2.5 Live model, the thinking budget is set to 0 (`GEMINI_THINKING_BUDGET` in `agent/src/config.ts`). Thinking was the largest measured cost: 2.7–4.5 s from end of speech to tool call with thinking, and 1.5–1.7 s without it. With thinking off, the latest 5 attempts on the device were all under 2 s.

### Voice session state machine (`src/voice/voiceSessionMachine.ts`)

| From | Event | To |
|---|---|---|
| disconnected | app foreground/start, or mic tap (retry) | connecting |
| connecting | room joined and agent listening | connected_muted |
| connected_muted | mic tap | connected_listening |
| connected_listening | mic tap, or end of turn (agent starts thinking/speaking) | connected_muted |
| any | app background (after a 10 s grace window), agent leaves, or LiveKit gives up reconnecting | disconnected |

- **Between turns** the room stays connected and muted. A mic tap only toggles the published mic track.
- **Backgrounding** the app for more than 10 s (`BACKGROUND_GRACE_MS`) disconnects the room. The grace window exists because Android also reports "background" while a system permission or location dialog is open. Foregrounding after a disconnect joins a fresh, uniquely named room, so the agent is always freshly dispatched.
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
npx jest          # 11 suites, 160 tests (Checkpoints 1–3)
npx tsc --noEmit
npx expo export --platform android   # Android JS bundle
cd agent && npm test && npm run typecheck   # 7 tests (language detection)
```

## Status of Checkpoint 3

| Area | Code | Automated tests | Tested on a real Android device |
|---|---|---|---|
| Android dev client (EAS development build) | ✅ | Android JS bundle builds | ✅ builds, installs, runs |
| LiveKit + Gemini Live end-to-end voice | ✅ | ✅ (state machine, hook, transport) | ✅ |
| Prayer-time Q&A (`getPrayerTimes`) | ✅ | ✅ | ✅ |
| Voice reminders (`createReminder`) | ✅ | ✅ | ✅ |
| Voice prayer confirmation (`logPrayer`) | ✅ | ✅ | ✅ |
| Coaching by voice (`getCoachingAdvice`) | ✅ | ✅ | ✅ |
| English and Arabic | ✅ | ✅ (agent language detection) | ✅ both |
| Switching English ↔ Arabic in one session | ✅ | ✅ | ✅ |
| Voice choice (Aoede, Kore, Charon, Puck, Fenrir tried in Arabic) | ✅ Fenrir | — | ✅ |
| Latency < 2 s | ✅ (thinking budget 0) | — | ✅ latest 5 attempts all under 2 s |
| General prayer question (answered by Gemini Live, no tool) | ✅ | — | ✅ |
| No leaked LiveKit sessions | ✅ (cleanup in code) | ✅ (hook + transport) | ✅ 4 background/reopen cycles, each disconnected → connecting → muted; old rooms CLOSED, only 1 ACTIVE |
| Gemini text/coaching through Cloudflare AI Gateway | ✅ | ✅ | ✅ |
| Gemini Live through Cloudflare AI Gateway | Kept direct to Google (see Architecture) | Standalone probe via documented endpoint ✅; SDK URL ❌ | — |
| Debug logging / state label removed | ✅ | ✅ | — |
| Final 2-minute demo | — | — | ☐ |
