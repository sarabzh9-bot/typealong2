import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractVideoId,
  cleanText,
  parseSubtitles,
  normalizeCues,
  transcriptItemsToCues,
} from '../lib/subtitles.js';
import { compareLine, countNewKeystrokes, wpm, accuracy } from '../lib/typing.js';

test('extractVideoId handles common URL shapes', () => {
  const id = 'dQw4w9WgXcQ';
  assert.equal(extractVideoId(id), id);
  assert.equal(extractVideoId(`https://www.youtube.com/watch?v=${id}&t=10s`), id);
  assert.equal(extractVideoId(`https://youtu.be/${id}?si=abc`), id);
  assert.equal(extractVideoId(`https://m.youtube.com/watch?v=${id}`), id);
  assert.equal(extractVideoId(`youtube.com/shorts/${id}`), id);
  assert.equal(extractVideoId(`https://www.youtube.com/embed/${id}`), id);
  assert.equal(extractVideoId('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(extractVideoId('not a link'), null);
  assert.equal(extractVideoId(''), null);
});

test('cleanText strips tags, sound labels, entities and fancy punctuation', () => {
  assert.equal(cleanText('[Music]'), '');
  assert.equal(cleanText('<i>Hello</i>  world'), 'Hello world');
  assert.equal(cleanText('It&amp;#39;s fine'), "It's fine");
  assert.equal(cleanText('It’s “great” — really…'), 'It\'s "great" - really...');
  assert.equal(cleanText('Salut ! ♪'), 'Salut !');
  assert.equal(cleanText('>> Hello there'), 'Hello there');
  assert.equal(cleanText('-5 degrees'), '-5 degrees');
  assert.equal(cleanText('Nice \u{1F600} one'), 'Nice one');
});

test('parseSubtitles reads SRT', () => {
  const srt = `1\n00:00:01,000 --> 00:00:03,500\nHello there,\nhow are you?\n\n2\n00:00:04,000 --> 00:00:06,000\nFine, thanks.\n`;
  const cues = parseSubtitles(srt);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { start: 1, end: 3.5, text: 'Hello there, how are you?' });
  assert.equal(cues[1].text, 'Fine, thanks.');
});

test('parseSubtitles reads VTT with header, notes, tags and short timestamps', () => {
  const vtt = `WEBVTT\n\nNOTE a comment\n\n00:01.000 --> 00:02.500 align:start\n<c>Hello</c> <00:01.500>world\n\n01:00:00.250 --> 01:00:02.000\nLater\n`;
  const cues = parseSubtitles(vtt);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].start, 1);
  assert.equal(cues[0].end, 2.5);
  assert.equal(cleanText(cues[0].text), 'Hello world');
  assert.equal(cues[1].start, 3600.25);
});

test('normalizeCues merges short lines, drops empties and duplicates', () => {
  const cues = [
    { start: 0, end: 1, text: '[Music]' },
    { start: 1, end: 2, text: 'Hi.' },
    { start: 2.1, end: 3, text: 'How are you doing today?' },
    { start: 3, end: 4, text: 'How are you doing today?' },
    { start: 20, end: 22, text: 'A completely separate sentence that stands alone.' },
  ];
  const out = normalizeCues(cues);
  assert.equal(out.length, 2);
  assert.equal(out[0].text, 'Hi. How are you doing today?');
  assert.equal(out[0].start, 1);
  assert.equal(out[0].end, 4);
  assert.equal(out[1].text, 'A completely separate sentence that stands alone.');
});

test('normalizeCues splits very long lines with proportional timing', () => {
  const long = 'word '.repeat(60).trim(); // 299 chars
  const out = normalizeCues([{ start: 10, end: 40, text: long }], { maxChars: 90 });
  assert.ok(out.length >= 4);
  for (const c of out) assert.ok(c.text.length <= 90);
  assert.equal(out[0].start, 10);
  assert.equal(out[out.length - 1].end, 40);
  for (let i = 1; i < out.length; i++) assert.ok(out[i].start >= out[i - 1].end - 1e-9);
  assert.equal(out.map((c) => c.text).join(' '), long);
});

test('transcriptItemsToCues detects seconds vs milliseconds', () => {
  const sec = transcriptItemsToCues([
    { text: 'a', offset: 1.5, duration: 2 },
    { text: 'b', offset: 3.5, duration: 3 },
  ]);
  assert.equal(sec[0].start, 1.5);
  assert.equal(sec[0].end, 3.5);
  const ms = transcriptItemsToCues([
    { text: 'a', offset: 1500, duration: 2000 },
    { text: 'b', offset: 3500, duration: 3000 },
  ]);
  assert.equal(ms[0].start, 1.5);
  assert.equal(ms[0].end, 3.5);
  assert.equal(ms[1].end, 6.5);
});

test('compareLine marks characters and detects completion', () => {
  const r = compareLine('Hello', 'Help', false);
  assert.deepEqual(r.states, ['ok', 'ok', 'ok', 'bad', 'todo']);
  assert.equal(r.complete, false);
  assert.equal(compareLine('Hello', 'Hello', false).complete, true);
  assert.equal(compareLine('Hello', 'Helloo', false).complete, false);
  assert.equal(compareLine('Hello', 'Helloo', false).extra, 1);
  assert.equal(compareLine('Hello', 'hello', false).complete, false);
  assert.equal(compareLine('Hello', 'hello', true).complete, true);
  assert.equal(compareLine('Élève', 'eleve', true).complete, true);
  assert.equal(compareLine('Élève', 'eleve', false).complete, false);
  assert.equal(compareLine('', '', true).complete, false);
});

test('countNewKeystrokes counts only added characters', () => {
  assert.deepEqual(countNewKeystrokes('He', 'Hel', 'Hello', false), { typed: 1, correct: 1 });
  assert.deepEqual(countNewKeystrokes('He', 'Hex', 'Hello', false), { typed: 1, correct: 0 });
  assert.deepEqual(countNewKeystrokes('Hel', 'He', 'Hello', false), { typed: 0, correct: 0 });
  assert.deepEqual(countNewKeystrokes('Hello', 'Hello!', 'Hello', false), { typed: 1, correct: 0 });
});

test('wpm and accuracy', () => {
  assert.equal(wpm(300, 60000), 60); // 300 chars = 60 words in 1 minute
  assert.equal(wpm(300, 30000), 120);
  assert.equal(wpm(10, 500), 0); // too little time to be meaningful
  assert.equal(accuracy(90, 100), 90);
  assert.equal(accuracy(0, 0), 100);
});
