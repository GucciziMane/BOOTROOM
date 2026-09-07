function SkeletonNavCard() {
  return (
    <div className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-line bg-paper p-6 lg:min-h-[200px] lg:p-8">
      <div className="h-6 w-2/3 animate-pulse rounded-lg bg-cream" />
      <div className="h-3 w-full animate-pulse rounded-lg bg-cream" />
      <div className="h-3 w-4/5 animate-pulse rounded-lg bg-cream" />
    </div>
  );
}

export default function Loading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-1 flex-col p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Boot Room</h1>
        <div className="h-16 w-16 animate-pulse rounded-full bg-cream" />
      </div>

      <div className="mt-3 h-6 w-40 animate-pulse rounded-lg bg-cream" />

      <div className="flex flex-1 items-center justify-center">
        <div className="grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonNavCard key={i} />
          ))}
        </div>
      </div>
    </main>
  );
}
