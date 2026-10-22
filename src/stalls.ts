// Restroom stalls. Coordinates match the office map (1 unit = 1 pixel).
// Door yaw 0 faces north, the same layout-forward used by seated actors.

export const STALL_REACH = 42;
export const STALL_META = "stall_doors";
export const STALL_COOLDOWN_MS = 300;

export type StallRoom = "men" | "women";

export type StallPart = {
  id: string;
  kind: "stallwall" | "stalldoor" | "toilet";
  room: StallRoom;
  x: number;
  y: number;
  w: number;
  h: number;
  solid: boolean;
  rot: number;
  tint: string;
  openX?: number;
  openY?: number;
  openW?: number;
  openH?: number;
};

type Box = { x: number; y: number; w: number; h: number };

const DOOR_W = 64;
const DOOR_H = 10;
const WALL_T = 8;
const STALL_Y = 968;
const WALL_H = 84;

function stallAt(room: StallRoom, id: string, x: number, tint: string): StallPart[] {
  const doorX = x + WALL_T;
  return [
    {
      id: `${id}-west`,
      kind: "stallwall",
      room,
      x,
      y: STALL_Y,
      w: WALL_T,
      h: WALL_H,
      solid: true,
      rot: 90,
      tint,
    },
    {
      id,
      kind: "stalldoor",
      room,
      x: doorX,
      y: STALL_Y,
      w: DOOR_W,
      h: DOOR_H,
      solid: true,
      rot: 0,
      tint,
      openX: doorX,
      openY: STALL_Y - DOOR_W,
      openW: DOOR_H,
      openH: DOOR_W,
    },
    {
      id: `${id}-east`,
      kind: "stallwall",
      room,
      x: doorX + DOOR_W,
      y: STALL_Y,
      w: WALL_T,
      h: WALL_H,
      solid: true,
      rot: 90,
      tint,
    },
    {
      id: `${id}-toilet`,
      kind: "toilet",
      room,
      x: doorX + (DOOR_W - 34) / 2,
      y: 1008,
      w: 34,
      h: 40,
      solid: true,
      rot: 0,
      tint,
    },
  ];
}

// Each restroom is five tiles wide, so its two stalls sit wall to wall.
// Butter-yellow partitions follow the Bubbly Bathroom look in both rooms.
export function stallProps(): StallPart[] {
  const tint = "#ffe9a8";
  return [
    ...stallAt("men", "men-a", 32, tint),
    ...stallAt("men", "men-b", 112, tint),
    ...stallAt("women", "women-a", 224, tint),
    ...stallAt("women", "women-b", 304, tint),
  ];
}

function hits(cx: number, cy: number, r: number, box: Box): boolean {
  const nx = Math.max(box.x, Math.min(cx, box.x + box.w));
  const ny = Math.max(box.y, Math.min(cy, box.y + box.h));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

function near(px: number, py: number, box: Box, reach: number): boolean {
  const nx = Math.max(box.x, Math.min(px, box.x + box.w));
  const ny = Math.max(box.y, Math.min(py, box.y + box.h));
  return Math.hypot(px - nx, py - ny) <= reach;
}

function doorBox(part: StallPart, open: boolean): Box {
  if (open && part.openX != null && part.openY != null && part.openW != null && part.openH != null) {
    return { x: part.openX, y: part.openY, w: part.openW, h: part.openH };
  }
  return part;
}

export type StallFail = "unknown" | "far" | "busy";

export class StallDoors {
  private readonly parts: StallPart[];
  private readonly open = new Set<string>();

  constructor(parts: StallPart[] = stallProps()) {
    this.parts = parts;
  }

  load(raw: string | null | undefined) {
    this.open.clear();
    if (!raw) return;
    let list: unknown;
    try {
      list = JSON.parse(raw);
    } catch {
      return;
    }
    if (!Array.isArray(list)) return;
    for (const id of list) {
      if (typeof id === "string" && this.parts.some((part) => part.kind === "stalldoor" && part.id === id)) this.open.add(id);
    }
  }

  save(): string {
    return JSON.stringify([...this.open].sort());
  }

  view(): Array<{ id: string; open: boolean }> {
    return this.parts.filter((part) => part.kind === "stalldoor").map((part) => ({
      id: part.id,
      open: this.open.has(part.id),
    }));
  }

  isOpen(id: string): boolean {
    return this.open.has(id);
  }

  blocks(x: number, y: number, radius = 11): boolean {
    for (const part of this.parts) {
      if (!part.solid) continue;
      const box = part.kind === "stalldoor" ? doorBox(part, this.open.has(part.id)) : part;
      if (hits(x, y, radius, box)) return true;
    }
    return false;
  }

  // Bodies lists everyone in the room; a door never swings onto someone.
  toggle(
    id: string,
    x: number,
    y: number,
    bodies: Array<{ x: number; y: number }> = [],
    radius = 11,
  ): { ok: true; open: boolean } | { ok: false; reason: StallFail } {
    const door = this.parts.find((part) => part.kind === "stalldoor" && part.id === id);
    if (!door) return { ok: false, reason: "unknown" };
    if (!near(x, y, door, STALL_REACH)) return { ok: false, reason: "far" };
    const target = doorBox(door, !this.open.has(id));
    if (bodies.some((body) => hits(body.x, body.y, radius, target))) return { ok: false, reason: "busy" };
    if (this.open.has(id)) this.open.delete(id);
    else this.open.add(id);
    return { ok: true, open: this.open.has(id) };
  }
}
