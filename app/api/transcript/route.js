import { YoutubeTranscript } from 'youtube-transcript';
import { extractVideoId, transcriptItemsToCues, normalizeCues } from '../../../lib/subtitles.js';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Per-instance memory cache. The Cache-Control header below also lets
// Vercel's CDN cache each video's subtitles, so a video is fetched once.
const cache = new Map();
const MAX_CACHE = 200;
const MAX_CUES = 3000;

function json(body, status = 200, cacheable = false) {
  return Response.json(body, {
    status,
    headers: cacheable
      ? { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' }
      : { 'Cache-Control': 'no-store' },
  });
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const id = extractVideoId(searchParams.get('v') || '');
  const lang = (searchParams.get('lang') || 'en').replace(/[^a-zA-Z-]/g, '').slice(0, 10) || 'en';

  if (!id) return json({ error: 'Invalid YouTube link or video ID.' }, 400);

  const key = `${id}:${lang}`;
  if (cache.has(key)) return json(cache.get(key), 200, true);

  try {
    const items = await YoutubeTranscript.fetchTranscript(id, { lang });
    const cues = normalizeCues(transcriptItemsToCues(items)).slice(0, MAX_CUES);
    if (!cues.length) {
      return json({ error: 'This video has subtitles, but no usable text lines were found.' }, 404);
    }
    const body = { videoId: id, lang, cues };
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
    cache.set(key, body);
    return json(body, 200, true);
  } catch (err) {
    const msg = String(err?.message || err);
    if (/disabled/i.test(msg)) {
      return json({ error: 'Subtitles are disabled for this video. Try another video, or upload an SRT/VTT file.' }, 404);
    }
    if (/No transcripts? are available|not available in/i.test(msg)) {
      return json({ error: msg.replace(/\[YoutubeTranscript\]\s*🚨\s*/, '').slice(0, 300) }, 404);
    }
    if (/unavailable|private|not found/i.test(msg)) {
      return json({ error: 'This video is unavailable or private.' }, 404);
    }
    return json(
      { error: 'Could not fetch subtitles for this video right now. Try again, try another video, or upload an SRT/VTT file.' },
      502
    );
  }
}
