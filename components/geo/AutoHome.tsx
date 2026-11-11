"use client";

import { useEffect, useRef, useState } from "react";
import {
  AUTO_HOME_EVENT,
  GEO_CHECKED_EVENT,
  autoHomeEnabled,
  clearManualOverride,
  decideAtHome,
  geoErrorOutcome,
  getPosition,
  hasManualOverride,
  setAutoHomeEnabled,
  type GeoCheck,
  type Point,
} from "@/lib/geo";
import { createClient } from "@/lib/supabase/client";

type Props = { home: Point | null; radiusM: number };

const MINUTE = 60_000;
// Same answer as last time and sent recently? Skip the write. Still re-sent
// every 10 minutes, which keeps "at home" fresh for push routing (Phase 3
// treats a "home" older than 3 hours as unknown).
const RESEND_SAME_AFTER_MS = 10 * MINUTE;
// Hidden this long and back again counts as a new "app open": a manual
// location choice stops winning. An installed PWA can stay in memory for
// days, so "until the page reloads" alone could mean forever.
const NEW_OPEN_AFTER_HIDDEN_MS = 30 * MINUTE;

// Renders nothing. Mounted once for every in-room screen (app/(app)/layout).
//
// PRIVACY: the phone's coordinates are used only inside this browser tab,
// for one distance calculation against the ROOM's home point. They are never
// sent anywhere and never stored. The database only receives
// rpc("set_geo_home", { p_at_home: true | false }), and that function has no
// way to accept coordinates even if we tried.
export default function AutoHome({ home, radiusM }: Props) {
  const [supabase] = useState(createClient);
  const lastSent = useRef<{ value: boolean; at: number } | null>(null);
  const checking = useRef(false);

  const homeLat = home?.lat ?? null;
  const homeLng = home?.lng ?? null;

  useEffect(() => {
    // The admin hasn't set the home point yet.
    if (homeLat === null || homeLng === null) return;
    const homePoint = { lat: homeLat, lng: homeLng };
    let hiddenAt: number | null = null;

    function report(check: GeoCheck) {
      window.dispatchEvent(new CustomEvent<GeoCheck>(GEO_CHECKED_EVENT, { detail: check }));
    }

    async function check() {
      if (checking.current) return;
      if (!autoHomeEnabled() || hasManualOverride()) return;
      checking.current = true;
      try {
        const position = await getPosition();
        const { latitude, longitude, accuracy } = position.coords;
        const atHome = decideAtHome({ lat: latitude, lng: longitude, accuracy }, homePoint, radiusM);
        // From here on only `atHome` (true/false/null) is used.

        if (atHome === null) {
          report({ outcome: "low_accuracy", accuracy, at: Date.now() });
          return;
        }
        report({ outcome: atHome ? "home" : "away", accuracy, at: Date.now() });

        const last = lastSent.current;
        if (last && last.value === atHome && Date.now() - last.at < RESEND_SAME_AFTER_MS) return;
        // The person may have picked a location by hand while GPS was working.
        if (hasManualOverride()) return;

        const { error } = await supabase.rpc("set_geo_home", { p_at_home: atHome });
        if (!error) lastSent.current = { value: atHome, at: Date.now() };
      } catch (error) {
        const outcome = geoErrorOutcome(error as GeolocationPositionError);
        report({ outcome, at: Date.now() });
        // Blocked in browser settings: switch off so we stop asking. The Me
        // screen explains how to allow it again.
        if (outcome === "denied") setAutoHomeEnabled(false);
        // Timeout / unavailable: leave at_home as it is; next open tries again.
      } finally {
        checking.current = false;
      }
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt > NEW_OPEN_AFTER_HIDDEN_MS) {
        clearManualOverride();
      }
      hiddenAt = null;
      void check();
    }

    void check(); // App open.
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(AUTO_HOME_EVENT, check); // Switched on in Me.
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(AUTO_HOME_EVENT, check);
    };
  }, [homeLat, homeLng, radiusM, supabase]);

  return null;
}
