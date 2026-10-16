# ANVIL AI — Predict. Protect. Respond. Recover.

Location-aware disaster intelligence for India, built as a single Next.js (App Router) full-stack app.

ANVIL takes a user's district, pulls **live official CAP alerts from NDMA SACHET** (issued by IMD, CWC, State SDMAs), runs a **TinyFish-powered research agent** over government web pages to find relief camps and control-room numbers, and assembles a **source-linked safety plan** — while saying plainly what it does not know.

> ANVIL is an information aid and a hackathon prototype, not an official government service. In an emergency call **112**.

---

## What is real, and what isn't

| Area | Status |
|---|---|
| Official alerts | **Live.** SACHET all-India RSS → per-alert CAP 1.2 XML (severity, area, expiry, instruction). Parsed with a dependency-free parser verified against the live feed. |
| Location | Browser Geolocation (opt-in, rounded to ~1 km on device) → OpenStreetMap Nominatim reverse geocode. Manual search and a labelled demo preset (Patna) as fallbacks. |
| Research agent | **Live when `TINYFISH_API_KEY` is set.** TinyFish Search → only `*.gov.in` / `*.nic.in` results → TinyFish Fetch (markdown). Optional TinyFish Agent (`run-sse`) browsing with genuine streamed progress (`TINYFISH_AGENT_ENABLED=true`). Without a key the agent refuses to run — it never simulates. |
| Fact extraction | With `AI_API_KEY`: Anthropic Messages API extracts shelters/contacts/advisories **with verbatim quotes**; every quote is checked against the fetched page text and dropped if not found. Without it: deterministic pattern-matching of control-room lines (contacts only). |
| Shelters | Only those documented on an official page, with quote + link + retrieval time. Never labelled "safe"; capacity/status shown only if inside the quoted evidence. |
| Routes | OSRM road routing (public demo server by default). **Always** marked "safety not verified" — no official road-closure feed is integrated. Active flood/rain alerts are attached. |
| Safety plan | Ordered by authority: CAP instructions (verbatim) → verified district contacts/shelters → checklist (AI-generated or ANVIL template, both labelled). English and Hindi. |
| Notifications | In-browser notifications while ANVIL is open (polls every 5 min). Background web push is **not implemented**; `PUSH_*` env vars are reserved. |
| What-if simulator | Fully working on a **fictional** district; always labelled SIMULATED and stored in its own collection. |
| Family check-in | Opt-in, explicit consent, no location, token-hashed membership, 72-hour auto-deletion, no emergency dispatch. |
| Storage | MongoDB Atlas via Mongoose (TTL retention per collection). Without `MONGODB_URI` an in-memory store is used and the UI says "ephemeral". |

---

## Quick start

Requires **Node.js ≥ 20.9**.

```bash
npm install
cp .env.example .env.local      # fill in what you have — everything is optional for a first run
npm run dev                     # http://localhost:3000
```

With **no keys at all** you still get: live SACHET alerts, location + dashboard, routing, shelter finder (empty until research runs), safety plan (template checklist), simulator and family check-in (ephemeral storage).

### Environment variables

| Variable | Needed for |
|---|---|
| `MONGODB_URI` | Persistence (Atlas connection string). Add your server's IP to the Atlas network access list. |
| `TINYFISH_API_KEY` | Research agent (Search + Fetch). Create at https://agent.tinyfish.ai/api-keys |
| `TINYFISH_AGENT_ENABLED` | `true` to also run TinyFish Agent browser sessions (consumes credits). |
| `AI_API_KEY`, `AI_MODEL` | Quote-verified extraction, briefings, AI checklists (Anthropic Messages API). |
| `GEOCODER_CONTACT` | Contact e-mail in the Nominatim User-Agent (required by its usage policy). |
| `MAP_TILE_URL`, `MAP_TILE_ATTRIBUTION` | Map tiles. The OSM default is for light demo use only. |
| `ROUTING_BASE_URL` | OSRM-compatible routing server. |
| `ADMIN_TOKEN` | Protects live probes on `/admin`. |
| `NEXT_PUBLIC_APP_URL` | Public base URL. |
| `PUSH_PUBLIC_KEY`, `PUSH_PRIVATE_KEY` | Reserved — not used by this build. |

All provider calls run server-side; no secret is ever sent to the browser (`/api/config` exposes booleans only).

---

## Commands

```bash
npm run dev         # development server
npm test            # vitest — unit + integration tests (network stubbed)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint (Next.js flat config)
npm run build       # production build
npm start           # serve the production build
```

### Deployment (Vercel)

