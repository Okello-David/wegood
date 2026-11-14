// A tiny buzz on tap. Only Android Chrome supports navigator.vibrate; iPhone
// Safari doesn't have it, so the ?. makes it a silent no-op there.
// 10 ms is a "tick", not a buzz: enough to feel, not enough to annoy.
export function haptic(ms = 10) {
  if (typeof navigator === "undefined") return;
  navigator.vibrate?.(ms);
}

// "Reduce motion" is set in the phone's accessibility settings. CSS handles
// most of it (motion-safe:), this is for things drawn from JavaScript.
export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
