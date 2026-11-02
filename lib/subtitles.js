// Pure helpers for turning YouTube links and subtitle data into typing lines.
// No dependencies, so they can be tested with plain Node (`npm test`).

const ID_RE = /^[\w-]{11}$/;

/** Extract an 11-character YouTube video ID from a URL or a bare ID. */
export function extractVideoId(input) {
  if (!input) return null;
  const s = String(input).trim();
  if (ID_RE.test(s)) return s;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const host = u.hostname.replace(/^(www|m)\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      return ID_RE.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v');
      if (v && ID_RE.test(v)) return v;
      const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch {
    /* not a URL */
  }
  return null;
}

function decodeEntities(str) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  let out = str;
  // Two passes: YouTube sometimes double-encodes (e.g. "&amp;#39;").
  for (let pass = 0; pass < 2; pass++) {
    out = out.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g) => {
      if (g[0] === '#') {
        const code = g[1].toLowerCase() === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
        try {
          return String.fromCodePoint(code);
        } catch {
          return m;
        }
      }
      const v = named[g.toLowerCase()];
      return v === undefined ? m : v;
    });
  }
  return out;
}

/** Clean one caption line so it is pleasant to type. */
export function cleanText(raw) {
  let t = String(raw ?? '').replace(/<[^>]*>/g, ''); // VTT / HTML tags
  t = decodeEntities(t);
  t = t
    .replace(/\[[^\]]*\]/g, ' ') // [Music], [Applause]
    .replace(/[♪♫]+/g, ' ') // music notes
    .replace(/[\p{Extended_Pictographic}️‍]/gu, '') // emoji
    .replace(/​/g, '')
    .replace(/[  ]/g, ' ') // non-breaking spaces (French punctuation)
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/^(?:>>+|-)\s+/, ''); // speaker-change markers
  return t.trim();
}

function parseTime(str) {
  const m = String(str)
    .trim()
    .match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/);
  if (!m) return null;
  const h = Number(m[1] || 0);
  const mi = Number(m[2]);
  const s = Number(m[3]);
  const ms = Number(m[4].padEnd(3, '0'));
  return h * 3600 + mi * 60 + s + ms / 1000;
}

/** Parse SRT or WebVTT text into raw cues: [{start, end, text}] (seconds). */
export function parseSubtitles(input) {
  const text = String(input ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const cues = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i === -1) continue;
    const m = lines[i].match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
    if (!m) continue;
    const start = parseTime(m[1]);
    const end = parseTime(m[2]);
    if (start == null || end == null) continue;
    const body = lines
      .slice(i + 1)
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ');
    cues.push({ start, end, text: body });
  }
  return cues;
}

/**
 * Convert items from the `youtube-transcript` package into cues in seconds.
 * Some versions of that package return milliseconds, others seconds, so the
 * unit is detected from the median caption duration (captions last a few
 * seconds, never 100+).
 */
export function transcriptItemsToCues(items) {
  const durs = items
    .map((i) => Number(i.duration))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  const median = durs.length ? durs[Math.floor(durs.length / 2)] : 0;
  const k = median > 100 ? 1 / 1000 : 1;
  return items
    .map((i) => {
      const start = Number(i.offset) * k;
      const end = start + Number(i.duration) * k;
      return { start, end, text: i.text };
    })
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end));
}

function splitLong(c, maxChars) {
  if (c.text.length <= maxChars) return [c];
  const words = c.text.split(' ');
  const parts = Math.ceil(c.text.length / maxChars);
  const target = c.text.length / parts;
  const chunks = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && next.length > maxChars) {
      chunks.push(cur);
      cur = w;
    } else if (cur && cur.length >= target && chunks.length < parts - 1) {
      chunks.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) chunks.push(cur);
  const total = c.text.length;
  const dur = c.end - c.start;
  let t = c.start;
  return chunks.map((txt, idx) => {
    const d = dur * (txt.length / total);
    const seg = { start: t, end: idx === chunks.length - 1 ? c.end : t + d, text: txt };
    t += d;
    return seg;
  });
}

/**
 * Clean raw cues into good typing lines: strip tags/sound labels, drop empty
 * and duplicate lines, merge very short lines, split very long ones.
 */
export function normalizeCues(cues, { minChars = 20, maxChars = 90, maxGap = 1.5 } = {}) {
  const cleaned = [];
  for (const c of [...cues].sort((a, b) => a.start - b.start)) {
    const text = cleanText(c.text);
    if (!text) continue;
    const last = cleaned[cleaned.length - 1];
    if (last && last.text === text) {
      last.end = Math.max(last.end, c.end);
      continue;
    }
    cleaned.push({ start: c.start, end: Math.max(c.end, c.start + 0.5), text });
  }

  const merged = [];
  for (let i = 0; i < cleaned.length; i++) {
    let cur = { ...cleaned[i] };
    while (cur.text.length < minChars && i + 1 < cleaned.length) {
      const next = cleaned[i + 1];
      if (next.start - cur.end > maxGap) break;
      if (`${cur.text} ${next.text}`.length > maxChars) break;
      cur = { start: cur.start, end: Math.max(cur.end, next.end), text: `${cur.text} ${next.text}` };
      i++;
    }
    merged.push(cur);
  }

  return merged.flatMap((c) => splitLong(c, maxChars));
}
