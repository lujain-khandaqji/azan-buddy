// Plain TypeScript service — no React or UI imports. Wraps @google/genai, routed
// through the Cloudflare AI Gateway in front of Gemini. Returns plain text only.

import { GoogleGenAI } from '@google/genai';

import { PrayerName } from './prayerTimesService';
import { PrayerLogStatus } from './prayerLogService';

export type CoachingTriggerStatus = Extract<PrayerLogStatus, 'late' | 'qada' | 'missed'>;

export type CoachingContext =
  | { type: 'status'; prayerName: PrayerName; status: CoachingTriggerStatus }
  | { type: 'reflection'; question: string };

const MODEL = 'gemini-3.6-flash';
const GATEWAY_BASE_URL =
  'https://gateway.ai.cloudflare.com/v1/d0f40847281073ea5ed296ebddcc5e07/azan-buddy/google-ai-studio';

const SYSTEM_PROMPT = `You are Nafy, a gentle prayer companion. When the user's prayer status is late, qada, or missed, or when they ask a reflective question about their prayer habits, respond with warmth and encouragement, never judgment.

Rules:
- Never scold, guilt-trip, or lecture. Avoid phrases like "you should," "this is your Nth time," or "is a serious matter."
- Keep responses short: 1 to 3 sentences.
- Focus on one practical, forward-looking suggestion (an earlier reminder, preparing wudu ahead of time, adjusting for a scheduling conflict) rather than dwelling on what went wrong.
- When it fits naturally, gently reference Allah's mercy (for example, Ar-Rahman). Don't force it into every response.
- If the user made up a missed prayer (qada), acknowledge it warmly first, e.g. "alhamdulillah," before offering anything else.

Example of the tone to aim for: the user's Asr was qada. You say: "You made it up, alhamdulillah. Want me to set an earlier reminder for tomorrow's Asr?"

Never say things like: "You should be more careful about your prayers," "This is your third qada this week," or "Missing prayers is a serious matter in Islam."`;

// No client cache on purpose (same reasoning as prayerLogService's getDb()):
// constructing a fresh client per call is cheap and keeps this trivially testable
// without coordinating a shared singleton's lifecycle across tests.
function getClient(): GoogleGenAI {
  const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('EXPO_PUBLIC_GEMINI_API_KEY is not set');
  }
  return new GoogleGenAI({ apiKey, httpOptions: { baseUrl: GATEWAY_BASE_URL } });
}

const STATUS_PHRASES: Record<CoachingTriggerStatus, string> = {
  late: 'was completed later than the on-time window',
  qada: 'is being made up as qada after being missed',
  missed: 'was missed and has not been made up yet',
};

function buildUserContent(context: CoachingContext): string {
  if (context.type === 'reflection') {
    return context.question;
  }
  return `The user's ${context.prayerName} prayer ${STATUS_PHRASES[context.status]}. Offer a short, supportive coaching message.`;
}

export async function getCoachingResponse(context: CoachingContext): Promise<string> {
  const ai = getClient();
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: buildUserContent(context),
    config: { systemInstruction: SYSTEM_PROMPT },
  });
  return response.text ?? '';
}
