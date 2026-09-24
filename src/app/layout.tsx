import type { Metadata, Viewport } from 'next';
import './globals.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: 'Web Audio Step Sequencer & Soundboard',
  description: 'Hardware synthesizer style step-sequencer and soundboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-[100dvh] antialiased selection:bg-cyan-500/20">
        {children}
      </body>
    </html>
  );
}
