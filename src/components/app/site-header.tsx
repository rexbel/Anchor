"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Anchor as AnchorIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/call", label: "Live call" },
  { href: "/clinician", label: "Clinician queue" },
  { href: "/audit", label: "Audit log" },
  { href: "/how-it-works", label: "How it works" },
];

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#111] text-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-md bg-brand text-brand-foreground">
            <AnchorIcon className="size-4" aria-hidden />
          </span>
          Anchor
        </Link>
        <nav aria-label="Primary" className="-mx-2 flex items-center gap-1 overflow-x-auto text-sm">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
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
  );
}
