export default function Loading() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
      <div className="relative h-56 w-48">
        <div
          className="loading-goal absolute left-1/2 top-0 h-28 w-40 -translate-x-1/2 rounded-t-lg border-4 border-ink"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(16,24,42,0.15) 0 1px, transparent 1px 11px), repeating-linear-gradient(90deg, rgba(16,24,42,0.15) 0 1px, transparent 1px 11px)",
          }}
        />
        <span className="loading-ball absolute bottom-0 left-1/2 text-4xl">⚽</span>
      </div>
      <div className="flex flex-col items-center gap-3">
        <p className="text-xl font-bold text-ink">Boot Room</p>
        <div className="flex gap-1.5">
          <span className="h-2 w-2 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-accent" />
        </div>
      </div>
    </div>
  );
}
