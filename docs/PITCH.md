# ANVIL AI — Hackathon presentation kit

## Problem statement

India issues thousands of official disaster alerts every month — IMD thunderstorm nowcasts, CWC river-flood bulletins, SDMA advisories — through NDMA's SACHET system. The information exists, but it is scattered across feeds, regional languages and district websites. In the hours that matter, a family in Patna or Narela still has to work out: *Does this alert apply to my district? Is it still active? Where is the nearest relief camp? Which control-room number is current?*

General-purpose chatbots make this worse: they answer confidently, invent shelters and phone numbers, and give no way to check.

## 60-second pitch

> When a flood warning goes out, the information people need is already public — it's just scattered across SACHET alerts, IMD bulletins and dozens of district websites. ANVIL brings it together for your district, and refuses to make anything up.
>
> Share an approximate location, and ANVIL pulls live official CAP alerts from NDMA SACHET, matches them to your district, and shows when each was issued, retrieved and expires. Then our TinyFish research agent searches the web, reads **only government pages**, and extracts relief camps and control-room numbers — but every fact must quote its source word-for-word, or it's thrown away. Stale pages, conflicting numbers and prompt-injection attempts are flagged, not hidden.
>
> The result is a bilingual household safety plan where official instructions always come first, and every line links back to its source. For responders, a what-if simulator shows how the plan rebalances when a shelter goes down.
>
> ANVIL: Predict. Protect. Respond. Recover. — with receipts.

## 3-minute live demo script

| Time | Action | What to say |
|---|---|---|
| 0:00 | Open landing page → **Set my location** | "No account. Location is optional and rounded to about a kilometre on the device." |
| 0:15 | Click **Use my approximate location** (or **Demo mode: Patna**) | "If permission is denied we fall straight back to manual search — tested." |
| 0:30 | Dashboard | "This status comes only from official alerts. Here's the SACHET record, the issuing office — IMD or CWC — issued time, retrieval time, expiry. Expired alerts are separated, and if SACHET is down we say 'unavailable', never 'all clear'." |
| 0:55 | **Live alerts** → filter hazard = Flood, toggle *show expired* | "These are CWC river-flood messages live from today's feed." |
| 1:10 | **Research agent** → *Research Patna* | "Watch the timeline — each line is a real TinyFish call. Non-government results are ignored; only .gov.in and .nic.in pages are read." |
| 1:40 | Point to **Validation flags** and **Verified findings** | "Every contact carries the exact sentence from the page. Anything the model said that isn't on the page is discarded — here's the count. A page with 'ignore previous instructions' text is flagged and treated as data." |
| 2:00 | **Shelters** | "Listed because an official page documents it — quote and link. We never call a building 'safe'; capacity shows only if the page says it." |
| 2:15 | **Safety plan** → Hindi → Generate | "Official CAP instructions first, verbatim. Then verified district contacts. Then a checklist that's clearly labelled AI-generated." |
| 2:35 | **Simulator** → close Shelter S1, push demand to ×2 | "Purple means simulated — fictional district. Watch the load shift, the shortfall appear, and the action list update." |
| 2:50 | **Source health** | "Every integration, whether it's live right now, and how it's used. That's ANVIL." |

**Fallbacks if the network misbehaves:** use Demo mode (Patna — CWC flood alerts are frequent there), keep a completed research task from rehearsal to show via *Previous runs*, and show the simulator, which needs no external services.

## Architecture explanation (talk track)

- **One Next.js App Router repo.** Route Handlers are the backend; no separate server.
- **Official data path:** SACHET RSS → CAP XML (bounded concurrency, cached; CAP docs are immutable) → normalization → freshness (ACTIVE/EXPIRED/STALE/UNKNOWN) → district matching → risk summary that can never exceed official severity.
- **Research path:** `POST /api/research` returns 202 and continues via `after()`. State machine PENDING → RESEARCHING → VALIDATING → COMPLETED/PARTIAL/FAILED is persisted after every real step; the UI polls it. TinyFish Search → government-domain filter → TinyFish Fetch → (optional) TinyFish Agent with SSE progress → Claude extraction with verbatim quotes → quote verification → conflict/stale/injection flags → MongoDB.
- **Storage:** MongoDB Atlas via Mongoose, nine collections with TTL retention. Simulated data has its own collection with an immutable `isSimulated: true`.
- **Safety by construction:** Zod on every boundary, SSRF guard, rate limits, timeouts, untrusted-content delimiters, no secrets client-side.

## Innovation and differentiation

