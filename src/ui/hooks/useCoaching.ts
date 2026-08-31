import { useState } from 'react';
import { getCoachingResponse } from '../../domain/services/coachingService';

export interface CoachingMessage {
  id: string;
  role: 'user' | 'nafy';
  text: string;
}

export interface CoachingState {
  messages: CoachingMessage[];
  sending: boolean;
  error: string | null;
  sendMessage: (question: string) => Promise<void>;
}

function describeError(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Owns no coaching/AI logic of its own — getCoachingResponse is called directly
 * from coachingService; this hook only tracks the message list and loading/error
 * state for the screen.
 */
export function useCoaching(): CoachingState {
  const [messages, setMessages] = useState<CoachingMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendMessage(question: string) {
    const trimmed = question.trim();
    if (!trimmed || sending) return;

    setMessages((prev) => [...prev, { id: generateMessageId(), role: 'user', text: trimmed }]);
    setSending(true);
    setError(null);

    try {
      const reply = await getCoachingResponse({ type: 'reflection', question: trimmed });
      setMessages((prev) => [...prev, { id: generateMessageId(), role: 'nafy', text: reply }]);
    } catch (e) {
      setError(describeError(e, 'Failed to get a response'));
    } finally {
      setSending(false);
    }
  }

  return { messages, sending, error, sendMessage };
}
