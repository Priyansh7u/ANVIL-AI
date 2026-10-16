"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/national", label: "National picture" },
  { href: "/map3d", label: "3D map" },
  { href: "/research", label: "Research" },
  { href: "/dashboard", label: "Command center" },
];

/** Transparent over the hero, solid once the page moves. */
export function LandingHeader() {
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 40);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header className={cn("fixed inset-x-0 top-0 z-50 transition-colors duration-300", solid || open ? "bg-[#0d1a26]/90 backdrop-blur-md" : "bg-transparent")}>
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 text-[#edf1ee] sm:px-10">
        <Link href="/" className="flex items-center gap-2" aria-label="ANVIL home">
          <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
            <rect width="32" height="32" rx="8" fill="#f0a33a" />
            <path d="M6 11h17c0 2.8 1.6 4.4 3 5v1h-6l-1.5 3H21v3H11v-3h2.5L12 17H9c-1.7 0-3-1.3-3-3z" fill="#0d1a26" />
          </svg>
          <span className="text-xl font-extrabold" style={{ fontStretch: "75%" }}>ANVIL</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm md:flex" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="landing-nav-link">{l.label}</Link>
          ))}
        </nav>
        <button type="button" className="rounded-md p-2 md:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      <div className={cn("grid overflow-hidden transition-[grid-template-rows] duration-300 md:hidden motion-reduce:transition-none", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <nav className="min-h-0" aria-label="Mobile">
          <ul className="space-y-1 px-5 pb-5">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="block rounded-lg px-3 py-2.5 text-[#edf1ee] hover:bg-white/10" onClick={() => setOpen(false)}>{l.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}