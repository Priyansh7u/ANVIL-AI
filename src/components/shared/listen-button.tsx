"use client";

import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { canSpeak, speak, stopSpeaking } from "@/lib/speech";

/** Reads text aloud with the browser's voice (Hindi voice for Devanagari text). Hidden if unsupported. */
export function ListenButton({ text, label = "Listen" }: { text: string; label?: string }) {
  const [supported, setSupported] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setSupported(canSpeak());
  }, []);

  if (!supported || !text) return null;

  return (
    <button
      type="button"
      onClick={() => {
        if (playing) {
          stopSpeaking();
          setPlaying(false);
        } else {
          setPlaying(true);
          speak(text, undefined, () => setPlaying(false));
        }
      }}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-primary hover:bg-muted"
      aria-label={playing ? "Stop reading aloud" : `${label}: read this alert aloud`}
    >
      {playing ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
      {playing ? "Stop" : label}
    </button>
  );
}