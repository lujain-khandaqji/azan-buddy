import { act, renderHook } from '@testing-library/react-native';
import { AppState, AppStateStatus } from 'react-native';

import { useVoiceSession } from './useVoiceSession';
import { VoiceTransport, VoiceTransportHandlers } from './voiceTransport';

// The real transport pulls in LiveKit's native modules; the hook only needs the interface.
jest.mock('./voiceTransport', () => ({ createLiveKitTransport: jest.fn() }));

interface FakeTransport extends VoiceTransport {
  handlers: VoiceTransportHandlers;
  resolveConnect: () => void;
  rejectConnect: () => void;
}

let transports: FakeTransport[];
let appStateListener: (s: AppStateStatus) => void;
const removeListener = jest.fn();

function factory(handlers: VoiceTransportHandlers): VoiceTransport {
  let resolveConnect = () => {};
  let rejectConnect = () => {};
  const t: FakeTransport = {
    handlers,
    connect: jest.fn(() => new Promise<void>((res, rej) => ((resolveConnect = res), (rejectConnect = () => rej(new Error('x')))))),
    setMicEnabled: jest.fn(() => Promise.resolve()),
    disconnect: jest.fn(),
    resolveConnect: () => resolveConnect(),
    rejectConnect: () => rejectConnect(),
  };
  transports.push(t);
  return t;
}

async function connected() {
  const hook = await renderHook(() => useVoiceSession(factory));
  await act(async () => transports[0].resolveConnect());
  return hook;
}

beforeEach(() => {
  transports = [];
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (s: AppStateStatus) => void;
    return { remove: removeListener };
  });
});

afterEach(() => jest.restoreAllMocks());

describe('useVoiceSession', () => {
  it('connects once on start and lands muted', async () => {
    const { result } = await renderHook(() => useVoiceSession(factory));
    expect(result.current.state).toBe('connecting');
    await act(async () => transports[0].resolveConnect());
    expect(result.current.state).toBe('connected_muted');
    expect(transports).toHaveLength(1);
  });

  it('toggles the mic on the same connection instead of reconnecting per tap', async () => {
    const { result } = await connected();
    await act(async () => result.current.toggleMic());
    expect(result.current.state).toBe('connected_listening');
    expect(transports[0].setMicEnabled).toHaveBeenLastCalledWith(true);
    await act(async () => result.current.toggleMic());
    expect(result.current.state).toBe('connected_muted');
    expect(transports[0].setMicEnabled).toHaveBeenLastCalledWith(false);
    expect(transports).toHaveLength(1);
    expect(transports[0].connect).toHaveBeenCalledTimes(1);
  });

  it('mutes when the agent reports end of turn', async () => {
    const { result } = await connected();
    await act(async () => result.current.toggleMic());
    await act(async () => transports[0].handlers.onEndOfTurn());
    expect(result.current.state).toBe('connected_muted');
    expect(transports[0].setMicEnabled).toHaveBeenLastCalledWith(false);
  });

  it('keeps the session across re-renders', async () => {
    const { result, rerender } = await connected();
    await rerender({});
    await rerender({});
    expect(result.current.state).toBe('connected_muted');
    expect(transports).toHaveLength(1);
  });

  it('disconnects on background and reconnects a fresh room on foreground', async () => {
    const { result } = await connected();
    await act(async () => appStateListener('background'));
    expect(result.current.state).toBe('disconnected');
    expect(transports[0].disconnect).toHaveBeenCalledTimes(1);

    await act(async () => appStateListener('active'));
    expect(result.current.state).toBe('connecting');
    expect(transports).toHaveLength(2);
    await act(async () => transports[1].resolveConnect());
    expect(result.current.state).toBe('connected_muted');
  });

  it('ignores events from a torn-down transport', async () => {
    const { result } = await renderHook(() => useVoiceSession(factory));
    await act(async () => appStateListener('background'));
    await act(async () => transports[0].resolveConnect());
    await act(async () => transports[0].handlers.onDisconnected());
    expect(result.current.state).toBe('disconnected');
  });

  it('goes to disconnected when LiveKit gives up reconnecting, and a tap retries', async () => {
    const { result } = await connected();
    await act(async () => transports[0].handlers.onDisconnected());
    expect(result.current.state).toBe('disconnected');
    await act(async () => result.current.toggleMic());
    expect(result.current.state).toBe('connecting');
    expect(transports).toHaveLength(2);
  });

  it('returns to disconnected when the connection attempt fails, without retrying on its own', async () => {
    const { result } = await renderHook(() => useVoiceSession(factory));
    await act(async () => transports[0].rejectConnect());
    expect(result.current.state).toBe('disconnected');
    expect(transports).toHaveLength(1);
  });

  it('bumps dataVersion when a voice tool changes data', async () => {
    const { result } = await connected();
    await act(async () => transports[0].handlers.onDataChanged());
    expect(result.current.dataVersion).toBe(1);
  });

  it('cleans up the connection and the AppState listener on unmount', async () => {
    const { unmount } = await connected();
    await unmount();
    expect(transports[0].disconnect).toHaveBeenCalled();
    expect(removeListener).toHaveBeenCalled();
  });
});
