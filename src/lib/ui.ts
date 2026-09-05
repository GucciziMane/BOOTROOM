// Classes Tailwind partagées pour une identité visuelle cohérente (blanc / beige / noir).
export const card = "rounded-2xl border border-line bg-paper p-6 shadow-sm";
export const buttonPrimary =
  "inline-flex items-center justify-center rounded-xl bg-accent px-5 py-2.5 font-bold text-paper transition-colors hover:bg-accent-hover disabled:opacity-50";
export const buttonSecondary =
  "inline-flex items-center justify-center rounded-xl border-2 border-ink bg-paper px-5 py-2.5 font-bold text-ink transition-colors hover:bg-cream disabled:opacity-50";
export const input =
  "w-full rounded-xl border-2 border-line bg-paper px-3 py-2 text-ink placeholder:text-mute focus:border-ink focus:outline-none";
// Pas de soulignement : un lien souligné se lit comme du texte de site web, pas comme un contrôle
// d'appli — la couleur + le poids suffisent à signaler que c'est cliquable.
export const link = "font-bold text-accent hover:text-accent-hover";
export const linkMuted = "font-bold text-mute hover:text-ink";
export const bannerWarn = "rounded-2xl border-2 border-warn-text bg-warn-bg px-4 py-3 text-sm text-warn-text";
export const bannerNeutral = "rounded-2xl border border-line bg-paper px-4 py-3 text-sm text-mute";
export const listCard = "divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper";
