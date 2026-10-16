import type { Metadata, Viewport } from "next";
import { Archivo, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";

// Archivo's width axis gives condensed numerals/headlines without a monospace face.
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const devanagari = Noto_Sans_Devanagari({ subsets: ["devanagari"], weight: ["400", "600"], variable: "--font-devanagari", display: "swap" });

export const metadata: Metadata = {
  title: { default: "ANVIL AI — Predict. Protect. Respond. Recover.", template: "%s · ANVIL AI" },
  description:
    "Location-aware disaster intelligence for India: official SACHET/IMD/CWC alerts, evidence-backed research, documented shelters and preparedness plans.",
  applicationName: "ANVIL AI",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0f1626" },
    { media: "(prefers-color-scheme: light)", color: "#f7f9fc" },
  ],
};

// Applies saved theme/accessibility classes before first paint (no flash). Static string, no user input.
const PREFS_BOOTSTRAP = `try{var p=JSON.parse(localStorage.getItem("anvil.prefs.v1")||"{}");var r=document.documentElement;if(p.theme!=="light")r.classList.add("dark");if(p.largeText)r.classList.add("large-text");if(p.reducedMotion)r.classList.add("reduce-motion");}catch(e){document.documentElement.classList.add("dark")}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${archivo.variable} ${devanagari.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFS_BOOTSTRAP }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}