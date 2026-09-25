"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Anchor as AnchorIcon, Info, LayoutDashboard, Phone, ScrollText, Stethoscope } from "lucide-react";

import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", short: "Home", icon: LayoutDashboard },
  { href: "/call", label: "Live call", short: "Call", icon: Phone },
  { href: "/clinician", label: "Clinician queue", short: "Queue", icon: Stethoscope },
  { href: "/audit", label: "Audit log", short: "Audit", icon: ScrollText },
  { href: "/how-it-works", label: "How it works", short: "About", icon: Info },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#111] pt-[env(safe-area-inset-top)] text-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-md bg-brand text-brand-foreground">
              <AnchorIcon className="size-4" aria-hidden />
            </span>
            Anchor
          </Link>
          <nav aria-label="Primary" className="-mx-2 hidden items-center gap-1 text-sm sm:flex">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "whitespace-nowrap rounded-md px-2.5 py-1.5 text-white/70 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-brand",
                    active && "bg-white/10 text-white",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      {/* Phones get a bottom tab bar: five labels don't fit across a 375px header. */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#111] pb-[env(safe-area-inset-bottom)] text-white sm:hidden"
      >
        <ul className="grid grid-cols-5">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-14 flex-col items-center justify-center gap-0.5 text-xs text-white/60 outline-none transition-colors focus-visible:bg-white/10",
                    active && "text-white",
                  )}
                >
                  <Icon className={cn("size-5", active && "text-brand")} aria-hidden />
                  {item.short}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
