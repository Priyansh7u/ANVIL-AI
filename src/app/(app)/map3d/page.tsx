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
    <div className="-mx-3 -my-5 flex h-[calc(100dvh-5.5rem)] items-center justify-center bg-[#070d1a] text-sm text-slate-300 sm:-mx-6">
      <Loader2 className="mr-2 size-4 animate-spin text-cyan-300" /> Loading the 3D map…
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
      <div className="-mx-3 -my-5 flex h-[calc(100dvh-5.5rem)] items-center justify-center bg-[#070d1a] p-6 sm:-mx-6">
        <div className="max-w-md rounded-xl border border-white/10 bg-slate-950/80 p-5 text-center text-slate-100">
          <p className="font-medium">The 3D map stopped unexpectedly</p>
          <p className="mt-1 text-sm text-slate-400">{this.state.error.message}</p>
          <div className="mt-3 flex justify-center gap-2">
            <button type="button" onClick={() => this.setState({ error: null })} className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10">
              Try again
            </button>
            <a href="/map" className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10">
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