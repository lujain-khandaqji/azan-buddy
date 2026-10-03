// The one place to change Nafy's voice, model, and mode.
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

/** Must match AGENT_NAME in src/voice/voiceTransport.ts. */
export const AGENT_NAME = 'nafy';

/**
 * Gemini Live voice. Temporary default — compare Aoede, Kore, Charon, Puck and
 * Fenrir by ear with a short Arabic phrase, then set NAFY_VOICE in .env.local.
 */
export const VOICE = process.env.NAFY_VOICE || 'Aoede';

export const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025';

/** 'hello' = Phase 5 hello-world loop (fixed greeting, no tools); 'full' = tools enabled. */
export const MODE: 'hello' | 'full' = process.env.NAFY_MODE === 'hello' ? 'hello' : 'full';

export const HELLO_WORLD_GREETING = "Assalamu alaikum! I'm Nafy, your prayer companion.";

/**
 * Optional Cloudflare AI Gateway base URL for the Gemini Live websocket, e.g.
 * https://gateway.ai.cloudflare.com/v1/<account>/azan-buddy/google-ai-studio
 * Unset = connect to Gemini directly. Gateway support for Live must be verified.
 */
export const GEMINI_GATEWAY_URL = process.env.GEMINI_LIVE_GATEWAY_URL || undefined;
