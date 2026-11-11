import { redirect } from "next/navigation";
import {
  loadActivities,
  loadCheckins,
  loadFeed,
  loadProfiles,
  loadRequests,
  loadSchedule,
} from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export async function requireUserId() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");
  return userId;
}

export async function getMyRoomId(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("room_members")
    .select("room_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.room_id ?? null;
}

// For every in-room screen: signed in and in a room, or sent where they belong.
export async function requireRoom() {
  const userId = await requireUserId();
  const roomId = await getMyRoomId(userId);
  if (!roomId) redirect("/onboarding");
  return { userId, roomId, supabase: await createClient() };
}

export async function getBoardData() {
  const { userId, roomId, supabase } = await requireRoom();
  const [room, profiles, statuses, requests, feed, activities, checkins, schedule] =
    await Promise.all([
    supabase.from("rooms").select("name, invite_code").eq("id", roomId).single(),
    supabase.from("profiles").select("*"), // RLS limits this to roommates.
    supabase.from("statuses").select("*").eq("room_id", roomId),
    loadRequests(supabase, roomId),
    loadFeed(supabase, roomId),
    loadActivities(supabase, roomId),
    loadCheckins(supabase, roomId),
    loadSchedule(supabase, roomId),
  ]);
  const failure = room.error ?? profiles.error ?? statuses.error;
  if (failure) throw new Error(failure.message);

  return {
    myId: userId,
    roomId,
    roomName: room.data!.name,
    inviteCode: room.data!.invite_code,
    profiles: profiles.data!,
    statuses: statuses.data!,
    requests,
    feed,
    activities,
    checkins,
    schedule,
    serverNow: Date.now(),
  };
}

export async function getRequestsData() {
  const { userId, roomId, supabase } = await requireRoom();
  const [requests, profiles] = await Promise.all([
    loadRequests(supabase, roomId),
    loadProfiles(supabase),
  ]);
  return { myId: userId, roomId, initialRequests: requests, profiles, serverNow: Date.now() };
}

export async function getPlanData() {
  const { userId, roomId, supabase } = await requireRoom();
  const [profiles, schedule] = await Promise.all([
    loadProfiles(supabase),
    loadSchedule(supabase, roomId),
  ]);
  return { myId: userId, roomId, profiles, initialSchedule: schedule, serverNow: Date.now() };
}
