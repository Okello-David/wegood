// notify: decides WHO gets a push notification and sends it.
//
// Runs on Supabase's servers (Deno), never in the browser, so it is the one
// place allowed to hold the VAPID private key and the service role key.
//
// Two kinds of caller:
//   1. A signed-in roommate (the app): "Ping home" and "Send me a test".
//      We check their login token and that they are in the room.
//   2. The database (triggers and scheduled jobs), which proves itself with a
//      shared secret in the x-notify-secret header.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const AT_HOME_FRESH_MS = 3 * 60 * 60 * 1000;

type Kind =
  | "request"
  | "visitor_note"
  | "food"
  | "bringing"
  | "ping"
  | "test"
  | "escalation"
  | "starving"
  | "mvp";
const KINDS: Kind[] = [
  "request",
  "visitor_note",
  "food",
  "bringing",
  "ping",
  "test",
  "escalation",
  "starving",
  "mvp",
];
// Sent by scheduled jobs, not by someone tapping, so they neither count
// against nor are blocked by the sender's rate limit.
const SCHEDULED_KINDS: Kind[] = ["escalation", "starving", "mvp"];
// Which kinds a roommate's browser may send directly. Everything else is
// written by the database, so its text can't be faked.
const USER_KINDS: Kind[] = ["ping", "test"];

// Which preference toggle switches each kind off. A test always goes through.
const PREF_FOR_KIND: Record<Kind, string | null> = {
  request: "requests",
  escalation: "requests",
  visitor_note: "visitor_notes",
  food: "food",
  bringing: "bringing",
  ping: "pings",
  starving: "fun",
  mvp: "fun",
  test: null,
};

type Prefs = {
  user_id: string;
  requests: boolean;
  visitor_notes: boolean;
  food: boolean;
  bringing: boolean;
  pings: boolean;
  fun: boolean;
  quiet_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  timezone: string;
};

const DEFAULT_PREFS: Omit<Prefs, "user_id"> = {
  requests: true,
  visitor_notes: true,
  food: true,
  bringing: true,
  pings: true,
  fun: true,
  quiet_enabled: true,
  quiet_start: "23:00",
  quiet_end: "06:00",
  timezone: "Africa/Kampala",
};

