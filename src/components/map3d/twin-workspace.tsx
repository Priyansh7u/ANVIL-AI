"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GeoJSONSource, Map as MLMap, MapGeoJSONFeature, MapMouseEvent } from "maplibre-gl";
import {
  Activity,
  AlertTriangle,
  Box,
  Building2,
  Compass,
  Crosshair,
  Droplets,
  ExternalLink,
  Layers,
  Link2,
  LocateFixed,
  Loader2,
  Maximize,
  Minimize,
  Navigation,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Radar,
  RefreshCw,
  RotateCcw,
  Route as RouteIcon,
  X,
} from "lucide-react";
import { relativeTime } from "@/lib/core/freshness";
import { latLonRingsToPolygons, type Geom, type MultiPolygonGeom, type Position } from "@/lib/core/geo3d/geojson";
import { analyzeExposure, mergeFragments, type ExposureResult, type HazardZone, type MappedFeature, type RasterZone } from "@/lib/core/geo3d/exposure";
import { connectedInundation, DEPTH_BANDS, geomTouchesMask, inundationCells, positionToCell, sampleGrid, SIMULATION_LABEL, type ElevationGrid } from "@/lib/core/geo3d/inundation";
import { assessLayer, VERIFICATION_LABEL, type LayerQuality } from "@/lib/core/geo3d/quality";
import { scoreRoute, type RouteHazard, type RouteRisk } from "@/lib/core/geo3d/route-risk";
import { bboxOfPositions, circlePolygon, pointInArea, type BBox } from "@/lib/core/geo3d/spatial";
import { DEFAULT_LAYERS, parseViewState, serializeViewState, type LayerId } from "@/lib/core/geo3d/view-state";
import { FACILITY_LABEL, type FacilityKind, type OsmFacility } from "@/lib/core/nearby";
import { STAGE_LABEL, TERMINAL_STAGES, type HazardStage } from "@/lib/core/hazard-intel";
import { cn } from "@/lib/utils";
import { apiFetch, placeQuery, useApi, type ApiError } from "@/hooks/use-api";
import { useClientId, usePlace } from "@/hooks/use-local-state";
import { SEVERITY_COLOR, type HazardDto, type HazardMapResponse } from "@/types/api";
import type { FindingDto } from "@/types/research";
import { loadElevationGrid, elevationAt, type GridLoadResult } from "./elevation";
import { buildStyle, HILLSHADE_LAYER, OPENFREEMAP_TILEJSON, TERRAIN_EXAGGERATION, TERRAIN_PROVIDERS, terrainSource, type TerrainProvider } from "./style";
import { clampLiveBox, type LiveBuildings } from "@/lib/core/geo3d/osm-buildings";
import { Glass, IconButton, Pill, SearchBox, SectionTitle, Stat, Toggle, type SearchResult } from "./twin-ui";

// ── types ────────────────────────────────────────────────────────────────────
type Severity = HazardDto["severity"];
const SEVERITIES: Severity[] = ["Extreme", "Severe", "Moderate", "Minor", "Unknown"];

interface Focus {
  label: string;
  district: string | null;
  state: string | null;
  lat: number;
  lon: number;
}

interface OfficialShelter {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
  capacity: number | null;
  operationalStatus: string | null;
  sourceUrl: string;
  evidenceQuote: string;
  verifiedAt: string;
}

interface NearbyResponse {
  facilities: OsmFacility[];
  osm: { status: "LIVE" | "STALE" | "UNAVAILABLE"; fetchedAt: string | null; error: string | null };
  officialShelters: OfficialShelter[];
}

interface RouteResponse {
  alternatives: { rank: number; distanceKm: number; durationMin: number; path: [number, number][]; provider: string; isProviderFastest: boolean }[];
  unmappedAlerts: unknown[];
  roadClosures: { road: string; status: string; evidence: { sourceUrl: string; retrievedAt: string } }[];
  routedAt: string;
}

interface Feat {
  type: "Feature";
  id?: number;
  properties: Record<string, unknown>;
  geometry: unknown;
}
interface FC {
  type: "FeatureCollection";
  features: Feat[];
}
const EMPTY: FC = { type: "FeatureCollection", features: [] };

type Inspect =
  | { kind: "alert"; dto: HazardDto }
  | { kind: "facility"; f: OsmFacility }
  | { kind: "shelter"; s: OfficialShelter }
  | { kind: "building"; height: number | null; name: string | null; at: Position }
  | { kind: "live-building"; height: number; heightSource: string; levels: number | null; name: string | null; edited: string | null; osmId: string; at: Position }
  | { kind: "road"; cls: string | null; at: Position }
  | { kind: "cell"; depth: number; at: Position }
  | { kind: "point"; at: Position };

interface Scenario {
  type: "flood" | "zone";
  seed: Position | null;
  rise: number; // metres above ground at the seed
  radius: number; // metres
}

const FACILITY_COLOR: Record<FacilityKind, string> = {
  hospital: "#ef4444",
  clinic: "#f472b6",
  shelter: "#22c55e",
  assembly_point: "#a3e635",
  fire_station: "#f97316",
  police: "#3b82f6",
};

const INDIA: Focus = { label: "India", district: null, state: null, lat: 22.5, lon: 79 };
const GRID = 96;
const MAX_SPAN_DEG = 0.35;

