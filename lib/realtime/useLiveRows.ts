"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Client } from "@/lib/queries";
import type { Database } from "@/types/database";

type LiveTable =
  | "pantry_items"
  | "requests"
  | "feed_events"
  | "activities"
  | "energy_checkins"
  | "schedule_items"
  | "point_events";
type RowOf<T extends LiveTable> = Database["public"]["Tables"][T]["Row"];
type Id = string | number;

type Options<T extends LiveTable> = {
  supabase: Client;
  table: T;
  roomId: string;
  initialRows: RowOf<T>[];
  // Define it outside the component so it stays the same between renders.
  load: (supabase: Client, roomId: string) => Promise<RowOf<T>[]>;
};

// Keeps a list of one room's rows in sync with the database: applies Realtime
// events as they arrive, and reloads the whole list after a reconnect or when
// the phone wakes the tab up (it may have missed events while asleep).
//
// The Phase 1 Board does the same for statuses by hand; this is that pattern
// made reusable.
export function useLiveRows<T extends LiveTable>({
  supabase,
  table,
  roomId,
  initialRows,
  load,
}: Options<T>) {
  type Row = RowOf<T>;
  const [rows, setRows] = useState<Row[]>(initialRows);
  // Rows with a save in flight. Their Realtime echoes are ignored so that
  // quick taps never "rewind" on screen (have -> low -> out -> low -> out).
  const busy = useRef(new Map<Id, number>());
  const channelKey = useId();

  const refetch = useCallback(async () => {
    try {
      const fresh = await load(supabase, roomId);
      setRows((current) =>
        fresh.map((row) =>
          busy.current.has(row.id) ? (current.find((c) => c.id === row.id) ?? row) : row,
        ),
      );
    } catch {
      // Offline or similar: keep what's on screen; the next catch-up retries.
    }
  }, [supabase, roomId, load]);

  useEffect(() => {
    let cancelled = false;
    let channel: RealtimeChannel | undefined;

    function upsert(row: Row) {
      if (busy.current.has(row.id)) return;
      setRows((current) => {
        const index = current.findIndex((c) => c.id === row.id);
        if (index === -1) return [...current, row];
        const next = current.slice();
        next[index] = row;
        return next;
      });
    }

    async function subscribe() {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      // Realtime applies RLS using this token, so it must be set first.
      if (data.session) supabase.realtime.setAuth(data.session.access_token);

      const filter = `room_id=eq.${roomId}`;
      channel = supabase
        .channel(`${table}:${roomId}:${channelKey}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table, filter }, (payload) =>
          upsert(payload.new as Row),
        )
        .on("postgres_changes", { event: "UPDATE", schema: "public", table, filter }, (payload) =>
          upsert(payload.new as Row),
        )
        // Deletes can't be filtered by room (the row is gone, only its id is
        // sent), so we get every room's delete ids and ignore unknown ones.
        .on("postgres_changes", { event: "DELETE", schema: "public", table }, (payload) => {
          const id = (payload.old as Partial<Row>).id;
          if (id !== undefined) setRows((current) => current.filter((c) => c.id !== id));
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") void refetch();
        });
    }

    void subscribe();
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, table, roomId, channelKey, refetch]);

  useEffect(() => {
    function catchUp() {
      if (document.visibilityState === "visible") void refetch();
    }
    document.addEventListener("visibilitychange", catchUp);
    window.addEventListener("online", catchUp);
    return () => {
      document.removeEventListener("visibilitychange", catchUp);
      window.removeEventListener("online", catchUp);
    };
  }, [refetch]);

  // Wraps a save: echoes for this row are ignored until it finishes.
  const hold = useCallback(async <R,>(id: Id, save: () => Promise<R>) => {
    busy.current.set(id, (busy.current.get(id) ?? 0) + 1);
    try {
      return await save();
    } finally {
      const left = (busy.current.get(id) ?? 1) - 1;
      if (left > 0) busy.current.set(id, left);
      else busy.current.delete(id);
    }
  }, []);

  // True while another save for this row is still in flight.
  const isBusy = useCallback((id: Id) => busy.current.has(id), []);

  return { rows, setRows, refetch, hold, isBusy };
}
