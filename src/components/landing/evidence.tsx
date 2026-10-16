"use client";

import { useRef } from "react";
import { Check, X } from "lucide-react";
import { useScrollScene } from "./gsap";

/**
 * How ANVIL decides what to keep, shown on an illustrative page excerpt.
 * The highlight is driven by scroll so the reader sees the check happen.
 */
export function Evidence() {
  const root = useRef<HTMLElement>(null);

  useScrollScene(root, ({ gsap }) => {
    const tl = gsap.timeline({ scrollTrigger: { trigger: root.current, start: "top 65%", end: "bottom 60%", scrub: 0.6 } });
    tl.from(".ev-page", { rotateX: 18, rotateY: -14, y: 60, opacity: 0, duration: 0.3, ease: "power2.out" }, 0)
      .fromTo(".ev-mark", { backgroundSize: "0% 100%" }, { backgroundSize: "100% 100%", duration: 0.35, ease: "none" }, 0.25)
      .from(".ev-kept", { x: 40, opacity: 0, duration: 0.15 }, 0.6)
      .from(".ev-dropped", { x: 40, opacity: 0, duration: 0.15 }, 0.75);
  });

  return (
    <section ref={root} className="relative bg-[#0d1a26] text-[#edf1ee]" aria-labelledby="ev-h">
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 py-28 sm:px-10 md:grid-cols-2">
        <div>
          <h2 id="ev-h" className="landing-display max-w-[14ch] text-[clamp(2.4rem,5.5vw,4.6rem)]">A shelter is listed only if its sentence is on the page.</h2>
          <p className="mt-5 max-w-[46ch] text-[#b8c4c1]">
            The research agent reads government websites with TinyFish. Every shelter, phone number and advisory it extracts must come with a quote that ANVIL then finds, word for word, in the page it fetched. Anything that fails is dropped and counted, never shown.
          </p>
        </div>
        <div className="[perspective:1400px]">
          <figure className="ev-page rounded-2xl bg-[#f4f6f3] p-6 text-[#1d2a30] shadow-[0_50px_100px_-40px_rgba(0,0,0,0.9)] sm:p-8">
            <figcaption className="mb-4 text-xs text-[#5f7176]">Illustrative excerpt of a district relief page</figcaption>
            <p className="leading-relaxed">
              In view of the flood situation, relief camps have been set up for affected families.{" "}
              <mark className="ev-mark bg-[linear-gradient(#f0a33a66,#f0a33a66)] bg-no-repeat px-0.5 text-inherit [background-size:0%_100%]">Relief camp operational at Government Middle School, Danapur.</mark>{" "}
              Residents are advised to follow instructions issued by the district administration.
            </p>
          </figure>
          <div className="mt-5 space-y-2.5">
            <div className="ev-kept flex items-start gap-3 rounded-xl bg-[#13303a] px-4 py-3">
              <Check className="mt-0.5 size-4 shrink-0 text-[#5cc8be]" aria-hidden />
              <p className="text-sm"><span className="font-semibold">Kept:</span> “Government Middle School, Danapur” — its quote is on the page.</p>
            </div>
            <div className="ev-dropped flex items-start gap-3 rounded-xl bg-[#3a1f22] px-4 py-3">
              <X className="mt-0.5 size-4 shrink-0 text-[#ff8a8f]" aria-hidden />
              <p className="text-sm"><span className="font-semibold">Dropped:</span> “capacity 500” — the page never says it, so it isn&apos;t shown.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}