// Icône "ballon d'or" (ballon à facettes doré + rayons de lumière), inspirée du logo officiel
// sans le reproduire à l'identique — dessinée en SVG plutôt qu'importée en image, pour rester
// aussi nette à 24px (nav) qu'à 64px (en-tête de page) et suivre le thème doré déjà établi
// (--color-reward, voir globals.css) au lieu d'une palette propre à cette icône.
export function BallonDorIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="bdor-gold" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fff2b0" />
          <stop offset="45%" stopColor="#e8a600" />
          <stop offset="100%" stopColor="#8a6205" />
        </linearGradient>
      </defs>
      {/* Rayons */}
      <g stroke="url(#bdor-gold)" strokeWidth="2" strokeLinecap="round">
        <path d="M32 2v8" />
        <path d="M22 4l2 8" />
        <path d="M42 4l-2 8" />
        <path d="M14 9l3.5 7" />
        <path d="M50 9l-3.5 7" />
        <path d="M32 62v-8" />
        <path d="M22 60l2-8" />
        <path d="M42 60l-2-8" />
      </g>
      {/* Ballon */}
      <circle cx="32" cy="32" r="17" fill="url(#bdor-gold)" />
      <g stroke="#5c4204" strokeWidth="1.1" strokeLinejoin="round" fill="none" opacity="0.55">
        <path d="M32 20l7 5-2.7 8h-8.6L25 25z" />
        <path d="M32 20V15.5M39 25l4.5-2.8M25 25l-4.5-2.8M28.7 33h-9M35.3 33h9M28.7 33l-3 7.5M35.3 33l3 7.5" />
      </g>
    </svg>
  );
}