// ── helpers ──────────────────────────────────────────────────────────────────
function webglSupported(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

function setGeo(map: MLMap | null, id: string, fc: FC) {
  const s = map?.getSource(id) as GeoJSONSource | undefined;
  s?.setData(fc as unknown as GeoJSON.GeoJSON);
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const LAYER_GROUPS: Record<LayerId, string[]> = {
  alerts: ["alerts-fill", "alerts-line", "alerts-line-approx"],
  boundary: ["boundary-line"],
  buildings: ["building-3d", "building-flat", "live-buildings", "live-box"],
  terrain: ["hillshade"],
  facilities: ["fac-clusters", "fac-count", "fac-points"],
  shelters: ["shelter-points"],
  scenario: ["scenario-cells-3d", "scenario-cells-2d", "scenario-zone-fill", "scenario-zone-line", "seed-point"],
  exposure: ["exposed-bldg", "exposed-road", "exposed-point"],
  routes: ["route-alt", "route-best"],
};

const INSPECTABLE = ["live-buildings", "seed-point", "shelter-points", "fac-points", "fac-clusters", "scenario-cells-3d", "scenario-cells-2d", "exposed-bldg", "alerts-fill", "building-3d", "building-flat", "roads-major", "roads-mid", "roads-minor"];

function addOverlays(map: MLMap) {
  const src = (id: string, extra: Record<string, unknown> = {}) => map.addSource(id, { type: "geojson", data: EMPTY as unknown as GeoJSON.GeoJSON, ...extra });
  ["alerts", "boundary", "scenario-cells", "scenario-zone", "seed", "exposed", "routes", "shelters", "live-buildings", "live-box"].forEach((id) => src(id));

  // Live OSM buildings (Overpass). Brighter = height from OSM tags; grey = default height.
  map.addLayer(
    {
      id: "live-buildings",
      type: "fill-extrusion",
      source: "live-buildings",
      paint: {
        "fill-extrusion-color": ["match", ["get", "heightSource"], "height tag", "#4f7cc0", "levels tag", "#3b6aa8", "#2a3850"],
        "fill-extrusion-height": ["to-number", ["get", "height"], 6],
        "fill-extrusion-base": ["to-number", ["get", "minHeight"], 0],
        "fill-extrusion-opacity": 0.95,
      },
    },
    "road-labels",
  );
  map.addLayer({ id: "live-box", type: "line", source: "live-box", paint: { "line-color": "#22d3ee", "line-width": 1.2, "line-dasharray": [2, 3], "line-opacity": 0.6 } }, "road-labels");
  src("facilities", { cluster: true, clusterRadius: 42, clusterMaxZoom: 15 });

  // Official areas sit below buildings so mapped structures stay readable.
  map.addLayer({ id: "alerts-fill", type: "fill", source: "alerts", paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["==", ["get", "approx"], true], 0.1, 0.24] } }, "building-flat");
  map.addLayer({ id: "alerts-line", type: "line", source: "alerts", filter: ["!=", ["get", "approx"], true], paint: { "line-color": ["get", "color"], "line-width": 2.2 } }, "building-flat");
  map.addLayer({ id: "alerts-line-approx", type: "line", source: "alerts", filter: ["==", ["get", "approx"], true], paint: { "line-color": ["get", "color"], "line-width": 1.6, "line-dasharray": [2, 2] } }, "building-flat");
  map.addLayer({ id: "boundary-line", type: "line", source: "boundary", paint: { "line-color": "#94a3b8", "line-width": 1.2, "line-dasharray": [4, 3], "line-opacity": 0.7 } }, "building-flat");

  map.addLayer({ id: "scenario-zone-fill", type: "fill", source: "scenario-zone", paint: { "fill-color": "#a855f7", "fill-opacity": 0.16 } });
  map.addLayer({ id: "scenario-zone-line", type: "line", source: "scenario-zone", paint: { "line-color": "#c084fc", "line-width": 2, "line-dasharray": [3, 2] } });
  map.addLayer({ id: "scenario-cells-2d", type: "fill", source: "scenario-cells", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.55 } });
  map.addLayer({
    id: "scenario-cells-3d",
    type: "fill-extrusion",
    source: "scenario-cells",
    paint: { "fill-extrusion-color": ["get", "color"], "fill-extrusion-height": ["*", ["get", "depth"], TERRAIN_EXAGGERATION], "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.62 },
  });

  map.addLayer({
    id: "exposed-bldg",
    type: "fill-extrusion",
    source: "exposed",
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "fill-extrusion-color": ["match", ["get", "set"], "scenario", "#c084fc", "#f59e0b"],
      "fill-extrusion-height": ["+", ["to-number", ["coalesce", ["get", "height"], 6]], 0.6],
      "fill-extrusion-opacity": 0.95,
    },
  });
  map.addLayer({ id: "exposed-road", type: "line", source: "exposed", filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": ["match", ["get", "set"], "scenario", "#c084fc", "#f59e0b"], "line-width": 3.5 } });
  map.addLayer({ id: "exposed-point", type: "circle", source: "exposed", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 11, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": ["match", ["get", "set"], "scenario", "#c084fc", "#f59e0b"], "circle-stroke-width": 2.5 } });

  map.addLayer({ id: "route-alt", type: "line", source: "routes", filter: ["!=", ["get", "best"], true], layout: { "line-cap": "round" }, paint: { "line-color": "#94a3b8", "line-width": 3, "line-opacity": 0.7, "line-dasharray": [1.5, 1.5] } });
  map.addLayer({ id: "route-best", type: "line", source: "routes", filter: ["==", ["get", "best"], true], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#22d3ee", "line-width": 5, "line-opacity": 0.95 } });

  map.addLayer({
    id: "fac-clusters",
    type: "circle",
    source: "facilities",
    filter: ["has", "point_count"],
    paint: { "circle-color": "#0f172a", "circle-stroke-color": "#22d3ee", "circle-stroke-width": 1.5, "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 24] },
  });
  map.addLayer({ id: "fac-count", type: "symbol", source: "facilities", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Regular"], "text-size": 12 }, paint: { "text-color": "#e2e8f0" } });
  map.addLayer({
    id: "fac-points",
    type: "circle",
    source: "facilities",
    filter: ["!", ["has", "point_count"]],
    paint: { "circle-color": ["get", "color"], "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 4, 16, 8], "circle-stroke-color": "#020617", "circle-stroke-width": 1.5 },
  });
  map.addLayer({ id: "shelter-points", type: "circle", source: "shelters", paint: { "circle-color": "#2dd4bf", "circle-radius": 9, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
  map.addLayer({ id: "seed-point", type: "circle", source: "seed", paint: { "circle-color": "#c084fc", "circle-radius": 7, "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 } });
}

/** Replace the terrain + hillshade sources with another provider, keeping the layer order. */
function swapTerrain(map: MLMap, provider: TerrainProvider, exaggeration: number, terrainOn: boolean) {
  try {
    map.setTerrain(null);
    if (map.getLayer("hillshade")) map.removeLayer("hillshade");
    for (const id of ["terrain", "hillshade"]) if (map.getSource(id)) map.removeSource(id);
    map.addSource("terrain", terrainSource(provider));
    map.addSource("hillshade", terrainSource(provider, false));
    map.addLayer(HILLSHADE_LAYER, "water");
    if (terrainOn) map.setTerrain({ source: "terrain", exaggeration });
  } catch {
    /* keep the flat map if even the fallback can't be installed */
  }
}

function zoneFromDto(h: HazardDto): { zone: HazardZone | null; invalid: number } {
  const { polygons, invalid } = latLonRingsToPolygons(h.polygons);
  if (!polygons.length) return { zone: null, invalid };
  const geometry: MultiPolygonGeom = { type: "MultiPolygon", coordinates: polygons.map((p) => p.coordinates) };
  return { zone: { id: h.id, label: `${h.issuer}: ${h.headline}`.slice(0, 160), kind: "OFFICIAL", geometry }, invalid };
}

// ── component ────────────────────────────────────────────────────────────────
export default function TwinWorkspace() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [tileError, setTileError] = useState<string | null>(null);
  const [place] = usePlace();
  const clientId = useClientId();

  const [focus, setFocus] = useState<Focus | null>(null);
  const [layers, setLayers] = useState<Set<LayerId>>(new Set(DEFAULT_LAYERS));
  const [mode, setMode] = useState<"3d" | "2d">("3d");
  const [cursor, setCursor] = useState<{ lon: number; lat: number; elev: number | null } | null>(null);
  const [zoom, setZoom] = useState(4);
  const [fullscreen, setFullscreen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState<"scenario" | "analysis" | "research">("scenario");
  const [sheet, setSheet] = useState<null | "layers" | "scenario" | "analysis" | "research">(null);
  const [copied, setCopied] = useState(false);
  const [exaggeration, setExaggeration] = useState(TERRAIN_EXAGGERATION);
  const [terrainProvider, setTerrainProvider] = useState<TerrainProvider>("mapterhorn");
  const [buildingsMode, setBuildingsMode] = useState<"live" | "tiles">("live");
  const [live, setLive] = useState<{ data: (LiveBuildings & { fetchedAt: string; cached?: boolean; stale?: boolean; error?: string }) | null; loading: boolean; error: string | null; box: { west: number; south: number; east: number; north: number } | null }>({ data: null, loading: false, error: null, box: null });
  const [status, setStatus] = useState<Record<"basemap" | "terrain" | "buildings", { state: "loading" | "ok" | "error"; message?: string }>>({ basemap: { state: "loading" }, terrain: { state: "loading" }, buildings: { state: "loading" } });
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [, setTick] = useState(0);

  const [sevFilter, setSevFilter] = useState<Set<Severity>>(new Set(SEVERITIES));
  const [includeApprox, setIncludeApprox] = useState(true);
  const [eventId, setEventId] = useState<string | null>(null);
  const [facFilter, setFacFilter] = useState<Set<FacilityKind>>(new Set(Object.keys(FACILITY_COLOR) as FacilityKind[]));

  const [scenario, setScenario] = useState<Scenario>({ type: "flood", seed: null, rise: 2, radius: 1500 });
  const [scenarioOn, setScenarioOn] = useState(false);
  const [pickSeed, setPickSeed] = useState(false);
  const [grid, setGrid] = useState<GridLoadResult | null>(null);
  const [gridState, setGridState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null });
  const [compare, setCompare] = useState<"baseline" | "scenario" | "both">("both");

  const [features, setFeatures] = useState<{ list: MappedFeature[]; heights: Map<string, number>; zoom: number; bbox: BBox | null; at: string | null }>({ list: [], heights: new Map(), zoom: 0, bbox: null, at: null });
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const [route, setRoute] = useState<{ loading: boolean; error: string | null; to: string | null; risks: (RouteRisk & { distanceKm: number; durationMin: number; provider: string })[]; routedAt: string | null }>({ loading: false, error: null, to: null, risks: [], routedAt: null });

  const reduced = useRef(false);
  const pickRef = useRef(false);
  pickRef.current = pickSeed;

  // ── data (refreshes keep the map live) ───────────────────────────────────
  const hasArea = Boolean(focus && (focus.district || focus.state));
  const hazards = useApi<HazardMapResponse>(hasArea && focus ? `/api/hazard-map?${placeQuery(focus)}` : null, { refreshMs: 60_000 });
  const nearby = useApi<NearbyResponse>(focus && focus !== INDIA ? `/api/nearby?lat=${focus.lat.toFixed(2)}&lon=${focus.lon.toFixed(2)}&radiusKm=10${hasArea ? `&${placeQuery(focus)}` : ""}` : null, { refreshMs: 10 * 60_000 });

  const nearbyRef = useRef<NearbyResponse | null>(null);
  nearbyRef.current = nearby.data;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const hazardsRef = useRef<HazardMapResponse | null>(null);
  hazardsRef.current = hazards.data;
  const buildingsModeRef = useRef(buildingsMode);
  buildingsModeRef.current = buildingsMode;
  const liveRef = useRef(live);
  liveRef.current = live;
  const exaggerationRef = useRef(exaggeration);
  exaggerationRef.current = exaggeration;
  const terrainErrors = useRef(0);
  const terrainProviderRef = useRef<TerrainProvider>("mapterhorn");
  const liveCtrl = useRef<AbortController | null>(null);

  // OpenStreetMap snapshot date of the vector tiles, read live from the provider.
  useEffect(() => {
    fetch(OPENFREEMAP_TILEJSON)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { tiles?: string[] } | null) => {
        const m = j?.tiles?.[0]?.match(/\/(\d{4})(\d{2})(\d{2})_/);
        if (m) setSnapshot(`${m[1]}-${m[2]}-${m[3]}`);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  // ── zones ────────────────────────────────────────────────────────────────
  const officialAll = useMemo(() => {
    const out: { dto: HazardDto; zone: HazardZone }[] = [];
    let invalid = 0;
    for (const h of hazards.data?.hazards ?? []) {
      const z = zoneFromDto(h);
      invalid += z.invalid;
      if (z.zone) out.push({ dto: h, zone: z.zone });
    }
    return { list: out, invalid, unmapped: (hazards.data?.hazards ?? []).filter((h) => !h.polygons.length).length };
  }, [hazards.data]);

  const official = useMemo(
    () => officialAll.list.filter(({ dto }) => sevFilter.has(dto.severity) && (includeApprox || dto.areaSource === "CAP_POLYGON") && (!eventId || dto.id === eventId)),
    [officialAll, sevFilter, includeApprox, eventId],
  );

  const inundation = useMemo(() => {
    if (!scenarioOn || scenario.type !== "flood" || !grid || !scenario.seed) return null;
    const cell = positionToCell(grid.grid, scenario.seed);
    if (!cell) return { outside: true as const };
    const ground = sampleGrid(grid.grid, scenario.seed);
    if (Number.isNaN(ground)) return { noData: true as const };
    const res = connectedInundation(grid.grid, cell, ground + scenario.rise);
    return { res, ground };
  }, [scenarioOn, scenario.type, scenario.seed, scenario.rise, grid]);

  const scenarioZone: HazardZone | RasterZone | null = useMemo(() => {
    if (!scenarioOn || !scenario.seed) return null;
    if (scenario.type === "zone") {
      return { id: "scenario", label: `Hypothetical zone, ${(scenario.radius / 1000).toFixed(1)} km radius`, kind: "SIMULATED", geometry: { type: "Polygon", coordinates: [circlePolygon(scenario.seed, scenario.radius)] } };
    }
    if (!inundation || !("res" in inundation) || !inundation.res || !grid) return null;
    const res = inundation.res;
    const g: ElevationGrid = grid.grid;
    return { id: "scenario", label: `Hypothetical water level +${scenario.rise} m`, kind: "SIMULATED", bbox: [g.west, g.south, g.east, g.north], hits: (geom: Geom) => geomTouchesMask(g, res, geom) };
  }, [scenarioOn, scenario, inundation, grid]);

  // ── analysis (recomputed only when features or zones change) ─────────────
  const coverageNote = features.zoom < 14 ? "Zoom to street level (14+) to load building footprints; at this zoom only roads are evaluated." : null;
  const baseline: ExposureResult | null = useMemo(
    () => (features.list.length && official.length ? analyzeExposure(features.list, official.map((o) => o.zone), { coverageNote }) : null),
    [features, official, coverageNote],
  );
  const scenarioExposure: ExposureResult | null = useMemo(() => (features.list.length && scenarioZone ? analyzeExposure(features.list, [scenarioZone], { coverageNote }) : null), [features, scenarioZone, coverageNote]);

  // ── data quality ─────────────────────────────────────────────────────────
  const quality: Record<string, LayerQuality> = useMemo(() => {
    const hz = hazards.data;
    return {
      alerts: assessLayer({
        layer: "Official alert areas",
        source: "NDMA SACHET (CAP)",
        verification: official.some((o) => o.dto.areaSource === "CAP_POLYGON") ? "OFFICIAL" : official.length ? "OFFICIAL_APPROXIMATE" : hz ? "OFFICIAL" : "UNAVAILABLE",
        retrievedAt: hz?.feed.retrievedAt ?? null,
        features: official.length,
        invalidGeometry: officialAll.invalid,
        liveMinutes: 10,
        staleMinutes: 60,
        uncertainty: [
          ...(officialAll.unmapped ? [`${officialAll.unmapped} active alert(s) publish no area and are not drawn.`] : []),
          ...(official.some((o) => o.dto.areaSource === "DISTRICT_BOUNDARY") ? ["Dashed areas are the district boundary of an alert that names the district — the real warning area may be smaller."] : []),
        ],
      }),
      facilities: assessLayer({
        layer: "Emergency facilities",
        source: "OpenStreetMap via Overpass",
        verification: nearby.data?.osm.status === "UNAVAILABLE" ? "UNAVAILABLE" : "COMMUNITY_MAPPED",
        retrievedAt: nearby.data?.osm.fetchedAt ?? null,
        features: nearby.data?.facilities.length ?? 0,
        liveMinutes: 15,
        staleMinutes: 24 * 60,
        uncertainty: ["Community-mapped: existence, phone and status are not officially verified."],
      }),
      shelters: assessLayer({
        layer: "Documented shelters",
        source: "Official government pages (research agent)",
        verification: "OFFICIAL",
        retrievedAt: nearby.data?.officialShelters[0]?.verifiedAt ?? null,
        features: nearby.data?.officialShelters.filter((s) => s.lat != null).length ?? 0,
        liveMinutes: 24 * 60,
        staleMinutes: 7 * 24 * 60,
        uncertainty: ["Positions are geocoded from published addresses (approximate). Open/full status is not verified."],
      }),
    };
  }, [hazards.data, official, officialAll, nearby.data]);

  // ── map init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    reduced.current = prefersReducedMotion();
    if (!containerRef.current) return;
    if (!webglSupported()) {
      setEngineError("This browser or device has WebGL turned off, so the 3D map can't start. Use the 2D Map & routes page, or enable hardware acceleration.");
      return;
    }
    let cancelled = false;
    let map: MLMap | null = null;
    const url = parseViewState(new URLSearchParams(window.location.search));
    const start: Focus = place?.lat != null && place.lon != null ? { label: place.label, district: place.district, state: place.state, lat: place.lat, lon: place.lon } : INDIA;
    if (url.mode) setMode(url.mode);
    if (url.layers) setLayers(new Set(url.layers));
    setFocus(start);

    (async () => {
      try {
        const maplibregl = (await import("maplibre-gl")).default;
        if (cancelled || !containerRef.current) return;
        map = new maplibregl.Map({
          container: containerRef.current,
          style: buildStyle("mapterhorn"),
          center: [url.lon ?? start.lon, url.lat ?? start.lat],
          zoom: url.zoom ?? (start === INDIA ? 4.2 : 15.5),
          pitch: url.pitch ?? (url.mode === "2d" ? 0 : 60),
          bearing: url.bearing ?? -15,
          maxPitch: 80,
          attributionControl: { compact: true },
        });
        mapRef.current = map;
        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true, showZoom: true }), "bottom-right");
        map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 120 }), "bottom-left");

        map.on("load", () => {
          if (!map) return;
          addOverlays(map);
          try {
            map.setSky({ "sky-color": "#0b1424", "horizon-color": "#13233d", "fog-color": "#070d1a", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.4 });
          } catch {
            /* sky is cosmetic */
          }
          setZoom(map.getZoom());
          setReady(true);
        });
        map.on("sourcedata", (e) => {
          const id = (e as { sourceId?: string }).sourceId;
          if (!map || !(e as { isSourceLoaded?: boolean }).isSourceLoaded) return;
          if (id === "openmaptiles") setStatus((st) => (st.basemap.state === "ok" ? st : { ...st, basemap: { state: "ok" }, buildings: st.buildings.state === "error" ? st.buildings : { state: "ok" } }));
          if (id === "terrain") setStatus((st) => (st.terrain.state === "ok" ? st : { ...st, terrain: { state: "ok", message: TERRAIN_PROVIDERS[terrainProviderRef.current].label } }));
        });
        map.on("error", (e) => {
          const msg = (e as { error?: { message?: string } }).error?.message ?? "error";
          const id = (e as { sourceId?: string }).sourceId ?? "";
          if (id === "terrain" || id === "hillshade" || /mapterhorn|terrarium|elevation/i.test(msg)) {
            terrainErrors.current++;
            // Fall back to the second keyless provider after repeated failures.
            if (terrainErrors.current >= 4 && terrainProviderRef.current === "mapterhorn" && map) {
              terrainProviderRef.current = "aws";
              terrainErrors.current = 0;
              swapTerrain(map, "aws", exaggerationRef.current, modeRef.current === "3d" && layersRef.current.has("terrain"));
              setTerrainProvider("aws");
              setStatus((st) => ({ ...st, terrain: { state: "loading", message: "Primary terrain failed; switched to AWS Terrain Tiles" } }));
            } else if (terrainErrors.current >= 4) {
              setStatus((st) => ({ ...st, terrain: { state: "error", message: msg.slice(0, 120) } }));
            }
            return;
          }
          if (id === "openmaptiles" || /openfreemap/i.test(msg)) {
            setStatus((st) => ({ ...st, basemap: { state: "error", message: msg.slice(0, 120) } }));
            setTileError("Some basemap/building tiles failed to load. The map keeps working with what loaded.");
          }
        });
      } catch (e) {
        setEngineError(`The 3D engine failed to start: ${(e as Error).message}`);
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the map is created once
  }, []);

  // Feature snapshot for analysis: real OSM geometry from the loaded vector tiles.
  const collectFeatures = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    const view: BBox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const inView = (g: unknown) => {
      try {
        const v = (g as { coordinates: unknown }).coordinates;
        const pts = JSON.stringify(v).match(/-?\d+\.?\d*,-?\d+\.?\d*/g) ?? [];
        return pts.some((s) => {
          const [x, y] = s.split(",").map(Number) as [number, number];
          return x >= view[0] && x <= view[2] && y >= view[1] && y <= view[3];
        });
      } catch {
        return false;
      }
    };
    const raw: MappedFeature[] = [];
    const heights = new Map<string, number>();
    const z = map.getZoom();
    const keyOf = (f: MapGeoJSONFeature, prefix: string) => {
      if (f.id !== undefined && f.id !== null) return `${prefix}:${f.id}`;
      const c = JSON.stringify((f.geometry as { coordinates?: unknown }).coordinates ?? "").slice(0, 60);
      return `${prefix}:${c}`;
    };
    const liveData = liveRef.current.data;
    const useLive = buildingsModeRef.current === "live" && z >= 16 && liveData;
    if (useLive) {
      for (const f of liveData.features) {
        if (!inView(f.geometry)) continue;
        const id = `lb:${f.id}`;
        heights.set(id, f.properties.height);
        raw.push({ id, category: "building", name: f.properties.name, geometry: f.geometry });
      }
    } else if (z >= 14) {
      for (const f of map.querySourceFeatures("openmaptiles", { sourceLayer: "building" })) {
        if (!inView(f.geometry)) continue;
        const id = keyOf(f, "b");
        const h = Number(f.properties?.render_height);
        if (Number.isFinite(h)) heights.set(id, h);
        raw.push({ id, category: "building", name: (f.properties?.name as string | undefined) ?? null, geometry: f.geometry });
      }
    }
    if (z >= 11) {
      for (const f of map.querySourceFeatures("openmaptiles", { sourceLayer: "transportation" })) {
        const cls = String(f.properties?.class ?? "");
        if (["ferry", "path", "track", "rail", "transit"].includes(cls) || !inView(f.geometry)) continue;
        raw.push({ id: keyOf(f, "r"), category: "road", name: null, geometry: f.geometry });
      }
    }
    for (const fa of nearbyRef.current?.facilities ?? []) raw.push({ id: `f:${fa.id}`, category: "facility", name: fa.name, geometry: { type: "Point", coordinates: [fa.lon, fa.lat] } });
    const list = mergeFragments(raw);
    setFeatures({ list, heights, zoom: z, bbox: view, at: new Date().toISOString() });
  }, []);

  // ── map events ───────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let raf = 0;
    let elevTimer: ReturnType<typeof setTimeout> | undefined;
    let collectTimer: ReturnType<typeof setTimeout> | undefined;
    let urlTimer: ReturnType<typeof setTimeout> | undefined;

    const onMove = (e: MapMouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setCursor((c) => ({ lon: e.lngLat.lng, lat: e.lngLat.lat, elev: c?.elev ?? null })));
      clearTimeout(elevTimer);
      elevTimer = setTimeout(() => {
        elevationAt(e.lngLat.lng, e.lngLat.lat).then((elev) => setCursor({ lon: e.lngLat.lng, lat: e.lngLat.lat, elev }));
      }, 250);
    };
    let liveTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleLive = () => {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => {
        if (buildingsModeRef.current !== "live" || map.getZoom() < 16) return;
        const b = map.getBounds();
        const box = clampLiveBox({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
        const prev = liveRef.current.box;
        const c = map.getCenter();
        // Skip refetch while the centre stays well inside the area already loaded.
        if (prev && liveRef.current.data && c.lng > prev.west + (prev.east - prev.west) * 0.25 && c.lng < prev.east - (prev.east - prev.west) * 0.25 && c.lat > prev.south + (prev.north - prev.south) * 0.25 && c.lat < prev.north - (prev.north - prev.south) * 0.25) return;
        void fetchLive(box);
      }, 700);
    };
    const onMoveEnd = () => {
      setZoom(map.getZoom());
      scheduleLive();
      clearTimeout(collectTimer);
      collectTimer = setTimeout(() => map.once("idle", collectFeatures), 500);
      clearTimeout(urlTimer);
      urlTimer = setTimeout(() => {
        const c = map.getCenter();
        const qs = serializeViewState({ lat: c.lat, lon: c.lng, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), mode: modeRef.current, layers: Array.from(layersRef.current) });
        window.history.replaceState(null, "", `${window.location.pathname}?${qs}`);
      }, 600);
    };
    const onClick = (e: MapMouseEvent) => {
      const at: Position = [e.lngLat.lng, e.lngLat.lat];
      if (pickRef.current) {
        setScenario((s) => ({ ...s, seed: at }));
        setScenarioOn(true);
        setPickSeed(false);
        return;
      }
      const layerIds = INSPECTABLE.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none");
      const hits = map.queryRenderedFeatures(e.point, { layers: layerIds });
      const top = hits[0];
      if (!top) return setInspect({ kind: "point", at });
      const lid = top.layer.id;
      const p = top.properties ?? {};
      if (lid === "fac-clusters") {
        const src = map.getSource("facilities") as GeoJSONSource;
        void src.getClusterExpansionZoom(Number(p.cluster_id)).then((z) => map.easeTo({ center: e.lngLat, zoom: z, duration: reduced.current ? 0 : 600 })).catch(() => undefined);
        return;
      }
      if (lid === "fac-points") {
        const f = nearbyRef.current?.facilities.find((x) => x.id === p.id);
        if (f) return setInspect({ kind: "facility", f });
      }
      if (lid === "shelter-points") {
        const s = nearbyRef.current?.officialShelters.find((x) => x.id === p.id);
        if (s) return setInspect({ kind: "shelter", s });
      }
      if (lid === "alerts-fill") {
        const dto = hazardsRef.current?.hazards.find((h) => h.id === p.id);
        if (dto) return setInspect({ kind: "alert", dto });
      }
      if (lid === "live-buildings") {
        return setInspect({ kind: "live-building", height: Number(p.height), heightSource: String(p.heightSource), levels: p.levels == null || p.levels === "null" ? null : Number(p.levels), name: (p.name as string | null) ?? null, edited: (p.edited as string | null) ?? null, osmId: String(p.osmId), at });
      }
      if (lid.startsWith("scenario-cells")) return setInspect({ kind: "cell", depth: Number(p.depth), at });
      if (lid === "building-3d" || lid === "building-flat" || lid === "exposed-bldg") {
        const h = Number(p.render_height ?? p.height);
        return setInspect({ kind: "building", height: Number.isFinite(h) ? h : null, name: (p.name as string | undefined) ?? null, at });
      }
      if (lid.startsWith("roads-")) return setInspect({ kind: "road", cls: (p.class as string | undefined) ?? null, at });
      setInspect({ kind: "point", at });
    };
    const pointer = () => (map.getCanvas().style.cursor = pickRef.current ? "crosshair" : "pointer");
    const unpointer = () => (map.getCanvas().style.cursor = pickRef.current ? "crosshair" : "");
    map.on("mousemove", onMove);
    map.on("moveend", onMoveEnd);
    map.on("click", onClick);
    for (const id of ["fac-points", "fac-clusters", "shelter-points", "alerts-fill", "scenario-cells-3d"]) {
      map.on("mouseenter", id, pointer);
      map.on("mouseleave", id, unpointer);
    }
    onMoveEnd();
    return () => {
      map.off("mousemove", onMove);
      map.off("moveend", onMoveEnd);
      map.off("click", onClick);
      for (const id of ["fac-points", "fac-clusters", "shelter-points", "alerts-fill", "scenario-cells-3d"]) {
        map.off("mouseenter", id, pointer);
        map.off("mouseleave", id, unpointer);
      }
      cancelAnimationFrame(raf);
      clearTimeout(elevTimer);
      clearTimeout(collectTimer);
      clearTimeout(urlTimer);
      clearTimeout(liveTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchLive is stable (refs only)
  }, [ready, collectFeatures]);


  useEffect(() => {
    const map = mapRef.current;
    if (map && ready) map.getCanvas().style.cursor = pickSeed ? "crosshair" : "";
  }, [pickSeed, ready]);

  // ── push data to the map ─────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    setGeo(mapRef.current, "alerts", {
      type: "FeatureCollection",
      features: official.flatMap(({ dto, zone }) =>
        (zone.geometry.type === "MultiPolygon" ? zone.geometry.coordinates : [zone.geometry.coordinates]).map((rings) => ({
          type: "Feature" as const,
          properties: { id: dto.id, color: SEVERITY_COLOR[dto.severity], approx: dto.areaSource !== "CAP_POLYGON" },
          geometry: { type: "Polygon", coordinates: rings },
        })),
      ),
    });
    const b = hazards.data?.boundary;
    const bp = b ? latLonRingsToPolygons(b.polygons).polygons : [];
    setGeo(mapRef.current, "boundary", { type: "FeatureCollection", features: bp.map((p) => ({ type: "Feature" as const, properties: {}, geometry: p })) });
  }, [ready, official, hazards.data]);

  useEffect(() => {
    if (!ready) return;
    const facs = (nearby.data?.facilities ?? []).filter((f) => facFilter.has(f.kind));
    setGeo(mapRef.current, "facilities", { type: "FeatureCollection", features: facs.map((f) => ({ type: "Feature" as const, properties: { id: f.id, color: FACILITY_COLOR[f.kind] }, geometry: { type: "Point", coordinates: [f.lon, f.lat] } })) });
    const sh = (nearby.data?.officialShelters ?? []).filter((s) => s.lat != null && s.lon != null);
    setGeo(mapRef.current, "shelters", { type: "FeatureCollection", features: sh.map((s) => ({ type: "Feature" as const, properties: { id: s.id }, geometry: { type: "Point", coordinates: [s.lon, s.lat] } })) });
  }, [ready, nearby.data, facFilter]);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    setGeo(map, "seed", scenario.seed && scenarioOn ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: scenario.seed } }] } : EMPTY);
    if (scenarioOn && scenario.type === "zone" && scenario.seed) {
      setGeo(map, "scenario-zone", { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circlePolygon(scenario.seed, scenario.radius)] } }] });
    } else setGeo(map, "scenario-zone", EMPTY);
    if (inundation && "res" in inundation && inundation.res && grid) {
      setGeo(map, "scenario-cells", { type: "FeatureCollection", features: inundationCells(grid.grid, inundation.res) as unknown as Feat[] });
    } else setGeo(map, "scenario-cells", EMPTY);
  }, [ready, scenario, scenarioOn, inundation, grid]);

  useEffect(() => {
    if (!ready) return;
    const feats: Feat[] = [];
    const push = (r: ExposureResult | null, set: "baseline" | "scenario") => {
      for (const f of (r?.intersecting ?? []).slice(0, 2500)) {
        const parts: unknown[] = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates.map((c) => ({ type: "Polygon", coordinates: c })) : f.geometry.type === "MultiLineString" ? f.geometry.coordinates.map((c) => ({ type: "LineString", coordinates: c })) : [f.geometry];
        const h = features.heights.get(f.id);
        for (const g of parts) feats.push({ type: "Feature", properties: { set, name: f.name, ...(h !== undefined ? { height: h } : {}) }, geometry: g });
      }
    };
    if (compare !== "scenario") push(baseline, "baseline");
    if (compare !== "baseline") push(scenarioExposure, "scenario");
    setGeo(mapRef.current, "exposed", { type: "FeatureCollection", features: feats });
  }, [ready, baseline, scenarioExposure, compare, features.heights]);

  // Layer visibility, 2D/3D, terrain.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const vis = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    (Object.keys(LAYER_GROUPS) as LayerId[]).forEach((g) => LAYER_GROUPS[g].forEach((id) => vis(id, layers.has(g))));
    const liveOn = buildingsMode === "live" && zoom >= 16 && Boolean(live.data);
    vis("building-3d", layers.has("buildings") && mode === "3d" && !liveOn);
    vis("building-flat", layers.has("buildings") && mode === "2d" && !liveOn);
    vis("live-buildings", layers.has("buildings") && liveOn);
    vis("live-box", layers.has("buildings") && liveOn);
    vis("scenario-cells-3d", layers.has("scenario") && mode === "3d" && compare !== "baseline");
    vis("scenario-cells-2d", layers.has("scenario") && mode === "2d" && compare !== "baseline");
    for (const id of ["scenario-zone-fill", "scenario-zone-line"]) vis(id, layers.has("scenario") && compare !== "baseline");
    for (const id of LAYER_GROUPS.alerts) vis(id, layers.has("alerts") && compare !== "scenario");
  }, [ready, layers, mode, compare, buildingsMode, zoom, live.data]);

  // Terrain only changes when its inputs change (re-applying it on every move is expensive).
  const terrainOn = layers.has("terrain");
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    try {
      map.setTerrain(mode === "3d" && terrainOn ? { source: "terrain", exaggeration } : null);
      if (map.getLayer("scenario-cells-3d")) map.setPaintProperty("scenario-cells-3d", "fill-extrusion-height", ["*", ["get", "depth"], exaggeration]);
    } catch {
      /* terrain unavailable */
    }
  }, [ready, mode, terrainOn, exaggeration]);

  // Push live buildings to the map.
  useEffect(() => {
    if (!ready) return;
    setGeo(mapRef.current, "live-buildings", (live.data as unknown as FC) ?? EMPTY);
    const b = live.box;
    setGeo(mapRef.current, "live-box", b ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north], [b.west, b.south]] } }] } : EMPTY);
    if (live.data) mapRef.current?.once("idle", collectFeatures);
  }, [ready, live.data, live.box, collectFeatures]);

  // ── actions ──────────────────────────────────────────────────────────────
  async function fetchLive(box: { west: number; south: number; east: number; north: number }) {
    liveCtrl.current?.abort();
    const c = new AbortController();
    liveCtrl.current = c;
    setLive((l) => ({ ...l, loading: true, error: null }));
    setStatus((st) => ({ ...st, buildings: { state: "loading", message: "Fetching live OSM buildings…" } }));
    try {
      const qs = new URLSearchParams({ west: box.west.toFixed(5), south: box.south.toFixed(5), east: box.east.toFixed(5), north: box.north.toFixed(5) });
      const data = await apiFetch<LiveBuildings & { fetchedAt: string; cached?: boolean; stale?: boolean; error?: string; bbox: typeof box }>(`/api/osm/buildings?${qs}`, { signal: c.signal, timeoutMs: 45_000 });
      if (c.signal.aborted) return;
      setLive({ data, loading: false, error: data.stale ? (data.error ?? null) : null, box: data.bbox ?? box });
      setStatus((st) => ({ ...st, buildings: { state: "ok", message: `${data.summary.count} live OSM buildings` } }));
    } catch (e) {
      if (c.signal.aborted || (e as ApiError).code === "ABORTED") return;
      setLive((l) => ({ ...l, loading: false, error: (e as ApiError).message }));
      setStatus((st) => ({ ...st, buildings: { state: "error", message: `Live buildings unavailable — showing weekly tiles. ${(e as ApiError).message}` } }));
    }
  }

  const geolocate = () => {
    if (!("geolocation" in navigator)) return setTileError("Location is not available in this browser. Search a place instead.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        // Rounded to ~1 km before it leaves the device.
        const lat = Math.round(pos.coords.latitude * 100) / 100;
        const lon = Math.round(pos.coords.longitude * 100) / 100;
        try {
          const r = await apiFetch<{ place: SearchResult }>(`/api/geo/reverse?lat=${lat}&lon=${lon}`);
          setFocus({ ...r.place, lat, lon });
        } catch {
          setFocus({ label: `${lat}, ${lon}`, district: null, state: null, lat, lon });
        }
        setLocating(false);
        flyTo(lon, lat, 16);
      },
      (err) => {
        setLocating(false);
        setTileError(err.code === err.PERMISSION_DENIED ? "Location permission denied — search a place instead." : "Couldn't get your location — search a place instead.");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const flyTo = useCallback((lon: number, lat: number, z = 14.5) => {
    mapRef.current?.flyTo({ center: [lon, lat], zoom: z, pitch: modeRef.current === "3d" ? 60 : 0, bearing: modeRef.current === "3d" ? -20 : 0, duration: reduced.current ? 0 : 2600, essential: false });
  }, []);

  const onSearch = (r: SearchResult) => {
    setFocus({ label: r.label, district: r.district, state: r.state, lat: r.lat, lon: r.lon });
    setEventId(null);
    setInspect(null);
    setRoute((x) => ({ ...x, risks: [], to: null }));
    setGeo(mapRef.current, "routes", EMPTY);
    flyTo(r.lon, r.lat, 16);
  };

  const useCentre = async () => {
    const c = mapRef.current?.getCenter();
    if (!c) return;
    try {
      const r = await apiFetch<{ place: SearchResult }>(`/api/geo/reverse?lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}`);
      setFocus({ ...r.place, lat: c.lat, lon: c.lng });
    } catch (e) {
      setFocus({ label: `${c.lat.toFixed(3)}, ${c.lng.toFixed(3)}`, district: null, state: null, lat: c.lat, lon: c.lng });
      setTileError((e as ApiError).message);
    }
  };

  const setModeAnimated = (m: "3d" | "2d") => {
    setMode(m);
    mapRef.current?.easeTo({ pitch: m === "3d" ? 58 : 0, bearing: m === "3d" ? -15 : 0, duration: reduced.current ? 0 : 900 });
  };

  const resetCamera = () => {
    const f = focus ?? INDIA;
    mapRef.current?.flyTo({ center: [f.lon, f.lat], zoom: f === INDIA ? 4.2 : 13, pitch: mode === "3d" ? 55 : 0, bearing: mode === "3d" ? -15 : 0, duration: reduced.current ? 0 : 1500 });
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await wrapRef.current?.requestFullscreen();
    } catch {
      /* not allowed */
    }
  };
  useEffect(() => {
    const on = () => {
      setFullscreen(Boolean(document.fullscreenElement));
      setTimeout(() => mapRef.current?.resize(), 50);
    };
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked */
    }
  };

  const loadEventFor = (id: string | null) => {
    setEventId(id);
    const e = officialAll.list.find((o) => o.dto.id === id);
    if (!e) return;
    const pts = (e.zone.geometry.type === "MultiPolygon" ? e.zone.geometry.coordinates.flat(2) : e.zone.geometry.coordinates.flat()) as Position[];
    const b = bboxOfPositions(pts);
    mapRef.current?.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 80, pitch: mode === "3d" ? 50 : 0, duration: reduced.current ? 0 : 1800 });
  };

  const sampleTerrain = async () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    let west = b.getWest();
    let east = b.getEast();
    let south = b.getSouth();
    let north = b.getNorth();
    if (east - west > MAX_SPAN_DEG || north - south > MAX_SPAN_DEG) {
      const c = map.getCenter();
      west = c.lng - MAX_SPAN_DEG / 2;
      east = c.lng + MAX_SPAN_DEG / 2;
      south = c.lat - MAX_SPAN_DEG / 2;
      north = c.lat + MAX_SPAN_DEG / 2;
    }
    setGridState({ loading: true, error: null });
    try {
      const g = await loadElevationGrid({ west, south, east, north }, GRID, GRID);
      if (g.failedTiles === g.tiles) throw new Error("No elevation tiles could be loaded");
      setGrid(g);
      setGridState({ loading: false, error: null });
      if (!scenario.seed || !positionToCell(g.grid, scenario.seed)) {
        const c = map.getCenter();
        setScenario((s) => ({ ...s, seed: [c.lng, c.lat] }));
      }
      setScenarioOn(true);
    } catch (e) {
      setGridState({ loading: false, error: (e as Error).message });
    }
  };

  const resetScenario = () => {
    setScenarioOn(false);
    setGrid(null);
    setPickSeed(false);
    setScenario({ type: scenario.type, seed: null, rise: 2, radius: 1500 });
    setCompare("both");
  };

  const checkRoute = async (to: { lat: number; lon: number; name: string }) => {
    const from = focus && focus !== INDIA ? focus : null;
    const c = mapRef.current?.getCenter();
    const fromLat = from?.lat ?? c?.lat;
    const fromLon = from?.lon ?? c?.lng;
    if (fromLat == null || fromLon == null) return;
    setRoute({ loading: true, error: null, to: to.name, risks: [], routedAt: null });
    setRightTab("analysis");
    setSheet((s) => (s ? "analysis" : s));
    try {
      const qs = new URLSearchParams({ fromLat: fromLat.toFixed(4), fromLon: fromLon.toFixed(4), toLat: to.lat.toFixed(4), toLon: to.lon.toFixed(4) });
      if (focus?.district) qs.set("district", focus.district);
      if (focus?.state) qs.set("state", focus.state);
      const r = await apiFetch<RouteResponse>(`/api/route?${qs}`, { timeoutMs: 30_000 });
      const hz: RouteHazard[] = official.map(({ dto, zone }) => ({ id: dto.id, label: `${dto.issuer} · ${dto.severity}`, geometry: zone.geometry, severity: dto.severity, sourceCategory: "OFFICIAL", issuedAt: dto.issuedAt, expiresAt: dto.expiresAt, evidenceUrl: dto.capUrl }));
      if (scenarioZone && "geometry" in scenarioZone) hz.push({ id: "scenario", label: scenarioZone.label, geometry: scenarioZone.geometry, severity: "Unknown", sourceCategory: "UNVERIFIED", issuedAt: null, expiresAt: null, simulated: true });
      const closures = r.roadClosures.map((x) => ({ road: x.road, status: x.status, sourceUrl: x.evidence.sourceUrl, retrievedAt: x.evidence.retrievedAt }));
      const risks = r.alternatives.map((a) => {
        const path = a.path.map(([la, lo]) => [lo, la] as Position);
        return { ...scoreRoute({ path, hazards: hz, closures, unmappedAlerts: r.unmappedAlerts.length }), distanceKm: a.distanceKm, durationMin: a.durationMin, provider: a.provider, path };
      });
      // Lowest exposure first, then the shortest time — the same rule as the 2D map.
      const order = risks.map((x, i) => i).sort((i, j) => (risks[i]!.exposureIndex - risks[j]!.exposureIndex) || (risks[i]!.durationMin - risks[j]!.durationMin));
      const sorted = order.map((i) => risks[i]!);
      setGeo(mapRef.current, "routes", { type: "FeatureCollection", features: sorted.map((x, i) => ({ type: "Feature" as const, properties: { best: i === 0 }, geometry: { type: "LineString", coordinates: x.path } })) });
      setRoute({ loading: false, error: null, to: to.name, risks: sorted, routedAt: r.routedAt });
    } catch (e) {
      setRoute({ loading: false, error: (e as ApiError).message, to: to.name, risks: [], routedAt: null });
    }
  };

  const toggleLayer = (id: LayerId, on: boolean) =>
    setLayers((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });

  // ── render pieces ────────────────────────────────────────────────────────
  const hzData = hazards.data;
  const feedLive = hzData?.feed.dataMode === "LIVE";
  const swatch = (c: string, dashed = false) => <span className={cn("inline-block h-2.5 w-4 rounded-sm", dashed && "border border-dashed bg-transparent")} style={dashed ? { borderColor: c } : { background: c }} aria-hidden />;

  const statusDot = (st: "loading" | "ok" | "error") => <span className={cn("inline-block size-2 rounded-full", st === "ok" ? "bg-emerald-400" : st === "error" ? "bg-red-400" : "animate-pulse bg-amber-300")} aria-hidden />;
  const layersPanel = (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-1 text-[11px]" aria-label="Map data status">
        {([["Basemap", status.basemap], ["Buildings", status.buildings], ["Terrain", status.terrain]] as const).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5 rounded-md border border-white/10 px-2 py-1" title={v.message}>
            {statusDot(v.state)} <span className="text-slate-300">{k}</span>
          </div>
        ))}
      </div>
      <div>
        <SectionTitle right={hasArea ? <button type="button" onClick={hazards.reload} className="text-[11px] text-cyan-300 hover:underline" aria-label="Refresh official alerts"><RefreshCw className="inline size-3" /> Refresh</button> : null}>Real observations</SectionTitle>
        <Toggle
          checked={layers.has("alerts")}
          onChange={(v) => toggleLayer("alerts", v)}
          label="Official alert areas"
          swatch={swatch("#ef4444")}
          meta={
            !hasArea ? "Search an Indian location to load official alerts." : hazards.loading && !hzData ? "Loading from NDMA SACHET…" : hazards.error ? `Unavailable: ${hazards.error.message}` : (
              <>
                {official.length} drawn · NDMA SACHET · {feedLive ? "live" : hzData?.feed.dataMode.toLowerCase()} · retrieved {relativeTime(hzData?.feed.retrievedAt ?? null)}
                {officialAll.unmapped ? ` · ${officialAll.unmapped} without published area` : ""}
              </>
            )
          }
        />
        <Toggle checked={layers.has("boundary")} onChange={(v) => toggleLayer("boundary", v)} label="District boundary" swatch={swatch("#94a3b8", true)} meta={hzData?.boundary ? `${hzData.boundary.source}` : "Shown when an alert names the district"} />
        <Toggle checked={false} onChange={() => undefined} disabled label="Observed flood depth" swatch={swatch("#0284c7")} meta="No observed flood-depth dataset is connected. Depths appear only in a labelled simulation." />
        <div className="mt-1 rounded-lg border border-white/5 bg-white/[0.02] p-2">
          <p className="mb-1 text-[11px] text-slate-400">Road closures on official pages</p>
          {hzData?.roadClosures.length ? (
            <ul className="space-y-1 text-[11px]">
              {hzData.roadClosures.slice(0, 5).map((r, i) => (
                <li key={i}>
                  <span className="text-amber-200">{r.road}</span> — {r.status}{" "}
                  <a className="text-cyan-300 hover:underline" href={r.evidence.sourceUrl} target="_blank" rel="noopener noreferrer">source</a> · {relativeTime(r.evidence.retrievedAt)}
                </li>
              ))}
              <li className="text-slate-500">Not drawn: official pages publish names, not coordinates.</li>
            </ul>
          ) : (
            <p className="text-[11px] text-slate-500">None found for this district. That does not mean roads are open.</p>
          )}
        </div>
      </div>

      <div>
        <SectionTitle>Filter incidents</SectionTitle>
        <div className="flex flex-wrap gap-1">
          {SEVERITIES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={sevFilter.has(s)}
              onClick={() => setSevFilter((f) => { const n = new Set(f); if (n.has(s)) n.delete(s); else n.add(s); return n; })}
              className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]", sevFilter.has(s) ? "border-white/30 bg-white/10" : "border-white/10 text-slate-500")}
            >
              <span className="size-2 rounded-full" style={{ background: SEVERITY_COLOR[s] }} /> {s === "Unknown" ? "Not stated" : s}
            </button>
          ))}
        </div>
        <label className="mt-2 flex items-center gap-2 text-[12px] text-slate-300">
          <input type="checkbox" checked={includeApprox} onChange={(e) => setIncludeApprox(e.target.checked)} className="accent-cyan-400" /> Include approximate (district-boundary) areas
        </label>
      </div>

      <div>
        <SectionTitle>Emergency</SectionTitle>
        <Toggle
          checked={layers.has("facilities")}
          onChange={(v) => toggleLayer("facilities", v)}
          label="Hospitals, police, fire, shelters"
          swatch={swatch("#ef4444")}
          meta={nearby.loading && !nearby.data ? "Loading from OpenStreetMap…" : nearby.error ? `Unavailable: ${nearby.error.message}` : nearby.data ? `${nearby.data.facilities.length} within 10 km · community-mapped · ${relativeTime(nearby.data.osm.fetchedAt)}` : "Search a location"}
        />
        <div className="ml-9 flex flex-wrap gap-1">
          {(Object.keys(FACILITY_COLOR) as FacilityKind[]).map((k) => (
            <button key={k} type="button" aria-pressed={facFilter.has(k)} onClick={() => setFacFilter((f) => { const n = new Set(f); if (n.has(k)) n.delete(k); else n.add(k); return n; })} className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]", facFilter.has(k) ? "border-white/25 bg-white/10" : "border-white/10 text-slate-500")}>
              <span className="size-2 rounded-full" style={{ background: FACILITY_COLOR[k] }} /> {FACILITY_LABEL[k]}
            </button>
          ))}
        </div>
        <Toggle checked={layers.has("shelters")} onChange={(v) => toggleLayer("shelters", v)} label="Shelters on official pages" swatch={swatch("#2dd4bf")} meta={`${quality.shelters?.features ?? 0} mapped · quote-verified by the research agent`} />
        <Toggle checked={layers.has("routes")} onChange={(v) => toggleLayer("routes", v)} label="Route check" swatch={swatch("#22d3ee")} meta="OSRM road route to a selected facility. Not an official evacuation route." />
      </div>

      <div>
        <SectionTitle>Geography</SectionTitle>
        <Toggle
          checked={layers.has("buildings")}
          onChange={(v) => toggleLayer("buildings", v)}
          label="3D buildings (OpenStreetMap)"
          swatch={<Building2 className="size-3.5 text-slate-300" />}
          meta={
            buildingsMode === "live" && zoom >= 16
              ? live.loading
                ? "Fetching live buildings from the OSM database…"
                : live.data
                  ? `${live.data.summary.count} live buildings${live.data.summary.truncated ? " (limit reached)" : ""} · ${live.data.summary.withHeightTag + live.data.summary.withLevels} with mapped height · newest edit ${relativeTime(live.data.summary.newestEdit)} · fetched ${relativeTime(live.data.fetchedAt)}`
                  : live.error ?? "Waiting for the map to settle…"
              : zoom < 13
                ? "Zoom in to street level (13+) to see buildings."
                : `Weekly OSM snapshot${snapshot ? ` of ${snapshot}` : ""} (OpenFreeMap tiles)${buildingsMode === "live" ? " · zoom to 16+ for live data" : ""}`
          }
        />
        <div className="ml-9 grid grid-cols-2 gap-1 rounded-lg border border-white/10 p-0.5" role="radiogroup" aria-label="Building data source">
          {(["live", "tiles"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={buildingsMode === m}
              onClick={() => {
                setBuildingsMode(m);
                if (m === "live" && zoom >= 16) {
                  const b = mapRef.current?.getBounds();
                  if (b) void fetchLive(clampLiveBox({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }));
                }
              }}
              className={cn("rounded-md py-1 text-[11px]", buildingsMode === m ? "bg-cyan-400/15 text-cyan-100" : "text-slate-400 hover:text-slate-100")}
            >
              {m === "live" ? "Live OSM (Overpass)" : "Weekly tiles"}
            </button>
          ))}
        </div>
        {live.error && buildingsMode === "live" ? <p className="ml-9 mt-1 text-[11px] text-amber-200">{live.error}</p> : null}
        <p className="ml-9 mt-1 text-[10px] text-slate-500">Bright blue = height from OSM tags · dark = no height mapped (drawn at a default height).</p>
        <Toggle
          checked={layers.has("terrain")}
          onChange={(v) => toggleLayer("terrain", v)}
          label="Terrain & hillshade"
          swatch={<Box className="size-3.5 text-slate-300" />}
          meta={`${TERRAIN_PROVIDERS[terrainProvider].label} · ~30 m elevation · ${status.terrain.state === "ok" ? "loaded" : status.terrain.state === "error" ? `error: ${status.terrain.message ?? ""}` : status.terrain.message ?? "loading…"}`}
        />
        <label className="ml-9 block">
          <span className="flex justify-between text-[11px] text-slate-400">
            Vertical exaggeration <span className="num text-slate-200">×{exaggeration.toFixed(1)}</span>
          </span>
          <input type="range" min={1} max={5} step={0.1} value={exaggeration} onChange={(e) => setExaggeration(Number(e.target.value))} className="w-full accent-cyan-400" aria-label="Terrain vertical exaggeration" disabled={mode !== "3d"} />
          <span className="text-[10px] text-slate-500">Plains such as the Ganga basin are nearly flat — raise this to see relief.</span>
        </label>
        <Toggle checked={layers.has("exposure")} onChange={(v) => toggleLayer("exposure", v)} label="Exposed mapped features" swatch={swatch("#f59e0b")} meta="Amber = official area · purple = simulation" />
      </div>

      <details className="rounded-lg border border-white/5 bg-white/[0.02] p-2 text-[11px] text-slate-400">
        <summary className="cursor-pointer text-slate-300">Data quality</summary>
        <ul className="mt-2 space-y-2">
          {Object.values(quality).map((q) => (
            <li key={q.layer}>
              <div className="flex flex-wrap items-center gap-1.5 text-slate-200">
                {q.layer} <Pill tone={q.freshness === "LIVE" ? "live" : q.freshness === "STALE" ? "warn" : "neutral"}>{q.freshness.toLowerCase().replace("_", " ")}</Pill>
              </div>
              <div>{VERIFICATION_LABEL[q.verification]} · {q.source} · {q.retrievedAt ? `retrieved ${relativeTime(q.retrievedAt)}` : "timestamp unavailable"}</div>
              {q.uncertainty.map((u, i) => (
                <div key={i} className="text-amber-200/80">• {u}</div>
              ))}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );

  const inun = inundation && "res" in inundation ? inundation : null;
  const scenarioPanel = (
    <div className="space-y-3">
      <div className="rounded-lg border border-purple-400/40 bg-purple-500/10 p-2 text-[11px] font-semibold tracking-wide text-purple-100">{SIMULATION_LABEL}</div>
      <div>
        <SectionTitle>1 · Real event (optional)</SectionTitle>
        <select
          aria-label="Load an active official alert"
          value={eventId ?? ""}
          onChange={(e) => loadEventFor(e.target.value || null)}
          className="h-9 w-full rounded-lg border border-white/10 bg-slate-900 px-2 text-[13px] text-slate-100"
          disabled={!officialAll.list.length}
        >
          <option value="">{officialAll.list.length ? `All active official areas (${officialAll.list.length})` : "No mapped official alerts here"}</option>
          {officialAll.list.map(({ dto }) => (
            <option key={dto.id} value={dto.id}>
              {dto.severity} · {dto.issuer} · {dto.headline.slice(0, 60)}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-slate-500">This is the baseline: real, official areas.</p>
      </div>
      <div>
        <SectionTitle>2 · Hypothetical scenario</SectionTitle>
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 p-1" role="radiogroup" aria-label="Scenario model">
          {(["flood", "zone"] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={scenario.type === t} onClick={() => setScenario((s) => ({ ...s, type: t }))} className={cn("flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px]", scenario.type === t ? "bg-purple-500/25 text-purple-50" : "text-slate-300 hover:bg-white/5")}>
              {t === "flood" ? <Droplets className="size-3.5" /> : <Crosshair className="size-3.5" />} {t === "flood" ? "Water level" : "Hazard zone"}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
          {scenario.type === "flood"
            ? "Raises water above the ground at a chosen point and spreads it to connected lower ground, using real elevation. No rainfall, flow, drainage, embankments or timing — an illustration, not a hydraulic model."
            : "A circle of chosen radius around a point — for cyclone, landslide, industrial or other what-if zones."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setPickSeed((v) => !v)} aria-pressed={pickSeed} className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px]", pickSeed ? "border-purple-400 bg-purple-500/25" : "border-white/10 hover:bg-white/10")}>
          <Crosshair className="size-3.5" /> {pickSeed ? "Click the map…" : scenario.seed ? "Move point" : "Pick point on map"}
        </button>
        {scenario.type === "flood" ? (
          <button type="button" onClick={sampleTerrain} disabled={gridState.loading || zoom < 9} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] hover:bg-white/10 disabled:opacity-40">
            {gridState.loading ? <Loader2 className="size-3.5 animate-spin" /> : <Activity className="size-3.5" />} {grid ? "Re-sample this view" : "Sample terrain & run"}
          </button>
        ) : (
          <button type="button" onClick={() => { const c = mapRef.current?.getCenter(); if (!scenario.seed && c) setScenario((s) => ({ ...s, seed: [c.lng, c.lat] })); setScenarioOn(true); }} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] hover:bg-white/10">
            <Activity className="size-3.5" /> Run
          </button>
        )}
        <button type="button" onClick={resetScenario} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] hover:bg-white/10">
          <RotateCcw className="size-3.5" /> Reset
        </button>
      </div>
      {scenario.type === "flood" && zoom < 9 ? <p className="text-[11px] text-amber-200">Zoom in to a town or district (zoom 9+) to run the water-level model.</p> : null}
      {gridState.error ? <p className="text-[11px] text-red-300">Elevation unavailable: {gridState.error}</p> : null}

      {scenario.type === "flood" ? (
        <label className="block">
          <span className="flex justify-between text-[12px] text-slate-300">
            Water level above ground at point <span className="num font-semibold text-purple-100">+{scenario.rise.toFixed(1)} m</span>
          </span>
          <input type="range" min={0.5} max={15} step={0.5} value={scenario.rise} onChange={(e) => setScenario((s) => ({ ...s, rise: Number(e.target.value) }))} className="mt-1 w-full accent-purple-400" aria-label="Water level in metres" />
        </label>
      ) : (
        <label className="block">
          <span className="flex justify-between text-[12px] text-slate-300">
            Radius <span className="num font-semibold text-purple-100">{(scenario.radius / 1000).toFixed(1)} km</span>
          </span>
          <input type="range" min={100} max={10_000} step={100} value={scenario.radius} onChange={(e) => setScenario((s) => ({ ...s, radius: Number(e.target.value) }))} className="mt-1 w-full accent-purple-400" aria-label="Radius in metres" />
        </label>
      )}

      {scenarioOn && scenario.type === "flood" ? (
        inundation && "outside" in inundation ? (
          <p className="text-[11px] text-amber-200">The point is outside the sampled area — re-sample this view.</p>
        ) : inundation && "noData" in inundation ? (
          <p className="text-[11px] text-amber-200">No elevation data at this point.</p>
        ) : inun?.res ? (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-1.5">
              <Stat tone="sim" label="Area" value={`${inun.res.areaKm2.toFixed(2)} km²`} />
              <Stat tone="sim" label="Max depth" value={`${inun.res.maxDepth.toFixed(1)} m`} />
              <Stat tone="sim" label="Mean depth" value={`${inun.res.meanDepth.toFixed(1)} m`} />
            </div>
            <p className="text-[11px] text-slate-400">
              Ground at point {inun.ground.toFixed(0)} m · water surface {(inun.ground + scenario.rise).toFixed(1)} m above sea level · {GRID}×{GRID} cells from zoom-{grid?.zoom} elevation tiles
              {grid?.failedTiles ? ` · ${grid.failedTiles} tile(s) missing` : ""}
            </p>
            {inun.res.touchesEdge ? <p className="text-[11px] text-amber-200">Water reaches the edge of the sampled area — the real extent of connected low ground may be larger. Zoom out and re-sample.</p> : null}
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {DEPTH_BANDS.map((b) => (
                <span key={b.label} className="flex items-center gap-1 text-[11px] text-slate-300">
                  <span className="inline-block size-2.5 rounded-sm" style={{ background: b.color }} /> {b.label}
                </span>
              ))}
            </div>
          </div>
        ) : null
      ) : null}

      <div>
        <SectionTitle>3 · Compare</SectionTitle>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-white/10 p-1" role="radiogroup" aria-label="Comparison view">
          {(["baseline", "scenario", "both"] as const).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={compare === c} onClick={() => setCompare(c)} className={cn("rounded-md py-1.5 text-[12px] capitalize", compare === c ? "bg-white/15 text-white" : "text-slate-300 hover:bg-white/5")}>
              {c === "baseline" ? "Official" : c === "scenario" ? "Scenario" : "Both"}
            </button>
          ))}
        </div>
      </div>
      <CompareTable baseline={baseline} scenario={scenarioExposure} />
    </div>
  );

  const analysisPanel = (
    <div className="space-y-4">
      <div>
        <SectionTitle right={features.at ? <span className="text-[10px] text-slate-500">view analysed {relativeTime(features.at)}</span> : null}>Mapped-feature exposure</SectionTitle>
        <p className="mb-2 text-[11px] text-slate-400">Features whose geometry intersects a hazard area. This is exposure of features mapped in OpenStreetMap — not confirmed damage.</p>
        {coverageNote ? <p className="mb-2 rounded-md bg-amber-400/10 p-2 text-[11px] text-amber-200">{coverageNote}</p> : null}
        <ExposureCard title="Official alert areas" result={baseline} empty={!official.length ? "No official alert areas are drawn in this view." : null} tone="warn" />
        <div className="h-2" />
        <ExposureCard title="Scenario (simulated)" result={scenarioExposure} empty={!scenarioZone ? "Run a scenario to compare." : null} tone="sim" />
        <p className="mt-2 text-[10px] text-slate-500">{features.list.length} mapped features loaded in view (tile fragments merged by id). Roads without ids may count once per tile segment.</p>
      </div>

      <div>
        <SectionTitle>Route check</SectionTitle>
        {!route.to && !route.loading ? <p className="text-[11px] text-slate-400">Click a hospital, shelter or facility on the map and choose “Check route”.</p> : null}
        {route.loading ? (
          <p className="flex items-center gap-2 text-[12px] text-slate-300"><Loader2 className="size-3.5 animate-spin" /> Routing to {route.to}…</p>
        ) : null}
        {route.error ? <p className="text-[12px] text-red-300">{route.error}</p> : null}
        {route.risks.length ? (
          <div className="space-y-2">
            <p className="text-[12px] text-slate-300">To <span className="font-medium text-white">{route.to}</span> · {route.risks.length} alternative(s), ranked by exposure index then time</p>
            {route.risks.map((r, i) => (
              <details key={i} open={i === 0} className={cn("rounded-lg border p-2 text-[12px]", i === 0 ? "border-cyan-400/40 bg-cyan-400/5" : "border-white/10")}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <span className="font-semibold">{i === 0 ? "Lowest exposure" : `Alternative ${i + 1}`}</span>
                  <span className="num text-slate-300">{r.distanceKm.toFixed(1)} km · {r.durationMin} min</span>
                  <Pill tone={r.status === "NO_MAPPED_HAZARD_FOUND" ? "neutral" : "danger"}>{r.status === "ENTERS_HAZARD_AREA" ? `Enters official area ${r.kmInsideOfficial} km` : r.status === "REPORTED_CLOSURE_ON_ROUTE" ? "Reported closure on route" : "No mapped hazard found"}</Pill>
                  <span className="num text-slate-400">index {r.exposureIndex}</span>
                </summary>
                <ul className="mt-2 space-y-1 text-[11px] text-slate-300">
                  {r.factors.map((f, k) => (
                    <li key={k}>
                      {f.type === "SIMULATED_AREA" ? <Pill tone="sim">simulated</Pill> : f.type === "REPORTED_CLOSURE" ? <Pill tone="danger">closure</Pill> : <Pill tone="warn">official</Pill>} {f.label}
                      {f.km != null ? ` — ${f.km} km inside` : ""}
                      {f.weight ? ` × severity ${f.weight} × reliability ${f.reliability} × freshness (${f.freshness}) = ${f.contribution}` : ""}
                      {f.evidenceUrl ? <> · <a className="text-cyan-300 hover:underline" href={f.evidenceUrl} target="_blank" rel="noopener noreferrer">evidence</a></> : null}
                    </li>
                  ))}
                  {r.warnings.map((w, k) => (
                    <li key={`w${k}`} className="text-amber-200/90">• {w}</li>
                  ))}
                </ul>
              </details>
            ))}
            <p className="text-[10px] text-slate-500">Index = Σ km inside × severity (1–4) × source reliability × freshness. Relative, not a probability.</p>
          </div>
        ) : null}
      </div>
    </div>
  );

  // ── layout ───────────────────────────────────────────────────────────────
  return (
    <div ref={wrapRef} className={cn("relative -mx-3 -my-5 overflow-hidden bg-[#070d1a] text-slate-100 sm:-mx-6", fullscreen ? "h-dvh" : "h-[calc(100dvh-5.5rem)] min-h-[520px]")}>
      <div ref={containerRef} className="absolute inset-0" role="application" aria-label="3D map. Use arrow keys to pan, plus and minus to zoom, shift with arrows to rotate and tilt." />

      {engineError ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-6">
          <Glass className="max-w-md p-5 text-center">
            <AlertTriangle className="mx-auto size-6 text-amber-300" />
            <p className="mt-2 font-medium">3D map unavailable</p>
            <p className="mt-1 text-sm text-slate-300">{engineError}</p>
            <a href="/map" className="mt-3 inline-block rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10">Open 2D Map & routes</a>
          </Glass>
        </div>
      ) : !ready ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center">
          <Glass className="flex items-center gap-3 px-4 py-3 text-sm">
            <Loader2 className="size-4 animate-spin text-cyan-300" /> Loading 3D engine, terrain and buildings…
          </Glass>
        </div>
      ) : null}

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start gap-2 p-3">
        <SearchBox onSelect={onSearch} className="pointer-events-auto w-full sm:w-[380px]" />
        <Glass className="pointer-events-auto flex items-center gap-1 p-1">
          <div className="flex rounded-lg border border-white/10 p-0.5" role="radiogroup" aria-label="View mode">
            {(["3d", "2d"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setModeAnimated(m)} className={cn("rounded-md px-2.5 py-1 text-[12px] font-semibold uppercase", mode === m ? "bg-cyan-400/20 text-cyan-100" : "text-slate-400 hover:text-slate-100")}>
                {m}
              </button>
            ))}
          </div>
          <IconButton label="Reset camera" onClick={resetCamera}><Compass /></IconButton>
          <IconButton label={fullscreen ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen}>{fullscreen ? <Minimize /> : <Maximize />}</IconButton>
          <IconButton label={copied ? "Link copied" : "Copy link to this view"} onClick={copyLink} active={copied}><Link2 /></IconButton>
          <IconButton label="Use map centre as the area" onClick={useCentre}><Crosshair /></IconButton>
          <IconButton label="Use my location" onClick={geolocate} disabled={locating}>{locating ? <Loader2 className="animate-spin" /> : <LocateFixed />}</IconButton>
        </Glass>
        <Glass className="pointer-events-auto hidden items-center gap-2 px-3 py-2 text-[12px] md:flex">
          <span className={cn("live-dot", feedLive ? "text-red-400" : "text-amber-300")} aria-hidden />
          {focus && focus !== INDIA ? (
            <span>
              <span className="font-medium">{focus.label.split(",")[0]}</span>
              <span className="text-slate-400"> · {hasArea ? (hzData ? `${hzData.hazards.length} active alert(s) · updated ${relativeTime(hzData.feed.retrievedAt)}` : hazards.error ? "alerts unavailable" : "loading alerts…") : "official alerts cover India"}</span>
            </span>
          ) : (
            <span className="text-slate-400">Search a place to load live official alerts</span>
          )}
        </Glass>
      </div>

      {tileError ? (
        <div className="absolute left-1/2 top-16 z-20 -translate-x-1/2">
          <Glass className="flex items-center gap-2 px-3 py-1.5 text-[12px] text-amber-100">
            <AlertTriangle className="size-3.5" /> {tileError}
            <button type="button" aria-label="Dismiss" onClick={() => setTileError(null)}><X className="size-3.5" /></button>
          </Glass>
        </div>
      ) : null}

      {ready && zoom < 13 && !engineError ? (
        <div className="absolute bottom-24 left-1/2 z-10 -translate-x-1/2 lg:bottom-12">
          <Glass className="flex flex-wrap items-center justify-center gap-2 px-3 py-2 text-[12px]">
            <Building2 className="size-4 text-cyan-300" /> 3D buildings appear at street level.
            <button
              type="button"
              onClick={() => {
                const f = focus && focus !== INDIA ? focus : null;
                const c = mapRef.current?.getCenter();
                if (f) flyTo(f.lon, f.lat, 16.2);
                else if (c && zoom >= 8) flyTo(c.lng, c.lat, 16.2);
                else geolocate();
              }}
              className="rounded-md bg-cyan-500/80 px-2.5 py-1 font-semibold text-slate-950 hover:bg-cyan-400"
            >
              {focus && focus !== INDIA ? `Fly to ${focus.label.split(",")[0]}` : zoom >= 8 ? "Zoom to street level" : "Use my location"}
            </button>
            {!(focus && focus !== INDIA) ? <span className="text-slate-400">or search a place</span> : null}
          </Glass>
        </div>
      ) : null}

      {scenarioOn ? (
        <div className="pointer-events-none absolute left-1/2 top-[4.25rem] z-10 -translate-x-1/2 max-sm:top-[7.5rem]">
          <span className="rounded-full border border-purple-400/60 bg-purple-950/80 px-3 py-1 text-[11px] font-semibold tracking-wide text-purple-100 shadow-lg">{SIMULATION_LABEL}</span>
        </div>
      ) : null}

      {/* Desktop side panels */}
      <aside className={cn("absolute bottom-10 left-3 top-[4.5rem] z-10 hidden w-[320px] flex-col transition-transform motion-reduce:transition-none lg:flex", !leftOpen && "-translate-x-[340px]")} aria-label="Layers">
        <Glass className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <span className="flex items-center gap-2 text-sm font-semibold"><Layers className="size-4 text-cyan-300" /> Layers & data</span>
            <IconButton label="Collapse layers" onClick={() => setLeftOpen(false)} className="size-7 border-transparent"><PanelLeftClose /></IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">{layersPanel}</div>
        </Glass>
      </aside>
      {!leftOpen ? (
        <IconButton label="Open layers" onClick={() => setLeftOpen(true)} className="absolute left-3 top-[4.5rem] z-10 hidden bg-slate-950/80 lg:inline-flex"><PanelLeftOpen /></IconButton>
      ) : null}

      <aside className={cn("absolute bottom-10 right-3 top-[4.5rem] z-10 hidden w-[360px] flex-col transition-transform motion-reduce:transition-none lg:flex", !rightOpen && "translate-x-[380px]")} aria-label="Scenario and analysis">
        <Glass className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-1 border-b border-white/10 px-2 py-1.5" role="tablist">
            {(["scenario", "analysis", "research"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={rightTab === t} type="button" onClick={() => setRightTab(t)} className={cn("rounded-md px-2.5 py-1.5 text-[12px] font-medium capitalize", rightTab === t ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-100")}>
                {t}
              </button>
            ))}
            <IconButton label="Collapse panel" onClick={() => setRightOpen(false)} className="ml-auto size-7 border-transparent"><PanelRightClose /></IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {rightTab === "scenario" ? scenarioPanel : rightTab === "analysis" ? analysisPanel : <ResearchPanel focus={focus && focus !== INDIA ? focus : null} clientId={clientId} />}
          </div>
        </Glass>
      </aside>
      {!rightOpen ? (
        <IconButton label="Open analysis panel" onClick={() => setRightOpen(true)} className="absolute right-3 top-[4.5rem] z-10 hidden bg-slate-950/80 lg:inline-flex"><PanelRightOpen /></IconButton>
      ) : null}

      {/* Mobile bottom bar + sheet */}
      <div className="absolute inset-x-3 bottom-3 z-20 lg:hidden">
        {sheet ? (
          <Glass className="mb-2 max-h-[55dvh] overflow-y-auto p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold capitalize">{sheet}</span>
              <IconButton label="Close" onClick={() => setSheet(null)} className="size-7"><X /></IconButton>
            </div>
            {sheet === "layers" ? layersPanel : sheet === "scenario" ? scenarioPanel : sheet === "analysis" ? analysisPanel : <ResearchPanel focus={focus && focus !== INDIA ? focus : null} clientId={clientId} />}
          </Glass>
        ) : null}
        <Glass className="grid grid-cols-4 gap-1 p-1">
          {([["layers", Layers], ["scenario", Droplets], ["analysis", Activity], ["research", Radar]] as const).map(([k, Icon]) => (
            <button key={k} type="button" aria-pressed={sheet === k} onClick={() => setSheet((s) => (s === k ? null : k))} className={cn("flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] capitalize", sheet === k ? "bg-white/10 text-white" : "text-slate-300")}>
              <Icon className="size-4" /> {k}
            </button>
          ))}
        </Glass>
      </div>

      {/* Inspector */}
      {inspect ? (
        <div className="absolute bottom-24 left-1/2 z-20 w-[min(92vw,420px)] -translate-x-1/2 lg:bottom-12">
          <Glass className="p-3 text-[13px]">
            <div className="mb-1 flex items-start justify-between gap-2">
              <InspectBody item={inspect} official={official} scenarioZone={scenarioZone} onRoute={checkRoute} />
              <IconButton label="Close inspector" onClick={() => setInspect(null)} className="size-7 shrink-0"><X /></IconButton>
            </div>
          </Glass>
        </div>
      ) : null}

      {/* Coordinates */}
      <div className="pointer-events-none absolute bottom-9 left-3 z-10 hidden sm:block lg:left-[340px]">
        <span className="num rounded-md bg-slate-950/75 px-2 py-1 text-[11px] text-slate-300">
          {cursor ? `${cursor.lat.toFixed(5)}°, ${cursor.lon.toFixed(5)}°${cursor.elev != null ? ` · ground ${cursor.elev} m` : ""}` : "—"} · z {zoom.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

// ── sub-components ───────────────────────────────────────────────────────────
function ExposureCard({ title, result, empty, tone }: { title: string; result: ExposureResult | null; empty: string | null; tone: "warn" | "sim" }) {
  return (
    <div className={cn("rounded-lg border p-2.5", tone === "sim" ? "border-purple-400/30 bg-purple-500/5" : "border-amber-400/25 bg-amber-400/5")}>
      <div className="mb-1.5 flex items-center justify-between text-[12px] font-semibold">
        {title} {tone === "sim" ? <Pill tone="sim">simulated</Pill> : <Pill tone="warn">official</Pill>}
      </div>
      {empty || !result ? (
        <p className="text-[11px] text-slate-400">{empty ?? "Pan or zoom the map to analyse the view."}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            <Stat label="Evaluated" value={result.evaluated} />
            <Stat label="Intersecting" value={result.intersectingCount} tone={tone} />
            <Stat label={`Within ${result.nearMeters} m`} value={tone === "sim" ? "—" : result.nearCount} />
          </div>
          <table className="mt-2 w-full text-[11px]">
            <thead className="text-slate-500">
              <tr><th className="text-left font-normal">Category</th><th className="text-right font-normal">Evaluated</th><th className="text-right font-normal">Intersect</th></tr>
            </thead>
            <tbody>
              {Object.entries(result.byCategory).map(([k, v]) => (
                <tr key={k}>
                  <td className="capitalize text-slate-300">{k === "road" ? "road segments" : `${k}s`}</td>
                  <td className="num text-right text-slate-400">{v.evaluated}</td>
                  <td className="num text-right font-semibold">{v.intersecting}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.invalidGeometry ? <p className="mt-1 text-[10px] text-amber-200">{result.invalidGeometry} invalid geometries skipped.</p> : null}
          {result.coverage.truncated ? <p className="mt-1 text-[10px] text-amber-200">Only the first {result.evaluated + result.invalidGeometry} features were evaluated.</p> : null}
        </>
      )}
    </div>
  );
}

function CompareTable({ baseline, scenario }: { baseline: ExposureResult | null; scenario: ExposureResult | null }) {
  if (!baseline && !scenario) return <p className="text-[11px] text-slate-500">Exposure numbers appear here once official areas or a scenario are in view.</p>;
  const cats = Array.from(new Set([...Object.keys(baseline?.byCategory ?? {}), ...Object.keys(scenario?.byCategory ?? {})]));
  return (
    <table className="w-full text-[12px]">
      <thead className="text-[11px] text-slate-500">
        <tr><th className="text-left font-normal">Intersecting</th><th className="text-right font-normal text-amber-200/80">Official</th><th className="text-right font-normal text-purple-200/80">Scenario</th></tr>
      </thead>
      <tbody>
        {cats.map((c) => (
          <tr key={c} className="border-t border-white/5">
            <td className="py-1 capitalize text-slate-300">{c === "road" ? "road segments" : `${c}s`}</td>
            <td className="num text-right">{baseline ? baseline.byCategory[c]?.intersecting ?? 0 : "—"}</td>
            <td className="num text-right">{scenario ? scenario.byCategory[c]?.intersecting ?? 0 : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function InspectBody({ item, official, scenarioZone, onRoute }: { item: Inspect; official: { dto: HazardDto; zone: HazardZone }[]; scenarioZone: HazardZone | RasterZone | null; onRoute: (to: { lat: number; lon: number; name: string }) => void }) {
  const at = "at" in item ? item.at : null;
  // Algorithm A on the clicked point.
  const inside = at ? official.filter((o) => pointInArea(at, o.zone.geometry)) : [];
  const inScenario = at && scenarioZone ? ("hits" in scenarioZone ? scenarioZone.hits({ type: "Point", coordinates: at }) : pointInArea(at, scenarioZone.geometry)) : false;
  const insideBlock = at ? (
    <div className="mt-1.5 space-y-0.5 text-[11px]">
      {inside.length ? inside.map((o) => <div key={o.dto.id} className="text-red-200">Inside official area: {o.dto.issuer} · {o.dto.severity}</div>) : <div className="text-slate-400">Not inside any drawn official alert area.</div>}
      {scenarioZone ? <div className={inScenario ? "text-purple-200" : "text-slate-500"}>{inScenario ? "Inside the simulated scenario area." : "Outside the simulated scenario area."}</div> : null}
    </div>
  ) : null;

  switch (item.kind) {
    case "alert":
      return (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5"><Pill tone="danger">{item.dto.severity}</Pill><Pill tone="neutral">{item.dto.areaSource === "CAP_POLYGON" ? "official area" : "district boundary (approx.)"}</Pill></div>
          <p className="mt-1 font-medium">{item.dto.headline}</p>
          <p className="text-[11px] text-slate-400">{item.dto.issuer} · issued {relativeTime(item.dto.issuedAt)}{item.dto.expiresAt ? ` · expires ${new Date(item.dto.expiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST` : ""}</p>
          {item.dto.instruction ? <p className="mt-1 text-[12px]">{item.dto.instruction}</p> : null}
          <a href={item.dto.capUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:underline">Official CAP record <ExternalLink className="size-3" /></a>
        </div>
      );
    case "facility":
      return (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: FACILITY_COLOR[item.f.kind] }} /><span className="text-[11px] text-slate-400">{FACILITY_LABEL[item.f.kind]} · community-mapped</span></div>
          <p className="mt-0.5 font-medium">{item.f.name}</p>
          <p className="text-[11px] text-slate-400">{item.f.address ?? "No address on the map"} · {item.f.distanceKm} km from search point</p>
          <div className="mt-1.5 flex flex-wrap gap-2 text-[12px]">
            {item.f.phone ? <a className="text-cyan-300 hover:underline" href={`tel:${item.f.phone.replace(/[^\d+]/g, "")}`}>{item.f.phone}</a> : <span className="text-slate-500">No phone on the map</span>}
            <button type="button" onClick={() => onRoute({ lat: item.f.lat, lon: item.f.lon, name: item.f.name })} className="inline-flex items-center gap-1 text-cyan-300 hover:underline"><RouteIcon className="size-3.5" /> Check route</button>
            <a className="inline-flex items-center gap-1 text-slate-300 hover:underline" href={item.f.osmUrl} target="_blank" rel="noopener noreferrer">OSM source <ExternalLink className="size-3" /></a>
          </div>
          <p className="mt-1 text-[10px] text-slate-500">Last edited on OpenStreetMap {item.f.lastEditedAt ? relativeTime(item.f.lastEditedAt) : "unknown"}. Not officially verified.</p>
        </div>
      );
    case "shelter":
      return (
        <div className="min-w-0">
          <Pill tone="ok">Listed on an official page</Pill>
          <p className="mt-1 font-medium">{item.s.name}</p>
          <p className="text-[11px] text-slate-400">{item.s.address ?? "Address not stated"}{item.s.capacity ? ` · capacity ${item.s.capacity} (as stated)` : ""}</p>
          {item.s.evidenceQuote ? <p className="mt-1 text-[11px] italic text-slate-300">“{item.s.evidenceQuote}”</p> : null}
          <div className="mt-1.5 flex flex-wrap gap-2 text-[12px]">
            {item.s.lat != null && item.s.lon != null ? <button type="button" onClick={() => onRoute({ lat: item.s.lat as number, lon: item.s.lon as number, name: item.s.name })} className="inline-flex items-center gap-1 text-cyan-300 hover:underline"><Navigation className="size-3.5" /> Check route</button> : null}
            <a className="inline-flex items-center gap-1 text-slate-300 hover:underline" href={item.s.sourceUrl} target="_blank" rel="noopener noreferrer">Source <ExternalLink className="size-3" /></a>
          </div>
          <p className="mt-1 text-[10px] text-slate-500">Verified {relativeTime(item.s.verifiedAt)}. Position geocoded from the address. Open/full status not verified.</p>
        </div>
      );
    case "building":
      return (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium"><Building2 className="size-4 text-slate-300" /> {item.name ?? "Mapped building"}</p>
          <p className="text-[11px] text-slate-400">{item.height != null ? `Height ~${Math.round(item.height)} m (OSM height/levels where mapped, otherwise schema default)` : "Height not available"} · © OpenStreetMap</p>
          {insideBlock}
        </div>
      );
    case "live-building":
      return (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium"><Building2 className="size-4 text-cyan-300" /> {item.name ?? "Building"}</p>
          <p className="text-[11px] text-slate-400">
            {item.heightSource === "default" ? `No height mapped — drawn at ${Math.round(item.height)} m by default` : `Height ${Math.round(item.height)} m from OSM ${item.heightSource}${item.levels ? ` (${item.levels} levels)` : ""}`}
          </p>
          <p className="text-[11px] text-slate-400">
            Live from OpenStreetMap · last edited {item.edited ? relativeTime(item.edited) : "unknown"} ·{" "}
            <a className="text-cyan-300 hover:underline" href={`https://www.openstreetmap.org/${item.osmId}`} target="_blank" rel="noopener noreferrer">{item.osmId}</a>
          </p>
          {insideBlock}
        </div>
      );
    case "road":
      return (
        <div className="min-w-0">
          <p className="font-medium capitalize">{item.cls ?? "Road"} road</p>
          <p className="text-[11px] text-slate-400">OpenStreetMap road geometry. Status (open/closed) is not known from map data.</p>
          {insideBlock}
        </div>
      );
    case "cell":
      return (
        <div className="min-w-0">
          <Pill tone="sim">SIMULATED</Pill>
          <p className="mt-1 font-medium">Hypothetical water depth ~{item.depth.toFixed(1)} m</p>
          <p className="text-[11px] text-slate-400">From the water-level illustration, not an observation or forecast.</p>
          {insideBlock}
        </div>
      );
    case "point":
      return (
        <div className="min-w-0">
          <p className="num font-medium">{item.at[1].toFixed(5)}°, {item.at[0].toFixed(5)}°</p>
          {insideBlock}
        </div>
      );
  }
}

function ResearchPanel({ focus, clientId }: { focus: Focus | null; clientId: string | null }) {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [stage, setStage] = useState<HazardStage | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [findings, setFindings] = useState<FindingDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  useEffect(() => () => esRef.current?.close(), []);

  const load = useCallback(async (id: string) => {
    try {
      const r = await apiFetch<{ findings: FindingDto[]; task: { stage: HazardStage } }>(`/api/research/${id}/results`);
      setFindings(r.findings);
      setStage(r.task.stage);
    } catch (e) {
      setError((e as ApiError).message);
    }
  }, []);

  const start = async () => {
    if (!focus || !(focus.district || focus.state)) return;
    setStarting(true);
    setError(null);
    setFindings([]);
    try {
      const r = await apiFetch<{ id: string }>("/api/research/live", { method: "POST", body: JSON.stringify({ place: { label: focus.label.slice(0, 200), district: focus.district, state: focus.state }, hazard: "all", ...(clientId ? { clientId } : {}) }) });
      setTaskId(r.id);
      setStage("INITIALIZING");
      esRef.current?.close();
      const es = new EventSource(`/api/research/${r.id}/stream`);
      esRef.current = es;
      es.addEventListener("task", (ev) => {
        try {
          const d = JSON.parse((ev as MessageEvent).data) as { stage: HazardStage; newEvents: { message: string }[] };
          setStage(d.stage);
          const m = d.newEvents[d.newEvents.length - 1]?.message;
          if (m) setLast(m);
        } catch {
          /* ignore malformed event */
        }
      });
      const finish = () => {
        es.close();
        void load(r.id);
      };
      es.addEventListener("done", finish);
      es.addEventListener("timeout", finish);
      es.addEventListener("error", finish);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setStarting(false);
    }
  };

  const running = stage !== null && !TERMINAL_STAGES.includes(stage);
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-slate-300">TinyFish researches official disaster-management and weather sources for the selected area, then news. Every finding links to its source.</p>
      <p className="rounded-md border border-white/10 bg-white/[0.03] p-2 text-[11px] text-slate-400">Web findings are never drawn as map incidents — only official alerts with published areas are.</p>
      <button type="button" onClick={start} disabled={!focus || !(focus.district || focus.state) || starting || running} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-500/80 px-3 py-2 text-[13px] font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-40">
        {starting || running ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />} {focus ? `Research ${focus.label.split(",")[0]}` : "Search a place first"}
      </button>
      {focus && !(focus.district || focus.state) ? <p className="text-[11px] text-amber-200">This location has no Indian district or state; research is not available.</p> : null}
      {stage ? (
        <div className="rounded-lg border border-white/10 p-2 text-[12px]">
          <div className="flex items-center gap-2">
            <Pill tone={stage === "COMPLETED" ? "ok" : stage === "FAILED" ? "danger" : running ? "live" : "warn"}>{STAGE_LABEL[stage]}</Pill>
            {taskId ? <a href="/research" className="ml-auto text-[11px] text-cyan-300 hover:underline">Full report</a> : null}
          </div>
          {running && last ? <p className="mt-1 text-[11px] text-slate-400">{last}</p> : null}
        </div>
      ) : null}
      {error ? <p className="text-[12px] text-red-300">{error}</p> : null}
      {findings.length ? (
        <ul className="space-y-2">
          {findings.slice(0, 6).map((f) => (
            <li key={f.id} className="rounded-lg border border-white/10 p-2 text-[12px]">
              <div className="flex flex-wrap gap-1">
                <Pill tone={f.sourceCategory === "OFFICIAL" ? "ok" : f.sourceCategory === "SECONDARY" ? "neutral" : "warn"}>{f.sourceCategory === "OFFICIAL" ? "Official" : f.sourceCategory === "SECONDARY" ? "Media" : "Unverified"}</Pill>
                {f.conflictsWith.length ? <Pill tone="danger">Conflicting</Pill> : null}
              </div>
              <p className="mt-1 font-medium">{f.title}</p>
              <p className="text-[11px] text-slate-400">
                <a className="text-cyan-300 hover:underline" href={f.sourceUrl} target="_blank" rel="noopener noreferrer">{f.sourceName}</a> · {f.publishedAt ? `published ${relativeTime(f.publishedAt)}` : "timestamp unavailable"} · retrieved {relativeTime(f.retrievedAt)}
              </p>
            </li>
          ))}
        </ul>
      ) : stage && !running && !error ? (
        <p className="text-[11px] text-slate-400">No verifiable findings in this run. See the full report for sources and gaps.</p>
      ) : null}
    </div>
  );
}