// Plain TypeScript service — no React or UI imports. Wraps @google/genai, routed
// through the Cloudflare AI Gateway in front of Gemini. Returns plain text only.

import { GoogleGenAI } from '@google/genai';

import { PrayerName } from './prayerTimesService';
import { PrayerLogStatus } from './prayerLogService';
import { COACHING_SYSTEM_PROMPT } from '../../prompts/coachingSystemPrompt';

export type CoachingTriggerStatus = Extract<PrayerLogStatus, 'late' | 'qada' | 'missed'>;

export type CoachingContext =
  | { type: 'status'; prayerName: PrayerName; status: CoachingTriggerStatus }
  | { type: 'reflection'; question: string };

const MODEL = 'gemini-3.6-flash';
const GATEWAY_BASE_URL =
  'https://gateway.ai.cloudflare.com/v1/d0f40847281073ea5ed296ebddcc5e07/azan-buddy/google-ai-studio';

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
    config: { systemInstruction: COACHING_SYSTEM_PROMPT },
  });
  return response.text ?? '';
}
