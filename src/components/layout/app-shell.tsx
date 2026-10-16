"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  BellRing,
  Bot,
  ClipboardList,
  FlaskConical,
  Gauge,
  Globe2,
  HeartHandshake,
  Hospital,
  Mountain,
  Radar,
  House,
  Map as MapIcon,
  MapPin,
  Menu,
  MessagesSquare,
  Moon,
  Search,
  Settings,
  Sun,
  TriangleAlert,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlace, usePrefs } from "@/hooks/use-local-state";
import { AlertWatcher } from "./alert-watcher";
import { CommandPalette, type PaletteItem } from "./command-palette";
import { LiveTicker } from "./live-ticker";

const NAV_GROUPS = [
  {
    title: "Situation",
    items: [
      { href: "/dashboard", label: "Command center", icon: Gauge, keywords: "home overview my district" },
      { href: "/national", label: "National situation room", icon: Globe2, keywords: "india states all" },
      { href: "/alerts", label: "Live alerts", icon: TriangleAlert, keywords: "warnings sachet imd cwc" },
      { href: "/map", label: "Map & routes", icon: MapIcon, keywords: "route navigation hazard" },
      { href: "/map3d", label: "3D disaster map", icon: Mountain, keywords: "3d terrain buildings digital twin flood scenario exposure" },
      { href: "/research", label: "Live research agent", icon: Radar, keywords: "tinyfish imd cwc ndma report monitor" },
    ],
  },
  {
    title: "Plan & act",
    items: [
      { href: "/ask", label: "Ask ANVIL", icon: MessagesSquare, keywords: "question voice hindi chat" },
      { href: "/plan", label: "Safety plan", icon: ClipboardList, keywords: "checklist household whatsapp" },
      { href: "/nearby", label: "Nearby help", icon: Hospital, keywords: "hospital shelter police fire relief near me" },
      { href: "/shelters", label: "Shelters", icon: House, keywords: "relief camp evacuation" },
      { href: "/agent", label: "Shelter & contact research", icon: Bot, keywords: "tinyfish verify contacts shelters" },
      { href: "/simulator", label: "What-if simulator", icon: FlaskConical, keywords: "scenario closure demand" },
    ],
  },
  {
    title: "Your circle",
    items: [
      { href: "/watch", label: "Smart alerts", icon: BellRing, keywords: "geofence notify watch area" },
      { href: "/family", label: "Family check-in", icon: HeartHandshake, keywords: "safe status group" },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/settings", label: "Settings & privacy", icon: Settings, keywords: "theme language delete data" },
      { href: "/admin", label: "Source health", icon: Activity, keywords: "status api sources" },
    ],
  },
] as const;

