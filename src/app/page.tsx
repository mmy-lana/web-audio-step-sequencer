'use client';

export default function HomePage() {
  return (
    <main className="min-h-[100dvh] bg-[#0b0d10] text-zinc-100 flex flex-col items-center justify-center p-4 pb-[calc(env(safe-area-inset-bottom)+5rem)]">
      <div className="w-full max-w-5xl rounded-lg border border-zinc-800 bg-[#14171d] p-6 shadow-2xl">
        <header className="mb-6 flex items-center justify-between border-b border-zinc-800/80 pb-4">
          <div>
            <h1 className="text-xl font-bold tracking-wider text-zinc-100 font-mono">
              W-AUDIO // MODEL-16
            </h1>
            <p className="text-xs text-zinc-400 font-mono">
              ANALOG-STYLE HARDWARE SEQUENCER & SOUNDBOARD
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
            <span className="font-mono text-xs text-zinc-400">STANDBY</span>
          </div>
        </header>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="font-mono text-sm text-zinc-400">
            HARDWARE CHASSIS INITIALIZED
          </p>
        </div>
      </div>
    </main>
  );
}
