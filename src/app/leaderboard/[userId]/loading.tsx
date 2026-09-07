import { BackLink } from "@/app/BackLink";
import { SkeletonMatchCard, SkeletonTitle } from "@/lib/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-6">
      <div className="mb-6 flex items-center justify-between">
        <SkeletonTitle width="w-56" />
        <BackLink href="/leaderboard">Retour au classement</BackLink>
      </div>

      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonMatchCard key={i} />
        ))}
      </div>
    </main>
  );
}
