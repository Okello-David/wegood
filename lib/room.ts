import { redirect } from "next/navigation";
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

export async function getBoardData() {
  const userId = await requireUserId();
  const roomId = await getMyRoomId(userId);
  if (!roomId) redirect("/onboarding");

  const supabase = await createClient();
  const [room, profiles, statuses] = await Promise.all([
    supabase.from("rooms").select("name, invite_code").eq("id", roomId).single(),
    supabase.from("profiles").select("*"), // RLS limits this to roommates.
    supabase.from("statuses").select("*").eq("room_id", roomId),
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
    serverNow: Date.now(),
  };
}
