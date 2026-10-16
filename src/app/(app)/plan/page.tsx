"use client";

import { useState } from "react";
import { ClipboardList, Loader2, Phone, Printer, Quote, Sparkles } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { apiFetch, type ApiError } from "@/hooks/use-api";
import { getOrCreateClientId, usePlace, usePrefs } from "@/hooks/use-local-state";
import { SharePlan } from "@/components/shared/share-plan";
import { HOUSEHOLD_KEY } from "@/components/dashboard/action-center";
import { DataModeBadge, EmptyState, ErrorState, NeedsPlace, PageHeader, SourceLink } from "@/components/shared/status";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Select } from "@/components/ui/primitives";
import type { DataMode, VerifiedAdvisory, VerifiedShelter } from "@/lib/core/types";

interface Plan {
  generatedAt: string;
  language: "en" | "hi";
  alertFeed: { dataMode: DataMode; retrievedAt: string | null; sourceUrl: string };
  officialInstructions: { alertId: string; issuer: string; headline: string; instruction: string; capUrl: string; expiresAt: string | null }[];
  activeHazards: string[];
  contacts: { label: string; phone: string; sourceUrl: string; evidenceQuote: string | null; kind: "NATIONAL" | "VERIFIED_DISTRICT" }[];
  shelters: VerifiedShelter[];
  advisories: VerifiedAdvisory[];
  checklist: { text: string; reason: string | null }[];
  checklistSource: "AI_GENERATED" | "ANVIL_TEMPLATE";
  researchTaskId: string | null;
  researchFinishedAt: string | null;
  disclaimer: string;
}

const T = {
  en: { official: "Official instructions", contacts: "Emergency contacts", shelters: "Documented shelters", checklist: "Your household checklist", advisories: "Advisories from official pages" },
  hi: { official: "आधिकारिक निर्देश", contacts: "आपातकालीन संपर्क", shelters: "दर्ज आश्रय स्थल", checklist: "आपके परिवार की चेकलिस्ट", advisories: "आधिकारिक पृष्ठों से सलाह" },
};

