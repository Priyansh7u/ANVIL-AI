"use client";

import { ErrorState } from "@/components/shared/status";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <ErrorState
        message={`This page hit an unexpected error${error.digest ? ` (ref ${error.digest})` : ""}. Official alerts remain available at sachet.ndma.gov.in. In an emergency call 112.`}
        onRetry={reset}
      />
    </div>
  );
}
