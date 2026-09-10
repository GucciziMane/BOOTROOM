import { BackLink } from "@/app/BackLink";

function Bubble({ mine = false, widthPct }: { mine?: boolean; widthPct: number }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"} px-4`}>
      <div
        className={`h-10 animate-pulse rounded-2xl ${mine ? "bg-accent-soft" : "bg-cream"}`}
        style={{ width: `${widthPct}%` }}
      />
    </div>
  );
}

const BUBBLES: Array<{ mine: boolean; widthPct: number }> = [
  { mine: false, widthPct: 45 },
  { mine: true, widthPct: 35 },
  { mine: false, widthPct: 55 },
  { mine: false, widthPct: 40 },
  { mine: true, widthPct: 30 },
  { mine: false, widthPct: 50 },
];

export default function Loading() {
  return (
    <main className="mx-auto flex h-[calc(100dvh-4.75rem-env(safe-area-inset-bottom))] w-full max-w-2xl flex-col overflow-hidden p-6 lg:h-dvh">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <h1 className="text-3xl font-bold">3ème mi-temps 🍻</h1>
        <BackLink href="/" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-hidden rounded-[28px] bg-surface/60 py-4">
        {BUBBLES.map((b, i) => (
          <Bubble key={i} mine={b.mine} widthPct={b.widthPct} />
        ))}
      </div>
    </main>
  );
}
