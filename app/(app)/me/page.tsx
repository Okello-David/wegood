import { redirect } from "next/navigation";
import NotificationPrefs from "@/components/me/NotificationPrefs";
import NotificationsCard from "@/components/me/NotificationsCard";
import ProfileForm from "@/components/profile/ProfileForm";
import { requireRoom } from "@/lib/room";

export default async function MePage() {
  const { userId, roomId, supabase } = await requireRoom();
  const [{ data: profile }, { data: room }, { data: prefs }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("rooms").select("name, invite_code").eq("id", roomId).single(),
    // No row yet just means "all defaults".
    supabase.from("notification_prefs").select("*").eq("user_id", userId).maybeSingle(),
  ]);
  if (!profile) redirect("/login");

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-28">
      <ProfileForm
        userId={userId}
        initialName={profile.display_name}
        initialEmoji={profile.avatar_emoji}
        roomName={room?.name ?? ""}
        inviteCode={room?.invite_code ?? ""}
      >
        <NotificationsCard userId={userId} roomId={roomId} />
        <NotificationPrefs userId={userId} initial={prefs} />
      </ProfileForm>
    </main>
  );
}
