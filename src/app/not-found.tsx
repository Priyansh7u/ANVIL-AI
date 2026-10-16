import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <p className="text-sm text-muted-foreground">404</p>
        <h1 className="mt-1 text-2xl font-semibold">Page not found</h1>
        <Link href="/dashboard" className="mt-4 inline-block text-primary underline">
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
