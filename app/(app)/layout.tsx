import AutoHome from "@/components/geo/AutoHome";
import BottomTabs from "@/components/nav/BottomTabs";
import { requireRoom } from "@/lib/room";

// A route group: the (app) folder adds the tab bar to every in-room screen
// without adding "/app" to the URLs. Login and onboarding stay outside it.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Phase 4: the room's home point, for the geofence check in the browser.
  // (Only the room's point exists in the database, never a person's.)
  const { roomId, supabase } = await requireRoom();
  const { data: room } = await supabase
    .from("rooms")
    .select("home_lat, home_lng, radius_m")
    .eq("id", roomId)
    .single();
  const home =
    room?.home_lat != null && room.home_lng != null
      ? { lat: room.home_lat, lng: room.home_lng }
      : null;

  return (
    <>
      {children}
      <AutoHome home={home} radiusM={room?.radius_m ?? 60} />
      <BottomTabs />
    </>
  );
}
