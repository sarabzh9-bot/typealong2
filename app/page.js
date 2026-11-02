'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractVideoId, parseSubtitles, normalizeCues } from '../lib/subtitles.js';
import { compareLine, countNewKeystrokes, wpm, accuracy, formatDuration } from '../lib/typing.js';

const HISTORY_KEY = 'typealong:history';
const EMPTY_STATS = { correct: 0, typed: 0, doneChars: 0, activeMs: 0 };

function loadYouTubeApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (window.__ytApiPromise) return window.__ytApiPromise;
  window.__ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prev) prev();
      resolve(window.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return window.__ytApiPromise;
}

export default function Page() {
  const [url, setUrl] = useState('');
  const [lang, setLang] = useState('en');
  const [relaxed, setRelaxed] = useState(true);
  const [videoId, setVideoId] = useState(null);
  const [cues, setCues] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [error, setError] = useState('');
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState('');
  const [stats, setStats] = useState(EMPTY_STATS);
  const [now, setNow] = useState(0);
  const [finished, setFinished] = useState(false);
  const [history, setHistory] = useState([]);
  const [playerReady, setPlayerReady] = useState(false);

  const wrapRef = useRef(null);
  const playerRef = useRef(null);
  const cuesRef = useRef([]);
  const segEndRef = useRef(null);
  const segGuardRef = useRef(0);
  const lineStartRef = useRef(null);
  const inputRef = useRef(null);

  // Load saved results (browser only).
  useEffect(() => {
    try {
      setHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'));
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Create the YouTube player whenever the video changes.
  useEffect(() => {
    if (!videoId) return undefined;
    let cancelled = false;
    setPlayerReady(false);
    loadYouTubeApi().then((YT) => {
      if (cancelled || !wrapRef.current) return;
      wrapRef.current.innerHTML = '';
      const el = document.createElement('div');
      wrapRef.current.appendChild(el);
      playerRef.current = new YT.Player(el, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: { onReady: () => !cancelled && setPlayerReady(true) },
      });
    });
    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        /* already gone */
      }
      playerRef.current = null;
    };
  }, [videoId]);

  // Pause the video when the current line's audio has finished.
  useEffect(() => {
    const t = setInterval(() => {
      const p = playerRef.current;
      if (!p || segEndRef.current == null || typeof p.getCurrentTime !== 'function') return;
      if (Date.now() < segGuardRef.current) return;
      try {
        if (p.getPlayerState() === 1 && p.getCurrentTime() >= segEndRef.current) {
          p.pauseVideo();
          segEndRef.current = null;
        }
      } catch {
        /* player not ready */
      }
    }, 100);
    return () => clearInterval(t);
  }, []);

  // Clock for the live WPM display.
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const playLine = useCallback((i) => {
    const c = cuesRef.current[i];
    const p = playerRef.current;
    if (!c || !p || typeof p.seekTo !== 'function') return;
    segEndRef.current = c.end;
    segGuardRef.current = Date.now() + 500; // ignore stale time right after seeking
    try {
      p.seekTo(Math.max(0, c.start - 0.1), true);
      p.playVideo();
    } catch {
      /* player not ready */
    }
  }, []);

  // Start the first line once both the player and the subtitles are ready.
  useEffect(() => {
    if (playerReady && status === 'ready' && cues.length) {
      playLine(0);
      inputRef.current?.focus();
    }
  }, [playerReady, status, cues, playLine]);

  function begin(id, newCues) {
    cuesRef.current = newCues;
    segEndRef.current = null;
    lineStartRef.current = null;
    setVideoId(id);
    setCues(newCues);
    setIdx(0);
    setTyped('');
    setStats(EMPTY_STATS);
    setFinished(false);
    setError('');
    setStatus('ready');
  }

  async function handleLoad(e) {
    e.preventDefault();
    const id = extractVideoId(url);
    if (!id) {
      setStatus('error');
      setError('Paste a valid YouTube link or video ID.');
      return;
    }
    setStatus('loading');
    setError('');
    try {
      const res = await fetch(`/api/transcript?v=${id}&lang=${encodeURIComponent(lang.trim() || 'en')}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load subtitles.');
      if (!data.cues?.length) throw new Error('No usable subtitle lines found.');
      begin(id, data.cues);
    } catch (err) {
      setStatus('error');
      setError(err.message || 'Could not load subtitles.');
    }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const id = extractVideoId(url);
    if (!id) {
      setStatus('error');
      setError('Paste the YouTube link first, then choose the subtitle file.');
      return;
    }
    try {
      const cs = normalizeCues(parseSubtitles(await file.text()));
      if (!cs.length) throw new Error('No subtitle lines found in that file (use .srt or .vtt).');
      begin(id, cs);
    } catch (err) {
      setStatus('error');
      setError(err.message);
    }
  }

  function goTo(i) {
    const n = Math.min(Math.max(i, 0), cuesRef.current.length - 1);
    lineStartRef.current = null;
    setIdx(n);
    setTyped('');
    playLine(n);
    inputRef.current?.focus();
  }

  function restart() {
    setStats(EMPTY_STATS);
    setFinished(false);
    goTo(0);
  }

  function finish(finalStats) {
    setFinished(true);
    segEndRef.current = null;
    try {
      playerRef.current?.pauseVideo();
    } catch {
      /* ignore */
    }
    const entry = {
      videoId,
      wpm: wpm(finalStats.doneChars, finalStats.activeMs),
      accuracy: accuracy(finalStats.correct, finalStats.typed),
      lines: cuesRef.current.length,
      date: new Date().toISOString().slice(0, 10),
    };
    const next = [entry, ...history].slice(0, 20);
    setHistory(next);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  }

  const target = cues[idx]?.text ?? '';
  const cmp = useMemo(() => compareLine(target, typed, relaxed), [target, typed, relaxed]);

  function handleChange(e) {
    if (finished) return;
    const next = e.target.value;
    const k = countNewKeystrokes(typed, next, target, relaxed);
    if (lineStartRef.current == null && next.length > 0) lineStartRef.current = Date.now();
    const ns = { ...stats, correct: stats.correct + k.correct, typed: stats.typed + k.typed };

    if (compareLine(target, next, relaxed).complete) {
      const ms = lineStartRef.current ? Date.now() - lineStartRef.current : 0;
      lineStartRef.current = null;
      ns.doneChars += target.length;
      ns.activeMs += ms;
      setStats(ns);
      setTyped('');
      if (idx + 1 >= cues.length) {
        finish(ns);
      } else {
        setIdx(idx + 1);
        playLine(idx + 1);
      }
      return;
    }
    setStats(ns);
    setTyped(next);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) playLine(idx); // Ctrl/Cmd+Enter = replay line
    }
  }

  const activeNow = stats.activeMs + (lineStartRef.current && now ? Math.max(0, now - lineStartRef.current) : 0);
  const liveWpm = wpm(stats.doneChars + cmp.correct, activeNow);
  const liveAcc = accuracy(stats.correct, stats.typed);
  const progress = cues.length ? Math.round((idx / cues.length) * 100) : 0;
  const hasSession = status === 'ready' && cues.length > 0;

  return (
    <main className="wrap">
      <header className="top">
        <h1>TypeAlong</h1>
        <p>Type along with any YouTube video that has subtitles. The video pauses until you finish each line.</p>
      </header>

      <form className="load" onSubmit={handleLoad}>
        <input
          className="url"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a YouTube link, e.g. https://www.youtube.com/watch?v=..."
          aria-label="YouTube link"
        />
        <input
          className="lang"
          type="text"
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          placeholder="en"
          aria-label="Subtitle language code"
          title="Subtitle language code (en, fr, es, de...)"
        />
        <button type="submit" disabled={status === 'loading'}>
          {status === 'loading' ? 'Loading...' : 'Start'}
        </button>
      </form>

      <div className="options">
        <label>
          <input type="checkbox" checked={relaxed} onChange={(e) => setRelaxed(e.target.checked)} /> Relaxed mode (ignore
          capital letters and accents)
        </label>
        <label className="file">
          Or upload your own subtitles (.srt / .vtt)
          <input type="file" accept=".srt,.vtt,.txt" onChange={handleFile} />
        </label>
      </div>

      {status === 'error' && <p className="error">{error}</p>}

      <section className="stage" hidden={!videoId}>
        <div className="video">
          <div ref={wrapRef} className="player" />
        </div>

        {hasSession && !finished && (
          <div className="panel">
            <div className="metrics">
              <div>
                <b>{liveWpm}</b>
                <span>WPM</span>
              </div>
              <div>
                <b>{liveAcc}%</b>
                <span>Accuracy</span>
              </div>
              <div>
                <b>
                  {idx + 1}/{cues.length}
                </b>
                <span>Line</span>
              </div>
              <div>
                <b>{formatDuration(activeNow)}</b>
                <span>Typing time</span>
              </div>
            </div>
            <div className="bar" aria-hidden="true">
              <div style={{ width: `${progress}%` }} />
            </div>

            <p className="ctx prev">{cues[idx - 1]?.text ?? ' '}</p>
            <p className="target" aria-label="Line to type">
              {target.split('').map((ch, i) => (
                <span
                  key={i}
                  className={`${cmp.states[i]}${i === typed.length ? ' caret' : ''}`}
                >
                  {ch}
                </span>
              ))}
            </p>
            <p className="ctx next">{cues[idx + 1]?.text ?? ' '}</p>

            <input
              ref={inputRef}
              className={`typebox${cmp.extra > 0 ? ' over' : ''}`}
              value={typed}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onPaste={(e) => e.preventDefault()}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="Type the line above..."
              aria-label="Type here"
            />
            {cmp.extra > 0 && <p className="hint">Too many characters - press Backspace.</p>}

            <div className="buttons">
              <button type="button" onClick={() => goTo(idx - 1)} disabled={idx === 0}>
                Previous line
              </button>
              <button type="button" onClick={() => playLine(idx)}>
                Replay (Ctrl+Enter)
              </button>
              <button type="button" onClick={() => goTo(idx + 1)} disabled={idx >= cues.length - 1}>
                Skip line
              </button>
            </div>
          </div>
        )}

        {hasSession && finished && (
          <div className="panel done">
            <h2>Finished!</h2>
            <div className="metrics">
              <div>
                <b>{wpm(stats.doneChars, stats.activeMs)}</b>
                <span>WPM</span>
              </div>
              <div>
                <b>{accuracy(stats.correct, stats.typed)}%</b>
                <span>Accuracy</span>
              </div>
              <div>
                <b>{cues.length}</b>
                <span>Lines</span>
              </div>
              <div>
                <b>{formatDuration(stats.activeMs)}</b>
                <span>Typing time</span>
              </div>
            </div>
            <div className="buttons">
              <button type="button" onClick={restart}>
                Try again
              </button>
            </div>
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section className="history">
          <h2>Your recent results</h2>
          <ul>
            {history.slice(0, 5).map((h, i) => (
              <li key={i}>
                {h.date} - {h.wpm} WPM, {h.accuracy}% accuracy, {h.lines} lines
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer>
        Subtitles are fetched on demand and are not stored. Results are saved only in your browser.
      </footer>
    </main>
  );
}
