import { BackLink } from "@/app/BackLink";
import { card } from "@/lib/ui";
import { SkeletonText } from "@/lib/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Quiz du jour 🧠</h1>
        <BackLink href="/" />
      </div>

      <div className={`space-y-4 ${card}`}>
        <SkeletonText lines={2} />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-11 w-full animate-pulse rounded-xl bg-cream" />
          ))}
        </div>
      </div>
    </main>
  );
}
