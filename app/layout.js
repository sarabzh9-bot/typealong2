import './globals.css';

export const metadata = {
  title: 'TypeAlong - practice typing with YouTube subtitles',
  description:
    'Improve your typing and listening by typing along with any YouTube video that has subtitles. The video pauses until you finish each line.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
