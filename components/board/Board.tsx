"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import Avatar from "@/components/board/Avatar";
import EnergySheet from "@/components/board/EnergySheet";
import Feed from "@/components/board/Feed";
import Leaderboard from "@/components/board/Leaderboard";
import MemberCard from "@/components/board/MemberCard";
import StatusSheet from "@/components/board/StatusSheet";
import Toast from "@/components/ui/Toast";
import { useIsClient } from "@/components/ui/useIsClient";
import { energyForUser, hasWokenUp, runningActivity } from "@/lib/battery";
import { FEEL_LEVEL, FEELS, activityInfo } from "@/lib/energy";
import { haptic } from "@/lib/haptics";
import {
  FEED_LIMIT,
  loadActivities,
  loadCheckins,
  loadFeed,
  loadLeaderboard,
  loadRecentPoints,
  loadRequests,
  loadSchedule,
} from "@/lib/queries";
import { callNotify, notifyErrorMessage } from "@/lib/push";
import { useLiveRows } from "@/lib/realtime/useLiveRows";
import { requestErrorMessage } from "@/lib/requests";
import { nowAndNext } from "@/lib/schedule";
import { createClient } from "@/lib/supabase/client";
import type {
  ActivityRow,
  ActivityType,
  EnergyCheckinRow,
  FeedEventRow,
  PointEventRow,
  ProfileRow,
  RequestRow,
  ScheduleItemRow,
  StatusPatch,
  StatusRow,
} from "@/types/database";

type Props = {
  myId: string;
  roomId: string;
  roomName: string;
  inviteCode: string;
  profiles: ProfileRow[];
  statuses: StatusRow[];
  requests: RequestRow[];
  feed: FeedEventRow[];
  activities: ActivityRow[];
  checkins: EnergyCheckinRow[];
  schedule: ScheduleItemRow[];
  // Phase 5
  leaderboard: { user_id: string; points: number }[];
  points: PointEventRow[];
  // This week's trophy holder(s): last week's MVP.
  mvps: string[];
  serverNow: number;
};

function byId<T>(rows: T[], key: (row: T) => string) {
  return Object.fromEntries(rows.map((row) => [key(row), row]));
}

