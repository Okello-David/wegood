"use client";

import { REQUEST_KINDS } from "@/lib/requests";
import { timeAgo } from "@/lib/time";
import type { ProfileRow, RequestRow } from "@/types/database";

type Props = {
  request: RequestRow;
  myId: string;
  profiles: Record<string, ProfileRow>;
  now: number;
  busy: boolean;
  onClaim: () => void;
  onDone: () => void;
  onDelete: () => void;
};

export default function RequestCard({
  request,
  myId,
  profiles,
  now,
  busy,
  onClaim,
  onDone,
  onDelete,
}: Props) {
  const info = REQUEST_KINDS[request.kind];
  const name = (id: string | null) => (id && profiles[id]?.display_name) || "Someone";
  const mine = request.created_by === myId;
  const isNote = request.kind === "visitor_note";
  const finished = request.done_at !== null;
  const urgent = request.urgency === "urgent" && !finished;

  // Which buttons this person gets, mirroring the rules in complete_request.
  let action: { label: string; run: () => void; style: string } | null = null;
  if (!finished) {
    if (isNote) {
      if (request.for_user === myId) {
        action = { label: "Got it 👍", run: onDone, style: "bg-green-600 text-white" };
      } else if (mine) {
        action = { label: "Clear", run: onDone, style: "bg-stone-100" };
      }
    } else if (!request.claimed_by) {
      action = mine
        ? { label: "Done ✅", run: onDone, style: "bg-stone-100" }
        : { label: "I got it 🙌", run: onClaim, style: "bg-stone-900 text-white" };
    } else if (request.claimed_by === myId || mine) {
      action = { label: "Done ✅", run: onDone, style: "bg-green-600 text-white" };
    }
  }

  return (
    <article
      className={`rounded-2xl bg-white p-4 shadow-sm ${urgent ? "ring-2 ring-red-500" : ""} ${
        finished ? "opacity-70" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="text-3xl" aria-hidden="true">
          {info.icon}
        </span>
        <div className="min-w-0 flex-1">
          {urgent && (
            <p className="mb-1 text-xs font-bold tracking-wide text-red-600 uppercase">🔥 Urgent</p>
          )}
          {isNote && (
            <p className="text-sm font-semibold text-amber-700">
              For {request.for_user === myId ? "you" : name(request.for_user)}
            </p>
          )}
          <p className="text-lg break-words">{request.text}</p>
          <p className="mt-1 text-sm text-stone-600">
            {mine ? "You" : name(request.created_by)} · {timeAgo(request.created_at, now)}
          </p>
          {request.claimed_by && !finished && (
            <p className="mt-1 font-semibold text-green-700">
              🙌 {request.claimed_by === myId ? "You're" : `${name(request.claimed_by)}'s`} on it
            </p>
          )}
          {finished && (
            <p className="mt-1 text-sm text-stone-600">
              ✅ Done {timeAgo(request.done_at!, now)}
              {request.claimed_by && ` by ${name(request.claimed_by)}`}
            </p>
          )}
        </div>
        {mine && !finished && !request.claimed_by && (
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete request"
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-xl text-stone-400"
          >
            🗑️
          </button>
        )}
      </div>

      {action && (
        <button
          type="button"
          disabled={busy}
          onClick={action.run}
          className={`mt-3 min-h-12 w-full rounded-xl font-semibold disabled:opacity-50 ${action.style}`}
        >
          {busy ? "…" : action.label}
        </button>
      )}
    </article>
  );
}
