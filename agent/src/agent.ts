// Nafy voice agent. Joins the app's LiveKit room, talks to Gemini Live, and
// forwards every function tool to the phone over RPC — the phone runs the real
// domain services (SQLite, notifications, location, CoachingService). This
// file owns no prayer, reminder, or coaching logic.
import { type JobContext, ServerOptions, cli, defineAgent, llm, voice } from '@livekit/agents';
import * as google from '@livekit/agents-plugin-google';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import {
  AGENT_NAME,
  GEMINI_GATEWAY_URL,
  GEMINI_LIVE_MODEL,
  GEMINI_THINKING_BUDGET,
  HELLO_WORLD_GREETING,
  MODE,
  VOICE,
} from './config.js';
import { createTurnLanguageTracker, Language, withLanguageDirective } from './language.js';

const HELLO_INSTRUCTIONS = `Whatever the user says, reply with exactly this sentence and nothing else: "${HELLO_WORLD_GREETING}"`;

// No Arabic script in here on purpose: it biases replies toward Arabic.
const FULL_INSTRUCTIONS = `You are Nafy, a gentle prayer companion speaking by voice.
- Language: every reply must be in the language of the user's most recent utterance only. English utterance means an English reply; Arabic utterance means an Arabic reply. Ignore the language of earlier turns, of tool results, and of these instructions. The user may switch language at any turn.
- When a tool result says which language to reply in, follow it.
- Keep replies short and conversational. No lists, markdown, or symbols.
- Prayer times, or how long until a prayer: call getPrayerTimes. Setting a reminder: call createReminder. The user says they prayed: call logPrayer. Encouragement, coaching, or reflection about their prayer habits: call getCoachingAdvice.
- Always pass the English prayer names Fajr, Dhuhr, Asr, Maghrib, Isha to tools, including when the user says them in Arabic.
- Say tool results naturally without changing any fact, time, or number. Relay coaching advice faithfully.
- Never invent prayer times and never say something was saved unless the tool confirmed it.
- For general questions about prayer, answer briefly; for religious rulings, suggest asking a qualified scholar.`;

const PRAYER = z.enum(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']);

// Declared by the model on every call; only a fallback for when the transcript can't decide.
const withUserLanguage = <T extends z.ZodRawShape>(shape: T) =>
  z.object({
    ...shape,
    userLanguage: z.enum(['English', 'Arabic']).describe("Language of the user's most recent utterance"),
  });

function deviceTools(ctx: JobContext, transcriptLanguage: () => Language | null) {
  // Every tool is answered by the phone (src/voice/voiceTools.ts) with a spoken
  // sentence; the agent only adds which language to reply in.
  const forward =
    (method: string) =>
    async ({ userLanguage, ...args }: { userLanguage: Language } & Record<string, unknown>) => {
      const phone = await ctx.waitForParticipant();
      const result = await ctx.room.localParticipant!.performRpc({
        destinationIdentity: phone.identity,
        method,
        payload: JSON.stringify(args),
        responseTimeout: 20000,
      });
      return withLanguageDirective(result, transcriptLanguage() ?? userLanguage);
    };

  return {
    getPrayerTimes: llm.tool({
      description: 'Get prayer times from the app, for one prayer or all five, today or tomorrow, including how long until it.',
      parameters: withUserLanguage({
        prayer: PRAYER.optional().describe('Omit to get all five prayers'),
        day: z.enum(['today', 'tomorrow']).optional().describe('Defaults to today'),
      }),
      execute: forward('getPrayerTimes'),
    }),
    createReminder: llm.tool({
      description: 'Create a real reminder notification some minutes before a prayer.',
      parameters: withUserLanguage({
        prayer: PRAYER,
        offsetMinutes: z.number().int().positive().describe('Minutes before the prayer time'),
        scope: z.enum(['today', 'always']).optional().describe("'always' only if the user asks for every day"),
      }),
      execute: forward('createReminder'),
      onDuplicate: 'reject',
    }),
    logPrayer: llm.tool({
      description: "Record that the user has prayed one of today's prayers.",
      parameters: withUserLanguage({ prayer: PRAYER }),
      execute: forward('logPrayer'),
      onDuplicate: 'reject',
    }),
    getCoachingAdvice: llm.tool({
      description: "Get Nafy's gentle coaching from the app, either about a late/qada/missed prayer or a reflective question.",
      parameters: withUserLanguage({
        question: z.string().optional().describe("The user's question in their own words"),
        prayer: PRAYER.optional(),
        status: z.enum(['late', 'qada', 'missed']).optional(),
      }),
      execute: forward('getCoachingAdvice'),
    }),
  };
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const session = new voice.AgentSession({
      llm: new google.beta.realtime.RealtimeModel({
        model: GEMINI_LIVE_MODEL,
        voice: VOICE,
        ...(GEMINI_GATEWAY_URL && { httpOptions: { baseUrl: GEMINI_GATEWAY_URL } }),
        ...(GEMINI_LIVE_MODEL.includes('2.5') && { thinkingConfig: { thinkingBudget: GEMINI_THINKING_BUDGET } }),
      }),
    });
    const hello = MODE === 'hello';
    const language = createTurnLanguageTracker();
    // Gemini's own input transcription, interim and final; each update is the current turn.
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => language.onUserTranscript(ev.transcript));
    await session.start({
      agent: new voice.Agent({
        instructions: hello ? HELLO_INSTRUCTIONS : FULL_INSTRUCTIONS,
        tools: hello ? undefined : deviceTools(ctx, language.current),
      }),
      room: ctx.room,
    });
    await ctx.connect();
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: AGENT_NAME }));
