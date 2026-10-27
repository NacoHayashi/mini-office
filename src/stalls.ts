// Restroom stalls. Coordinates match the office map (1 unit = 1 pixel).
// Door yaw 0 faces north, the same layout-forward used by seated actors.

// Reach is measured from a person's center to the closed door. A wide body standing
// fully inside a stall is still within reach of its own door.
export const STALL_REACH = 60;
export const STALL_META = "stall_doors";
export const STALL_COOLDOWN_MS = 300;

export type StallPart = {
  id: string;
  kind: "stallwall" | "stalldoor" | "toilet";
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

// One restroom with two stalls side by side along its south wall. Each stall is wide
// and deep enough that the widest body fits between the toilet and the closed door.
// Doors swing in along the west partition, so the walkway in front stays clear.
export const STALL_X = 32;
export const STALL_Y = 896;
export const STALL_INNER = 116;
const DOOR_H = 10;
const WALL_T = 8;
const WALL_H = 1056 - STALL_Y;
const TOILET_W = 34;
const TOILET_H = 40;
const TOILET_Y = 1008;

function wallAt(id: string, x: number, tint: string): StallPart {
  return { id, kind: "stallwall", x, y: STALL_Y, w: WALL_T, h: WALL_H, solid: true, rot: 90, tint };
}

function stallAt(id: string, x: number, tint: string): StallPart[] {
  return [
    {
      id,
      kind: "stalldoor",
      x,
      y: STALL_Y,
      w: STALL_INNER,
      h: DOOR_H,
      solid: true,
      rot: 0,
      tint,
      openX: x,
      openY: STALL_Y + DOOR_H,
      openW: DOOR_H,
      openH: STALL_INNER,
    },
    {
      id: `${id}-toilet`,
      kind: "toilet",
      x: x + (STALL_INNER - TOILET_W) / 2,
      y: TOILET_Y,
      w: TOILET_W,
      h: TOILET_H,
      solid: true,
      rot: 0,
      tint,
    },
  ];
}

// Butter-yellow partitions follow the Bubbly Bathroom look. The middle partition is shared.
export function stallProps(): StallPart[] {
  const tint = "#ffe9a8";
  const step = WALL_T + STALL_INNER;
  return [
    wallAt("stall-west", STALL_X, tint),
    ...stallAt("stall-a", STALL_X + WALL_T, tint),
    wallAt("stall-mid", STALL_X + step, tint),
    ...stallAt("stall-b", STALL_X + step + WALL_T, tint),
    wallAt("stall-east", STALL_X + 2 * step, tint),
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

  // Bodies lists everyone in the room with their body size; a door never swings onto someone.
  toggle(
    id: string,
    x: number,
    y: number,
    bodies: Array<{ x: number; y: number; r?: number }> = [],
    radius = 11,
  ): { ok: true; open: boolean } | { ok: false; reason: StallFail } {
    const door = this.parts.find((part) => part.kind === "stalldoor" && part.id === id);
    if (!door) return { ok: false, reason: "unknown" };
    if (!near(x, y, door, STALL_REACH)) return { ok: false, reason: "far" };
    const target = doorBox(door, !this.open.has(id));
    if (bodies.some((body) => hits(body.x, body.y, body.r ?? radius, target))) return { ok: false, reason: "busy" };
    if (this.open.has(id)) this.open.delete(id);
    else this.open.add(id);
    return { ok: true, open: this.open.has(id) };
  }
}
