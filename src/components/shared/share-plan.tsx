"use client";

import { useState } from "react";
import { Check, Copy, MessageCircle, Share2 } from "lucide-react";
import { Button } from "@/components/ui/primitives";

export interface ShareablePlan {
  language: "en" | "hi";
  officialInstructions: { issuer: string; instruction: string; capUrl: string }[];
  contacts: { label: string; phone: string }[];
  shelters: { name: string; address: string | null; evidence: { sourceUrl: string } }[];
  checklist: { text: string }[];
  checklistSource: "AI_GENERATED" | "ANVIL_TEMPLATE";
  disclaimer: string;
}

/** Plain-text version of the plan, short enough for WhatsApp/SMS, with source links kept. */
export function planToText(plan: ShareablePlan, placeLabel: string): string {
  const hi = plan.language === "hi";
  const L = hi
    ? { title: "सुरक्षा योजना", official: "आधिकारिक निर्देश", contacts: "आपातकालीन संपर्क", shelters: "आश्रय स्थल (उपलब्धता की पुष्टि करें)", checklist: "चेकलिस्ट", ai: "(AI द्वारा बनाई गई — आधिकारिक निर्देश नहीं)" }
    : { title: "Safety plan", official: "Official instructions", contacts: "Emergency contacts", shelters: "Documented shelters (confirm availability)", checklist: "Checklist", ai: "(AI-generated — not an official instruction)" };
  const lines: string[] = [`*ANVIL ${L.title} — ${placeLabel}*`, ""];
  if (plan.officialInstructions.length) {
    lines.push(`*${L.official}*`);
    plan.officialInstructions.slice(0, 3).forEach((o) => lines.push(`• ${o.instruction} (${o.issuer}) ${o.capUrl}`));
    lines.push("");
  }
  lines.push(`*${L.contacts}*`);
  plan.contacts.slice(0, 5).forEach((c) => lines.push(`• ${c.label}: ${c.phone}`));
  lines.push("");
  if (plan.shelters.length) {
    lines.push(`*${L.shelters}*`);
    plan.shelters.slice(0, 3).forEach((s) => lines.push(`• ${s.name}${s.address ? `, ${s.address}` : ""} ${s.evidence.sourceUrl}`));
    lines.push("");
  }
  lines.push(`*${L.checklist}* ${plan.checklistSource === "AI_GENERATED" ? L.ai : ""}`.trim());
  plan.checklist.slice(0, 8).forEach((c) => lines.push(`☐ ${c.text}`));
  lines.push("", plan.disclaimer);
  return lines.join("\n");
}

export function SharePlan({ plan, placeLabel }: { plan: ShareablePlan; placeLabel: string }) {
  const [copied, setCopied] = useState(false);
  const text = planToText(plan, placeLabel);
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <>
      <a
        href={`https://wa.me/?text=${encodeURIComponent(text)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-9 min-h-9 items-center gap-2 rounded-md bg-[#25D366] px-3 text-xs font-medium text-white hover:opacity-90"
      >
        <MessageCircle className="size-4" /> WhatsApp
      </a>
      {canNativeShare ? (
        <Button size="sm" variant="outline" onClick={() => navigator.share({ title: `ANVIL safety plan — ${placeLabel}`, text }).catch(() => undefined)}>
          <Share2 /> Share
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            /* clipboard blocked */
          }
        }}
      >
        {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
      </Button>
    </>
  );
}