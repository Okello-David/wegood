"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import MemberCard from "@/components/board/MemberCard";
import StatusSheet from "@/components/board/StatusSheet";
import Toast from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import type { ProfileRow, StatusPatch, StatusRow } from "@/types/database";

type Props = {
  myId: string;
  roomId: string;
  roomName: string;
  inviteCode: string;
  profiles: ProfileRow[];
  statuses: StatusRow[];
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
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);

  // Refs, not state: changing these shouldn't redraw the board.
  const pendingSaves = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const toastId = useRef(0);
  const knownProfiles = useRef(new Set(props.profiles.map((p) => p.id)));

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

  const myStatus = statuses[myId];
  const myProfile = profiles[myId];

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-28">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold">{roomName}</h1>
          <p className="text-sm text-stone-600">
            Invite code: <span className="font-mono font-semibold">{inviteCode}</span>
          </p>
        </div>
        <Link
          href="/profile"
          aria-label="Edit profile"
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white text-2xl"
        >
          {myProfile?.avatar_emoji ?? "🙂"}
        </Link>
      </header>

      <div className="flex flex-col gap-3">
        {myStatus && myProfile && (
          <MemberCard
            profile={myProfile}
            status={myStatus}
            now={now}
            isMe
            onOpen={() => setSheetOpen(true)}
          />
        )}
        {roommates.map((status) => (
          <MemberCard
            key={status.user_id}
            profile={profiles[status.user_id]}
            status={status}
            now={now}
          />
        ))}
        {roommates.length === 0 && (
          <p className="rounded-2xl bg-white/60 p-4 text-center">
            It&apos;s quiet in here. Share code{" "}
            <span className="font-mono font-semibold">{inviteCode}</span> with your roommates.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-label="Update my status"
        className="fixed right-4 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] flex size-16 items-center justify-center rounded-full bg-stone-900 text-3xl text-white shadow-lg"
      >
        ✏️
      </button>

      {sheetOpen && myStatus && (
        <StatusSheet status={myStatus} onSave={save} onClose={() => setSheetOpen(false)} />
      )}
      <Toast toast={toast} onDone={() => setToast(null)} />
    </main>
  );
}
