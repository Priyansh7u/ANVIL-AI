"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Backpack, BellRing, ClipboardList, Loader2, Phone, Printer, Quote, RefreshCw, ShieldCheck, Sparkles, Timer, Users } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { goBagList, readinessScore } from "@/lib/core/readiness";
import { apiFetch, placeQuery, useApi, type ApiError } from "@/hooks/use-api";
import { getOrCreateClientId, usePlace, usePrefs } from "@/hooks/use-local-state";
import { useStored } from "@/hooks/use-stored";
import type { AlertsResponse } from "@/types/api";
import { HAZARD_LABEL } from "@/components/alerts/alert-card";
import { Drill, type DrillRecord } from "@/components/plan/drill";
import { cardComplete, EMPTY_CARD, FamilyCard, type FamilyCardData } from "@/components/plan/family-card";
import { GoBag } from "@/components/plan/go-bag";
import { ReadinessPanel } from "@/components/plan/readiness";
import { Tabs, tabPanelProps } from "@/components/shared/tabs";
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

type Household = { members: number; children: number; elderly: number; mobilityNeeds: boolean; medicalNeeds: boolean; pets: boolean };
type TabId = "plan" | "bag" | "family" | "drill";
const DEFAULT_HOUSEHOLD: Household = { members: 4, children: 0, elderly: 0, mobilityNeeds: false, medicalNeeds: false, pets: false };

export default function PlanPage() {
  const [place] = usePlace();
  const [prefs] = usePrefs();
  const [language, setLanguage] = useState<"en" | "hi">(prefs.language);
  const [save, setSave] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("plan");

  // Everything below lives only in this browser.
  const [household, setHousehold] = useStored<Household>("anvil.household.form.v1", DEFAULT_HOUSEHOLD);
  const [saved, setSaved] = useStored<{ placeLabel: string; plan: Plan; household: Household } | null>("anvil.plan.v1", null);
  const [ticks, setTicks] = useStored<{ key: string; done: number[] }>("anvil.plan.ticks.v1", { key: "", done: [] });
  const [bag, setBag] = useStored<{ days: number; packed: string[] }>("anvil.bag.v1", { days: 3, packed: [] });
  const [card, setCard] = useStored<FamilyCardData>("anvil.familycard.v1", EMPTY_CARD);
  const [drills, setDrills] = useStored<DrillRecord[]>("anvil.drills.v1", []);

  const plan = saved && place && saved.placeLabel === place.label ? saved.plan : null;

  // Live check: has an official alert arrived since this plan was made?
  const alerts = useApi<AlertsResponse>(place ? `/api/alerts?${placeQuery(place)}&scope=local` : null, { refreshMs: 3 * 60_000 });
  const newAlerts = useMemo(() => {
    if (!plan || !alerts.data) return [];
    const made = Date.parse(plan.generatedAt);
    return alerts.data.alerts.filter(
      (a) => a.freshness === "ACTIVE" && a.relevance !== "NONE" && ((a.issuedAt && Date.parse(a.issuedAt) > made) || (a.hazard !== "other" && !plan.activeHazards.includes(a.hazard))),
    );
  }, [plan, alerts.data]);

  const bagItems = useMemo(() => goBagList(household, bag.days), [household, bag.days]);
  const planKey = plan?.generatedAt ?? "";
  const doneTicks = ticks.key === planKey ? ticks.done : [];
  const readiness = readinessScore({
    checklistDone: plan ? doneTicks.filter((i) => i < plan.checklist.length).length : 0,
    checklistTotal: plan?.checklist.length ?? 0,
    bagDone: bagItems.filter((i) => bag.packed.includes(i.id)).length,
    bagTotal: bagItems.length,
    familyCardComplete: cardComplete(card),
    drillSeconds: drills.length ? Math.min(...drills.map((d) => d.seconds)) : null,
    planAgeHours: plan ? (Date.now() - Date.parse(plan.generatedAt)) / 3_600_000 : null,
    planOutdated: newAlerts.length > 0,
  });

  if (!place) {
    return (
      <>
        <PageHeader title="Safety action plan" />
        <NeedsPlace what="Your safety plan" />
      </>
    );
  }

  const generate = (e: React.FormEvent) => {
    e.preventDefault();
    void runGenerate();
  };

  async function runGenerate() {
    if (!place) return;
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
      setSaved({ placeLabel: place.label, plan: r.plan, household });
      setTicks({ key: r.plan.generatedAt, done: [] });
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setLoading(false);
    }
  }

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

      <div className="print:hidden">
        <ReadinessPanel
          result={readiness}
          status={
            plan ? (
              newAlerts.length ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-danger/50 bg-danger-soft px-3 py-2 text-sm text-danger" role="status">
                  <BellRing className="size-4" aria-hidden />
                  {newAlerts.length} new official alert{newAlerts.length === 1 ? "" : "s"} since your plan ({Array.from(new Set(newAlerts.map((a) => HAZARD_LABEL[a.hazard] ?? a.hazard))).join(", ")}).
                  <Button size="sm" variant="danger" className="ml-auto" disabled={loading} onClick={() => void runGenerate()}>
                    {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />} Update plan
                  </Button>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm text-ok" role="status">
                  <ShieldCheck className="size-4" aria-hidden /> Plan matches the live official feed{alerts.data ? ` · checked ${formatDateTime(alerts.data.retrievedAt ?? new Date().toISOString())}` : ""}
                </p>
              )
            ) : null
          }
        />
        <Tabs<TabId>
          label="Safety plan sections"
          value={tab}
          onChange={setTab}
          className="mb-4"
          items={[
            { id: "plan", label: "Action plan", icon: ClipboardList },
            { id: "bag", label: "Emergency bag", icon: Backpack, badge: <span className="num text-xs text-muted-foreground">{bagItems.filter((i) => bag.packed.includes(i.id)).length}/{bagItems.length}</span> },
            { id: "family", label: "Family card", icon: Users },
            { id: "drill", label: "Drill", icon: Timer },
          ]}
        />
      </div>

      <AnimatePresence mode="wait" initial={false}>
      <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }} {...tabPanelProps(tab)}>
      {tab === "bag" ? (
        <GoBag
          items={bagItems}
          packed={bag.packed}
          onToggle={(id) => setBag((b) => ({ ...b, packed: b.packed.includes(id) ? b.packed.filter((x) => x !== id) : [...b.packed, id] }))}
          onReset={() => setBag((b) => ({ ...b, packed: [] }))}
          days={bag.days}
          onDays={(d) => setBag((b) => ({ ...b, days: d }))}
          language={plan?.language ?? language}
        />
      ) : tab === "family" ? (
        <FamilyCard card={card} onChange={setCard} placeLabel={place.label} />
      ) : tab === "drill" ? (
        <Drill history={drills} onRecord={(r) => setDrills((h) => [r, ...h].slice(0, 20))} onClear={() => setDrills([])} />
      ) : (
      <>
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
              {loading ? <Loader2 className="animate-spin" /> : <ClipboardList />} {plan ? "Regenerate" : "Generate"} plan for {place.label}
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
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-[var(--ok)]"
                      aria-label={c.text}
                      checked={doneTicks.includes(i)}
                      onChange={() => setTicks({ key: planKey, done: doneTicks.includes(i) ? doneTicks.filter((x) => x !== i) : [...doneTicks, i] })}
                    />
                    <span className={doneTicks.includes(i) ? "text-muted-foreground line-through" : undefined}>
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
      )}
      </motion.div>
      </AnimatePresence>
    </>
  );
}