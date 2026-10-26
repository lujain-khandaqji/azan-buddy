import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTurnLanguageTracker, detectLanguage, withLanguageDirective } from './language.js';

test('detects English and Arabic utterances', () => {
  assert.equal(detectLanguage('Remind me 10 minutes before Asr.'), 'English');
  assert.equal(detectLanguage('متى المغرب اليوم؟'), 'Arabic');
  assert.equal(detectLanguage('ذكرني قبل العصر بعشر دقائق'), 'Arabic');
});

test('uses the majority script for mixed utterances', () => {
  assert.equal(detectLanguage('When is المغرب today?'), 'English');
  assert.equal(detectLanguage('متى صلاة Maghrib اليوم؟'), 'Arabic');
});

test('returns null when there is nothing to judge', () => {
  assert.equal(detectLanguage(''), null);
  assert.equal(detectLanguage('10 ... 15?'), null);
});

test('follows only the most recent utterance, switching both ways', () => {
  const tracker = createTurnLanguageTracker();
  assert.equal(tracker.current(), null);
  tracker.onUserTranscript('متى المغرب اليوم؟');
  assert.equal(tracker.current(), 'Arabic');
  tracker.onUserTranscript('Remind me 10 minutes before Asr.');
  assert.equal(tracker.current(), 'English');
  tracker.onUserTranscript('صليت العصر');
  assert.equal(tracker.current(), 'Arabic');
});

test('an earlier Arabic turn does not stick when the new utterance is unjudgeable', () => {
  const tracker = createTurnLanguageTracker();
  tracker.onUserTranscript('متى المغرب اليوم؟');
  tracker.onUserTranscript('10');
  assert.equal(tracker.current(), null);
});

test('interim transcripts of the current turn update the language', () => {
  const tracker = createTurnLanguageTracker();
  tracker.onUserTranscript('متى');
  tracker.onUserTranscript('Remind');
  tracker.onUserTranscript('Remind me 10 minutes before Asr');
  assert.equal(tracker.current(), 'English');
});

test('the directive names the language and keeps the English app result intact', () => {
  const result = "Done. I'll remind you 10 minutes before Asr today.";
  const en = withLanguageDirective(result, 'English');
  assert.match(en, /Reply to the user in English only/);
  assert.ok(en.endsWith(result));
  assert.match(withLanguageDirective(result, 'Arabic'), /Reply to the user in Arabic only/);
});
