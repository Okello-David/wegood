"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Board", icon: "🏠" },
  { href: "/stuff", label: "Home Stuff", icon: "🛒" },
  { href: "/requests", label: "Requests", icon: "🙋" },
  { href: "/me", label: "Me", icon: "😎" },
] as const;

// Fixed to the bottom where a thumb can reach it. The extra bottom padding
// keeps it clear of the iPhone home bar.
export default function BottomTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-amber-200 bg-amber-50/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${
                  active ? "text-stone-900" : "text-stone-500"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`text-2xl transition-transform ${active ? "scale-110" : "grayscale-[60%]"}`}
                >
                  {tab.icon}
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
