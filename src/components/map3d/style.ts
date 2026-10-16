import type { ExpressionSpecification, HillshadeLayerSpecification, RasterDEMSourceSpecification, StyleSpecification } from "maplibre-gl";

/**
 * Dark operational basemap built from real, keyless open data:
 *  - OpenFreeMap vector tiles (OpenMapTiles schema, © OpenStreetMap contributors):
 *    roads, water, land use, place names and OSM building footprints with heights.
 *  - Terrarium elevation tiles (Mapzen terrain tiles on AWS Open Data) for 3D terrain
 *    and hillshade. India coverage is SRTM-derived, about 30 m resolution.
 * Nothing in this style is invented: a building appears only if it is mapped in OSM.
 */

export const OPENFREEMAP_TILEJSON = "https://tiles.openfreemap.org/planet";
export const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
export const TERRARIUM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const TERRAIN_ATTRIBUTION = '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Elevation: Terrain Tiles (Mapzen, AWS Open Data)</a>';
export const TERRAIN_EXAGGERATION = 1.6;

/**
 * Terrain providers, both keyless Terrarium-encoded elevation:
 *  - Mapterhorn (Cloudflare-served, 512 px, ~30 m globally, finer in some regions) — primary
 *  - Mapzen/Tilezen Terrain Tiles on AWS Open Data (256 px) — automatic fallback
 */
export type TerrainProvider = "mapterhorn" | "aws";
export const TERRAIN_PROVIDERS: Record<TerrainProvider, { label: string; tiles: string; tileSize: 256 | 512; maxzoom: number; attribution: string }> = {
  mapterhorn: { label: "Mapterhorn", tiles: "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp", tileSize: 512, maxzoom: 12, attribution: "<a href='https://mapterhorn.com/attribution' target='_blank' rel='noopener'>© Mapterhorn</a>" },
  aws: { label: "Terrain Tiles (AWS Open Data)", tiles: TERRARIUM_TILES, tileSize: 256, maxzoom: 15, attribution: TERRAIN_ATTRIBUTION },
};

export function terrainSource(p: TerrainProvider, withAttribution = true): RasterDEMSourceSpecification {
  const t = TERRAIN_PROVIDERS[p];
  return { type: "raster-dem", tiles: [t.tiles], tileSize: t.tileSize, encoding: "terrarium", maxzoom: t.maxzoom, ...(withAttribution ? { attribution: t.attribution } : {}) };
}

export const HILLSHADE_LAYER: HillshadeLayerSpecification = {
  id: "hillshade",
  type: "hillshade",
  source: "hillshade",
  paint: { "hillshade-shadow-color": "#01040b", "hillshade-highlight-color": "#2a3d5e", "hillshade-accent-color": "#0b1424", "hillshade-exaggeration": 0.55 },
};

const NAME: ExpressionSpecification = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]];

export function buildStyle(terrain: TerrainProvider = "mapterhorn"): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      openmaptiles: { type: "vector", url: OPENFREEMAP_TILEJSON },
      terrain: terrainSource(terrain),
      hillshade: terrainSource(terrain, false),
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#070d1a" } },
      { id: "landcover", type: "fill", source: "openmaptiles", "source-layer": "landcover", paint: { "fill-color": "#0c1a17", "fill-opacity": 0.45 } },
      { id: "landuse-res", type: "fill", source: "openmaptiles", "source-layer": "landuse", filter: ["in", ["get", "class"], ["literal", ["residential", "suburb", "neighbourhood"]]], paint: { "fill-color": "#0e1626", "fill-opacity": 0.8 } },
      { id: "park", type: "fill", source: "openmaptiles", "source-layer": "park", paint: { "fill-color": "#0b1f19", "fill-opacity": 0.6 } },
      HILLSHADE_LAYER,
      { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": "#0a2540" } },
      { id: "waterway", type: "line", source: "openmaptiles", "source-layer": "waterway", paint: { "line-color": "#0f3a63", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 14, 2.5] } },
      { id: "boundary-admin", type: "line", source: "openmaptiles", "source-layer": "boundary", filter: ["<=", ["to-number", ["get", "admin_level"], 99], 4], paint: { "line-color": "#3b4a66", "line-width": 1, "line-dasharray": [3, 2] } },
      {
        id: "roads-minor",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["minor", "service", "track", "path"]]],
        minzoom: 12,
        paint: { "line-color": "#1d2a40", "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 12, 0.4, 18, 6] },
      },
      {
        id: "roads-mid",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["secondary", "tertiary"]]],
        paint: { "line-color": "#2e3e5a", "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 8, 0.4, 18, 10] },
      },
      {
        id: "roads-major",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary"]]],
        paint: { "line-color": "#4b5f80", "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 5, 0.5, 18, 14] },
      },
      { id: "rail", type: "line", source: "openmaptiles", "source-layer": "transportation", filter: ["==", ["get", "class"], "rail"], paint: { "line-color": "#2a3550", "line-width": 1, "line-dasharray": [2, 2] } },
      { id: "building-flat", type: "fill", source: "openmaptiles", "source-layer": "building", minzoom: 13, paint: { "fill-color": "#1b263b", "fill-outline-color": "#2b3a55" } },
      {
        id: "building-3d",
        type: "fill-extrusion",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: 13,
        filter: ["!=", ["get", "hide_3d"], true],
        paint: {
          "fill-extrusion-color": ["interpolate", ["linear"], ["to-number", ["get", "render_height"], 0], 0, "#1a2436", 20, "#26354f", 60, "#33486b", 150, "#4a6590"],
          "fill-extrusion-height": ["to-number", ["get", "render_height"], 0],
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
        paint: { "text-color": "#8a9bb8", "text-halo-color": "#070d1a", "text-halo-width": 1.2 },
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
        paint: { "text-color": ["match", ["get", "class"], "state", "#5d6f8f", "#c7d2e3"], "text-halo-color": "#070d1a", "text-halo-width": 1.5 },
      },
    ],
  };
}