1. **Evidence-or-nothing extraction.** Most AI assistants cite sources loosely; ANVIL mechanically verifies every extracted fact against retrieved text and discards failures.
2. **Honest states.** PARTIAL, STALE, UNAVAILABLE, "safety not verified" are first-class UI states, not hidden errors.
3. **Official-first ordering.** AI output is structurally prevented from outranking official instructions.
4. **Real agentic browsing with real progress** — no fake spinners.
5. **India-specific:** SACHET CAP, IMD/CWC issuers, Hindi plans, NIC/gov.in domain trust, LGD-ready.

## Technical challenges and solutions

| Challenge | Solution |
|---|---|
| SACHET RSS has no area/severity | Fetch each CAP XML (bounded to 6 concurrent, immutable cache) and fall back to "summary only" when it fails. |
| Reverse-geocoded names ≠ CAP area names ("North West Delhi" vs "North West") | Normalized phrase matching with state stripping, aliases, and issuer-office state hints; conservative by design. |
| LLM hallucination of phone numbers/shelters | Verbatim quote check + key value must appear in the quote + Zod schema; unverified items dropped and counted. |
| Prompt injection from web pages | Nonce-delimited untrusted blocks, explicit system rules, pattern detection surfaced as a flag, and verification that makes injected claims useless. |
| Long agent runs on serverless | `after()` + persisted state machine + client polling; overall 240 s budget. |
| Demo without credentials | Graceful degradation everywhere: in-memory store labelled "ephemeral", template checklists, honest FAILED state for research. |

## Roadmap

- LGD district codes and CAP polygon matching for precise targeting.
- Web Push (VAPID) with a background worker; SMS/WhatsApp opt-in.
- Official road-closure and waterlogging feeds where states publish them; flood-aware routing.
- Full Hindi + regional-language UI; voice read-out for low-literacy users.
- Responder view: multi-district research sweeps, shelter capacity reporting by officials.
- Offline-first PWA with cached last-known plan.

## Likely judge questions — honest answers

**Is the alert data real?** Yes — live from NDMA SACHET's public CAP feed. If it's unreachable we show the last retrieved copy labelled "cached", or "unavailable".

**Does TinyFish really browse?** Search and Fetch run on every research task when the key is configured; the Agent browser run is enabled with `TINYFISH_AGENT_ENABLED=true`. The timeline only records calls that actually happened. Without a key the task fails honestly.

**How do you stop the AI from making things up?** It can only extract, and every item must include a sentence that we find verbatim in the page we fetched. Capacity and status survive only if they're inside that sentence. Everything else is dropped and counted.

**Can I trust a shelter you list?** You can trust that an official page lists it — we show the quote and link. Whether it is open, safe or full is not something any website can guarantee, so we tell people to confirm with the district control room.

**Is the route safe?** We don't know, and we say so on every route. No official road-closure feed is integrated yet.

**What happens with no internet?** The app shows offline errors with retry; a saved/printed plan is the fallback. Offline PWA is on the roadmap.

**Privacy?** No accounts; coordinates rounded on-device and never stored; anonymous ID only if you save something; TTL deletion; one-tap "delete my data"; family check-ins hold no location and expire in 72 hours.

**What didn't you finish?** Background push notifications, road-closure data, a fully translated UI, and polygon-based matching.

**Why not just use the SACHET app?** SACHET is the authoritative alert source and we link to it. ANVIL adds the next step — shelters, contacts and a household plan from scattered district sites — with verification.

## Updated 3-minute demo (with the new features)

| Time | Show | Say |
|---|---|---|
| 0:00 | **Command center** for your district | "Live clock, live SACHET feed status, real counts. The map shows official alert areas — solid where the government published a polygon, dashed where the alert names the district and we draw its real OpenStreetMap boundary." |
| 0:30 | **Next steps** panel (left) | "ANVIL turns alerts into decisions: official instructions first, verbatim and linked; then verified district advisories; then clearly labelled guidance tailored to this household. It always defers to officials." |
| 0:55 | **Alert timeline** | "Every bar is a real alert from issue to expiry; the red line is now. You can see what expires next." |
| 1:10 | **Research agent** → run | "TinyFish searches, reads only .gov.in/.nic.in pages, and Gemini extracts shelters, contacts and road closures — each kept only if its quote is found word-for-word on the page." |
| 1:40 | **Map & routes** → *Route here* to a shelter | "The route is checked against live alert areas — it tells you it enters an alert area after N km. It is never called safe." |
| 2:05 | **Simulator → Live-seeded** | "These are this district's real documented shelters and real road distances. Close a shelter, close a road, surge demand ×2 — the plan re-balances and shows the shortfall. Purple = simulation, never mixed with live data." |
| 2:35 | **Smart alerts** → add a 10 km geofence | "Watch your home or your parents' village. ANVIL matches live alerts to that circle using the official polygon and notifies you with severity, source, time and official guidance." |
| 2:50 | **Ask ANVIL** by voice in Hindi | "Grounded answers with citations — an answer with an invented number is rejected." |

