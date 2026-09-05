// Classes Tailwind partagées pour une identité visuelle cohérente (blanc / beige / noir).
export const card = "rounded-2xl border border-line bg-paper p-6 shadow-sm";
// active:scale + transition-transform : un léger tassement au tap, comme un vrai bouton qu'on
// enfonce — les boutons web qui ne réagissent qu'au survol (inutile au doigt) sont un autre indice
// qu'on est sur un site plutôt que dans une appli.
export const buttonPrimary =
  "inline-flex items-center justify-center rounded-xl bg-accent px-5 py-2.5 font-bold text-paper transition-[background-color,transform] hover:bg-accent-hover active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100";
export const buttonSecondary =
  "inline-flex items-center justify-center rounded-xl border-2 border-ink bg-paper px-5 py-2.5 font-bold text-ink transition-[background-color,transform] hover:bg-cream active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100";
export const input =
  "w-full rounded-xl border-2 border-line bg-paper px-3 py-2 text-ink placeholder:text-mute focus:border-ink focus:outline-none";
// Pas de soulignement : un lien souligné se lit comme du texte de site web, pas comme un contrôle
// d'appli — la couleur + le poids suffisent à signaler que c'est cliquable.
export const link = "font-bold text-accent hover:text-accent-hover";
export const linkMuted = "font-bold text-mute hover:text-ink";
export const bannerWarn = "rounded-2xl border-2 border-warn-text bg-warn-bg px-4 py-3 text-sm text-warn-text";
export const bannerNeutral = "rounded-2xl border border-line bg-paper px-4 py-3 text-sm text-mute";
export const listCard = "divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper";
