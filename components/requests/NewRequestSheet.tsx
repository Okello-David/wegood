"use client";

import { useState, type FormEvent } from "react";
import Sheet from "@/components/ui/Sheet";
import { REQUEST_KINDS } from "@/lib/requests";
import type { ProfileRow, RequestKind, Urgency } from "@/types/database";

export type NewRequest = {
  kind: RequestKind;
  text: string;
  urgency: Urgency;
  for_user: string | null;
};

type Props = {
  kind: RequestKind;
  roommates: ProfileRow[];
  onCreate: (request: NewRequest) => Promise<boolean>;
  onClose: () => void;
};

export default function NewRequestSheet({ kind, roommates, onCreate, onClose }: Props) {
  const info = REQUEST_KINDS[kind];
  const [text, setText] = useState(info.prefill);
  const [urgent, setUrgent] = useState(false);
  const [forUser, setForUser] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isNote = kind === "visitor_note";
  const ready = text.trim() !== "" && (!isNote || forUser !== null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setSaving(true);
    const ok = await onCreate({
      kind,
      text: text.trim(),
      urgency: urgent ? "urgent" : "normal",
      for_user: isNote ? forUser : null,
    });
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Sheet title={`${info.icon} ${info.label}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {isNote && (
          <fieldset>
            <legend className="mb-2 font-semibold">Who is it for?</legend>
            {roommates.length === 0 ? (
              <p className="text-stone-600">Invite your roommates first.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {roommates.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    aria-pressed={forUser === person.id}
                    onClick={() => setForUser(person.id)}
                    className={`flex min-h-14 items-center gap-2 rounded-xl px-3 font-semibold ${
                      forUser === person.id ? "bg-stone-900 text-white" : "bg-stone-100"
                    }`}
                  >
                    <span className="text-2xl" aria-hidden="true">
                      {person.avatar_emoji}
                    </span>
                    <span className="truncate">{person.display_name}</span>
                  </button>
                ))}
              </div>
            )}
          </fieldset>
        )}

        <textarea
          autoFocus={!isNote}
          required
          maxLength={200}
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={info.placeholder}
          aria-label="Details"
          className="rounded-xl border border-stone-300 bg-white px-4 py-3 text-base"
        />

        <button
          type="button"
          aria-pressed={urgent}
          onClick={() => setUrgent((value) => !value)}
          className={`min-h-14 rounded-xl font-semibold ${
            urgent ? "bg-red-600 text-white" : "bg-stone-100"
          }`}
        >
          {urgent ? "🔥 Urgent!" : "Not urgent · tap if urgent"}
        </button>

        <button
          type="submit"
          disabled={saving || !ready}
          className="min-h-14 rounded-xl bg-stone-900 font-semibold text-white disabled:opacity-50"
        >
          Send to the room
        </button>
      </form>
    </Sheet>
  );
}
