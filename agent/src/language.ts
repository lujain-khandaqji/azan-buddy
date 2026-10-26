// Per-turn reply-language control. Gemini Live drifts toward the language of
// earlier turns or of English tool results, and its instructions can't be
// swapped per turn (that restarts the Live session), so the language of the
// user's latest utterance is attached to every tool result instead.

export type Language = 'English' | 'Arabic';

const ARABIC_LETTER = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
const LATIN_LETTER = /[A-Za-z]/g;

/** Language of a transcript by script majority; null when it has no letters to judge. */
export function detectLanguage(text: string): Language | null {
  const arabic = text.match(ARABIC_LETTER)?.length ?? 0;
  const latin = text.match(LATIN_LETTER)?.length ?? 0;
  if (arabic === 0 && latin === 0) return null;
  return arabic > latin ? 'Arabic' : 'English';
}

/**
 * Tracks the language of the user's most recent utterance only. Every
 * transcript update replaces the previous value, so an earlier turn's language
 * never carries over; an utterance with no judgeable letters resets it to null.
 */
export function createTurnLanguageTracker() {
  let latest: Language | null = null;
  return {
    onUserTranscript(transcript: string) {
      latest = detectLanguage(transcript);
    },
    current: () => latest,
  };
}

/** Wraps an app tool result so the reply language comes from the user, not the result text. */
export function withLanguageDirective(result: string, language: Language): string {
  return `Reply to the user in ${language} only, because their most recent message was in ${language}. ` +
    `Convey this app result faithfully in ${language}, keeping every time and number: ${result}`;
}
