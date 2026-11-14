"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Toast from "@/components/ui/Toast";
import { useToast } from "@/components/ui/useToast";
import {
  AUTO_HOME_EVENT,
  GEO_CHECKED_EVENT,
  autoHomeEnabled,
  geoErrorOutcome,
  getPosition,
  setAutoHomeEnabled,
  type GeoCheck,
} from "@/lib/geo";
import { createClient } from "@/lib/supabase/client";

type Props = {
  roomId: string;
  isAdmin: boolean;
  hasHome: boolean;
  initialRadius: number;
};

const MIN_RADIUS = 30;
const MAX_RADIUS = 150;
// A fix rougher than this would put "home" in the wrong place.
const MAX_SET_ACCURACY = 100;
const WARN_SET_ACCURACY = 50;

// The per-device switch lives in localStorage; AUTO_HOME_EVENT says it changed.
function subscribeAutoHome(onChange: () => void) {
  window.addEventListener(AUTO_HOME_EVENT, onChange);
  return () => window.removeEventListener(AUTO_HOME_EVENT, onChange);
}
const noSubscription = () => () => {};

function describeCheck(check: GeoCheck) {
  switch (check.outcome) {
    case "home":
      return `🏠 You're home (±${Math.round(check.accuracy)} m)`;
    case "away":
      return `🚶 You're out (±${Math.round(check.accuracy)} m)`;
    case "low_accuracy":
      return `🤷 Location too rough (±${Math.round(check.accuracy)} m), nothing changed`;
    case "timeout":
      return "⌛ Location took too long, nothing changed";
    case "denied":
      return "🚫 Location is blocked";
    default:
      return "❓ Location unavailable, nothing changed";
  }
}

