// Pure typing-comparison and scoring helpers.

/** In relaxed mode, ignore case and accents (e -> é, A -> a). */
export function normChar(c, relaxed) {
  if (!relaxed) return c;
  return c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function charsMatch(a, b, relaxed) {
  return normChar(a, relaxed) === normChar(b, relaxed);
}

/**
 * Compare what was typed with the target line.
 * Returns per-character states ('ok' | 'bad' | 'todo'), the number of correct
 * characters, and whether the line is complete (same length, all correct).
 */
export function compareLine(target, typed, relaxed = false) {
  const states = new Array(target.length);
  let correct = 0;
  for (let i = 0; i < target.length; i++) {
    if (i >= typed.length) {
      states[i] = 'todo';
    } else if (charsMatch(typed[i], target[i], relaxed)) {
      states[i] = 'ok';
      correct++;
    } else {
      states[i] = 'bad';
    }
  }
  const extra = Math.max(0, typed.length - target.length);
  const complete = target.length > 0 && typed.length === target.length && correct === target.length;
  return { states, correct, extra, complete };
}

/** Count newly typed characters (and how many were right) between two input values. */
export function countNewKeystrokes(prev, next, target, relaxed = false) {
  if (next.length <= prev.length) return { typed: 0, correct: 0 };
  let correct = 0;
  for (let i = prev.length; i < next.length; i++) {
    if (i < target.length && charsMatch(next[i], target[i], relaxed)) correct++;
  }
  return { typed: next.length - prev.length, correct };
}

/** Standard WPM: 5 characters = 1 word. Returns 0 until there is enough time to be meaningful. */
export function wpm(correctChars, ms) {
  if (!ms || ms < 1500) return 0;
  return Math.round(correctChars / 5 / (ms / 60000));
}

export function accuracy(correct, typed) {
  if (!typed) return 100;
  return Math.round((correct / typed) * 100);
}

export function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
