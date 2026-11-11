import type { Client } from "@/lib/queries";

// Browser-side push helpers. The public VAPID key is safe to ship: it only lets
// a browser check that pushes come from our server. The private half lives in
// the Edge Function's secrets and never reaches this code.
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export type PushSupport =
  | "loading" // Not known yet (server render).
  | "ok"
  | "ios_needs_install" // iPhone/iPad in a browser tab: must be on the Home Screen first.
  | "insecure" // Not https (and not localhost): browsers refuse service workers.
  | "not_configured" // The server has no VAPID key set.
  | "unsupported";

export function detectPushSupport(): PushSupport {
  const ua = navigator.userAgent;
  // iPadOS pretends to be a Mac, so also check for a touch screen.
  const isIos =
    /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;

  if (isIos && !standalone) return "ios_needs_install";
  if (!window.isSecureContext) return "insecure";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  if (!VAPID_PUBLIC_KEY) return "not_configured";
  return "ok";
}

// The key is stored as URL-safe base64 text; the browser wants raw bytes.
function keyToBytes(base64Url: string) {
  const padded = base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function sameBytes(a: ArrayBuffer | null, b: Uint8Array) {
  if (!a) return false;
  const view = new Uint8Array(a);
  return view.length === b.length && view.every((value, i) => value === b[i]);
}

async function registration() {
  // Registering again is harmless: the browser reuses the existing worker.
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

async function save(supabase: Client, subscription: PushSubscription) {
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.p256dh || !keys?.auth) throw new Error("incomplete_subscription");
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
    p_user_agent: navigator.userAgent,
  });
  if (error) throw new Error(error.message);
}

// Call only from a tap handler: browsers (iPhone especially) ignore or punish
// permission prompts that appear on their own.
export async function enablePush(supabase: Client): Promise<"on" | "blocked" | "dismissed"> {
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "dismissed";

  const reg = await registration();
  const key = keyToBytes(VAPID_PUBLIC_KEY);
  let subscription = await reg.pushManager.getSubscription();
  // A subscription made with an older key can never receive our pushes.
  if (subscription && !sameBytes(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  await save(supabase, subscription);
  return "on";
}

// On every visit to the Me screen: is this browser still subscribed? If so,
// save it again, which repairs a row the server deleted or one that belonged
// to someone else who used this phone.
export async function syncPush(supabase: Client): Promise<"on" | "off" | "blocked"> {
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  const reg = await navigator.serviceWorker.getRegistration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return "off";
  await save(supabase, subscription);
  return "on";
}

export async function disablePush(supabase: Client) {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;
  await supabase.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
  await subscription.unsubscribe();
}

export type NotifyResult = {
  ok: true;
  rule: "direct" | "everyone" | "at_home" | "fallback_all";
  why: string;
  targeted: { user_id: string; devices: number; delivered: number }[];
  skipped: { user_id: string; reason: string }[];
  sent: number;
  removed: number;
};

type NotifyInput = {
  kind: "ping" | "test";
  room_id: string;
  sender_id: string;
  title: string;
  body: string;
  url: string;
};

// supabase.functions.invoke adds the user's login token, which is how the
// Edge Function knows who is asking.
export async function callNotify(
  supabase: Client,
  input: NotifyInput,
): Promise<{ result: NotifyResult } | { error: string }> {
  const { data, error } = await supabase.functions.invoke<NotifyResult>("notify", {
    body: { ...input, urgency: "normal" },
  });
  if (error) {
    // For 4xx/5xx answers the real reason is in the response body.
    const response = (error as { context?: Response }).context;
    const detail = await response?.json?.().catch(() => null);
    return { error: (detail as { error?: string } | null)?.error ?? "failed" };
  }
  return { result: data! };
}

export function notifyErrorMessage(code: string) {
  switch (code) {
    case "rate_limited":
      return "Easy! Max 10 notifications in 10 minutes 😅";
    case "not_configured":
      return "Notifications aren't set up on the server yet.";
    default:
      return "Couldn't send that. Try again.";
  }
}
