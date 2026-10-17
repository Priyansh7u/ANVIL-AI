import type { ExpressionSpecification, HillshadeLayerSpecification, LayerSpecification, Map as MLMap, RasterDEMSourceSpecification, StyleSpecification } from "maplibre-gl";

/**
 * Operational basemap built from real, keyless open data, in a dark and a light theme:
 *  - OpenFreeMap vector tiles (OpenMapTiles schema, © OpenStreetMap contributors):
 *    roads, water, land use, place names and OSM building footprints with heights.
 *  - Terrarium elevation tiles for 3D terrain and hillshade (AWS Open Data first, Mapterhorn as fallback).
 *  - If the vector tiles can't load at all, a raster fallback (CARTO basemaps, © OpenStreetMap
 *    contributors © CARTO) keeps the map usable; live OSM buildings still extrude on top.
 * Nothing in this style is invented: a building appears only if it is mapped in OSM.
 */

export type MapTheme = "dark" | "light";

export const OPENFREEMAP_TILEJSON = "https://tiles.openfreemap.org/planet";
export const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
export const TERRARIUM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const TERRAIN_ATTRIBUTION = '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Elevation: Terrain Tiles (Mapzen, AWS Open Data)</a>';
export const TERRAIN_EXAGGERATION = 1.6;

/**
 * Terrain providers, both keyless Terrarium-encoded elevation:
 *  - Terrain Tiles on AWS Open Data (256 px, ~30 m SRTM-derived in India) — primary: long-standing and CORS-enabled
 *  - Mapterhorn (512 px) — automatic fallback
 */
export type TerrainProvider = "aws" | "mapterhorn";
export const TERRAIN_ORDER: TerrainProvider[] = ["aws", "mapterhorn"];
export const TERRAIN_PROVIDERS: Record<TerrainProvider, { label: string; tiles: string; tileSize: 256 | 512; maxzoom: number; attribution: string }> = {
  aws: { label: "Terrain Tiles (AWS Open Data)", tiles: TERRARIUM_TILES, tileSize: 256, maxzoom: 15, attribution: TERRAIN_ATTRIBUTION },
  mapterhorn: { label: "Mapterhorn", tiles: "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp", tileSize: 512, maxzoom: 12, attribution: "<a href='https://mapterhorn.com/attribution' target='_blank' rel='noopener'>© Mapterhorn</a>" },
};

export function terrainSource(p: TerrainProvider, withAttribution = true): RasterDEMSourceSpecification {
  const t = TERRAIN_PROVIDERS[p];
  return { type: "raster-dem", tiles: [t.tiles], tileSize: t.tileSize, encoding: "terrarium", maxzoom: t.maxzoom, ...(withAttribution ? { attribution: t.attribution } : {}) };
}

// ── Palettes ─────────────────────────────────────────────────────────────────
interface Palette {
  background: string;
  landcover: string;
  landcoverOpacity: number;
  residential: string;
  park: string;
  water: string;
  waterway: string;
  boundary: string;
  roadMinor: string;
  roadMid: string;
  roadMajor: string;
  rail: string;
  buildingFlat: string;
  buildingOutline: string;
  buildingRamp: [string, string, string, string];
  roadLabel: string;
  placeLabel: string;
  stateLabel: string;
  halo: string;
  hillShadow: string;
  hillHighlight: string;
  hillAccent: string;
  hillExaggeration: number;
  sky: { "sky-color": string; "horizon-color": string; "fog-color": string };
  liveBuildings: [string, string, string];
}

export const PALETTES: Record<MapTheme, Palette> = {
  dark: {
    background: "#070d1a",
    landcover: "#0c1a17",
    landcoverOpacity: 0.45,
    residential: "#0e1626",
    park: "#0b1f19",
    water: "#0a2540",
    waterway: "#0f3a63",
    boundary: "#3b4a66",
    roadMinor: "#1d2a40",
    roadMid: "#2e3e5a",
    roadMajor: "#4b5f80",
    rail: "#2a3550",
    buildingFlat: "#1b263b",
    buildingOutline: "#2b3a55",
    buildingRamp: ["#1a2436", "#26354f", "#33486b", "#4a6590"],
    roadLabel: "#8a9bb8",
    placeLabel: "#c7d2e3",
    stateLabel: "#5d6f8f",
    halo: "#070d1a",
    hillShadow: "#01040b",
    hillHighlight: "#2a3d5e",
    hillAccent: "#0b1424",
    hillExaggeration: 0.55,
    sky: { "sky-color": "#0b1424", "horizon-color": "#13233d", "fog-color": "#070d1a" },
    liveBuildings: ["#4f7cc0", "#3b6aa8", "#2a3850"],
  },
  light: {
    background: "#f4f2ec",
    landcover: "#dfe9d8",
    landcoverOpacity: 0.6,
    residential: "#ece9e1",
    park: "#d3e6cc",
    water: "#a9d3ee",
    waterway: "#86bfe3",
    boundary: "#9a8fb5",
    roadMinor: "#ffffff",
    roadMid: "#fdf6e3",
    roadMajor: "#f7d9a0",
    rail: "#b9b4c4",
    buildingFlat: "#e3ded4",
    buildingOutline: "#cfc8bb",
    buildingRamp: ["#ece7de", "#ddd6ca", "#cbc3d8", "#a9b4e6"],
    roadLabel: "#5b6170",
    placeLabel: "#2b2f45",
    stateLabel: "#7d7896",
    halo: "#ffffff",
    hillShadow: "#7a7468",
    hillHighlight: "#ffffff",
    hillAccent: "#b8b0a0",
    hillExaggeration: 0.35,
    sky: { "sky-color": "#bcd7f2", "horizon-color": "#eef3f8", "fog-color": "#f4f2ec" },
    liveBuildings: ["#8aa2ea", "#a8b8ee", "#d6d0c4"],
  },
};

