import HomeStuff from "@/components/stuff/HomeStuff";
import { loadPantry } from "@/lib/queries";
import { requireRoom } from "@/lib/room";

export default async function StuffPage() {
  const { roomId, supabase } = await requireRoom();
  const items = await loadPantry(supabase, roomId);
  return <HomeStuff roomId={roomId} initialItems={items} />;
}
