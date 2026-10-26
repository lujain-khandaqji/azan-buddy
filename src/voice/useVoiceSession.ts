import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { nextVoiceState, VoiceEvent } from './voiceSessionMachine';
import { createLiveKitTransport, VoiceTransport, VoiceTransportFactory } from './voiceTransport';

/**
 * Android reports AppState 'background' whenever any activity covers ours — including
 * the system permission and location-settings dialogs a voice tool (or the first mic
 * tap) can open mid-turn. Only a background that outlasts this window tears the room
 * down; returning to 'active' within it keeps the same session.
 */
export const BACKGROUND_GRACE_MS = 10_000;

/**
 * Owns the one voice connection for the app. The room stays connected (muted)
 * between turns; a mic tap only toggles the published mic track. Backgrounding
 * past the grace window tears the room down, foregrounding connects a fresh one. Reconnects after
 * network blips are LiveKit's own — there is no custom retry loop here.
 */
export function useVoiceSession(createTransport: VoiceTransportFactory = createLiveKitTransport) {
  const [state, dispatch] = useReducer(nextVoiceState, 'disconnected');
  // Bumped after a voice tool writes data, so the visible screen can re-read it.
  const [dataVersion, setDataVersion] = useState(0);
  const transportRef = useRef<VoiceTransport | null>(null);

  useEffect(() => {
    let backgroundTimer: ReturnType<typeof setTimeout> | undefined;
    if (AppState.currentState !== 'background') dispatch('FOREGROUND');
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      clearTimeout(backgroundTimer);
      if (s === 'active') dispatch('FOREGROUND');
      else if (s === 'background') backgroundTimer = setTimeout(() => dispatch('BACKGROUND'), BACKGROUND_GRACE_MS);
    });
    return () => {
      clearTimeout(backgroundTimer);
      sub.remove();
      transportRef.current?.disconnect();
      transportRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (state === 'connecting') {
      // Events from a transport that has since been replaced or torn down are ignored.
      const send = (event: VoiceEvent) => () => transportRef.current === t && dispatch(event);
      const t = createTransport({
        onEndOfTurn: send('END_OF_TURN'),
        onDisconnected: send('CONNECTION_LOST'),
        onDataChanged: () => setDataVersion((v) => v + 1),
      });
      transportRef.current = t;
      t.connect().then(send('CONNECTED'), send('CONNECTION_LOST'));
    } else if (state === 'disconnected') {
      transportRef.current?.disconnect();
      transportRef.current = null;
    } else {
      const listening = state === 'connected_listening';
      transportRef.current?.setMicEnabled(listening).catch((e) => {
        console.warn('[voice] mic toggle failed', e);
        if (listening) dispatch('END_OF_TURN');
      });
    }
  }, [state, createTransport]);

  const toggleMic = useCallback(() => dispatch('MIC_TAP'), []);
  return { state, toggleMic, dataVersion };
}
