import { GoogleGenAI } from '@google/genai';
import { getCoachingResponse } from './coachingService';

const mockGenerateContent = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}));

const MockedGoogleGenAI = GoogleGenAI as unknown as jest.Mock;
const ORIGINAL_ENV = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

describe('getCoachingResponse', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-api-key';
    mockGenerateContent.mockResolvedValue({ text: 'A short, supportive reply.' });
  });

  afterEach(() => {
    process.env.EXPO_PUBLIC_GEMINI_API_KEY = ORIGINAL_ENV;
    jest.clearAllMocks();
  });

  it('sends a status-trigger request naming the prayer, using the gemini-3.6-flash model', async () => {
    await getCoachingResponse({ type: 'status', prayerName: 'Dhuhr', status: 'late' });

    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.model).toBe('gemini-3.6-flash');
    expect(call.contents).toContain('Dhuhr');
  });

  it('passes a reflection question through as contents verbatim', async () => {
    await getCoachingResponse({ type: 'reflection', question: 'Any tips for waking up for Fajr?' });

    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.contents).toBe('Any tips for waking up for Fajr?');
  });

  it("returns the SDK's response.text", async () => {
    mockGenerateContent.mockResolvedValueOnce({ text: 'Take it one prayer at a time.' });

    const result = await getCoachingResponse({ type: 'reflection', question: 'I keep missing Asr, help?' });

    expect(result).toBe('Take it one prayer at a time.');
  });

  it('constructs the client with the API key from EXPO_PUBLIC_GEMINI_API_KEY and the Cloudflare Gateway base URL', async () => {
    await getCoachingResponse({ type: 'reflection', question: 'hi' });

    expect(MockedGoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      httpOptions: {
        baseUrl: 'https://gateway.ai.cloudflare.com/v1/d0f40847281073ea5ed296ebddcc5e07/azan-buddy/google-ai-studio',
      },
    });
  });

  it('throws a clear error when EXPO_PUBLIC_GEMINI_API_KEY is not set', async () => {
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;

    await expect(getCoachingResponse({ type: 'reflection', question: 'hi' })).rejects.toThrow(
      'EXPO_PUBLIC_GEMINI_API_KEY is not set'
    );
  });

  it('keeps the system prompt to 1 to 3 sentences', async () => {
    await getCoachingResponse({ type: 'reflection', question: 'hi' });

    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.config.systemInstruction).toContain('1 to 3 sentences');
  });

  it('instructs the model to avoid scolding, guilt-tripping, or repetition-count phrases', async () => {
    await getCoachingResponse({ type: 'reflection', question: 'hi' });

    const systemInstruction: string = mockGenerateContent.mock.calls[0][0].config.systemInstruction;
    expect(systemInstruction).toContain('Never scold, guilt-trip, or lecture');
    expect(systemInstruction).toContain('this is your Nth time');
  });

  it('names the persona Nafy and instructs it to acknowledge qada warmly first', async () => {
    await getCoachingResponse({ type: 'reflection', question: 'hi' });

    const systemInstruction: string = mockGenerateContent.mock.calls[0][0].config.systemInstruction;
    expect(systemInstruction).toContain('You are Nafy');
    expect(systemInstruction).toContain('acknowledge it warmly first');
  });
});
