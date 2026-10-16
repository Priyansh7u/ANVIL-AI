/**
 * Registry of every external source ANVIL touches, with how it is integrated.
 * The admin/source-health page renders this list and probes the live ones.
 */

export type IntegrationKind =
  | "LIVE_FEED" // documented machine-readable feed fetched directly by ANVIL's server
  | "TINYFISH_RESEARCH" // public web pages discovered/read through TinyFish
  | "MAP_PROVIDER" // geocoding / routing / tiles — not an official disaster source
  | "AI_PROVIDER";

export interface SourceDefinition {
  id: string;
  name: string;
  owner: string;
  kind: IntegrationKind;
  official: boolean;
  homepage: string;
  endpoint?: string;
  notes: string;
}

export const SACHET_RSS_URL = "https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml";

export const SOURCES: SourceDefinition[] = [
  {
    id: "sachet",
    name: "SACHET — CAP Integrated Alert System",
    owner: "National Disaster Management Authority (NDMA), Govt. of India",
    kind: "LIVE_FEED",
    official: true,
    homepage: "https://sachet.ndma.gov.in/",
    endpoint: SACHET_RSS_URL,
    notes:
      "RSS index of OASIS CAP 1.2 alerts issued by IMD, CWC, SDMAs and other alerting agencies. Each item links to the full CAP XML (severity, areas, expiry).",
  },
  {
    id: "imd",
    name: "India Meteorological Department",
    owner: "Ministry of Earth Sciences",
    kind: "TINYFISH_RESEARCH",
    official: true,
    homepage: "https://mausam.imd.gov.in/",
    notes: "IMD warnings reach ANVIL through SACHET CAP alerts; IMD pages are also eligible research sources.",
  },
  {
    id: "cwc",
    name: "Central Water Commission — flood forecasts",
    owner: "Ministry of Jal Shakti",
    kind: "TINYFISH_RESEARCH",
    official: true,
    homepage: "https://cwc.gov.in/",
    notes: "CWC river flood situation messages are published into SACHET (issuer 'CWC').",
  },
  {
    id: "ndma",
    name: "NDMA",
    owner: "Govt. of India",
    kind: "TINYFISH_RESEARCH",
    official: true,
    homepage: "https://ndma.gov.in/",
    notes: "National guidelines and preparedness material.",
  },
  {
    id: "district-sites",
    name: "State SDMA and district (NIC) websites",
    owner: "State / district administrations",
    kind: "TINYFISH_RESEARCH",
    official: true,
    homepage: "https://www.india.gov.in/",
    notes:
      "Discovered per location via TinyFish Search; only *.gov.in and *.nic.in pages are read. Used for relief camps, control-room numbers and advisories.",
  },
  {
    id: "erss-112",
    name: "Emergency Response Support System (112)",
    owner: "Ministry of Home Affairs",
    kind: "LIVE_FEED",
    official: true,
    homepage: "https://www.india.gov.in/directory/helpline",
    notes: "Single pan-India emergency number 112. Static reference — no API.",
  },
  {
    id: "nominatim",
    name: "OpenStreetMap Nominatim",
    owner: "OpenStreetMap Foundation",
    kind: "MAP_PROVIDER",
    official: false,
    homepage: "https://nominatim.org/",
    endpoint: "https://nominatim.openstreetmap.org",
    notes: "Reverse/forward geocoding. Usage policy: ≤1 request/second, identifying User-Agent, cache results.",
  },
  {
    id: "osrm",
    name: "OSRM routing (public demo server)",
    owner: "Project OSRM",
    kind: "MAP_PROVIDER",
    official: false,
    homepage: "https://project-osrm.org/",
    endpoint: "https://router.project-osrm.org",
    notes: "Road routing only. Has NO knowledge of flooding or closures. Replace the demo server for production.",
  },
  {
    id: "tinyfish",
    name: "TinyFish (Search, Fetch, Agent APIs)",
    owner: "TinyFish",
    kind: "TINYFISH_RESEARCH",
    official: false,
    homepage: "https://docs.tinyfish.ai/",
    notes: "Web search, page extraction and goal-based browsing used by the research agent.",
  },
];

export const BASELINE_CONTACTS = [
  {
    label: "Emergency Response Support System (police, fire, ambulance)",
    labelHi: "आपातकालीन प्रतिक्रिया सहायता प्रणाली (पुलिस, अग्निशमन, एम्बुलेंस)",
    phone: "112",
    sourceUrl: "https://www.india.gov.in/directory/helpline",
  },
] as const;
