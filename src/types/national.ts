import type { NationalPicture } from "@/lib/core/intelligence";
import type { CapSeverity, DataMode, HazardType } from "@/lib/core/types";

export interface NationalResponse extends NationalPicture {
  generatedAt: string;
  feed: { dataMode: DataMode; retrievedAt: string | null; feedPublishedAt: string | null; sourceUrl: string; error: string | null };
  latest: { id: string; issuer: string; headline: string; severity: CapSeverity; hazard: HazardType; issuedAt: string | null; capUrl: string }[];
}