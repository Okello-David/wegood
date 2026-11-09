import { redirect } from "next/navigation";
import ProfileForm from "@/components/profile/ProfileForm";
import { requireUserId } from "@/lib/room";
import { createClient } from "@/lib/supabase/server";

export default async function ProfilePage() {
  const userId = await requireUserId();
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) redirect("/login");

  return (
    <main className="mx-auto min-h-dvh max-w-md px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-8">
      <ProfileForm
        userId={userId}
        initialName={profile.display_name}
        initialEmoji={profile.avatar_emoji}
      />
    </main>
  );
}