1. Import the repo, set the environment variables above.
2. The research route uses `maxDuration = 300` and `after()` so the agent continues after the 202 response; long agent runs need a plan that allows ≥ 300 s functions. On shorter limits, keep `TINYFISH_AGENT_ENABLED=false` (Search + Fetch fit comfortably).
3. Use MongoDB in production — the in-memory fallback is per instance and is lost between invocations.
4. Replace the OSM tile server and OSRM demo server with your own/commercial providers for real traffic.

---

## Architecture

```
src/
  app/
    page.tsx                 landing
    onboarding/              location permission + manual search + demo preset
    (app)/                   pages inside the command-center shell
      dashboard alerts map shelters agent plan simulator family settings admin
    api/
      alerts                 SACHET → normalized, location-matched alerts + risk summary
      geo/reverse, geo/search Nominatim (rate-limited, cached, coords rounded)
      research, research/[id] start agent (202 + after()), poll persisted progress
      shelters               source-documented shelters only
      plans                  safety plan builder
      route                  OSRM route + official hazard warnings (never "verified safe")
      notifications          notification history
      preferences            anonymous preferences; DELETE = erase my data
      family, family/[code]  check-in groups (72 h TTL)
      simulator              synthetic what-if planning
      health, config         source health / public capability flags
  lib/
    core/                    dependency-free, unit-tested logic:
      cap.ts xml.ts          SACHET RSS + CAP parsing, hazard classification, dedupe
      freshness.ts           ACTIVE / EXPIRED / STALE / UNKNOWN, feed staleness
      location-match.ts      CAP areaDesc ↔ district/state matching
      url-safety.ts          SSRF guard, official-domain allowlist
      evidence.ts verify.ts  verbatim-quote verification, conflicts, stale pages
      sanitize.ts            untrusted-content wrapping, prompt-injection detection
      simulation.ts          what-if allocation engine
      risk-analysis.ts       alert-derived status (never upgrades official severity)
      rate-limit.ts concurrency.ts checklists.ts source-registry.ts
    agent/research.ts        PENDING → RESEARCHING → VALIDATING → COMPLETED|PARTIAL|FAILED
    tinyfish.ts ai.ts        provider clients (timeouts, schema-validated responses)
    sources/sachet.ts        feed + CAP fetching with caching, bounded concurrency
    geo.ts plan.ts family.ts repo.ts mongodb.ts env.ts http.ts validation.ts
  models/index.ts            9 Mongoose models with TTL retention
```

Security measures: Zod on every input and every external payload; server-only modules; per-route rate limits; hard timeouts and size caps on upstream calls; ANVIL's server only calls fixed hosts (SACHET, Nominatim, OSRM, TinyFish, Anthropic); search-result URLs are validated (https, no IPs/private hosts/credentials/odd ports) and restricted to government domains before being passed to TinyFish; redirects off government domains are discarded; page text is wrapped in nonce-delimited untrusted blocks and scanned for injection; AI output must be schema-valid and quote-verified.

---

## Tests

`tests/core/*` — pure logic (CAP parsing, freshness/stale alerts, location matching, SSRF, evidence verification, conflicts, stale pages, prompt injection, simulator, risk, rate limit, concurrency, geolocation-denied handling).
`tests/api/*` — Zod validation (invalid inputs, privacy stripping), TinyFish client (missing key, timeout, HTTP errors, invalid payloads, SSE), full research pipeline against a stubbed network (no-key failure, official-only sources, injection flagged, quote-verified contacts), family-token privacy, simulated/live separation through the simulator route.

### Verification status of this delivery

The code was written in a sandbox without npm registry access. What was actually executed there:

- `tests/core/*` (52 tests) — **passed**, using Node's test runner with the TypeScript 6 compiler under `strict` + `noUncheckedIndexedAccess`.
- Syntax check of every `.ts`/`.tsx` file — **passed**; app code type-checked against loose library stubs (remaining errors were stub artifacts).
- SACHET RSS and CAP formats and the TinyFish API shapes were checked against the live feed and current docs.

**Not executed there:** `npm install`, `tests/api/*`, `npm run typecheck`, `npm run lint`, `npm run build`, and any call with real TinyFish/AI/Mongo credentials. Run those first on your machine; dependency ranges in `package.json` may need a nudge if a major version has moved.

---

## Known limitations

- District matching is text-based (CAP `areaDesc` vs. reverse-geocoded names); LGD-code matching would be more precise.
- Only the latest 60 SACHET items in a 48 h window are enriched with full CAP documents per refresh.
- In-memory rate limiting and storage are per server instance.
- The UI chrome is English; safety plans are bilingual (English/Hindi).
- No background push, no road-closure feed, no official shelter API — the app says so wherever it matters.

See [`docs/PITCH.md`](docs/PITCH.md) for the pitch, demo script and judge Q&A.
