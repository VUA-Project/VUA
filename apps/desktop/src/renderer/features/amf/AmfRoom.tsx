/** A factory room keeps its accent colour. The sidebar and the page title already name the room,
 * so nothing else repeats it here. */
import type { ReactNode } from "react";
import type { PageId } from "../../app/nav-model.ts";
import "./factory.css";

export type RoomId = "materials" | "workshop" | "control" | "release";

const ROOM_OF_PAGE: Partial<Record<PageId, RoomId>> = {
  warehouse: "materials", "asset-browser": "materials", workshop: "workshop", recipe: "control", packages: "control", release: "release",
};

export function roomOf(page: PageId): RoomId | null {
  return ROOM_OF_PAGE[page] ?? null;
}

export function AmfRoom({ page, children }: { page: PageId; navigate: (page: PageId) => void; children: ReactNode }) {
  const room = roomOf(page);
  if (room === null) return <>{children}</>;
  return <div className="vua-room" data-room={room}>
    <div className="vua-room__content">{children}</div>
  </div>;
}
