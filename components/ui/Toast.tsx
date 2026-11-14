"use client";

import { useEffect } from "react";

type Props = {
  toast: { id: number; message: string } | null;
  onDone: () => void;
};

export default function Toast({ toast, onDone }: Props) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDone, 1800);
    return () => clearTimeout(timer);
  }, [toast, onDone]);

  // Always rendered so screen readers announce changes to its text.
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[calc(0.75rem+env(safe-area-inset-top))] z-50 flex justify-center px-4"
    >
      {toast && (
        <p className="max-w-full truncate rounded-full bg-primary px-4 py-2 text-sm font-medium text-on-primary shadow-lg">
          {toast.message}
        </p>
      )}
    </div>
  );
}
