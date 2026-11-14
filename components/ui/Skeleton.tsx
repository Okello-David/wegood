// Grey placeholder shapes shown while a screen loads (Next.js shows a route's
// loading.tsx instantly, then swaps in the real page). The pulse is skipped
// when the phone asks for reduced motion.

export function Block({ className = "" }: { className?: string }) {
  return <div className={`rounded-2xl bg-card/70 motion-safe:animate-pulse ${className}`} />;
}

export function ScreenSkeleton({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main
      aria-busy="true"
      className="mx-auto min-h-dvh max-w-md px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-28"
    >
      <p className="sr-only" role="status">
        Loading {title}…
      </p>
      {children}
    </main>
  );
}
