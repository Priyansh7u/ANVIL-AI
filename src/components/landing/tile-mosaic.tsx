"use client";

import { forwardRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { tileUrl, type ImageryId, type Mosaic } from "@/lib/landing/imagery";
import { refreshSoon } from "./gsap";

/**
 * A grid of real map tiles laid out to the exact aspect ratio of the tile
 * block, so overlays can be positioned in geographic coordinates. Width and
 * height are reserved up front (aspect-ratio), so nothing shifts while loading.
 */
export const TileMosaic = forwardRef<
  HTMLDivElement,
  { mosaic: Mosaic; layer: ImageryId; date?: string; eager?: boolean; className?: string; imgClassName?: string; style?: React.CSSProperties; children?: React.ReactNode; fallback?: ImageryId; alt?: string }
>(function TileMosaic({ mosaic, layer, date, eager, className, imgClassName, style, children, fallback, alt }, ref) {
  const tiles = useMemo(() => {
    const out: { x: number; y: number; key: string }[] = [];
    for (let r = 0; r < mosaic.rows; r++) for (let c = 0; c < mosaic.cols; c++) out.push({ x: mosaic.x0 + c, y: mosaic.y0 + r, key: `${c}-${r}` });
    return out;
  }, [mosaic]);
  return (
    <div ref={ref} role={alt ? "img" : undefined} aria-label={alt} className={cn("relative overflow-hidden", className)} style={{ aspectRatio: `${mosaic.cols} / ${mosaic.rows}`, ...style }}>
      {tiles.map((t) => (
        // eslint-disable-next-line @next/next/no-img-element -- third-party map tiles, not optimisable assets
        <img
          key={t.key}
          src={tileUrl(layer, mosaic.z, t.x, t.y, date)}
          alt=""
          aria-hidden
          draggable={false}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onLoad={refreshSoon}
          onError={(e) => {
            const img = e.currentTarget;
            if (fallback && !img.dataset.fellBack) {
              img.dataset.fellBack = "1";
              img.src = tileUrl(fallback, mosaic.z, t.x, t.y);
            } else img.style.visibility = "hidden";
          }}
          className={cn("absolute select-none", imgClassName)}
          style={{
            left: `${((t.x - mosaic.x0) / mosaic.cols) * 100}%`,
            top: `${((t.y - mosaic.y0) / mosaic.rows) * 100}%`,
            width: `${100 / mosaic.cols + 0.05}%`,
            height: `${100 / mosaic.rows + 0.05}%`,
          }}
        />
      ))}
      {children}
    </div>
  );
});