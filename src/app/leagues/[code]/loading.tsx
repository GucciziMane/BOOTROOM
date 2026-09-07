import { BackLink } from "@/app/BackLink";
import { card } from "@/lib/ui";
import { SkeletonText, SkeletonTitle } from "@/lib/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <SkeletonTitle />
        <BackLink href="/leagues" />
      </div>

      <div className={`space-y-6 ${card}`}>
        <SkeletonText lines={3} />
        <SkeletonText lines={3} />
        <SkeletonText lines={2} />
      </div>
    </main>
  );
}
