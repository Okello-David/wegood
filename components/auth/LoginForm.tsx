"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

function friendlyError(code: string | undefined) {
  if (code === "over_email_send_rate_limit") {
    return "Too many login emails right now. Try again in a little while.";
  }
  if (code === "email_address_not_authorized") {
    return "This address can't get login emails until custom email is set up.";
  }
  return "Couldn't send the link. Check the address and try again.";
}

export default function LoginForm({ linkFailed }: { linkFailed: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState(
    linkFailed ? "That link expired or was already used. Get a new one." : "",
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setState("sending");
    setError("");

    const { error: otpError } = await createClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });

    if (otpError) {
      setError(friendlyError(otpError.code));
      setState("idle");
    } else {
      setState("sent");
    }
  }

  if (state === "sent") {
    return (
      <p className="rounded-2xl bg-white p-4 text-center text-lg" role="status">
        📬 Link sent to <strong className="break-all">{email.trim()}</strong>. Open
        it on this device.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label htmlFor="email" className="font-medium">
        Email
      </label>
      {/* 16px text stops iPhone Safari zooming the page on focus. */}
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="min-h-12 rounded-xl border border-stone-300 bg-white px-4 text-base"
      />
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={state === "sending"}
        className="min-h-12 rounded-xl bg-stone-900 px-4 text-lg font-semibold text-white disabled:opacity-60"
      >
        {state === "sending" ? "Sending…" : "Send me a magic link"}
      </button>
    </form>
  );
}
