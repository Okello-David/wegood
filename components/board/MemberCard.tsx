"use client";

import { useState } from "react";
import Avatar, { RECENT_CHANGE_MS } from "@/components/board/Avatar";
import Battery from "@/components/board/Battery";
import HungerMeter from "@/components/board/HungerMeter";
import LocationChip from "@/components/board/LocationChip";
import { activityInfo, type Energy } from "@/lib/energy";
import { clockTime, type Occurrence } from "@/lib/schedule";
import { etaText, isFuture, isStale, timeAgo } from "@/lib/time";
import { vibeFor } from "@/lib/vibes";
import type { ProfileRow, StatusRow } from "@/types/database";

type Props = {
  profile: ProfileRow;
  status: StatusRow;
  now: number;
  isMe?: boolean;
  // Phase 5: wears the trophy this week.
  mvp?: boolean;
  // Open visitor notes for this person: highlighted so they can't miss them.
  notes?: string[];
  // Phase 4. undefined until the browser has worked them out (time zone).
  energy?: Energy;
  plan?: { now: Occurrence | null; next: Occurrence | null };
  onOpen?: () => void;
  onOpenEnergy?: () => void;
};

export default function MemberCard({
  profile,
  status,
  now,
  isMe = false,
  mvp = false,
  notes = [],
  energy,
  plan,
  onOpen,
  onOpenEnergy,
}: Props) {
  const stale = isStale(status.updated_at, now);
  const changedAt = Date.parse(status.updated_at);
  const recentlyChanged = now - changedAt < RECENT_CHANGE_MS;
  // The status this card first showed. A bounce only plays for changes that
  // happen while you're looking, not for every card when the page loads.
  const [firstSeen] = useState(status.updated_at);
  const changedWhileOpen = status.updated_at !== firstSeen;
  // Needs the battery, which only exists in the browser (see Board).
  const vibe =
    energy === undefined
      ? null
      : vibeFor({
          userId: profile.id,
          location: status.location_preset,
          hunger: status.hunger,
          bringing: status.bringing,
          energy: energy.percent,
          now,
        });

  const content = (
    <>
      {/* pr leaves room for the battery, which sits on top in the corner. */}
      <div className="flex items-center gap-3 pr-18">
        <Avatar
          userId={profile.id}
          emoji={profile.avatar_emoji}
          color={profile.color}
          size={isMe ? "lg" : "md"}
          pulse={recentlyChanged}
          mvp={mvp}
        />
        <div className="min-w-0 flex-1">
          <h2 className={`truncate font-bold ${isMe ? "text-2xl" : "text-lg"}`}>
            {profile.display_name}
            {isMe && <span className="font-normal text-muted"> (you)</span>}
          </h2>
          <p className="text-sm text-muted">
            updated {timeAgo(status.updated_at, now)}
            {stale && <span className="font-semibold"> · status may be old</span>}
          </p>
          {vibe && <p className="mt-0.5 text-sm text-ink italic">{vibe}</p>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <LocationChip value={status.location_preset} source={status.at_home_source} />
        <HungerMeter value={status.hunger} />
      </div>

      {(plan?.now || plan?.next) && (
        <p className="mt-2 text-sm text-ink">
          {plan.now && (
            <span>
              <b>Now:</b> {activityInfo(plan.now.type).emoji} {plan.now.title} until{" "}
              {clockTime(plan.now.end)}
            </span>
          )}
          {plan.now && plan.next && <span aria-hidden="true"> · </span>}
          {plan.next && (
            <span>
              <b>Next:</b> {activityInfo(plan.next.type).emoji} {plan.next.title} at{" "}
              {clockTime(plan.next.start)}
            </span>
          )}
        </p>
      )}
      {status.bringing && (
        <p className="mt-2 break-words">🛍️ Bringing: {status.bringing}</p>
      )}
      {isFuture(status.eta, now) && <p className="mt-1">⏱️ Back {etaText(status.eta, now)}</p>}
      {notes.map((note, index) => (
        <p key={index} className="mt-2 rounded-xl bg-amber-100 px-3 py-2 break-words text-amber-900">
          📬 {note}
        </p>
      ))}
    </>
  );

  const padding = isMe ? "p-5" : "p-4";
  // A stale card fades only its background (the page colour shows through
  // and the shadow goes). Fading the whole card with opacity also faded the
  // text below readable contrast, which Lighthouse flagged.
  const faded = stale && notes.length === 0;
  const cardClass = `relative w-full rounded-2xl text-left transition-colors ${
    faded ? "bg-card/50" : "bg-card shadow-sm"
  } ${changedWhileOpen ? "motion-safe:animate-bounce-in" : ""} ${
    notes.length > 0 ? "ring-4 ring-amber-400" : ""
  }`;

  // Two separate tap targets (status and battery), because a button inside
  // a button isn't allowed in HTML.
  return (
    // A new key per change restarts the bounce animation.
    <article key={changedWhileOpen ? status.updated_at : "first"} className={cardClass}>
      {onOpen ? (
        <button type="button" onClick={onOpen} className={`block w-full rounded-2xl text-left ${padding}`}>
          {content}
        </button>
      ) : (
        <div className={padding}>{content}</div>
      )}
      <div className={`absolute ${isMe ? "top-4 right-4" : "top-3 right-3"}`}>
        <Battery energy={energy} isMe={isMe} onOpen={onOpenEnergy} />
      </div>
    </article>
  );
}