export function hillshadeLayer(theme: MapTheme): HillshadeLayerSpecification {
  const p = PALETTES[theme];
  return {
    id: "hillshade",
    type: "hillshade",
    source: "hillshade",
    paint: { "hillshade-shadow-color": p.hillShadow, "hillshade-highlight-color": p.hillHighlight, "hillshade-accent-color": p.hillAccent, "hillshade-exaggeration": p.hillExaggeration },
  };
}
/** Kept for callers that don't know the theme yet. */
export const HILLSHADE_LAYER = hillshadeLayer("dark");

export function skyFor(theme: MapTheme) {
  return { ...PALETTES[theme].sky, "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": theme === "light" ? 0.25 : 0.4 };
}

const NAME: ExpressionSpecification = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]];

function buildingColor(p: Palette): ExpressionSpecification {
  return ["interpolate", ["linear"], ["to-number", ["get", "render_height"], 0], 0, p.buildingRamp[0], 20, p.buildingRamp[1], 60, p.buildingRamp[2], 150, p.buildingRamp[3]];
}

export function buildStyle(terrain: TerrainProvider = "aws", theme: MapTheme = "dark"): StyleSpecification {
  const p = PALETTES[theme];
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      openmaptiles: { type: "vector", url: OPENFREEMAP_TILEJSON },
      terrain: terrainSource(terrain),
      hillshade: terrainSource(terrain, false),
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": p.background } },
      { id: "landcover", type: "fill", source: "openmaptiles", "source-layer": "landcover", paint: { "fill-color": p.landcover, "fill-opacity": p.landcoverOpacity } },
      { id: "landuse-res", type: "fill", source: "openmaptiles", "source-layer": "landuse", filter: ["in", ["get", "class"], ["literal", ["residential", "suburb", "neighbourhood"]]], paint: { "fill-color": p.residential, "fill-opacity": 0.8 } },
      { id: "park", type: "fill", source: "openmaptiles", "source-layer": "park", paint: { "fill-color": p.park, "fill-opacity": 0.6 } },
      hillshadeLayer(theme),
      { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": p.water } },
      { id: "waterway", type: "line", source: "openmaptiles", "source-layer": "waterway", paint: { "line-color": p.waterway, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 14, 2.5] } },
      { id: "boundary-admin", type: "line", source: "openmaptiles", "source-layer": "boundary", filter: ["<=", ["to-number", ["get", "admin_level"], 99], 4], paint: { "line-color": p.boundary, "line-width": 1, "line-dasharray": [3, 2] } },
      {
        id: "roads-minor",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["minor", "service", "track", "path"]]],
        minzoom: 12,
        paint: { "line-color": p.roadMinor, "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 12, 0.4, 18, 6] },
      },
      {
        id: "roads-mid",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["secondary", "tertiary"]]],
        paint: { "line-color": p.roadMid, "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 8, 0.4, 18, 10] },
      },
      {
        id: "roads-major",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary"]]],
        paint: { "line-color": p.roadMajor, "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 5, 0.5, 18, 14] },
      },
      { id: "rail", type: "line", source: "openmaptiles", "source-layer": "transportation", filter: ["==", ["get", "class"], "rail"], paint: { "line-color": p.rail, "line-width": 1, "line-dasharray": [2, 2] } },
      { id: "building-flat", type: "fill", source: "openmaptiles", "source-layer": "building", minzoom: 13, paint: { "fill-color": p.buildingFlat, "fill-outline-color": p.buildingOutline } },
      {
        id: "building-3d",
        type: "fill-extrusion",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: 13,
        filter: ["!=", ["get", "hide_3d"], true],
        paint: {
          "fill-extrusion-color": buildingColor(p),
          // Footprints without a height tag still get a modest default so they read as buildings.
          "fill-extrusion-height": ["max", ["to-number", ["get", "render_height"], 0], 4],
          "fill-extrusion-base": ["to-number", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 0.92,
        },
      },
      {
        id: "road-labels",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "transportation_name",
        minzoom: 13,
        layout: { "symbol-placement": "line", "text-field": NAME, "text-font": ["Noto Sans Regular"], "text-size": 11 },
        paint: { "text-color": p.roadLabel, "text-halo-color": p.halo, "text-halo-width": 1.2 },
      },
      {
        id: "place-labels",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        filter: ["in", ["get", "class"], ["literal", ["city", "town", "village", "suburb", "state"]]],
        layout: {
          "text-field": NAME,
          "text-font": ["Noto Sans Regular"],
          "text-size": ["match", ["get", "class"], "state", 13, "city", 15, "town", 13, 11],
          "text-transform": ["match", ["get", "class"], "state", "uppercase", "none"],
          "text-letter-spacing": ["match", ["get", "class"], "state", 0.15, 0],
        },
        paint: { "text-color": ["match", ["get", "class"], "state", p.stateLabel, p.placeLabel], "text-halo-color": p.halo, "text-halo-width": 1.5 },
      },
    ],
  };
}

