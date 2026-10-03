// LiveKit transport for the voice session — the only file that knows about
// LiveKit. It joins a fresh room (the Nafy agent is dispatched into it, and the
// agent is what talks to Gemini Live), exposes mic on/off, reports the agent's
// end-of-turn, and answers the agent's tool calls over RPC via voiceTools.

import { AudioSession } from '@livekit/react-native';
import { Room, RoomEvent, TokenSource } from 'livekit-client';

import { MUTATING_TOOLS, VOICE_TOOLS, VoiceToolName, resetVoiceToolSession, runVoiceTool } from './voiceTools';

/** Must match agentName in agent/src/agent.ts. */
export const AGENT_NAME = 'nafy';

export interface VoiceTransport {
  connect(): Promise<void>;
  setMicEnabled(enabled: boolean): Promise<void>;
  disconnect(): void;
}

export interface VoiceTransportHandlers {
  onEndOfTurn(): void;
  onDisconnected(): void;
  onDataChanged(): void;
}

export type VoiceTransportFactory = (handlers: VoiceTransportHandlers) => VoiceTransport;

export const createLiveKitTransport: VoiceTransportFactory = (handlers) => {
  const room = new Room();
  let closed = false;

  room.on(RoomEvent.Disconnected, handlers.onDisconnected);
  // The agent framework publishes its state as a participant attribute; moving to
  // thinking/speaking means Gemini Live detected the end of the user's turn.
  room.on(RoomEvent.ParticipantAttributesChanged, (changed) => {
    const agentState = changed['lk.agent.state'];
    if (agentState === 'thinking' || agentState === 'speaking') handlers.onEndOfTurn();
  });

  for (const name of Object.keys(VOICE_TOOLS) as VoiceToolName[]) {
    room.registerRpcMethod(name, async ({ payload }) => {
      const reply = await runVoiceTool(name, payload);
      if (MUTATING_TOOLS.includes(name)) handlers.onDataChanged();
      return reply;
    });
  }

  return {
    async connect() {
      const sandboxId = process.env.EXPO_PUBLIC_LIVEKIT_SANDBOX_ID;
      if (!sandboxId) throw new Error('EXPO_PUBLIC_LIVEKIT_SANDBOX_ID is not set');
      resetVoiceToolSession();
      const { serverUrl, participantToken } = await TokenSource.sandboxTokenServer(sandboxId).fetch({
        // A unique room per connection guarantees a fresh agent dispatch and no
        // reuse of a room left over from a previous foreground.
        roomName: `azan-buddy-${Date.now()}`,
        agentName: AGENT_NAME,
      });
      if (closed) return;
      await AudioSession.startAudioSession();
      await room.connect(serverUrl, participantToken);
    },
    async setMicEnabled(enabled) {
      await room.localParticipant.setMicrophoneEnabled(enabled);
    },
    disconnect() {
      if (closed) return;
      closed = true;
      room.removeAllListeners();
      room.disconnect();
      AudioSession.stopAudioSession();
    },
  };
};
