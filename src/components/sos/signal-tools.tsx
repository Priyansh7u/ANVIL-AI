"use client";

import { useEffect, useRef, useState } from "react";
import { Flashlight, Megaphone, MonitorSmartphone, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives";

/** Morse SOS (··· ––– ···) as on/off durations in units; one unit = 250 ms (2 flashes per second at most). */
const UNIT_MS = 250;
const SOS_PATTERN: [boolean, number][] = [
  ...[1, 1, 1].flatMap((): [boolean, number][] => [[true, 1], [false, 1]]),
  [false, 2],
  ...[1, 1, 1].flatMap((): [boolean, number][] => [[true, 3], [false, 1]]),
  [false, 2],
  ...[1, 1, 1].flatMap((): [boolean, number][] => [[true, 1], [false, 1]]),
  [false, 6],
];

function useSosLoop(active: boolean, onChange: (on: boolean) => void) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    if (!active) return;
    let i = 0;
    let t = 0;
    const step = () => {
      const [on, units] = SOS_PATTERN[i % SOS_PATTERN.length]!;
      cb.current(on);
      i++;
      t = window.setTimeout(step, units * UNIT_MS);
    };
    step();
    return () => {
      window.clearTimeout(t);
      cb.current(false);
    };
  }, [active]);
}

/** Phone torch blinking SOS (Android Chrome supports torch control); falls back to the screen. */
function TorchSos() {
  const [state, setState] = useState<"idle" | "starting" | "on" | "unsupported">("idle");
  const track = useRef<MediaStreamTrack | null>(null);
  useSosLoop(state === "on", (on) => {
    const t = track.current;
    if (!t) return;
    void t.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] }).catch(() => undefined);
  });
  const stop = () => {
    track.current?.stop();
    track.current = null;
    setState((s) => (s === "unsupported" ? s : "idle"));
  };
  useEffect(() => stop, []);

  const start = async () => {
    setState("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const t = stream.getVideoTracks()[0];
      const caps = (t?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
      if (!t || !caps.torch) {
        stream.getTracks().forEach((x) => x.stop());
        setState("unsupported");
        return;
      }
      track.current = t;
      setState("on");
    } catch {
      setState("unsupported");
    }
  };

  return (
    <div className="rounded-lg border p-4">
      <p className="flex items-center gap-2 font-medium"><Flashlight className="size-4 text-warning" aria-hidden /> Torch SOS</p>
      <p className="mt-1 text-sm text-muted-foreground">Blinks ··· ––– ··· with your phone&apos;s torch so rescuers can spot you at night.</p>
      <div className="mt-3">
        {state === "on" ? (
          <Button variant="danger" onClick={stop}><Square /> Stop torch</Button>
        ) : (
          <Button variant="outline" onClick={() => void start()} disabled={state === "starting"}><Flashlight /> {state === "starting" ? "Asking for camera…" : "Start torch SOS"}</Button>
        )}
      </div>
      {state === "unsupported" ? <p className="mt-2 text-xs text-warning">This device or browser can&apos;t control the torch. Use the screen signal instead.</p> : null}
    </div>
  );
}

/** Full-screen light flashing SOS. Slow (≤2 flashes/s) and only after an explicit tap. */
function ScreenSos() {
  const [active, setActive] = useState(false);
  const [lit, setLit] = useState(false);
  useSosLoop(active, setLit);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setActive(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
  return (
    <div className="rounded-lg border p-4">
      <p className="flex items-center gap-2 font-medium"><MonitorSmartphone className="size-4 text-primary" aria-hidden /> Screen signal</p>
      <p className="mt-1 text-sm text-muted-foreground">Turns the whole screen into a flashing SOS light. Not suitable for people sensitive to flashing light.</p>
      <Button className="mt-3" variant="outline" onClick={() => setActive(true)}><MonitorSmartphone /> Start screen signal</Button>
      {active ? (
        <button
          type="button"
          onClick={() => setActive(false)}
          className={cn("fixed inset-0 z-[100] flex items-end justify-center pb-10 text-lg font-semibold", lit ? "bg-white text-black" : "bg-black text-white/70")}
          aria-label="Stop screen signal"
        >
          Tap anywhere or press Esc to stop
        </button>
      ) : null}
    </div>
  );
}

/** A loud rising-falling siren from the phone speaker. */
function Siren() {
  const [on, setOn] = useState(false);
  const ctx = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (!on) return;
    const ac = new AudioContext();
    ctx.current = ac;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sawtooth";
    gain.gain.value = 0.25;
    osc.connect(gain).connect(ac.destination);
    const sweep = () => {
      const t = ac.currentTime;
      osc.frequency.cancelScheduledValues(t);
      osc.frequency.setValueAtTime(650, t);
      osc.frequency.linearRampToValueAtTime(1450, t + 0.6);
      osc.frequency.linearRampToValueAtTime(650, t + 1.2);
    };
    sweep();
    const id = window.setInterval(sweep, 1200);
    osc.start();
    return () => {
      window.clearInterval(id);
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
      void ac.close();
      ctx.current = null;
    };
  }, [on]);
  return (
    <div className="rounded-lg border p-4">
      <p className="flex items-center gap-2 font-medium"><Megaphone className="size-4 text-danger" aria-hidden /> Siren</p>
      <p className="mt-1 text-sm text-muted-foreground">Helps rescuers find you if you are trapped. Turn your volume up.</p>
      <Button className="mt-3" variant={on ? "danger" : "outline"} onClick={() => setOn((v) => !v)} aria-pressed={on}>
        {on ? <Square /> : <Megaphone />} {on ? "Stop siren" : "Sound siren"}
      </Button>
    </div>
  );
}

export function SignalTools() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <TorchSos />
      <ScreenSos />
      <Siren />
    </div>
  );
}