export default function PlanPage() {
  const [place] = usePlace();
  const [prefs] = usePrefs();
  const [language, setLanguage] = useState<"en" | "hi">(prefs.language);
  const [household, setHousehold] = useState({ members: 4, children: 0, elderly: 0, mobilityNeeds: false, medicalNeeds: false, pets: false });
  const [save, setSave] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!place) {
    return (
      <>
        <PageHeader title="Safety action plan" />
        <NeedsPlace what="Your safety plan" />
      </>
    );
  }

  const generate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Lets the dashboard's next-steps panel tailor actions to this household (kept in this browser only).
      localStorage.setItem(HOUSEHOLD_KEY, JSON.stringify(household));
    } catch {
      /* storage blocked */
    }
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch<{ plan: Plan }>("/api/plans", {
        method: "POST",
        timeoutMs: 60_000,
        body: JSON.stringify({
          place: { label: place.label, district: place.district, state: place.state },
          household,
          language,
          ...(save ? { clientId: getOrCreateClientId() } : {}),
        }),
      });
      setPlan(r.plan);
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setLoading(false);
    }
  };

  const num = (k: "members" | "children" | "elderly", min: number) => (
    <div className="space-y-1">
      <Label htmlFor={k}>{k === "members" ? "People in household" : k === "children" ? "Children" : "Elderly (65+)"}</Label>
      <Input id={k} type="number" inputMode="numeric" min={min} max={20} value={household[k]} onChange={(e) => setHousehold((h) => ({ ...h, [k]: Math.max(min, Math.min(20, Number(e.target.value) || min)) }))} />
    </div>
  );
  const check = (k: "mobilityNeeds" | "medicalNeeds" | "pets", label: string) => (
    <label className="flex min-h-10 items-center gap-2 text-sm">
      <input type="checkbox" className="size-4" checked={household[k]} onChange={(e) => setHousehold((h) => ({ ...h, [k]: e.target.checked }))} />
      {label}
    </label>
  );
  const t = T[plan?.language ?? language];

  return (
    <>
      <PageHeader
        title="Safety action plan"
        description="Official instructions first, verified local contacts next, then a clearly labelled checklist for your household. Available in English and Hindi."
        actions={
          plan ? (
            <>
              <SharePlan plan={plan} placeLabel={place.label} />
              <Button variant="outline" size="sm" onClick={() => window.print()}><Printer /> Print</Button>
            </>
          ) : null
        }
      />

      <Card className="mb-4 print:hidden">
        <CardContent className="pt-5">
          <form onSubmit={generate} className="grid gap-3 sm:grid-cols-3">
            {num("members", 1)}
            {num("children", 0)}
            {num("elderly", 0)}
            {check("mobilityNeeds", "Someone has limited mobility")}
            {check("medicalNeeds", "Someone needs regular medicine")}
            {check("pets", "Pets")}
            <div className="space-y-1">
              <Label htmlFor="lang">Language / भाषा</Label>
              <Select id="lang" value={language} onChange={(e) => setLanguage(e.target.value as "en" | "hi")}>
                <option value="en">English</option>
                <option value="hi">हिन्दी (Hindi)</option>
              </Select>
            </div>
            <label className="flex min-h-10 items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="size-4" checked={save} onChange={(e) => setSave(e.target.checked)} />
              Save this plan to my anonymous device ID (kept 90 days; delete anytime in Settings)
            </label>
            <Button type="submit" disabled={loading} className="sm:col-span-3 sm:w-fit">
              {loading ? <Loader2 className="animate-spin" /> : <ClipboardList />} Generate plan for {place.label}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error ? <ErrorState message={error} /> : null}
      {!plan && !loading ? (
        <EmptyState icon={ClipboardList} title="No plan yet">Fill in your household details and generate a plan.</EmptyState>
      ) : null}

      {plan ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <DataModeBadge mode={plan.alertFeed.dataMode} at={plan.alertFeed.retrievedAt} />
            <span>Generated {formatDateTime(plan.generatedAt)}</span>
            {plan.researchFinishedAt ? <span>· local research from {formatDateTime(plan.researchFinishedAt)}</span> : <span>· no local research yet — run the research agent for district contacts</span>}
          </div>

          <Card className="border-2 border-primary/40">
            <CardHeader>
              <CardTitle>1 · {t.official}</CardTitle>
              <CardDescription>Verbatim from active CAP alerts. These take priority over everything else on this page.</CardDescription>
            </CardHeader>
            <CardContent>
              {plan.officialInstructions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active official alert for your area includes specific instructions right now.</p>
              ) : (
                <ul className="space-y-3">
                  {plan.officialInstructions.map((o) => (
                    <li key={o.alertId} className="rounded-md bg-muted p-3 text-sm">
                      <p className="font-medium">{o.instruction}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{o.issuer} — {o.headline}</p>
                      <SourceLink href={o.capUrl}>Official CAP record</SourceLink>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2 · {t.contacts}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {plan.contacts.map((c, i) => (
                  <li key={i} className="flex flex-col gap-1 rounded-md border p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">{c.label}</p>
                      {c.evidenceQuote ? <p className="flex gap-1 text-xs text-muted-foreground"><Quote className="size-3 shrink-0" />{c.evidenceQuote}</p> : null}
                      <SourceLink href={c.sourceUrl} />
                    </div>
                    <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 font-semibold text-primary">
                      <Phone className="size-4" /> {c.phone}
                    </a>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {plan.shelters.length || plan.advisories.length ? (
            <Card>
              <CardHeader>
                <CardTitle>3 · {t.shelters} &amp; {t.advisories}</CardTitle>
                <CardDescription>Documented on official pages. Availability is not verified — confirm with the control room.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {plan.shelters.map((s, i) => (
                  <div key={`s${i}`} className="rounded-md border p-3">
                    <p className="font-medium">{s.name}</p>
                    {s.address ? <p className="text-xs text-muted-foreground">{s.address}</p> : null}
                    <SourceLink href={s.evidence.sourceUrl} />
                  </div>
                ))}
                {plan.advisories.map((a, i) => (
                  <div key={`a${i}`} className="rounded-md border p-3">
                    <p>{a.text}</p>
                    <SourceLink href={a.evidence.sourceUrl} />
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>4 · {t.checklist}</CardTitle>
                {plan.checklistSource === "AI_GENERATED" ? (
                  <Badge tone="warning"><Sparkles className="size-3" /> AI-generated — not an official instruction</Badge>
                ) : (
                  <Badge>ANVIL general guidance — not an official instruction</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {plan.checklist.map((c, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <input type="checkbox" className="mt-0.5 size-4 shrink-0" aria-label={c.text} />
                    <span>
                      {c.text}
                      {c.reason ? <span className="block text-xs text-muted-foreground">{c.reason}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <p className="rounded-md border border-danger/40 bg-danger-soft p-3 text-sm">{plan.disclaimer}</p>
        </div>
      ) : null}
    </>
  );
}