import { nextVoiceState, VoiceEvent, VoiceState } from './voiceSessionMachine';

const run = (events: VoiceEvent[], from: VoiceState = 'disconnected') => events.reduce(nextVoiceState, from);

describe('nextVoiceState', () => {
  it('connects on app start and lands muted', () => {
    expect(nextVoiceState('disconnected', 'FOREGROUND')).toBe('connecting');
    expect(run(['FOREGROUND', 'CONNECTED'])).toBe('connected_muted');
  });

  it('toggles between muted and listening on mic taps without leaving the connection', () => {
    expect(nextVoiceState('connected_muted', 'MIC_TAP')).toBe('connected_listening');
    expect(nextVoiceState('connected_listening', 'MIC_TAP')).toBe('connected_muted');
    expect(run(['MIC_TAP', 'MIC_TAP', 'MIC_TAP'], 'connected_muted')).toBe('connected_listening');
  });

  it('mutes at end of turn, and ignores end of turn while already muted', () => {
    expect(nextVoiceState('connected_listening', 'END_OF_TURN')).toBe('connected_muted');
    expect(nextVoiceState('connected_muted', 'END_OF_TURN')).toBe('connected_muted');
  });

  it.each<VoiceState>(['disconnected', 'connecting', 'connected_muted', 'connected_listening'])(
    'disconnects from %s when the app backgrounds or the connection is lost',
    (state) => {
      expect(nextVoiceState(state, 'BACKGROUND')).toBe('disconnected');
      expect(nextVoiceState(state, 'CONNECTION_LOST')).toBe('disconnected');
    }
  );

  it('restarts the connection sequence when foregrounded again', () => {
    expect(run(['FOREGROUND', 'CONNECTED', 'MIC_TAP', 'BACKGROUND', 'FOREGROUND'])).toBe('connecting');
  });

  it('does not restart a connection that is already up or in progress', () => {
    expect(nextVoiceState('connecting', 'FOREGROUND')).toBe('connecting');
    expect(nextVoiceState('connected_muted', 'FOREGROUND')).toBe('connected_muted');
    expect(nextVoiceState('connected_listening', 'FOREGROUND')).toBe('connected_listening');
  });

  it('ignores mic taps while connecting and treats a tap while disconnected as a retry', () => {
    expect(nextVoiceState('connecting', 'MIC_TAP')).toBe('connecting');
    expect(nextVoiceState('disconnected', 'MIC_TAP')).toBe('connecting');
  });

  it('ignores a late CONNECTED after the session was already torn down', () => {
    expect(nextVoiceState('disconnected', 'CONNECTED')).toBe('disconnected');
  });
});