export default function Board(props: Props) {
  const { myId, roomId, roomName, inviteCode, serverNow } = props;
  const [supabase] = useState(createClient);
  const [profiles, setProfiles] = useState(() => byId(props.profiles, (p) => p.id));
  const [statuses, setStatuses] = useState(() => byId(props.statuses, (s) => s.user_id));
  const [now, setNow] = useState(serverNow);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [energyOpen, setEnergyOpen] = useState(false);
  const [energyBusy, setEnergyBusy] = useState(false);
  const isClient = useIsClient();
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);

  // Refs, not state: changing these shouldn't redraw the board.
  const pendingSaves = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const toastId = useRef(0);
  const knownProfiles = useRef(new Set(props.profiles.map((p) => p.id)));

  // Phase 2: visitor notes and the activity feed, kept live by the shared hook.
  const requests = useLiveRows({
    supabase,
    table: "requests",
    roomId,
    initialRows: props.requests,
    load: loadRequests,
  });
  const feed = useLiveRows({
    supabase,
    table: "feed_events",
    roomId,
    initialRows: props.feed,
    load: loadFeed,
  });

  // Phase 4: energy battery inputs and everyone's plans.
  const activities = useLiveRows({
    supabase,
    table: "activities",
    roomId,
    initialRows: props.activities,
    load: loadActivities,
  });
  const checkins = useLiveRows({
    supabase,
    table: "energy_checkins",
    roomId,
    initialRows: props.checkins,
    load: loadCheckins,
  });
  const schedule = useLiveRows({
    supabase,
    table: "schedule_items",
    roomId,
    initialRows: props.schedule,
    load: loadSchedule,
  });

  // Phase 5: the leaderboard. Realtime tells us when points change (the
  // point_events rows); the totals then come from the database, which knows
  // when the room's week started.
  const points = useLiveRows({
    supabase,
    table: "point_events",
    roomId,
    initialRows: props.points,
    load: loadRecentPoints,
  });
  const [leaderboard, setLeaderboard] = useState(props.leaderboard);
  const lastPointId = points.rows.reduce((max, row) => Math.max(max, row.id), 0);
  const firstPointId = useRef(lastPointId);
  useEffect(() => {
    // The first render already has fresh totals from the server.
    if (lastPointId === firstPointId.current) return;
    let cancelled = false;
    loadLeaderboard(supabase, roomId)
      .then((rows) => {
        if (!cancelled) setLeaderboard(rows);
      })
      .catch(() => {
        // Offline: keep the old totals; the next change retries.
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, roomId, lastPointId]);
  const mvpSet = useMemo(() => new Set(props.mvps), [props.mvps]);

  const showToast = useCallback((message: string) => {
    toastId.current += 1;
    setToast({ id: toastId.current, message });
  }, []);

  // Replaces state from the server, keeping my row while a tap is still saving.
  const refetch = useCallback(async () => {
    const [nextStatuses, nextProfiles] = await Promise.all([
      supabase.from("statuses").select("*").eq("room_id", roomId),
      supabase.from("profiles").select("*"),
    ]);
    if (nextStatuses.data) {
      const fresh = byId(nextStatuses.data, (s) => s.user_id);
      const saving = pendingSaves.current > 0;
      setStatuses((current) =>
        saving && current[myId] ? { ...fresh, [myId]: current[myId] } : fresh,
      );
    }
    if (nextProfiles.data) {
      knownProfiles.current = new Set(nextProfiles.data.map((p) => p.id));
      setProfiles(byId(nextProfiles.data, (p) => p.id));
    }
  }, [supabase, roomId, myId]);

  useEffect(() => {
    let cancelled = false;
    let channel: RealtimeChannel | undefined;

    async function subscribe() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      // Realtime applies RLS using this token, so it must be set first.
      if (data.session) supabase.realtime.setAuth(data.session.access_token);

      channel = supabase
        .channel(`room:${roomId}`)
        .on<StatusRow>(
          "postgres_changes",
          { event: "*", schema: "public", table: "statuses", filter: `room_id=eq.${roomId}` },
          (payload) => {
            if (payload.eventType === "DELETE") {
              void refetch();
              return;
            }
            const row = payload.new;
            // My own taps are already on screen; don't let echoes rewind them.
            if (row.user_id === myId && pendingSaves.current > 0) return;
            if (!knownProfiles.current.has(row.user_id)) void refetch();
            setStatuses((current) => {
              const existing = current[row.user_id];
              // Events can arrive out of order; the newest one wins.
              if (existing && Date.parse(row.updated_at) < Date.parse(existing.updated_at)) {
                return current;
              }
              return { ...current, [row.user_id]: row };
            });
          },
        )
        .on<ProfileRow>(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "profiles" },
          (payload) => {
            setProfiles((current) => ({ ...current, [payload.new.id]: payload.new }));
          },
        )
        .subscribe((status) => {
          // Also fires after a reconnect: catch up on anything we missed.
          if (status === "SUBSCRIBED") void refetch();
        });
    }

    void subscribe();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, roomId, myId, refetch]);

  // Phones suspend background tabs, so catch up whenever the app comes back.
  useEffect(() => {
    function catchUp() {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        void refetch();
      }
    }
    document.addEventListener("visibilitychange", catchUp);
    window.addEventListener("online", catchUp);
    return () => {
      document.removeEventListener("visibilitychange", catchUp);
      window.removeEventListener("online", catchUp);
    };
  }, [refetch]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const save = useCallback(
    (patch: StatusPatch, message: string) => {
      haptic();
      setStatuses((current) => ({ ...current, [myId]: { ...current[myId], ...patch } }));
      pendingSaves.current += 1;

      // One write at a time, so quick taps reach the database in order.
      saveQueue.current = saveQueue.current.then(async () => {
        const { data, error } = await supabase
          .from("statuses")
          .update(patch)
          .eq("user_id", myId)
          .select()
          .single();
        pendingSaves.current -= 1;

        if (error) {
          showToast("Couldn't save that. Try again.");
          if (pendingSaves.current === 0) await refetch();
          return;
        }
        if (pendingSaves.current === 0) {
          setStatuses((current) => ({ ...current, [myId]: data }));
          setNow(Date.now());
        }
        showToast(message);
      });
    },
    [supabase, myId, refetch, showToast],
  );

  const roommates = useMemo(
    () =>
      Object.values(statuses)
        .filter((status) => status.user_id !== myId && profiles[status.user_id])
        .sort((a, b) =>
          profiles[a.user_id].display_name.localeCompare(profiles[b.user_id].display_name),
        ),
    [statuses, profiles, myId],
  );

  const notesFor = useMemo(() => {
    const map: Record<string, RequestRow[]> = {};
    for (const request of requests.rows) {
      if (request.kind === "visitor_note" && !request.done_at && request.for_user) {
        (map[request.for_user] ??= []).push(request);
      }
    }
    return map;
  }, [requests.rows]);
  const noteText = (userId: string) => (notesFor[userId] ?? []).map((note) => note.text);

  // Newest first; live inserts are appended, so sort and trim here.
  const latestFeed = useMemo(
    () => [...feed.rows].sort((a, b) => b.id - a.id).slice(0, FEED_LIMIT),
    [feed.rows],
  );

  async function clearMyNotes() {
    const mine = notesFor[myId] ?? [];
    const results = await Promise.all(
      mine.map((note) => supabase.rpc("complete_request", { p_id: note.id })),
    );
    const failed = results.find((result) => result.error);
    if (failed?.error) showToast(requestErrorMessage(failed.error));
    else showToast("Noted 👍");
    void requests.refetch();
  }

  const myStatus = statuses[myId];
  const myProfile = profiles[myId];

  // Battery and "Now / Next" use the phone's clock and time zone, so they are
  // only worked out in the browser (undefined during the server render).
  const energyOf = (userId: string) =>
    isClient
      ? energyForUser(userId, activities.rows, checkins.rows, schedule.rows, now)
      : undefined;
  const planOf = (userId: string) =>
    isClient
      ? nowAndNext(
          schedule.rows.filter((item) => item.user_id === userId),
          now,
        )
      : undefined;
  const myEnergy = energyOf(myId);
  const myRunning = runningActivity(myId, activities.rows, now);
  const iAmAwake = hasWokenUp(myId, checkins.rows, now);

  // Each energy action: write, then reload so the battery updates at once
  // (Realtime also delivers it to roommates). The sheet closes: 1-2 taps.
  async function energyAction(action: () => Promise<string>) {
    setEnergyBusy(true);
    try {
      const message = await action();
      setEnergyOpen(false);
      showToast(message);
    } catch {
      showToast("Couldn't save that. Try again.");
    } finally {
      setEnergyBusy(false);
      setNow(Date.now());
      await Promise.all([activities.refetch(), checkins.refetch()]);
    }
  }

  async function stopActivity(row: ActivityRow) {
    // The phone's clock for both ends of an activity (started_at is sent
    // from here too), so a quick stop never looks like it ended before it began.
    const end = Math.max(Date.now(), Date.parse(row.started_at) + 1000);
    const { error } = await supabase
      .from("activities")
      .update({ ended_at: new Date(end).toISOString() })
      .eq("id", row.id);
    if (error) throw error;
  }

  async function addCheckin(kind: "wake" | "feel", feel?: number) {
    const { error } = await supabase
      .from("energy_checkins")
      .insert({ room_id: roomId, kind, feel: feel ?? null });
    if (error) throw error;
  }

  const wakeUp = () =>
    energyAction(async () => {
      if (myRunning?.type === "nap") await stopActivity(myRunning);
      await addCheckin("wake");
      return "☀️ Good morning! Battery full";
    });

  const startActivity = (type: ActivityType) =>
    energyAction(async () => {
      if (myRunning) await stopActivity(myRunning);
      const { error } = await supabase
        .from("activities")
        .insert({ room_id: roomId, type, started_at: new Date().toISOString() });
      if (error) throw error;
      const info = activityInfo(type);
      return `${info.emoji} ${info.label} started`;
    });

  const stopRunning = () =>
    energyAction(async () => {
      if (myRunning) await stopActivity(myRunning);
      return "⏹️ Stopped";
    });

  const checkInFeel = (feel: number) =>
    energyAction(async () => {
      // Saying how you feel means you're awake: count it as waking up too,
      // otherwise the battery would stay "?".
      if (!iAmAwake) await addCheckin("wake");
      await addCheckin("feel", feel);
      const info = FEELS.find((f) => f.value === feel);
      return `${info?.emoji ?? ""} Battery set to ${FEEL_LEVEL[feel]}%`;
    });

  // Phase 3: one tap asks "Anyone home?". The Edge Function decides who gets
  // it (people at home first, otherwise everyone) and tells us what it did.
  async function pingHome() {
    haptic();
    setPinging(true);
    const answer = await callNotify(supabase, {
      kind: "ping",
      room_id: roomId,
      sender_id: myId,
      title: `📣 ${myProfile?.display_name ?? "Someone"}: Anyone home?`,
      body: "Tap to open WeGood? and update your status.",
      url: "/",
    });
    setPinging(false);
    if ("error" in answer) {
      showToast(notifyErrorMessage(answer.error));
      return;
    }
    const { rule, targeted, sent } = answer.result;
    const names = targeted
      .filter((target) => target.delivered > 0)
      .map((target) => profiles[target.user_id]?.display_name ?? "someone");
    if (sent === 0) showToast("Nobody has notifications on yet 🔕");
    else if (rule === "at_home") showToast(`Pinged ${names.join(", ")} (at home) 📣`);
    else showToast(`Nobody's home, pinged ${names.join(", ")} 📣`);
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-44">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold">{roomName}</h1>
          <p className="text-sm text-muted">
            Invite code: <span className="font-mono font-semibold">{inviteCode}</span>
          </p>
        </div>
        <Link
          href="/me"
          aria-label="Edit profile"
          className="flex shrink-0 rounded-full"
        >
          <Avatar
            userId={myId}
            emoji={myProfile?.avatar_emoji ?? "🙂"}
            color={myProfile?.color ?? null}
            mvp={mvpSet.has(myId)}
          />
        </Link>
      </header>

      <Leaderboard rows={leaderboard} profiles={profiles} />

      <div className="flex flex-col gap-3">
        {myStatus && myProfile && (
          <MemberCard
            profile={myProfile}
            status={myStatus}
            now={now}
            isMe
            mvp={mvpSet.has(myId)}
            notes={noteText(myId)}
            energy={myEnergy}
            plan={planOf(myId)}
            onOpen={() => setSheetOpen(true)}
            onOpenEnergy={() => setEnergyOpen(true)}
          />
        )}
        {(notesFor[myId]?.length ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => void clearMyNotes()}
            className="min-h-12 rounded-xl bg-amber-400 font-semibold text-amber-950"
          >
            Got it 👍 (clear my note{notesFor[myId].length > 1 ? "s" : ""})
          </button>
        )}
        {roommates.map((status) => (
          <MemberCard
            key={status.user_id}
            profile={profiles[status.user_id]}
            status={status}
            now={now}
            mvp={mvpSet.has(status.user_id)}
            notes={noteText(status.user_id)}
            energy={energyOf(status.user_id)}
            plan={planOf(status.user_id)}
          />
        ))}
        {roommates.length === 0 && (
          <p className="rounded-2xl bg-card/60 p-4 text-center">
            It&apos;s quiet in here. Share code{" "}
            <span className="font-mono font-semibold">{inviteCode}</span> with your roommates.
          </p>
        )}
      </div>

      {roommates.length > 0 && (
        <button
          type="button"
          disabled={pinging}
          onClick={() => void pingHome()}
          className="mt-4 min-h-16 w-full rounded-2xl bg-amber-400 text-lg font-bold text-amber-950 shadow disabled:opacity-60"
        >
          {pinging ? "Pinging…" : "📣 Ping home: anyone there?"}
        </button>
      )}

      <Feed events={latestFeed} now={now} />

      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-label="Update my status"
        className="fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 flex size-16 items-center justify-center rounded-full bg-primary text-3xl text-on-primary shadow-lg"
      >
        ✏️
      </button>

      {sheetOpen && myStatus && (
        <StatusSheet status={myStatus} onSave={save} onClose={() => setSheetOpen(false)} />
      )}
      {energyOpen && (
        <EnergySheet
          percent={myEnergy?.percent ?? null}
          awake={iAmAwake}
          running={myRunning}
          busy={energyBusy}
          onWake={() => void wakeUp()}
          onStart={(type) => void startActivity(type)}
          onStop={() => void stopRunning()}
          onFeel={(feel) => void checkInFeel(feel)}
          onClose={() => setEnergyOpen(false)}
        />
      )}
      <Toast toast={toast} onDone={() => setToast(null)} />
    </main>
  );
}
