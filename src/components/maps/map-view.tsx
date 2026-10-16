"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/primitives";

/** Leaflet touches `window`, so it is only ever loaded in the browser. */
export const MapView = dynamic(() => import("./leaflet-map"), {
  ssr: false,
  loading: () => <Skeleton className="h-[420px] w-full rounded-lg" />,
});

export type { MapArea, MapCircle, MapMarker, MapPath } from "./leaflet-map";