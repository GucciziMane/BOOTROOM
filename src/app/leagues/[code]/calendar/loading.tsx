import { BackLink } from "@/app/BackLink";
import { SkeletonMatchCardGrid, SkeletonTitle } from "@/lib/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <SkeletonTitle width="w-64" />
        <BackLink href="/calendar" />
      </div>

      <SkeletonMatchCardGrid count={4} />
    </main>
  );
}
