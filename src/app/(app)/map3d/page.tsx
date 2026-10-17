"use client";

import dynamic from "next/dynamic";
import { Component, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

/**
 * 3D disaster map. The MapLibre engine (~800 kB) is loaded only on this route
 * and only in the browser, so no other page pays for it.
 */
const TwinWorkspace = dynamic(() => import("@/components/map3d/twin-workspace"), {
  ssr: false,
  loading: () => (
    <div className="-mx-3 -my-5 flex h-[calc(100dvh-5.5rem)] items-center justify-center bg-muted text-sm text-muted-foreground sm:-mx-6">
      <Loader2 className="mr-2 size-4 animate-spin text-primary" /> Loading the 3D map…
    </div>
  ),
});

class MapErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="-mx-3 -my-5 flex h-[calc(100dvh-5.5rem)] items-center justify-center bg-muted p-6 sm:-mx-6">
        <div className="max-w-md rounded-xl border bg-card p-5 text-center text-card-foreground">
          <p className="font-medium">The 3D map stopped unexpectedly</p>
          <p className="mt-1 text-sm text-muted-foreground">{this.state.error.message}</p>
          <div className="mt-3 flex justify-center gap-2">
            <button type="button" onClick={() => this.setState({ error: null })} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">
              Try again
            </button>
            <a href="/map" className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">
              Open 2D map
            </a>
          </div>
        </div>
      </div>
    );
  }
}

export default function Map3DPage() {
  return (
    <MapErrorBoundary>
      <TwinWorkspace />
    </MapErrorBoundary>
  );
}