/** The anvil mark: a simple silhouette, drawn inline so it needs no image request. */
function AnvilMark() {
  return (
    <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <path d="M6 11h17c0 2.8 1.6 4.4 3 5v1h-6l-1.5 3H21v3H11v-3h2.5L12 17H9c-1.7 0-3-1.3-3-3z" fill="var(--primary-foreground)" />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [place] = usePlace();
  const [prefs, setPrefs] = usePrefs();

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", prefs.theme === "dark");
    root.classList.toggle("large-text", prefs.largeText);
    root.classList.toggle("reduce-motion", prefs.reducedMotion);
    root.lang = prefs.language === "hi" ? "hi" : "en";
  }, [prefs]);

  const paletteItems = useMemo<PaletteItem[]>(
    () => [
      ...NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ id: i.href, label: i.label, group: "Go to", href: i.href, icon: i.icon, keywords: i.keywords }))),
      { id: "loc", label: "Change my location", group: "Actions", href: "/onboarding", icon: MapPin, keywords: "district gps" },
      { id: "theme", label: `Switch to ${prefs.theme === "dark" ? "light" : "dark"} theme`, group: "Actions", icon: prefs.theme === "dark" ? Sun : Moon, action: () => setPrefs({ theme: prefs.theme === "dark" ? "light" : "dark" }) },
      { id: "lang", label: prefs.language === "hi" ? "Use English for plans and answers" : "हिन्दी में योजना और उत्तर", group: "Actions", keywords: "hindi language", action: () => setPrefs({ language: prefs.language === "hi" ? "en" : "hi" }) },
    ],
    [prefs.theme, prefs.language, setPrefs],
  );

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-card focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 bg-background/85 backdrop-blur-md">
        <div className="flex h-14 items-center gap-3 border-b px-3 sm:px-5">
          <button className="rounded-md p-2 hover:bg-muted lg:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <Link href="/" className="flex items-center gap-2">
            <AnvilMark />
            <span className="text-lg font-extrabold" style={{ fontStretch: "80%" }}>ANVIL</span>
          </Link>
          <button
            onClick={() => setPalette(true)}
            className="ml-2 hidden h-9 min-w-[260px] items-center gap-2 rounded-md border bg-panel px-3 text-sm text-muted-foreground hover:bg-muted md:flex"
            aria-label="Open command palette"
          >
            <Search className="size-4" /> Jump to a screen or action
            <kbd className="ml-auto rounded border px-1.5 text-[10px]">Ctrl K</kbd>
          </button>
          <Link href="/onboarding" className="ml-auto flex min-w-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs hover:bg-muted" title="Change location">
            <MapPin className="size-3.5 shrink-0 text-primary" aria-hidden />
            <span className="truncate">{place ? place.label : "Set location"}</span>
            {place?.source === "demo" ? <span className="text-sim">(preset)</span> : null}
          </Link>
          <button className="rounded-md p-2 hover:bg-muted md:hidden" aria-label="Open command palette" onClick={() => setPalette(true)}>
            <Search className="size-4" />
          </button>
          <button
            className="rounded-md p-2 hover:bg-muted"
            aria-label={`Switch to ${prefs.theme === "dark" ? "light" : "dark"} theme`}
            onClick={() => setPrefs({ theme: prefs.theme === "dark" ? "light" : "dark" })}
          >
            {prefs.theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <Link href="/watch" className="rounded-md p-2 hover:bg-muted" aria-label="Smart alerts and notifications">
            <Bell className={cn("size-4", prefs.notifications && "text-primary")} />
          </Link>
        </div>
        <LiveTicker />
      </header>
      <div className="flex">
        <nav
          aria-label="Main"
          className={cn(
            "fixed inset-x-0 top-[5.5rem] z-30 max-h-[calc(100dvh-5.5rem)] overflow-auto border-b bg-background p-3 lg:sticky lg:top-[5.5rem] lg:block lg:h-[calc(100dvh-5.5rem)] lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r",
            open ? "block" : "hidden",
          )}
        >
          {NAV_GROUPS.map((g) => (
            <div key={g.title} className="mb-3">
              <p className="px-3 pb-1 text-[11px] font-semibold text-muted-foreground">{g.title}</p>
              <ul className="grid grid-cols-2 gap-0.5 lg:grid-cols-1">
                {g.items.map(({ href, label, icon: Icon }) => {
                  const active = pathname === href || pathname.startsWith(`${href}/`);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "relative flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted",
                          active && "bg-muted font-semibold text-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded before:bg-primary",
                        )}
                      >
                        <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
                        {label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <a href="tel:112" className="mx-1 mt-2 hidden items-center justify-between rounded-md border border-danger/50 bg-danger-soft px-3 py-2 text-sm font-semibold text-danger lg:flex">
            Emergency <span className="num text-lg">112</span>
          </a>
        </nav>
        <main id="main" className="min-w-0 flex-1 px-3 py-5 sm:px-6">
          {children}
        </main>
      </div>
      <CommandPalette items={paletteItems} open={palette} onOpenChange={setPalette} />
      <AlertWatcher />
    </div>
  );
}