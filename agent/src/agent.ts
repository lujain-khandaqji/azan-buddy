// Nafy voice agent. Joins the app's LiveKit room, talks to Gemini Live, and
// forwards every function tool to the phone over RPC — the phone runs the real
// domain services (SQLite, notifications, location, CoachingService). This
// file owns no prayer, reminder, or coaching logic.
import { type JobContext, ServerOptions, cli, defineAgent, llm, voice } from '@livekit/agents';
import * as google from '@livekit/agents-plugin-google';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { AGENT_NAME, GEMINI_GATEWAY_URL, GEMINI_LIVE_MODEL, HELLO_WORLD_GREETING, MODE, VOICE } from './config.js';

const HELLO_INSTRUCTIONS = `Whatever the user says, reply with exactly this sentence and nothing else: "${HELLO_WORLD_GREETING}"`;

const FULL_INSTRUCTIONS = `You are Nafy, a gentle prayer companion speaking by voice.
- Reply in the language the user just spoke: Arabic if they spoke Arabic, English if they spoke English. Switch whenever they switch.
- Keep replies short and conversational. No lists, markdown, or symbols.
- Prayer times, or how long until a prayer: call getPrayerTimes. Setting a reminder: call createReminder. The user says they prayed: call logPrayer. Encouragement, coaching, or reflection about their prayer habits: call getCoachingAdvice.
- Always pass English prayer names to tools: Fajr (الفجر), Dhuhr (الظهر), Asr (العصر), Maghrib (المغرب), Isha (العشاء).
- Tool results are short English sentences from the app. Say them naturally in the user's language without changing any fact, time, or number. Relay coaching advice faithfully.
- Never invent prayer times and never say something was saved unless the tool confirmed it.
- For general questions about prayer, answer briefly; for religious rulings, suggest asking a qualified scholar.`;

const PRAYER = z.enum(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']);

function deviceTools(ctx: JobContext) {
  // Every tool is answered by the phone (src/voice/voiceTools.ts) with a spoken sentence.
  const forward = (method: string) => async (args: unknown) => {
    const phone = await ctx.waitForParticipant();
    return ctx.room.localParticipant!.performRpc({
      destinationIdentity: phone.identity,
      method,
      payload: JSON.stringify(args ?? {}),
      responseTimeout: 20000,
    });
  };

  return {
    getPrayerTimes: llm.tool({
      description: 'Get prayer times from the app, for one prayer or all five, today or tomorrow, including how long until it.',
      parameters: z.object({
        prayer: PRAYER.optional().describe('Omit to get all five prayers'),
        day: z.enum(['today', 'tomorrow']).optional().describe('Defaults to today'),
      }),
      execute: forward('getPrayerTimes'),
    }),
    createReminder: llm.tool({
      description: 'Create a real reminder notification some minutes before a prayer.',
      parameters: z.object({
        prayer: PRAYER,
        offsetMinutes: z.number().int().positive().describe('Minutes before the prayer time'),
        scope: z.enum(['today', 'always']).optional().describe("'always' only if the user asks for every day"),
      }),
      execute: forward('createReminder'),
      onDuplicate: 'reject',
    }),
    logPrayer: llm.tool({
      description: "Record that the user has prayed one of today's prayers.",
      parameters: z.object({ prayer: PRAYER }),
      execute: forward('logPrayer'),
      onDuplicate: 'reject',
    }),
    getCoachingAdvice: llm.tool({
      description: "Get Nafy's gentle coaching from the app, either about a late/qada/missed prayer or a reflective question.",
      parameters: z.object({
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
      }),
    });
    const hello = MODE === 'hello';
    await session.start({
      agent: new voice.Agent({
        instructions: hello ? HELLO_INSTRUCTIONS : FULL_INSTRUCTIONS,
        tools: hello ? undefined : deviceTools(ctx),
      }),
      room: ctx.room,
    });
    await ctx.connect();
  },
});

cli.runApp(new ServerOptions({ agent: fileURLToPath(import.meta.url), agentName: AGENT_NAME }));
