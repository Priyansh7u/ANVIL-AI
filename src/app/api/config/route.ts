import { NextResponse } from "next/server";
import { capabilityFlags, env } from "@/lib/env";
import { storageMode } from "@/lib/repo";

export const runtime = "nodejs";

/** Public, non-secret configuration for the client (tile URL, feature availability). */
export async function GET() {
  return NextResponse.json({
    capabilities: capabilityFlags(),
    storage: storageMode(),
    map: { tileUrl: env.mapTileUrl, attribution: env.mapTileAttribution },
  });
}
