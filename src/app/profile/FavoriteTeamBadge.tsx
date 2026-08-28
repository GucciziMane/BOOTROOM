import Image from "next/image";

/** Petit blason du club favori, en overlay sur un avatar rond. */
export function FavoriteTeamBadge({ logoUrl, size }: { logoUrl: string | null; size: number }) {
  if (!logoUrl) return null;
  return (
    <span
      className="absolute bottom-0 right-0 flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-paper bg-paper"
      style={{ width: size, height: size }}
    >
      <Image src={logoUrl} alt="" fill sizes={`${size}px`} className="object-contain" />
    </span>
  );
}