## The algorithms (for technical judges)

All of these run on live official data only, and each one shows its working in the UI.

| Algorithm | What it does | Where |
|---|---|---|
| **Attention index** | Each active alert scores severity weight × urgency × certainty × area relevance × recency decay (6 h half-life). Scores combine as independent probabilities, 1 − Π(1 − pᵢ), with +10% per extra agency reporting the same hazard. Full factor breakdown under "Why this score". Never upgrades an official level. | `lib/core/intelligence.ts` → dashboard |
| **Surge detection** | Alerts per hour over 48 h; last 3 h compared with the 45 h baseline as a Poisson rate, z = (observed − expected)/√expected. z ≥ 2 with ≥ 2 recent alerts = "Surging". Runs per state and per district. | national room, dashboard |
| **Multi-agency corroboration** | Clusters active alerts of the same hazard family (rain+flood, coastal, …) issued within 12 h, so IMD + CWC + SDMA reporting the same event shows as "confirmed by 3 agencies". | dashboard |
| **State attribution** | Places each alert in a state from the official area text, SDMA issuer names, then IMD office — and leaves it unplaced rather than guessing (the count of unplaced alerts is shown). | national room |
| **Lowest-exposure routing** | Requests up to 4 alternative road routes, measures km inside live alert polygons weighted by severity, recommends the lowest. Never labelled safe. | map & routes |
| **Evidence verification** | Every AI- or agent-extracted fact must quote the source page verbatim; numbers must sit inside the quote. | research agent, Ask ANVIL |
| **Geofence matching** | Circle–polygon intersection between a watch area and official alert areas. | smart alerts |
| **Live-seeded allocation** | Nearest-first shelter allocation over real road distances with capacity limits; reports shortfall, vehicle trips and resource needs. | simulator |

**Demo addition (30 s):** open **National situation room** → point at the surging state and the hourly chart; back on the **Command center**, open "Why this score" on the attention gauge; on **Map & routes**, show the alternatives table where the lowest-exposure route avoids km of alert area.

## Live research agent and Nearby help (upgrade 4)

**Live research agent (`/research`).** Pick a place and a disaster type and press *Start live research*. The agent checks NDMA SACHET, runs four TinyFish searches at once (government domains, national agencies such as IMD, CWC and NDMA, the district administration, and news from the last 72 h), reads the best official and news pages with TinyFish Fetch, can optionally run a TinyFish Agent browser session, and extracts findings that must quote the page word for word.

- **Real stages, no fake progress.** Initializing → Discovering sources → Researching → Extracting evidence → Validating findings → Preparing report, ending as Completed, Partial, Failed or Cancelled. The worker writes each event when it happens, and the UI receives it over Server-Sent Events, falling back to polling. Provider events (TinyFish, SACHET) are labelled separately from ANVIL's own processing.
- **Each finding carries:** its source and URL; a publication time only if the source states one, along with where that time came from (CAP issue time, a date on the page, or the search provider); its retrieval time; its freshness (under 24 h, 24–72 h, potentially stale, or timestamp unavailable); its geographic relevance; whether it is official, secondary or unverified; any conflicts; and any other sources that report the same thing.
- **Validation.** Near-duplicates are merged with Jaccard similarity of 0.55 or more, keeping the official and freshest version. A conflict is flagged when two sources report different alert colours, or when one says a warning was withdrawn while another still reports it as active. An AI summary is used only if every claim cites a finding and contains no number that isn't in the findings.
- **Reports.** These have an executive summary, official advisories, affected areas (only those the evidence supports), source reliability, freshness, conflicts and gaps, and next steps with official items first. When there is no recent official source for the area, the report says *Insufficient evidence*. Reports export as JSON or as a printable page.
- **Monitor this location.** A cron job calls `/api/cron/monitor` with `CRON_SECRET`. The first run sets a baseline. Later runs report only new or changed findings, matched by item key and content fingerprint. Failed runs back off, and the UI shows the last successful refresh and a stale warning. Without a scheduler, the UI says monitors run only when you press *Run now*.

**Nearby help (`/nearby`).** A live map with a legend shows hospitals, clinics, shelters, assembly points, fire stations and police stations from OpenStreetMap through the Overpass API. Each one shows its distance, a phone link, directions, the OSM source link and when the map entry was last edited. These entries are labelled *community-mapped, not officially verified*. Shelters documented on government pages are listed first, with the quote, the source link and the time they were last verified. Facilities that fall inside an active official alert polygon are flagged. National helplines are one tap away.

**Likely judge question:** *Is OpenStreetMap data verified?* No, and we say so on every entry. Official verification comes only from government pages, through the shelter research agent.