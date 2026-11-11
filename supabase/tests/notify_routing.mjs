// Phase 3: end-to-end test of the `notify` Edge Function against the LOCAL
// Supabase (Docker). It creates throwaway users and a room, checks who gets
// targeted in each situation, and deletes everything again.
//
// Run from the project root:  node supabase/tests/notify_routing.mjs
//
// The test devices use made-up push addresses, so nothing really buzzes. What
// is checked is the function's own report of who it targeted and why.
// Local only: it uses `docker exec` to back-date rows, which the API can't do.

import { execFileSync } from "node:child_process";
import { createECDH, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function readEnv(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.includes("=") && !line.startsWith("#"))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
  );
}

const app = readEnv(".env.local");
const fn = readEnv("supabase/functions/.env");
const URL_ = "http://127.0.0.1:54321";
const NOTIFY = `${URL_}/functions/v1/notify`;
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, app.SUPABASE_SERVICE_ROLE_KEY, options);

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_wegood", "psql", "-U", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
}
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = randomBytes(4).toString("hex");
const people = {};

async function makeUser(name) {
  const email = `notify-${run}-${name}@test.invalid`;
  const password = randomBytes(12).toString("hex");
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const client = createClient(URL_, app.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  people[name] = { id: created.data.user.id, client, token: signedIn.data.session.access_token };
  return people[name];
}

async function call(body, headers) {
  const response = await fetch(NOTIFY, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
const asUser = (person, body) => call(body, { Authorization: `Bearer ${person.token}` });
const asDatabase = (body) => call(body, { "x-notify-secret": fn.NOTIFY_HOOK_SECRET });
const ids = (result) => result.body.targeted?.map((target) => target.user_id) ?? [];

function clearLog(roomId) {
  psql(`delete from public.notification_log where room_id = '${roomId}'`);
}

// Waits for the database -> pg_net -> Edge Function round trip to show up in the log.
async function waitForLog(roomId, kind, howMany = 1) {
  for (let i = 0; i < 40; i++) {
    const { data } = await admin
      .from("notification_log")
      .select("*")
      .eq("room_id", roomId)
      .eq("kind", kind)
      .order("id", { ascending: false });
    if ((data?.length ?? 0) >= howMany) return data;
    await sleep(500);
  }
  return [];
}

async function setLocation(person, at_home) {
  const { error } = await person.client
    .from("statuses")
    .update({ at_home, at_home_source: "manual", location_preset: at_home ? "home" : "campus" })
    .eq("user_id", person.id);
  if (error) throw error;
}

// Saves preferences as that person and fails loudly if the database refuses.
async function setPrefs(person, patch) {
  const { error } = await person.client
    .from("notification_prefs")
    .upsert({ user_id: person.id, ...patch });
  if (error) throw new Error(`saving preferences failed: ${error.message}`);
}

let roomId;
let otherRoomId;

try {
  const [alice, bob, carol, dora] = await Promise.all(["alice", "bob", "carol", "dora"].map(makeUser));

  // Alice, Bob and Carol share a room. Dora is an outsider in her own room.
  roomId = (await alice.client.rpc("create_room", { p_name: `Test ${run}` })).data;
  const code = (await alice.client.from("rooms").select("invite_code").eq("id", roomId).single()).data
    .invite_code;
  await bob.client.rpc("join_room", { p_code: code });
  await carol.client.rpc("join_room", { p_code: code });
  otherRoomId = (await dora.client.rpc("create_room", { p_name: `Other ${run}` })).data;

  // One made-up device each.
  for (const [name, person] of Object.entries(people)) {
    const { error } = await person.client.rpc("save_push_subscription", {
      p_endpoint: `https://push.test.invalid/${run}/${name}`,
      p_p256dh: createECDH("prime256v1").generateKeys("base64url"),
      p_auth: randomBytes(16).toString("base64url"),
      p_user_agent: "notify_routing test",
    });
    if (error) throw error;
  }
  // Quiet hours off for everyone to start with, so the time of day you run
  // this at doesn't change the results.
  for (const person of Object.values(people)) {
    await setPrefs(person, { quiet_enabled: false });
  }

  const ping = { kind: "ping", room_id: roomId, sender_id: alice.id, title: "Anyone home?", body: "", url: "/" };

  console.log("\n-- Who is allowed to call --");
  let r = await call(ping, {});
  check("no login token -> 401", r.status === 401, JSON.stringify(r.body));
  r = await call(ping, { "x-notify-secret": "wrong" });
  check("wrong database secret -> 401", r.status === 401, JSON.stringify(r.body));
  r = await asUser(dora, { ...ping, sender_id: dora.id });
  check("outsider pinging our room -> 403", r.status === 403 && r.body.error === "not_a_member", JSON.stringify(r.body));
  r = await asUser(alice, { ...ping, sender_id: bob.id });
  check("pretending to be a roommate -> 403", r.status === 403 && r.body.error === "sender_mismatch", JSON.stringify(r.body));
  r = await asUser(alice, { ...ping, kind: "request" });
  check("app sending a database-only kind -> 403", r.status === 403 && r.body.error === "kind_not_allowed", JSON.stringify(r.body));
  r = await asUser(alice, { ...ping, for_user: carol.id });
  check("app can't address one person (for_user ignored)", r.status === 200 && r.body.rule !== "direct", JSON.stringify(r.body));

  console.log("\n-- Routing rule --");
  clearLog(roomId);
  await setLocation(bob, true);
  await setLocation(carol, false);
  r = await asUser(alice, ping);
  check("Bob home, Carol away -> only Bob", r.body.rule === "at_home" && sameSet(ids(r), [bob.id]), JSON.stringify(r.body));

  await setLocation(bob, false);
  r = await asUser(alice, ping);
  check("nobody home -> everyone except the sender", r.body.rule === "fallback_all" && sameSet(ids(r), [bob.id, carol.id]), JSON.stringify(r.body));

  await setLocation(bob, true);
  // The statuses_touch trigger normally stops anyone faking this timestamp,
  // so it is switched off for a moment to make Bob's "home" look 4 hours old.
  psql(`alter table public.statuses disable trigger statuses_touch;
        update public.statuses set at_home_updated_at = now() - interval '4 hours' where user_id = '${bob.id}';
        alter table public.statuses enable trigger statuses_touch`);
  r = await asUser(alice, ping);
  check("Bob 'home' but not updated for 4 hours -> everyone", r.body.rule === "fallback_all" && sameSet(ids(r), [bob.id, carol.id]), JSON.stringify(r.body));

  await setLocation(alice, true);
  await setLocation(bob, false);
  r = await asUser(alice, ping);
  check("only the sender is home -> everyone else", r.body.rule === "fallback_all" && sameSet(ids(r), [bob.id, carol.id]), JSON.stringify(r.body));

  r = await asUser(alice, { ...ping, kind: "test" });
  check("test -> only me", r.body.rule === "direct" && sameSet(ids(r), [alice.id]), JSON.stringify(r.body));

  console.log("\n-- Preferences and quiet hours --");
  clearLog(roomId);
  await setPrefs(carol, { pings: false });
  r = await asUser(alice, ping);
  check(
    "Carol turned pings off -> only Bob, Carol listed as skipped",
    sameSet(ids(r), [bob.id]) && r.body.skipped.some((s) => s.user_id === carol.id && s.reason === "turned_off:pings"),
    JSON.stringify(r.body),
  );
  // 00:00 to 23:59 = quiet all day, whatever time the test runs.
  await setPrefs(bob, { quiet_enabled: true, quiet_start: "00:00", quiet_end: "23:59" });
  r = await asUser(alice, ping);
  check(
    "Bob in quiet hours -> normal ping skipped",
    ids(r).length === 0 && r.body.skipped.some((s) => s.user_id === bob.id && s.reason === "quiet_hours"),
    JSON.stringify(r.body),
  );
  r = await asDatabase({ kind: "request", room_id: roomId, sender_id: alice.id, urgency: "urgent", title: "Urgent", body: "x", url: "/requests" });
  check("Bob in quiet hours -> urgent still gets through", ids(r).includes(bob.id), JSON.stringify(r.body));
  await setPrefs(bob, { quiet_enabled: false });
  await setPrefs(carol, { pings: true });

  console.log("\n-- Rate limit --");
  clearLog(roomId);
  const statuses = [];
  for (let i = 0; i < 11; i++) statuses.push((await asUser(alice, ping)).status);
  check("10 allowed, the 11th in 10 minutes -> 429", statuses.slice(0, 10).every((s) => s === 200) && statuses[10] === 429, statuses.join(","));

  console.log("\n-- Database triggers (row change -> pg_net -> function) --");
  clearLog(roomId);
  await setLocation(alice, false);
  await setLocation(bob, true);
  await setLocation(carol, false);

  await alice.client.from("requests").insert({ room_id: roomId, kind: "errand", text: "Buy bread" });
  let rows = await waitForLog(roomId, "request");
  check("new request -> the person at home (Bob)", rows.length === 1 && rows[0].rule === "at_home" && sameSet(rows[0].targeted.map((t) => t.user_id), [bob.id]), JSON.stringify(rows[0]));

  await alice.client.from("requests").insert({ room_id: roomId, kind: "visitor_note", text: "Someone came for you", for_user: carol.id });
  rows = await waitForLog(roomId, "visitor_note");
  check("visitor note -> only the person it is for (Carol, who is away)", rows.length === 1 && rows[0].rule === "direct" && sameSet(rows[0].targeted.map((t) => t.user_id), [carol.id]), JSON.stringify(rows[0]));

  await alice.client.from("statuses").update({ bringing: "Food" }).eq("user_id", alice.id);
  rows = await waitForLog(roomId, "bringing");
  check("bringing food -> everyone", rows.length === 1 && rows[0].rule === "everyone" && rows[0].title.includes("is bringing food 🍚") && sameSet(rows[0].targeted.map((t) => t.user_id), [bob.id, carol.id]), JSON.stringify(rows[0]));

  const pilau = (await alice.client.from("pantry_items").insert({ room_id: roomId, name: "Pilau", kind: "ready_food" }).select().single()).data;
  await alice.client.from("pantry_items").update({ state: "out" }).eq("id", pilau.id);
  rows = await waitForLog(roomId, "food");
  check("ready food marked out -> 'Food is finished at home'", rows.length === 1 && rows[0].title.includes("Food is finished at home"), JSON.stringify(rows[0]));

  const sugar = (await alice.client.from("pantry_items").select("id").eq("room_id", roomId).eq("name", "Sugar").single()).data;
  await alice.client.from("pantry_items").update({ state: "out" }).eq("id", sugar.id);
  await sleep(3000);
  rows = await waitForLog(roomId, "food");
  check("a grocery (Sugar) marked out -> no notification", rows.length === 1);

  console.log("\n-- Escalation --");
  clearLog(roomId);
  const urgent = (await alice.client.from("requests").insert({ room_id: roomId, kind: "errand", text: "Locked out!", urgency: "urgent" }).select().single()).data;
  psql("select private.escalate_urgent_requests()");
  await sleep(3000);
  rows = await waitForLog(roomId, "escalation", 1);
  check("urgent request under 10 minutes old -> not escalated", rows.length === 0);
  psql(`update public.requests set created_at = now() - interval '11 minutes' where id = '${urgent.id}'`);
  const first = psql("select private.escalate_urgent_requests()");
  const second = psql("select private.escalate_urgent_requests()");
  await sleep(3000);
  rows = await waitForLog(roomId, "escalation", 1);
  check(
    "unclaimed for 11 minutes -> escalated once, to everyone",
    first === "1" && second === "0" && rows.length === 1 && rows[0].rule === "everyone" && sameSet(rows[0].targeted.map((t) => t.user_id), [bob.id, carol.id]),
    `first=${first} second=${second} rows=${JSON.stringify(rows)}`,
  );

  console.log("\n-- Dead device clean-up (needs internet) --");
  // A real push service address that was never issued: the service answers
  // 404/410, which must delete the row.
  const dead = `https://updates.push.services.mozilla.com/wpush/v2/${randomBytes(32).toString("base64url")}`;
  await alice.client.rpc("save_push_subscription", {
    p_endpoint: dead,
    p_p256dh: createECDH("prime256v1").generateKeys("base64url"),
    p_auth: randomBytes(16).toString("base64url"),
    p_user_agent: "notify_routing dead device",
  });
  clearLog(roomId);
  r = await asUser(alice, { ...ping, kind: "test" });
  const left = (await alice.client.from("push_subscriptions").select("id").eq("endpoint", dead)).data;
  check("push service says the device is gone -> row deleted", r.body.removed === 1 && left.length === 0, JSON.stringify(r.body));
} catch (error) {
  failures += 1;
  console.error("ERROR", error);
} finally {
  // Deleting the rooms and users removes everything else through cascades.
  for (const id of [roomId, otherRoomId].filter(Boolean)) {
    psql(`delete from public.rooms where id = '${id}'`);
  }
  for (const person of Object.values(people)) await admin.auth.admin.deleteUser(person.id);
}

console.log(failures === 0 ? "\nALL NOTIFY CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
