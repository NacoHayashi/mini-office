// Gym: dumbbell sets with a leaderboard, yoga on the mats, the bouncy ball and the water cooler.
// Everything here is plain data so it can be tested without a room.
import { type Prop, type Zone, zoneAt } from "./content";
import { cleanLine } from "./meeting";

export const GYM_META = "gym";
export const GYM_ZONE = "gym";
export const GYM_REACH = 90;
export const LIFT_GAP_MS = 2000;
export const BOUNCE_GAP_MS = 800;
export const BUFF_MS = 30000;
export const BOARD_KEEP = 50;
export const BOARD_TOP = 5;
export const NAME_CHARS = 20;
// A yoga pose ends once its owner steps this far from where it began.
export const POSE_DRIFT = 6;

export type BoardRow = { id: string; name: string; sets: number };
export type Pose = { x: number; y: number };

export function inGym(x: number, y: number, zones: Zone[]): boolean {
  return zoneAt(x, y, zones)?.id === GYM_ZONE;
}

export function decorOf(props: Prop[], model: string): Prop | null {
  return props.find((item) => item.kind === "decor" && item.model === model) || null;
}

/** True when the point stands on the decor piece itself, like a yoga mat. */
export function onDecor(x: number, y: number, prop: Prop | null): boolean {
  return Boolean(prop) && x >= prop!.x && x <= prop!.x + prop!.w && y >= prop!.y && y <= prop!.y + prop!.h;
}

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 40;

export class GymRoom {
  board: BoardRow[] = [];
  readonly poses = new Map<string, Pose>();
  readonly buffs = new Map<string, number>();

  load(raw: string | null) {
    this.board = [];
    if (!raw) return;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (!data || typeof data !== "object" || !Array.isArray(data.board)) return;
    const seen = new Set<string>();
    for (const row of data.board) {
      const name = cleanLine(row?.name, NAME_CHARS);
      const sets = Number(row?.sets);
      if (!isId(row?.id) || !name || !Number.isInteger(sets) || sets <= 0 || seen.has(row.id)) continue;
      seen.add(row.id);
      this.board.push({ id: row.id, name, sets });
    }
    this.rank();
  }

  save(): string {
    return JSON.stringify({ board: this.board });
  }

  private rank() {
    this.board.sort((a, b) => b.sets - a.sets || a.id.localeCompare(b.id));
    if (this.board.length > BOARD_KEEP) this.board.length = BOARD_KEEP;
  }

  /** One dumbbell set: counts on the board and gives a short buff. Returns the new count. */
  lift(id: string, name: string, now: number): number {
    let row = this.board.find((item) => item.id === id);
    if (!row) {
      row = { id, name: cleanLine(name, NAME_CHARS) || id, sets: 0 };
      this.board.push(row);
    }
    row.name = cleanLine(name, NAME_CHARS) || row.name;
    row.sets += 1;
    this.buffs.set(id, now + BUFF_MS);
    this.rank();
    return row.sets;
  }

  top() {
    return this.board.slice(0, BOARD_TOP).map((row) => ({ ...row }));
  }

  mine(id: string) {
    const at = this.board.findIndex((row) => row.id === id);
    return at < 0 ? null : { rank: at + 1, sets: this.board[at].sets };
  }

  /** `where` finds a person still in the room, or null once they left. */
  view(now: number, where: (id: string) => { x: number; y: number } | null) {
    const poses: string[] = [];
    for (const [id, pose] of this.poses) {
      const at = where(id);
      if (at && Math.hypot(at.x - pose.x, at.y - pose.y) <= POSE_DRIFT) poses.push(id);
      else this.poses.delete(id);
    }
    const buffs: Record<string, number> = {};
    for (const [id, until] of this.buffs) {
      if (until > now && where(id)) buffs[id] = until - now;
      else this.buffs.delete(id);
    }
    return { board: this.top(), poses, buffs };
  }

  forget(id: string) {
    this.poses.delete(id);
    this.buffs.delete(id);
  }
}
