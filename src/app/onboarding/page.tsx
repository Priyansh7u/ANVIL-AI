"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { LocationPicker } from "@/components/shared/location-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/primitives";
import { usePlace } from "@/hooks/use-local-state";

export default function OnboardingPage() {
  const router = useRouter();
  const [place, setPlace] = usePlace();

  return (
    <main className="grid-bg grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <Link href="/" className="text-sm font-semibold">
            ANVIL <span className="text-primary">AI</span>
          </Link>
          <CardTitle className="text-xl">Where should ANVIL watch for you?</CardTitle>
          <CardDescription>
            Official alerts are issued per district. ANVIL needs your district to show the warnings, shelters and contacts that apply to you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {place ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm">
              Current: <strong>{place.label}</strong> ({place.source === "gps" ? "approximate location" : place.source === "demo" ? "demo preset" : "chosen manually"})
            </p>
          ) : null}
          <LocationPicker
            onPicked={(p) => {
              setPlace(p);
              router.push("/dashboard");
            }}
          />
          <div className="flex items-start gap-2 rounded-md bg-ok-soft p-3 text-xs text-ok">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              No account, no tracking. Your district is kept in this browser; it is sent to the server with each request and saved server-side only when you choose to (syncing preferences or saving a plan). You can clear everything in Settings.
            </span>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