export default function HomeLocationCard({ roomId, isAdmin, hasHome, initialRadius }: Props) {
  const router = useRouter();
  const [supabase] = useState(createClient);
  // useSyncExternalStore: the server render can't see localStorage, so it
  // says "off"; the browser then reads the real value without a flash.
  const enabled = useSyncExternalStore(subscribeAutoHome, autoHomeEnabled, () => false);
  const secure = useSyncExternalStore(noSubscription, () => window.isSecureContext, () => true);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastCheck, setLastCheck] = useState<GeoCheck | null>(null);
  // Older rooms may have a radius outside the slider's range.
  const [radius, setRadius] = useState(
    Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, initialRadius)),
  );
  const radiusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast, showToast, clearToast } = useToast();

  // Listen for AutoHome's results, and see if location is already blocked.
  useEffect(() => {
    const onCheck = (event: Event) => {
      const check = (event as CustomEvent<GeoCheck>).detail;
      setLastCheck(check);
      if (check.outcome === "denied") setBlocked(true);
    };
    window.addEventListener(GEO_CHECKED_EVENT, onCheck);

    // Not in every browser (older iPhones), hence the guards.
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((status) => setBlocked(status.state === "denied"))
      .catch(() => {});

    return () => {
      window.removeEventListener(GEO_CHECKED_EVENT, onCheck);
      if (radiusTimer.current) clearTimeout(radiusTimer.current);
    };
  }, []);

  async function toggle() {
    if (enabled) {
      setAutoHomeEnabled(false);
      showToast("Auto-home off on this device");
      return;
    }
    // Asking for the position here is what makes the browser show its
    // permission prompt, right after the tap, so it isn't a surprise.
    setBusy(true);
    try {
      await getPosition();
      setBlocked(false);
      setAutoHomeEnabled(true); // AutoHome hears this and checks right away.
      showToast("Auto-home on 📍");
    } catch (error) {
      const outcome = geoErrorOutcome(error as GeolocationPositionError);
      if (outcome === "denied") setBlocked(true);
      else showToast("Couldn't get your location. Try again outside or near a window.");
    } finally {
      setBusy(false);
    }
  }

  async function setHomeHere() {
    setBusy(true);
    try {
      const { coords } = await getPosition(15_000);
      if (coords.accuracy > MAX_SET_ACCURACY) {
        showToast(`Location too rough (±${Math.round(coords.accuracy)} m). Try near a window.`);
        return;
      }
      // The ROOM's point, set once by an admin. This is the only place a
      // coordinate is ever written, and it's the house, not a person.
      const { error } = await supabase
        .from("rooms")
        .update({ home_lat: coords.latitude, home_lng: coords.longitude })
        .eq("id", roomId);
      if (error) {
        showToast("Couldn't save home. Try again.");
        return;
      }
      showToast(
        coords.accuracy > WARN_SET_ACCURACY
          ? `Home saved, but only ±${Math.round(coords.accuracy)} m. Set it again from a better spot if auto-home acts up.`
          : `Home saved 🏠 (±${Math.round(coords.accuracy)} m)`,
      );
      router.refresh(); // The layout re-reads the home point for AutoHome.
    } catch (error) {
      const outcome = geoErrorOutcome(error as GeolocationPositionError);
      if (outcome === "denied") setBlocked(true);
      else showToast("Couldn't get your location. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Save shortly after the slider stops moving, not on every pixel.
  function changeRadius(next: number) {
    setRadius(next);
    if (radiusTimer.current) clearTimeout(radiusTimer.current);
    radiusTimer.current = setTimeout(async () => {
      const { error } = await supabase.from("rooms").update({ radius_m: next }).eq("id", roomId);
      if (error) showToast("Couldn't save the radius.");
      else {
        showToast(`Home radius: ${next} m`);
        router.refresh();
      }
    }, 600);
  }

  const button =
    "min-h-12 w-full rounded-xl px-4 font-semibold disabled:opacity-60";

  return (
    <section className="mb-6 rounded-2xl bg-card p-4">
      <h2 className="mb-1 text-lg font-bold">📍 Auto-home</h2>
      <p className="mb-3 text-sm text-muted">
        When you open the app, your phone checks if it&apos;s inside the home circle and tells
        your roommates only <b>home</b> or <b>out</b>. Your location never leaves the phone.
      </p>

      {!secure && (
        <p className="mb-3 rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-900">
          Location only works on https (or localhost). It will work once the app is online.
        </p>
      )}

      {!hasHome && !isAdmin && (
        <p className="text-muted">Waiting for the room admin to set where home is.</p>
      )}

      {hasHome && (
        <>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={busy || !secure}
            onClick={() => void toggle()}
            className={`${button} flex items-center justify-between ${
              enabled ? "bg-emerald-600 text-white" : "bg-chip"
            }`}
          >
            <span>Auto-detect when I&apos;m home</span>
            <span aria-hidden="true">{enabled ? "ON" : "OFF"}</span>
          </button>
          {blocked && (
            <p className="mt-2 text-sm text-red-700 dark:text-red-300">
              Location is blocked for this site. Allow it in your browser&apos;s site settings,
              then switch this on again.
            </p>
          )}
          {enabled && lastCheck && (
            <p className="mt-2 text-sm text-muted">Last check: {describeCheck(lastCheck)}</p>
          )}
        </>
      )}

      {isAdmin && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="mb-2 text-sm font-semibold text-ink">Admin</p>
          <button
            type="button"
            disabled={busy || !secure}
            onClick={() => void setHomeHere()}
            className={`${button} bg-primary text-on-primary`}
          >
            {busy ? "Finding you…" : hasHome ? "I'm at home now, move home here" : "I'm at home now, set this as home"}
          </button>
          <label className="mt-4 block">
            <span className="flex justify-between text-sm font-semibold">
              <span>Home circle size</span>
              <span>{radius} m</span>
            </span>
            {/* A bigger circle tolerates rough GPS but also counts the
                neighbour's place as home. */}
            <input
              type="range"
              min={MIN_RADIUS}
              max={MAX_RADIUS}
              step={10}
              value={radius}
              onChange={(event) => changeRadius(Number(event.target.value))}
              className="mt-2 h-11 w-full accent-ink"
            />
          </label>
        </div>
      )}
      <Toast toast={toast} onDone={clearToast} />
    </section>
  );
}
