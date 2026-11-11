"use client";

import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

// false during the server render and hydration, true afterwards. For things
// that depend on the phone's clock or time zone (schedule times, battery),
// which the server can't know; rendering them early would mismatch.
export function useIsClient() {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
