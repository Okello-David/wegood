"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Toast from "@/components/ui/Toast";
import { useToast } from "@/components/ui/useToast";
import {
  callNotify,
  detectPushSupport,
  disablePush,
  enablePush,
  notifyErrorMessage,
  syncPush,
  type PushSupport,
} from "@/lib/push";
import { createClient } from "@/lib/supabase/client";

type Props = { userId: string; roomId: string };

// What the browser can do never changes while the page is open, so there is
// nothing to subscribe to. useSyncExternalStore is used only because it gives
// the server render ("loading") and the browser different answers safely.
const noSubscription = () => () => {};
const serverSupport = (): PushSupport => "loading";

function Step({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-2xl"
      >
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}

export default function NotificationsCard({ userId, roomId }: Props) {
  const [supabase] = useState(createClient);
  const support = useSyncExternalStore(noSubscription, detectPushSupport, serverSupport);
  const [state, setState] = useState<"checking" | "off" | "on" | "blocked">("checking");
  const [busy, setBusy] = useState(false);
  const { toast, showToast, clearToast } = useToast();

  // No permission prompt here: this only looks at what was already granted.
  useEffect(() => {
    if (support !== "ok") return;
    let cancelled = false;
    syncPush(supabase)
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        if (!cancelled) setState("off");
      });
    return () => {
      cancelled = true;
    };
  }, [support, supabase]);

  async function turnOn() {
    setBusy(true);
    try {
      const result = await enablePush(supabase);
      if (result === "on") {
        setState("on");
        // Quiet hours are in the phone's own clock, so remember its time zone.
        await supabase.from("notification_prefs").upsert({
          user_id: userId,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        showToast("Notifications on 🔔");
      } else if (result === "blocked") {
        setState("blocked");
      } else {
        showToast("No worries, maybe later");
      }
    } catch {
      showToast("Couldn't turn them on. Try again.");
    }
    setBusy(false);
  }

  async function turnOff() {
    setBusy(true);
    try {
      await disablePush(supabase);
      setState("off");
      showToast("Notifications off on this device");
    } catch {
      showToast("Couldn't turn them off. Try again.");
    }
    setBusy(false);
  }

  async function sendTest() {
    setBusy(true);
    const answer = await callNotify(supabase, {
      kind: "test",
      room_id: roomId,
      sender_id: userId,
      title: "WeGood? test 🔔",
      body: "If you can read this, notifications work.",
      url: "/me",
    });
    setBusy(false);
    if ("error" in answer) showToast(notifyErrorMessage(answer.error));
    else if (answer.result.sent > 0) showToast("Sent! It should pop up in a moment");
    else showToast("No device is subscribed. Turn notifications on again.");
  }

  const primary = "min-h-14 w-full rounded-xl bg-stone-900 font-semibold text-white disabled:opacity-50";
  const secondary = "min-h-12 w-full rounded-xl bg-stone-100 font-semibold disabled:opacity-50";

  return (
    <section className="mb-6 rounded-2xl bg-white p-4">
      <h2 className="mb-1 text-lg font-bold">Notifications</h2>

      {support === "loading" && <p className="text-stone-600">Checking…</p>}

      {support === "ios_needs_install" && (
        <>
          <p className="mb-3 font-semibold">Add WeGood? to your Home Screen first</p>
          <p className="mb-3 text-sm text-stone-600">
            iPhone only allows notifications for apps on the Home Screen.
          </p>
          <ol className="flex flex-col gap-3">
            <Step icon="⬆️">
              Tap the <strong>Share</strong> button (the square with an arrow).
            </Step>
            <Step icon="➕">
              Scroll down and tap <strong>Add to Home Screen</strong>.
            </Step>
            <Step icon="🔔">
              Open WeGood? from the new icon, sign in, and come back to this screen.
            </Step>
          </ol>
        </>
      )}

      {support === "insecure" && (
        <p className="text-stone-600">
          Notifications need a secure (https) address. They will work once the app is on its real
          web address.
        </p>
      )}

      {support === "not_configured" && (
        <p className="text-stone-600">Notifications aren&apos;t set up on this server yet.</p>
      )}

      {support === "unsupported" && (
        <p className="text-stone-600">
          This browser can&apos;t show notifications. Try Chrome on Android, or Safari on iPhone.
        </p>
      )}

      {support === "ok" && state === "checking" && <p className="text-stone-600">Checking…</p>}

      {support === "ok" && state === "off" && (
        <>
          <p className="mb-3 text-stone-600">
            Get a buzz when someone needs something, even with the app closed.
          </p>
          <button type="button" disabled={busy} onClick={() => void turnOn()} className={primary}>
            🔔 Turn on notifications
          </button>
        </>
      )}

      {support === "ok" && state === "blocked" && (
        <p className="text-stone-600">
          Notifications are blocked for WeGood? on this device. Open your browser&apos;s site
          settings (the icon next to the address), allow notifications, then reload this page.
        </p>
      )}

      {support === "ok" && state === "on" && (
        <div className="flex flex-col gap-2">
          <p className="text-stone-600">On for this device ✅</p>
          <button type="button" disabled={busy} onClick={() => void sendTest()} className={primary}>
            Send me a test notification
          </button>
          <button type="button" disabled={busy} onClick={() => void turnOff()} className={secondary}>
            Turn off on this device
          </button>
        </div>
      )}

      <Toast toast={toast} onDone={clearToast} />
    </section>
  );
}
