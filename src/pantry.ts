// Pantry: hot drinks, the microwave, tossing snacks and sticky notes on the fridge.
// Everything here is plain data so it can be tested without a room.
import { type Prop, type Zone, zoneAt } from "./content";
import { cleanLine } from "./meeting";

export const PANTRY_META = "pantry";
export const PANTRY_ZONE = "pantry";
export const FRIDGE_NOTES = 6;
export const FRIDGE_CHARS = 20;
export const FRIDGE_TINTS = ["#ffe08a", "#ffc6d9", "#c9e8ff", "#d4f2c4"];
export const HOT_DRINKS = ["hotcoffee", "cocoa", "hottea"] as const;
export const OVEN_ITEM = "bun";
export const HEAT_MS = 2400;
// A finished bun waits this long for its owner before someone else may use the microwave.
export const OVEN_KEEP_MS = 20000;
export const PANTRY_REACH = 100;
export const TOSS_REACH = 240;
export const TAP_GAP_MS = 300;

export type FridgeNote = { id: string; text: string; by: string; tint: number };
export type Oven = { by: string; ready: number };

export function inPantry(x: number, y: number, zones: Zone[]): boolean {
  return zoneAt(x, y, zones)?.id === PANTRY_ZONE;
}

/** Centre of the first decor piece using this model, e.g. the microwave or the fridge. */
export function propAnchor(props: Prop[], model: string): { x: number; y: number } | null {
  const prop = props.find((item) => item.kind === "decor" && item.model === model);
  return prop ? { x: prop.x + prop.w / 2, y: prop.y + prop.h / 2 } : null;
}

export function near(x: number, y: number, at: { x: number; y: number } | null, reach = PANTRY_REACH): boolean {
  return Boolean(at) && Number.isFinite(x) && Number.isFinite(y) && Math.hypot(x - at!.x, y - at!.y) <= reach;
}

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 40;

export class PantryRoom {
  notes: FridgeNote[] = [];
  oven: Oven | null = null;
  private seq = 0;

  load(raw: string | null) {
    this.notes = [];
    this.oven = null;
    this.seq = 0;
    if (!raw) return;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (!data || typeof data !== "object") return;
    if (Number.isInteger(data.seq) && (data.seq as number) >= 0) this.seq = data.seq as number;
    if (!Array.isArray(data.notes)) return;
    for (const row of data.notes.slice(-FRIDGE_NOTES)) {
      const text = cleanLine(row?.text, FRIDGE_CHARS);
      const tint = Number.isInteger(row?.tint) && row.tint >= 0 && row.tint < FRIDGE_TINTS.length ? row.tint : 0;
      if (text && isId(row.by) && isId(row.id) && !this.notes.some((note) => note.id === row.id)) {
        this.notes.push({ id: row.id, text, by: row.by, tint });
      }
    }
  }

  save(): string {
    return JSON.stringify({ seq: this.seq, notes: this.notes });
  }

  /** The newest notes stay; the oldest falls off once the door is full. */
  stick(by: string, raw: unknown, tintRaw: unknown): FridgeNote | null {
    const text = cleanLine(raw, FRIDGE_CHARS);
    if (!text) return null;
    const tint = Number.isInteger(tintRaw) && (tintRaw as number) >= 0 && (tintRaw as number) < FRIDGE_TINTS.length ? (tintRaw as number) : 0;
    this.seq += 1;
    const note = { id: `n${this.seq}`, text, by, tint };
    this.notes.push(note);
    if (this.notes.length > FRIDGE_NOTES) this.notes.splice(0, this.notes.length - FRIDGE_NOTES);
    return note;
  }

  peel(id: unknown): boolean {
    const at = this.notes.findIndex((note) => note.id === id);
    if (at < 0) return false;
    this.notes.splice(at, 1);
    return true;
  }

  private ovenFree(now: number): boolean {
    return !this.oven || now >= this.oven.ready + OVEN_KEEP_MS;
  }

  /** Starts the microwave. Returns an error to show, or null. */
  heat(by: string, now: number): string | null {
    if (!this.ovenFree(now)) return this.oven!.by === by ? "微波爐裡還有你的包子" : "微波爐有人在用";
    this.oven = { by, ready: now + HEAT_MS };
    return null;
  }

  /** Takes the bun out once it has dinged. Returns an error to show, or null. */
  unload(by: string, now: number): string | null {
    if (!this.oven || this.oven.by !== by || this.ovenFree(now)) return "微波爐裡沒有你的東西";
    if (now < this.oven.ready) return "還沒好，等叮一聲";
    this.oven = null;
    return null;
  }

  /** Someone left: their bun goes with them. Returns true when the microwave changed. */
  forget(by: string): boolean {
    if (this.oven?.by !== by) return false;
    this.oven = null;
    return true;
  }

  ovenView(now: number): { by: string; left: number } | null {
    if (this.ovenFree(now)) return null;
    return { by: this.oven!.by, left: Math.max(0, this.oven!.ready - now) };
  }

  view(now: number) {
    return { notes: this.notes.map((note) => ({ ...note })), oven: this.ovenView(now) };
  }
}
