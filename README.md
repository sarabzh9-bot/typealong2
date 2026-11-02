# TypeAlong

Practice typing by typing along with YouTube videos that have subtitles.
The video plays one subtitle line, then pauses until you finish typing it.

- Next.js (App Router), no database, no paid services.
- Subtitles are fetched by `/api/transcript` (uses the `youtube-transcript` package) and cleaned up
  (sound labels removed, short lines merged, long lines split).
- Fallback: upload your own `.srt` / `.vtt` file.
- Results are stored only in the browser (`localStorage`).

## Run locally

Requires Node.js 18+.

```bash
npm install
npm run dev
```

Open http://localhost:3000, paste a YouTube link (the video must have subtitles in the language code
you enter, e.g. `en`), and press Start.

Run the logic tests (subtitle parsing, typing checks, WPM):

```bash
npm test
```

## Deploy for free (Vercel)

1. Push this folder to a new GitHub repository.
2. On vercel.com, sign in with GitHub, click **Add New > Project**, pick the repository, click **Deploy**.
3. Open the `.vercel.app` URL and test several videos.

## Controls

- Type the highlighted line. Green = correct, red = wrong. The next line starts automatically.
- `Ctrl+Enter` (or `Cmd+Enter`) replays the current line.
- **Relaxed mode** ignores capital letters and accents. Turn it off for strict typing.

## If videos stop loading

Subtitle fetching relies on an unofficial method, which YouTube can change at any time.
Usually the fix is:

```bash
npm update youtube-transcript
```

then redeploy. Uploading an `.srt` / `.vtt` file always works as a fallback.
