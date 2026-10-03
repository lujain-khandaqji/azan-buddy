// Pure push-to-talk session state machine — no React, no LiveKit. useVoiceSession
// feeds it events and performs side effects based on the resulting state.

export type VoiceState = 'disconnected' | 'connecting' | 'connected_muted' | 'connected_listening';

export type VoiceEvent =
  | 'FOREGROUND' // app started or returned to the foreground
  | 'CONNECTED' // LiveKit room joined
  | 'MIC_TAP'
  | 'END_OF_TURN' // agent detected the end of the user's turn
  | 'BACKGROUND' // app left the foreground
  | 'CONNECTION_LOST'; // room closed after LiveKit's own reconnect attempts gave up

export function nextVoiceState(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (event) {
    case 'BACKGROUND':
    case 'CONNECTION_LOST':
      return 'disconnected';
    case 'FOREGROUND':
      return state === 'disconnected' ? 'connecting' : state;
    case 'CONNECTED':
      return state === 'connecting' ? 'connected_muted' : state;
    case 'END_OF_TURN':
      return state === 'connected_listening' ? 'connected_muted' : state;
    case 'MIC_TAP':
      if (state === 'connected_muted') return 'connected_listening';
      if (state === 'connected_listening') return 'connected_muted';
      // Tapping while disconnected is the manual retry; while connecting it's ignored.
      return state === 'disconnected' ? 'connecting' : state;
  }
}

export const VOICE_STATE_LABELS: Record<VoiceState, string> = {
  disconnected: 'disconnected',
  connecting: 'connecting',
  connected_muted: 'muted',
  connected_listening: 'listening',
};