// The browser calls this function from another origin (the app's address), so
// it first asks permission with an OPTIONS request. These headers say yes.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Comparing secrets with === can leak how many leading characters matched
// through timing. This always compares every character.
function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function minutesOfDay(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// "Is it quiet hours for this person right now?", in their own time zone.
// Handles ranges that cross midnight (23:00 to 06:00).
function inQuietHours(prefs: Omit<Prefs, "user_id">, now: Date) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: prefs.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    return false; // Unknown time zone: better to notify than to stay silent.
  }
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const current = hour * 60 + minute;
  const start = minutesOfDay(prefs.quiet_start);
  const end = minutesOfDay(prefs.quiet_end);
  if (start === end) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT");
  const hookSecret = Deno.env.get("NOTIFY_HOOK_SECRET");
  if (!supabaseUrl || !serviceKey || !vapidPublic || !vapidPrivate || !vapidSubject) {
    return json({ error: "not_configured" }, 500);
  }

  // The service role bypasses Row Level Security. That is why every check
  // below (who is calling, are they in the room) has to be done by hand.
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- 1. Who is calling? --------------------------------------------------
  let fromDatabase = false;
  let callerId: string | null = null;
  const givenSecret = req.headers.get("x-notify-secret");
  if (givenSecret) {
    if (!hookSecret || !sameSecret(givenSecret, hookSecret)) {
      return json({ error: "bad_secret" }, 401);
    }
    fromDatabase = true;
  } else {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "not_authenticated" }, 401);
    // getUser asks the Auth server to verify the token; we never trust a
    // token just because it decodes.
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return json({ error: "not_authenticated" }, 401);
    callerId = data.user.id;
  }

  // ---- 2. Read and check the input -----------------------------------------
  let input: Record<string, unknown>;
  try {
    input = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const roomId = String(input.room_id ?? "");
  const senderId = input.sender_id ? String(input.sender_id) : null;
  const kind = String(input.kind ?? "") as Kind;
  const title = String(input.title ?? "").trim().slice(0, 80);
  const body = String(input.body ?? "").trim().slice(0, 200);
  const urgency = input.urgency === "urgent" ? "urgent" : "normal";
  // Only paths inside the app: a full URL here could send a tap anywhere.
  const rawUrl = String(input.url ?? "/");
  const url = rawUrl.startsWith("/") && !rawUrl.startsWith("//") ? rawUrl.slice(0, 200) : "/";

  if (!UUID.test(roomId) || !KINDS.includes(kind) || !title) {
    return json({ error: "bad_input" }, 400);
  }
  if (senderId && !UUID.test(senderId)) return json({ error: "bad_input" }, 400);

  // Only the database may address one person or force "everyone".
  let forUser: string | null = null;
  let audienceAll = false;
  if (fromDatabase) {
    if (input.for_user && UUID.test(String(input.for_user))) forUser = String(input.for_user);
    audienceAll = input.audience === "all";
  } else {
    if (!USER_KINDS.includes(kind)) return json({ error: "kind_not_allowed" }, 403);
    if (senderId !== callerId) return json({ error: "sender_mismatch" }, 403);
  }

  const { data: memberRows, error: memberError } = await admin
    .from("room_members")
    .select("user_id")
    .eq("room_id", roomId);
  if (memberError) return json({ error: "db_error", detail: memberError.message }, 500);
  const members = (memberRows ?? []).map((row) => row.user_id as string);
  if (senderId && !members.includes(senderId)) {
    return json({ error: "not_a_member" }, 403);
  }

  // ---- 3. Rate limit: 10 per sender per 10 minutes ---------------------------
  // Scheduled kinds (escalation, starving, mvp) don't count against, and
  // aren't blocked by, the sender's limit.
  if (senderId && !SCHEDULED_KINDS.includes(kind)) {
    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const { count, error } = await admin
      .from("notification_log")
      .select("id", { count: "exact", head: true })
      .eq("sender_id", senderId)
      .not("kind", "in", `(${SCHEDULED_KINDS.join(",")})`)
      .gte("created_at", since);
    if (error) return json({ error: "db_error", detail: error.message }, 500);
    if ((count ?? 0) >= RATE_LIMIT) {
      return json({ error: "rate_limited", limit: RATE_LIMIT, window_minutes: 10 }, 429);
    }
  }

  // ---- 4. Routing: who should get it? ---------------------------------------
  const others = members.filter((id) => id !== senderId);
  let rule: "direct" | "everyone" | "at_home" | "fallback_all";
  let why: string;
  let targets: string[];

  if (kind === "test") {
    rule = "direct";
    why = "Test: sent only to you.";
    targets = senderId ? [senderId] : [];
  } else if (forUser) {
    rule = "direct";
    why = "Addressed to one person.";
    targets = members.includes(forUser) && forUser !== senderId ? [forUser] : [];
  } else if (audienceAll) {
    rule = "everyone";
    why = "This kind always goes to everyone except the sender.";
    targets = others;
  } else {
    const freshSince = new Date(Date.now() - AT_HOME_FRESH_MS).toISOString();
    const { data: homeRows, error } = await admin
      .from("statuses")
      .select("user_id")
      .eq("room_id", roomId)
      .eq("at_home", true)
      .gte("at_home_updated_at", freshSince);
    if (error) return json({ error: "db_error", detail: error.message }, 500);
    const home = (homeRows ?? [])
      .map((row) => row.user_id as string)
      .filter((id) => others.includes(id));
    if (home.length > 0) {
      rule = "at_home";
      why = "Sent to the people marked at home in the last 3 hours.";
      targets = home;
    } else {
      rule = "fallback_all";
      why = "Nobody is marked at home in the last 3 hours, so everyone except the sender.";
      targets = others;
    }
  }

  // ---- 5. Preferences and quiet hours ---------------------------------------
  const skipped: { user_id: string; reason: string }[] = [];
  let finalTargets = targets;
  if (targets.length > 0 && kind !== "test") {
    const { data: prefRows, error } = await admin
      .from("notification_prefs")
      .select("*")
      .in("user_id", targets);
    if (error) return json({ error: "db_error", detail: error.message }, 500);
    const prefsByUser = new Map((prefRows ?? []).map((row) => [row.user_id as string, row as Prefs]));
    const now = new Date();
    const column = PREF_FOR_KIND[kind];

    finalTargets = targets.filter((id) => {
      const prefs = prefsByUser.get(id) ?? DEFAULT_PREFS;
      if (column && (prefs as Record<string, unknown>)[column] === false) {
        skipped.push({ user_id: id, reason: `turned_off:${column}` });
        return false;
      }
      // Urgent messages are allowed through quiet hours.
      if (urgency !== "urgent" && prefs.quiet_enabled && inQuietHours(prefs, now)) {
        skipped.push({ user_id: id, reason: "quiet_hours" });
        return false;
      }
      return true;
    });
  }

  // ---- 6. Send ---------------------------------------------------------------
  let sent = 0;
  let removed = 0;
  const targeted: { user_id: string; devices: number; delivered: number }[] = [];

  if (finalTargets.length > 0) {
    const { data: subs, error } = await admin
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", finalTargets);
    if (error) return json({ error: "db_error", detail: error.message }, 500);

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    const message = JSON.stringify({ title, body, url, kind });
    const deadIds: string[] = [];
    const delivered = new Map<string, number>();

    await Promise.all(
      (subs ?? []).map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            message,
            // TTL: how long the push service keeps trying if the phone is off.
            { TTL: 4 * 60 * 60, urgency: urgency === "urgent" ? "high" : "normal" },
          );
          delivered.set(sub.user_id, (delivered.get(sub.user_id) ?? 0) + 1);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          // 404/410 = the browser unsubscribed or was wiped. The row is dead.
          if (status === 404 || status === 410) deadIds.push(sub.id);
          else console.error("push failed", status, (err as Error).message);
        }
      }),
    );

    if (deadIds.length > 0) {
      await admin.from("push_subscriptions").delete().in("id", deadIds);
      removed = deadIds.length;
    }

    for (const id of finalTargets) {
      const devices = (subs ?? []).filter((sub) => sub.user_id === id).length;
      const count = delivered.get(id) ?? 0;
      if (devices === 0) skipped.push({ user_id: id, reason: "no_device" });
      targeted.push({ user_id: id, devices, delivered: count });
      sent += count;
    }
  }

  // ---- 7. Log (also feeds the rate limit) and answer ---------------------------
  const { error: logError } = await admin.from("notification_log").insert({
    room_id: roomId,
    sender_id: senderId,
    kind,
    title,
    rule,
    targeted,
    skipped,
    sent,
  });
  if (logError) console.error("log failed", logError.message);

  return json({ ok: true, rule, why, targeted, skipped, sent, removed });
});
