import Requests from "@/components/requests/Requests";
import { getRequestsData } from "@/lib/room";

export default async function RequestsPage() {
  const data = await getRequestsData();
  return <Requests {...data} />;
}
