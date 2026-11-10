"use client";

import { useEffect, useState } from "react";

// "5 min ago" labels need a clock that ticks. Starts from the server's time so
// the first browser render matches the HTML the server sent.
export function useNow(serverNow: number, everyMs = 30_000) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, everyMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [everyMs]);
  return now;
}
