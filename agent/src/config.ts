// The one place to change Nafy's voice, model, and mode.
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

/** Must match AGENT_NAME in src/voice/voiceTransport.ts. */
export const AGENT_NAME = 'nafy';

/**
 * Gemini Live voice. Fenrir was chosen after comparing Aoede, Kore, Charon, Puck
 * and Fenrir in Arabic on a real device. NAFY_VOICE overrides it.
 */
export const VOICE = process.env.NAFY_VOICE || 'Fenrir';

export const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025';

/**
 * Gemini 2.5 Live models think before every reply unless the budget is 0. Thinking
 * was the largest latency cost measured (end of speech → tool call 2.7–4.5 s with
 * it, 1.5–1.7 s without), and Nafy's turns are short lookups that don't need it.
 * Only applied to 2.5 models; 3.x models use thinkingLevel instead.
 */
export const GEMINI_THINKING_BUDGET = Number(process.env.GEMINI_THINKING_BUDGET ?? 0);

/** 'hello' = Phase 5 hello-world loop (fixed greeting, no tools); 'full' = tools enabled. */
export const MODE: 'hello' | 'full' = process.env.NAFY_MODE === 'hello' ? 'hello' : 'full';

export const HELLO_WORLD_GREETING = "Assalamu alaikum! I'm Nafy, your prayer companion.";

/**
 * Optional Cloudflare AI Gateway base URL for the Gemini Live websocket, e.g.
 * https://gateway.ai.cloudflare.com/v1/<account>/azan-buddy/google-ai-studio
 * Unset = connect to Gemini directly (the production setting). Tested: the gateway rejects
 * the Live websocket URL the SDK builds from this base, so leave it unset (see SPEC.md).
 */
export const GEMINI_GATEWAY_URL = process.env.GEMINI_LIVE_GATEWAY_URL || undefined;
