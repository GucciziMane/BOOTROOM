import { BackLink } from "@/app/BackLink";
import { SkeletonList, SkeletonText, SkeletonTitle } from "@/lib/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <SkeletonTitle />
        <BackLink href="/calendar/classements" />
      </div>

      <div className="mb-4">
        <SkeletonText lines={2} />
      </div>

      <SkeletonList count={8} avatar={false} />
    </main>
  );
}
