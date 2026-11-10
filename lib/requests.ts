import type { PostgrestError } from "@supabase/supabase-js";
import type { RequestKind, RequestRow } from "@/types/database";

export const REQUEST_KINDS: Record<
  RequestKind,
  { icon: string; label: string; prefill: string; placeholder: string }
> = {
  clothes: {
    icon: "👕",
    label: "Pick my clothes",
    prefill: "Please pick my clothes off the line 🙏",
    placeholder: "Which clothes, where?",
  },
  errand: {
    icon: "🛍️",
    label: "Buy something",
    prefill: "",
    placeholder: "e.g. Bread and 2 eggs from the shop",
  },
  visitor_note: {
    icon: "📬",
    label: "Visitor note",
    prefill: "",
    placeholder: "e.g. Someone came for you, back at 6pm",
  },
  other: { icon: "💬", label: "Other", prefill: "", placeholder: "What do you need?" },
};

export const HISTORY_LIMIT = 30;

export function splitRequests(requests: RequestRow[]) {
  const open = requests
    .filter((r) => !r.done_at && !r.claimed_by)
    // Urgent first, then newest first.
    .sort(
      (a, b) =>
        Number(b.urgency === "urgent") - Number(a.urgency === "urgent") ||
        b.created_at.localeCompare(a.created_at),
    );
  const claimed = requests
    .filter((r) => !r.done_at && r.claimed_by)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const done = requests
    .filter((r) => r.done_at)
    .sort((a, b) => b.done_at!.localeCompare(a.done_at!))
    .slice(0, HISTORY_LIMIT);
  return { open, claimed, done };
}

// The database raises short codes; turn them into something friendly.
export function requestErrorMessage(error: PostgrestError) {
  switch (error.message) {
    case "already_claimed":
      return `Too slow! ${error.details || "Someone"} already got it 😅`;
    case "already_done":
      return "Already done, nice 👌";
    case "not_found":
      return "That request is gone.";
    case "not_allowed":
      return "Only the person on it (or who asked) can finish it.";
    case "cannot_claim_note":
      return "Visitor notes can't be claimed.";
    default:
      return "Couldn't do that. Try again.";
  }
}
