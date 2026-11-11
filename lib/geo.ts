// Geofence helpers. PRIVACY: everything in this file runs in the browser.
// The phone's position is used for one comparison and then thrown away; only
// the yes/no answer is ever sent (see components/geo/AutoHome.tsx).

export type Point = { lat: number; lng: number };

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

// Haversine: the distance between two points on a sphere, along the surface.
// Accurate to well under a metre at house scale, which is all we need.
export function haversineMeters(a: Point, b: Point) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

// The browser reports how unsure it is (`accuracy`, metres). If the error
// circle is bigger than the home circle, "inside" vs "outside" is a guess,
// so we return null: leave at_home as it is.
export function decideAtHome(
  position: Point & { accuracy: number },
  home: Point,
  radiusM: number,
): boolean | null {
  if (position.accuracy > radiusM) return null;
  return haversineMeters(position, home) <= radiusM;
}

// Per-device switch (localStorage, so each phone decides for itself).
const ENABLED_KEY = "wegood:auto-home";
export const AUTO_HOME_EVENT = "wegood:auto-home-changed";

export function autoHomeEnabled() {
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false; // Private mode or blocked storage: treat as off.
  }
}

export function setAutoHomeEnabled(on: boolean) {
  try {
    if (on) localStorage.setItem(ENABLED_KEY, "1");
    else localStorage.removeItem(ENABLED_KEY);
  } catch {
    // Nothing to do; the switch just won't be remembered.
  }
  window.dispatchEvent(new Event(AUTO_HOME_EVENT));
}

// Manual override: picking a location by hand beats the geofence until the
// next "app open". A module variable lives exactly as long as the page, so a
// fresh load resets it. AutoHome also resets it after the app was hidden for
// a long time (an installed PWA can sit in memory for days).
let manualOverride = false;
export function markManualOverride() {
  manualOverride = true;
}
export function clearManualOverride() {
  manualOverride = false;
}
export function hasManualOverride() {
  return manualOverride;
}

// Fired by AutoHome after each check, so the Me screen can show what happened.
export const GEO_CHECKED_EVENT = "wegood:geo-checked";
export type GeoCheck =
  | { outcome: "home" | "away"; accuracy: number; at: number }
  | { outcome: "low_accuracy"; accuracy: number; at: number }
  | { outcome: "denied" | "unavailable" | "timeout"; at: number };

// The callback-style browser API wrapped in a Promise.
// enableHighAccuracy asks for GPS instead of Wi-Fi guessing; maximumAge lets
// the browser reuse a fix from the last minute instead of waking GPS again.
export function getPosition(timeoutMs = 10_000) {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject({ code: 2 } as GeolocationPositionError); // POSITION_UNAVAILABLE
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: timeoutMs,
      maximumAge: 60_000,
    });
  });
}

export function geoErrorOutcome(error: GeolocationPositionError) {
  if (error.code === 1) return "denied" as const; // PERMISSION_DENIED
  if (error.code === 3) return "timeout" as const; // TIMEOUT
  return "unavailable" as const;
}
