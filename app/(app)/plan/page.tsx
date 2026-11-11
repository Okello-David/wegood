import PlanScreen from "@/components/plan/PlanScreen";
import { getPlanData } from "@/lib/room";

export default async function PlanPage() {
  const data = await getPlanData();
  return <PlanScreen {...data} />;
}
