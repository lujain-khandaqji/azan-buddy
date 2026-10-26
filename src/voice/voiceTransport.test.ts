import { AGENT_READY_TIMEOUT_MS, createLiveKitTransport } from './voiceTransport';

type Listener = (...args: unknown[]) => void;
type RpcHandler = (data: { payload: string }) => Promise<string>;
type FakeParticipant = { identity: string; kind: number; attributes: Record<string, string> };

const AGENT_KIND = 4; // ParticipantKind.AGENT
const listeners: Record<string, Listener[]> = {};
const rpcHandlers: Record<string, RpcHandler> = {};
const remoteParticipants = new Map<string, FakeParticipant>();

const mockRoom = {
  remoteParticipants,
  on: jest.fn((event: string, fn: Listener) => {
    (listeners[event] ??= []).push(fn);
  }),
  off: jest.fn((event: string, fn: Listener) => {
    listeners[event] = (listeners[event] ?? []).filter((l) => l !== fn);
  }),
  registerRpcMethod: jest.fn((name: string, fn: RpcHandler) => {
    rpcHandlers[name] = fn;
  }),
  connect: jest.fn(() => Promise.resolve()),
  disconnect: jest.fn(),
  removeAllListeners: jest.fn(),
  localParticipant: { setMicrophoneEnabled: jest.fn(() => Promise.resolve()) },
};

const emit = (event: string, ...args: unknown[]) => (listeners[event] ?? []).forEach((l) => l(...args));

function agentJoins(state: string) {
  const agent = { identity: 'agent-1', kind: AGENT_KIND, attributes: { 'lk.agent.state': state } };
  remoteParticipants.set(agent.identity, agent);
  emit('participantConnected', agent);
  return agent;
}

function agentStateChanges(agent: FakeParticipant, state: string) {
  agent.attributes['lk.agent.state'] = state;
  emit('participantAttributesChanged', { 'lk.agent.state': state }, agent);
}

jest.mock('livekit-client', () => ({
  Room: jest.fn(() => mockRoom),
  ParticipantKind: { AGENT: 4 },
  RoomEvent: {
    Disconnected: 'disconnected',
    ParticipantConnected: 'participantConnected',
    ParticipantDisconnected: 'participantDisconnected',
    ParticipantAttributesChanged: 'participantAttributesChanged',
  },
  TokenSource: {
    sandboxTokenServer: jest.fn(() => ({
      fetch: jest.fn(() => Promise.resolve({ serverUrl: 'wss://x', participantToken: 't' })),
    })),
  },
}));
jest.mock('@livekit/react-native', () => ({
  AudioSession: { startAudioSession: jest.fn(() => Promise.resolve()), stopAudioSession: jest.fn() },
}));
jest.mock('./voiceTools', () => ({
  VOICE_TOOLS: { getPrayerTimes: jest.fn(), logPrayer: jest.fn() },
  MUTATING_TOOLS: ['logPrayer'],
  resetVoiceToolSession: jest.fn(),
  runVoiceTool: jest.fn(() => Promise.resolve('Fajr tomorrow is at 4:51 AM.')),
}));

const handlers = { onEndOfTurn: jest.fn(), onDisconnected: jest.fn(), onDataChanged: jest.fn() };
const ORIGINAL_SANDBOX = process.env.EXPO_PUBLIC_LIVEKIT_SANDBOX_ID;
const flush = () => new Promise((r) => jest.requireActual('timers').setImmediate(r));

beforeEach(() => {
  process.env.EXPO_PUBLIC_LIVEKIT_SANDBOX_ID = 'sandbox';
  jest.spyOn(console, 'log').mockImplementation(() => {});
  for (const k of Object.keys(listeners)) delete listeners[k];
  remoteParticipants.clear();
});

afterEach(() => {
  process.env.EXPO_PUBLIC_LIVEKIT_SANDBOX_ID = ORIGINAL_SANDBOX;
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe('createLiveKitTransport', () => {
  it('does not report connected until the dispatched agent is in the room and listening', async () => {
    const transport = createLiveKitTransport(handlers);
    let connected = false;
    const connecting = transport.connect().then(() => (connected = true));
    await flush();
    expect(mockRoom.connect).toHaveBeenCalled(); // room joined...
    expect(connected).toBe(false); // ...but speech now would be lost: no agent yet

    const agent = agentJoins('initializing');
    await flush();
    expect(connected).toBe(false);

    agentStateChanges(agent, 'listening');
    await connecting;
    expect(connected).toBe(true);
    expect(handlers.onEndOfTurn).not.toHaveBeenCalled();
  });

  it('resolves immediately when the agent is already listening', async () => {
    agentJoins('listening');
    await expect(createLiveKitTransport(handlers).connect()).resolves.toBeUndefined();
  });

  it('fails the connection if the agent never becomes ready', async () => {
    jest.useFakeTimers();
    const failed = expect(createLiveKitTransport(handlers).connect()).rejects.toThrow('Nafy agent did not become ready');
    await jest.advanceTimersByTimeAsync(AGENT_READY_TIMEOUT_MS);
    await failed;
  });

  it('reports end of turn without disconnecting, and still answers the tool call afterwards', async () => {
    const agent = agentJoins('listening');
    const transport = createLiveKitTransport(handlers);
    await transport.connect();

    agentStateChanges(agent, 'thinking');
    await transport.setMicEnabled(false);
    const reply = await rpcHandlers.getPrayerTimes({ payload: '{"prayer":"Fajr","day":"tomorrow"}' });

    expect(handlers.onEndOfTurn).toHaveBeenCalledTimes(1);
    expect(mockRoom.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
    expect(reply).toBe('Fajr tomorrow is at 4:51 AM.');
    expect(mockRoom.disconnect).not.toHaveBeenCalled();
  });

  it('ignores agent states that are not an end of turn', async () => {
    const agent = agentJoins('listening');
    await createLiveKitTransport(handlers).connect();
    agentStateChanges(agent, 'listening');
    expect(handlers.onEndOfTurn).not.toHaveBeenCalled();
  });

  it('treats the agent leaving as a lost connection, but not other participants leaving', () => {
    createLiveKitTransport(handlers);
    emit('participantDisconnected', { identity: 'someone', kind: 0, attributes: {} });
    expect(handlers.onDisconnected).not.toHaveBeenCalled();
    emit('participantDisconnected', { identity: 'agent-1', kind: AGENT_KIND, attributes: {} });
    expect(handlers.onDisconnected).toHaveBeenCalledTimes(1);
  });

  it('only disconnects the room when disconnect() is called, and only once', () => {
    const transport = createLiveKitTransport(handlers);
    transport.disconnect();
    transport.disconnect();
    expect(mockRoom.removeAllListeners).toHaveBeenCalledTimes(1);
    expect(mockRoom.disconnect).toHaveBeenCalledTimes(1);
  });
});