/**
 * Raster fallback used only when the vector basemap can't load. It keeps the same
 * layer ids the overlays anchor to (as empty placeholders), so the rest of the 3D
 * workspace — terrain, live OSM buildings, alerts, scenarios — keeps working.
 */
export const RASTER_ATTRIBUTION = "© <a href='https://www.openstreetmap.org/copyright' target='_blank' rel='noopener'>OpenStreetMap</a> contributors © <a href='https://carto.com/attributions' target='_blank' rel='noopener'>CARTO</a>";
export function fallbackStyle(terrain: TerrainProvider = "aws", theme: MapTheme = "dark"): StyleSpecification {
  const variant = theme === "dark" ? "dark_all" : "light_all";
  const empty = { type: "geojson" as const, data: { type: "FeatureCollection" as const, features: [] } };
  const stub = (id: string, type: "fill" | "line" | "fill-extrusion" | "symbol"): LayerSpecification => ({ id, type, source: "stub" }) as LayerSpecification;
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      raster: {
        type: "raster",
        tiles: ["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}@2x.png`),
        tileSize: 256,
        maxzoom: 19,
        attribution: RASTER_ATTRIBUTION,
      },
      terrain: terrainSource(terrain),
      hillshade: terrainSource(terrain, false),
      stub: empty,
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": PALETTES[theme].background } },
      { id: "raster-base", type: "raster", source: "raster" },
      hillshadeLayer(theme),
      stub("water", "fill"),
      stub("roads-minor", "line"),
      stub("roads-mid", "line"),
      stub("roads-major", "line"),
      stub("building-flat", "fill"),
      stub("building-3d", "fill-extrusion"),
      stub("road-labels", "symbol"),
    ],
  };
}

/** Recolour a live map for a theme without rebuilding the style (overlays and data stay put). */
export function applyTheme(map: MLMap, theme: MapTheme) {
  const p = PALETTES[theme];
  const set = (id: string, prop: string, value: unknown) => {
    try {
      if (map.getLayer(id)) map.setPaintProperty(id, prop, value);
    } catch {
      /* layer missing in fallback style */
    }
  };
  set("background", "background-color", p.background);
  set("landcover", "fill-color", p.landcover);
  set("landcover", "fill-opacity", p.landcoverOpacity);
  set("landuse-res", "fill-color", p.residential);
  set("park", "fill-color", p.park);
  set("water", "fill-color", p.water);
  set("waterway", "line-color", p.waterway);
  set("boundary-admin", "line-color", p.boundary);
  set("roads-minor", "line-color", p.roadMinor);
  set("roads-mid", "line-color", p.roadMid);
  set("roads-major", "line-color", p.roadMajor);
  set("rail", "line-color", p.rail);
  set("building-flat", "fill-color", p.buildingFlat);
  set("building-flat", "fill-outline-color", p.buildingOutline);
  set("building-3d", "fill-extrusion-color", buildingColor(p));
  set("road-labels", "text-color", p.roadLabel);
  set("road-labels", "text-halo-color", p.halo);
  set("place-labels", "text-color", ["match", ["get", "class"], "state", p.stateLabel, p.placeLabel]);
  set("place-labels", "text-halo-color", p.halo);
  set("hillshade", "hillshade-shadow-color", p.hillShadow);
  set("hillshade", "hillshade-highlight-color", p.hillHighlight);
  set("hillshade", "hillshade-accent-color", p.hillAccent);
  set("hillshade", "hillshade-exaggeration", p.hillExaggeration);
  set("live-buildings", "fill-extrusion-color", ["match", ["get", "heightSource"], "height tag", p.liveBuildings[0], "levels tag", p.liveBuildings[1], p.liveBuildings[2]]);
  // The raster fallback has its own light/dark tiles.
  try {
    const src = map.getSource("raster") as unknown as { setTiles?: (t: string[]) => void } | undefined;
    src?.setTiles?.(["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com/${theme === "dark" ? "dark_all" : "light_all"}/{z}/{x}/{y}@2x.png`));
  } catch {
    /* not in fallback mode */
  }
  try {
    map.setSky(skyFor(theme));
  } catch {
    /* sky is cosmetic */
  }
}