import { BackLink } from "@/app/BackLink";
import { SkeletonList, SkeletonText } from "@/lib/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Classement général</h1>
        <BackLink href="/" />
      </div>

      <div className="mb-4">
        <SkeletonText lines={2} />
      </div>

      <SkeletonList count={10} />
    </main>
  );
}
