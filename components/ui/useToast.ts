"use client";

import { useCallback, useState } from "react";

// Pair with <Toast toast={toast} onDone={clearToast} />.
export function useToast() {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const showToast = useCallback((message: string) => {
    setToast((current) => ({ id: (current?.id ?? 0) + 1, message }));
  }, []);
  const clearToast = useCallback(() => setToast(null), []);
  return { toast, showToast, clearToast };
}
