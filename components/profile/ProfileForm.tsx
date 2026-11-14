"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import Toast from "@/components/ui/Toast";
import { disablePush } from "@/lib/push";
import { createClient } from "@/lib/supabase/client";

const EMOJIS = [
  "🙂", "😎", "🤓", "🥳", "😴", "🤠", "👻", "👽",
  "🤖", "🐱", "🐶", "🦊", "🐼", "🦁", "🐸", "🐵",
  "🦄", "🐝", "🍕", "🌮", "🍉", "🔥", "⚡", "🌈",
];

type Props = {
  userId: string;
  initialName: string;
  initialEmoji: string;
  roomName: string;
  inviteCode: string;
  // Extra cards (notifications) shown between the room and the name.
  children?: ReactNode;
};

export default function ProfileForm({
  userId,
  initialName,
  initialEmoji,
  roomName,
  inviteCode,
  children,
}: Props) {
  const router = useRouter();
  const [supabase] = useState(createClient);
  const [name, setName] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  const [emoji, setEmoji] = useState(initialEmoji);
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);

  function notify(message: string) {
    setToast((current) => ({ id: (current?.id ?? 0) + 1, message }));
  }

  async function pickEmoji(next: string) {
    const previous = emoji;
    setEmoji(next);
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_emoji: next })
      .eq("id", userId);
    if (error) {
      setEmoji(previous);
      notify("Couldn't save that. Try again.");
    } else {
      notify(`Looking good ${next}`);
    }
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: trimmed })
      .eq("id", userId);
    if (error) {
      notify("Couldn't save that. Try again.");
    } else {
      setName(trimmed);
      setSavedName(trimmed);
      notify("Name saved");
    }
  }

  async function signOut() {
    // Stop this device's notifications first, while we are still allowed to
    // delete the row. Otherwise the next person on this phone gets my buzzes.
    await disablePush(supabase).catch(() => {});
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const nameUnchanged = name.trim() === savedName || !name.trim();

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Me</h1>
      </header>

      <section className="mb-6 rounded-2xl bg-card p-4">
        <p className="text-sm text-muted">Room</p>
        <p className="text-lg font-bold">{roomName}</p>
        <p className="mt-1 text-sm text-muted">
          Invite code: <span className="font-mono text-base font-semibold">{inviteCode}</span>
        </p>
      </section>

      {children}

      <form onSubmit={saveName} className="mb-6 flex flex-col gap-2">
        <label htmlFor="display-name" className="font-semibold">
          Display name
        </label>
        <div className="flex gap-2">
          <input
            id="display-name"
            required
            maxLength={30}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="min-h-12 min-w-0 flex-1 rounded-xl border border-line bg-card px-4 text-base"
          />
          <button
            type="submit"
            disabled={nameUnchanged}
            className="min-h-12 rounded-xl bg-primary px-4 font-semibold text-on-primary disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </form>

      <section className="mb-8">
        <h2 className="mb-2 font-semibold">Avatar</h2>
        <div className="grid grid-cols-6 gap-2">
          {EMOJIS.map((option) => (
            <button
              key={option}
              type="button"
              aria-label={`Use ${option} as avatar`}
              aria-pressed={emoji === option}
              onClick={() => void pickEmoji(option)}
              className={`flex aspect-square min-h-11 items-center justify-center rounded-xl text-2xl ${
                emoji === option ? "bg-primary" : "bg-card"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </section>

      <button
        type="button"
        onClick={() => void signOut()}
        className="min-h-12 w-full rounded-xl bg-card font-semibold text-red-700"
      >
        Sign out
      </button>

      <Toast toast={toast} onDone={() => setToast(null)} />
    </>
  );
}
