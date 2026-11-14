"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import NewRequestSheet, { type NewRequest } from "@/components/requests/NewRequestSheet";
import RequestCard from "@/components/requests/RequestCard";
import ConfirmSheet from "@/components/ui/ConfirmSheet";
import Confetti from "@/components/ui/Confetti";
import Toast from "@/components/ui/Toast";
import { useNow } from "@/components/ui/useNow";
import { useToast } from "@/components/ui/useToast";
import { haptic, prefersReducedMotion } from "@/lib/haptics";
import { loadRequests } from "@/lib/queries";
import { useLiveRows } from "@/lib/realtime/useLiveRows";
import { REQUEST_KINDS, requestErrorMessage, splitRequests } from "@/lib/requests";
import { createClient } from "@/lib/supabase/client";
import type { ProfileRow, RequestKind, RequestRow } from "@/types/database";

type Props = {
  myId: string;
  roomId: string;
  initialRequests: RequestRow[];
  profiles: ProfileRow[];
  serverNow: number;
};

const QUICK: RequestKind[] = ["clothes", "errand", "visitor_note", "other"];

export default function Requests({ myId, roomId, initialRequests, profiles, serverNow }: Props) {
  const [supabase] = useState(createClient);
  const { rows, setRows, refetch } = useLiveRows({
    supabase,
    table: "requests",
    roomId,
    initialRows: initialRequests,
    load: loadRequests,
  });
  const now = useNow(serverNow);
  const { toast, showToast, clearToast } = useToast();
  const [creating, setCreating] = useState<RequestKind | null>(null);
  const [deleting, setDeleting] = useState<RequestRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Phase 5: a number per celebration (0 = none showing).
  const [confetti, setConfetti] = useState(0);
  const bursts = useRef(0);
  const endConfetti = useCallback(() => setConfetti(0), []);

  const profileMap = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);
  const roommates = useMemo(
    () =>
      profiles
        .filter((p) => p.id !== myId)
        .sort((a, b) => a.display_name.localeCompare(b.display_name)),
    [profiles, myId],
  );
  const { open, claimed, done } = useMemo(() => splitRequests(rows), [rows]);

  function replace(row: RequestRow) {
    setRows((current) => current.map((r) => (r.id === row.id ? row : r)));
  }

  async function create(request: NewRequest) {
    const { data, error } = await supabase
      .from("requests")
      .insert({ room_id: roomId, ...request })
      .select()
      .single();
    if (error) {
      showToast("Couldn't send that. Try again.");
      return false;
    }
    setRows((current) => (current.some((r) => r.id === data.id) ? current : [data, ...current]));
    haptic();
    showToast(request.urgency === "urgent" ? "Sent, with sirens 🚨" : "Sent to the room 📣");
    return true;
  }

  // Not optimistic on purpose: if two people tap at once, the database picks
  // the winner, and we only show "you got it" once it has said so.
  async function claim(request: RequestRow) {
    haptic();
    setBusyId(request.id);
    const { data, error } = await supabase.rpc("claim_request", { p_id: request.id });
    setBusyId(null);
    if (error) {
      showToast(requestErrorMessage(error));
      void refetch(); // Show who actually won.
      return;
    }
    replace(data);
    showToast("It's yours. Legend 🙌");
  }

  async function complete(request: RequestRow) {
    setBusyId(request.id);
    const { data, error } = await supabase.rpc("complete_request", { p_id: request.id });
    setBusyId(null);
    if (error) {
      showToast(requestErrorMessage(error));
      void refetch();
      return;
    }
    replace(data);
    // Same rule the database uses to award points (see the Phase 5
    // migration): you finished something you claimed for someone else.
    const earned =
      data.kind !== "visitor_note" && data.claimed_by === myId && data.created_by !== myId
        ? data.urgency === "urgent"
          ? 15
          : 10
        : 0;
    if (earned > 0) {
      haptic(30);
      if (!prefersReducedMotion()) {
        bursts.current += 1;
        setConfetti(bursts.current);
      }
      showToast(`Done! +${earned} points 🎉`);
    } else {
      haptic();
      showToast(request.kind === "visitor_note" ? "Noted 👍" : "Done! 🎉");
    }
  }

  async function remove(request: RequestRow) {
    setRows((current) => current.filter((r) => r.id !== request.id));
    const { error } = await supabase.from("requests").delete().eq("id", request.id);
    if (error) {
      showToast("Couldn't delete that.");
      void refetch();
    }
  }

  function card(request: RequestRow) {
    return (
      <RequestCard
        key={request.id}
        request={request}
        myId={myId}
        profiles={profileMap}
        now={now}
        busy={busyId === request.id}
        onClaim={() => void claim(request)}
        onDone={() => void complete(request)}
        onDelete={() => setDeleting(request)}
      />
    );
  }

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-28">
      <h1 className="mb-3 text-2xl font-bold">Requests</h1>

      <div className="mb-6 grid grid-cols-2 gap-2">
        {QUICK.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => setCreating(kind)}
            className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl bg-card font-semibold shadow-sm active:scale-95"
          >
            <span className="text-3xl" aria-hidden="true">
              {REQUEST_KINDS[kind].icon}
            </span>
            {REQUEST_KINDS[kind].label}
          </button>
        ))}
      </div>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-bold">Open {open.length > 0 && `(${open.length})`}</h2>
        {open.length === 0 ? (
          <p className="rounded-2xl bg-card/60 p-4 text-center text-muted">
            No requests. Suspiciously peaceful. 🕊️
          </p>
        ) : (
          <div className="flex flex-col gap-3">{open.map(card)}</div>
        )}
      </section>

      {claimed.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-lg font-bold">On it ({claimed.length})</h2>
          <div className="flex flex-col gap-3">{claimed.map(card)}</div>
        </section>
      )}

      {done.length > 0 && (
        <details className="mb-6">
          <summary className="flex min-h-12 cursor-pointer items-center text-lg font-bold">
            History ({done.length})
          </summary>
          <div className="mt-2 flex flex-col gap-3">{done.map(card)}</div>
        </details>
      )}

      {creating && (
        <NewRequestSheet
          kind={creating}
          roommates={roommates}
          onCreate={create}
          onClose={() => setCreating(null)}
        />
      )}
      {deleting && (
        <ConfirmSheet
          title="Delete this request?"
          confirmLabel="Delete"
          onConfirm={() => void remove(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
      {confetti > 0 && <Confetti burst={confetti} onDone={endConfetti} />}
      <Toast toast={toast} onDone={clearToast} />
    </main>
  );
}
