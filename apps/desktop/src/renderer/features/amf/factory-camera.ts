/** Camera for the factory map: where it looks, how it eases between rooms, and which rooms neighbor. */
export interface Camera { readonly x: number; readonly y: number; readonly scale: number }
export interface Box { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
export type Direction = "left" | "right" | "up" | "down";

export const OVERVIEW: Camera = { x: 0, y: 0, scale: 1 };
/** Share of the viewport the zoomed room fills; the rest shows its neighbors. */
export const ROOM_FILL = 0.8;

/** The camera that centers a room in the viewport, leaving its neighbors visible around it. */
export function cameraOn(room: Box, viewport: { width: number; height: number }, fill = ROOM_FILL): Camera {
  const scale = Math.min(viewport.width / room.width, viewport.height / room.height) * fill;
  return { scale, x: viewport.width / 2 - (room.left + room.width / 2) * scale, y: viewport.height / 2 - (room.top + room.height / 2) * scale };
}

export const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/** The camera between two others at progress t; scale moves geometrically so the zoom feels even. */
export function between(from: Camera, to: Camera, t: number): Camera {
  const k = easeInOutCubic(Math.min(1, Math.max(0, t)));
  const scale = from.scale * (to.scale / from.scale) ** k;
  return { scale, x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}

export function transformOf(camera: Camera): string {
  return `translate(${camera.x.toFixed(2)}px, ${camera.y.toFixed(2)}px) scale(${camera.scale.toFixed(4)})`;
}

/** Rooms laid out as floors from the top; each floor lists its rooms from the left. */
export function neighbors<R extends string>(floors: readonly (readonly R[])[], room: R): Partial<Record<Direction, R>> {
  const floor = floors.findIndex(rooms => rooms.includes(room));
  if (floor < 0) return {};
  const column = floors[floor]!.indexOf(room);
  const at = (f: number, c: number) => floors[f]?.[c];
  const result: Partial<Record<Direction, R>> = {};
  const left = at(floor, column - 1); const right = at(floor, column + 1);
  const up = at(floor - 1, column); const down = at(floor + 1, column);
  if (left) result.left = left; if (right) result.right = right; if (up) result.up = up; if (down) result.down = down;
  return result;
}
