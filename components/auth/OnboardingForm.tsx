"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

const ERRORS: Record<string, string> = {
  invalid_code: "That code doesn't match a room. Check it and try again.",
  already_in_room: "You're already in a room.",
};

export default function OnboardingForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(request: (client: ReturnType<typeof createClient>) => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError("");
    const { error: rpcError } = await request(createClient());
    if (rpcError && rpcError.message !== "already_in_room") {
      setError(ERRORS[rpcError.message] ?? "Something went wrong. Try again.");
      setBusy(false);
      return;
    }
    // refresh() makes the server load the new room instead of a cached page.
    router.replace("/");
    router.refresh();
  }

  function createRoom(event: FormEvent) {
    event.preventDefault();
    void run((client) => client.rpc("create_room", { p_name: name }));
  }

  function joinRoom(event: FormEvent) {
    event.preventDefault();
    void run((client) => client.rpc("join_room", { p_code: code }));
  }

  const inputClass = "min-h-12 rounded-xl border border-line bg-card px-4 text-base";
  const buttonClass =
    "min-h-12 rounded-xl bg-primary px-4 text-lg font-semibold text-on-primary disabled:opacity-60";

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={createRoom} className="flex flex-col gap-3 rounded-2xl bg-card/70 p-4">
        <label htmlFor="room-name" className="text-lg font-semibold">
          Create a room
        </label>
        <input
          id="room-name"
          required
          maxLength={40}
          placeholder="The Couch Collective"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
        />
        <button type="submit" disabled={busy || !name.trim()} className={buttonClass}>
          Create
        </button>
      </form>

      <form onSubmit={joinRoom} className="flex flex-col gap-3 rounded-2xl bg-card/70 p-4">
        <label htmlFor="room-code" className="text-lg font-semibold">
          Join with code
        </label>
        <input
          id="room-code"
          required
          maxLength={6}
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="ABC234"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          className={`${inputClass} font-mono tracking-widest`}
        />
        <button type="submit" disabled={busy || code.trim().length !== 6} className={buttonClass}>
          Join
        </button>
      </form>

      {error && (
        <p className="text-center text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
