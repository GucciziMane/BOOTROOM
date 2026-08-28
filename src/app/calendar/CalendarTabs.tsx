import Link from "next/link";

export function CalendarTabs({ active }: { active: "leagues" | "next" }) {
  const tabs = [
    { href: "/calendar", label: "Championnats", key: "leagues" as const },
    { href: "/calendar/next", label: "Prochaine journée", key: "next" as const },
  ];

  return (
    <div className="mb-6 flex gap-4 border-b border-line">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`-mb-px border-b-2 px-1 py-2 text-sm font-bold ${
            active === tab.key ? "border-ink text-ink" : "border-transparent text-mute hover:text-ink"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
