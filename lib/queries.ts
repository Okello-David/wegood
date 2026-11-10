import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Shared by Server Components (first render) and the browser (catching up after
// a reconnect). Both Supabase clients have this type, so one query serves both.
export type Client = SupabaseClient<Database>;

export const FEED_LIMIT = 20;
// Enough for every open request plus a recent history; old done ones drop off.
const REQUEST_LIMIT = 100;

function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }) {
  if (error) throw new Error(error.message);
  return data!;
}

export async function loadPantry(supabase: Client, roomId: string) {
  return unwrap(
    await supabase.from("pantry_items").select("*").eq("room_id", roomId).order("name"),
  );
}

export async function loadRequests(supabase: Client, roomId: string) {
  return unwrap(
    await supabase
      .from("requests")
      .select("*")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(REQUEST_LIMIT),
  );
}

export async function loadFeed(supabase: Client, roomId: string) {
  return unwrap(
    await supabase
      .from("feed_events")
      .select("*")
      .eq("room_id", roomId)
      .order("id", { ascending: false })
      .limit(FEED_LIMIT),
  );
}

export async function loadProfiles(supabase: Client) {
  // RLS limits this to me and my roommates.
  return unwrap(await supabase.from("profiles").select("*"));
}
