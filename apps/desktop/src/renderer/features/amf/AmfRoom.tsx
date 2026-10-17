/** A factory room: a header with the room's name and tabs for the pages it holds. */
import type { ReactNode } from "react";
import { Icon } from "@vua/design-system";
import type { PageId } from "../../app/nav-model.ts";
import { strings } from "../../i18n/index.ts";
import "./factory.css";

const copy = strings.factory;
export type RoomId = "materials" | "workshop" | "control" | "release";
type TabKey = keyof typeof copy.tabs;

export const ROOM_TABS: Record<RoomId, readonly { page: PageId; label: TabKey }[]> = {
  materials: [{ page: "warehouse", label: "library" }, { page: "asset-browser", label: "browse" }],
  workshop: [{ page: "workshop", label: "lines" }, { page: "inspection", label: "inspection" }],
  control: [{ page: "recipe", label: "recipes" }, { page: "packages", label: "packages" }],
  release: [],
};

export function roomOf(page: PageId): RoomId | null {
  for (const room of Object.keys(ROOM_TABS) as RoomId[]) if (ROOM_TABS[room].some(tab => tab.page === page)) return room;
  return page === "release" ? "release" : null;
}

export function AmfRoom({ page, navigate, children }: { page: PageId; navigate: (page: PageId) => void; children: ReactNode }) {
  const room = roomOf(page);
  if (room === null) return <>{children}</>;
  const tabs = ROOM_TABS[room];
  return <div className="vua-room" data-room={room}>
    <nav className="vua-room__bar" aria-label={copy.rooms[room].name}>
      <button type="button" className="vua-room__map" data-nav-id="room-map" onClick={() => navigate("avatar-hub")} aria-label={copy.mapTitle}><Icon name="home" size={16}/></button>
      <span className="vua-room__name"><span className="vua-factory__tag">{copy.rooms[room].tag}</span>{copy.rooms[room].name}</span>
      {tabs.length > 1 && <span className="vua-room__tabs" role="tablist">{tabs.map(tab => <button type="button" role="tab" key={tab.page} aria-selected={tab.page === page}
        data-nav-id={`tab-${tab.page}`} onClick={() => navigate(tab.page)}>{copy.tabs[tab.label]}</button>)}</span>}
    </nav>
    <div className="vua-room__content">{children}</div>
  </div>;
}
