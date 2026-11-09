import Board from "@/components/board/Board";
import { getBoardData } from "@/lib/room";

export default async function Home() {
  const data = await getBoardData();
  return <Board {...data} />;
}
