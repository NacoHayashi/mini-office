/** Toy rack in the game room: who holds which toy, and the short effects toys play on coworkers. */

import { hitsSolid, hitsWall, WALL_RADIUS } from "./content";

export const TOY_META = "toy_state";
export const TOY_RACK_ID = "toy-rack";
export const RACK_REACH = 108;
export const PICK_REACH = 60;
/** How far past touching bodies a hand toy still reaches. */
export const HIT_GAP = 34;
/** Running into someone counts when bodies are this close past touching. */
export const RAM_GAP = 22;
export const THROW_REACH = 320;
export const PLANE_REACH = 480;
export const BALL_FLIGHT_MS = 900;
/** The catch key works from a moment after the throw until a little after the ball arrives. */
export const CATCH_OPEN_MS = 200;
export const CATCH_GRACE_MS = 450;
export const PINCH_MAX_MS = 2000;
/** Effects one person can receive inside the window, from everyone together. */
export const TARGET_CAP = 6;
export const TARGET_WINDOW_MS = 10000;
/** One knockback per person inside this window; later rams only wobble. */
export const KNOCK_WINDOW_MS = 6000;
export const RUN_SPEED = 215;
export const RUN_SPAN_MS = 700;
export const KNOCK_DISTANCES = [64, 52, 40, 28] as const;
export const KNOCK_STEP = 6;

export const TOY_IDS = ["hammer", "ball", "plane", "pillow", "pinch", "ram"] as const;
export type ToyId = (typeof TOY_IDS)[number];

export const TOY_ITEMS: ReadonlyArray<{ id: ToyId; label: string }> = [
  { id: "hammer", label: "玩具錘子" },
  { id: "ball", label: "丟接球" },
  { id: "plane", label: "紙飛機" },
  { id: "pillow", label: "枕頭" },
  { id: "pinch", label: "捏捏臉" },
  { id: "ram", label: "撞撞車" },
];

export const TOY_COOLDOWN_MS: Record<ToyId, number> = {
  hammer: 900,
  ball: 1500,
  plane: 4000,
  pillow: 900,
  pinch: 1500,
  ram: 3000,
};

export type Anchor = { x: number; y: number };
export type Body = { id: string; x: number; y: number; r: number; seated?: boolean };

type Place = { at: "rack" } | { at: "hand"; id: string } | { at: "floor"; x: number; y: number } | { at: "air" };

type Flight = {
  by: string;
  to: string;
  t0: number;
  until: number;
  drop: Anchor;
  combo: number;
};

type Pinch = { by: string; to: string; until: number };

export type ToyView = { id: ToyId; at: "rack" | "hand" | "floor" | "air"; holder?: string; x?: number; y?: number };

export type ToyFail =
  | "unknown"
  | "far"
  | "busy"
  | "full"
  | "snack"
  | "empty"
  | "wrong"
  | "cool"
  | "capped"
  | "self"
  | "seated"
  | "walking"
  | "none"
  | "early"
  | "late";

export type Fail = { ok: false; reason: ToyFail };

const KNOWN = new Set<string>(TOY_IDS);

export function isToy(value: unknown): value is ToyId {
  return typeof value === "string" && KNOWN.has(value);
}

function finite(...values: number[]): boolean {
  return values.every((value) => Number.isFinite(value));
}

export function parseToys(raw: string | null | undefined): Map<ToyId, Place> {
  const places = new Map<ToyId, Place>();
  for (const id of TOY_IDS) places.set(id, { at: "rack" });
  if (!raw) return places;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return places;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return places;
  const holders = new Set<string>();
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isToy(id) || !value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    if (typeof row.hand === "string" && row.hand && !holders.has(row.hand)) {
      holders.add(row.hand);
      places.set(id, { at: "hand", id: row.hand });
    } else if (typeof row.x === "number" && typeof row.y === "number" && finite(row.x, row.y)) {
      places.set(id, { at: "floor", x: row.x, y: row.y });
    }
  }
  return places;
}

/**
 * Walks from start along (nx, ny) and returns the farthest listed distance whose whole
 * path is clear, or null when even the shortest step is blocked.
 */
export function knockSpot(
  start: Anchor,
  nx: number,
  ny: number,
  clear: (x: number, y: number) => boolean,
  distances: readonly number[] = KNOCK_DISTANCES,
  step = KNOCK_STEP,
): Anchor | null {
  const len = Math.hypot(nx, ny);
  if (!finite(start.x, start.y, nx, ny) || len < 1e-6) return null;
  const ux = nx / len;
  const uy = ny / len;
  for (const dist of distances) {
    let ok = true;
    for (let s = Math.min(step, dist); s <= dist + 1e-6; s += step) {
      if (!clear(start.x + ux * s, start.y + uy * s)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const x = start.x + ux * dist;
    const y = start.y + uy * dist;
    if (clear(x, y)) return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  }
  return null;
}

/** Floor test used for knockback and dropped toys: walls, map bounds, solid props and furniture, other bodies. */
export function openFloor(opts: {
  walls: string[];
  props: Array<{ x: number; y: number; w: number; h: number; solid: boolean }>;
  furniture: Array<{ kind: string; x: number; y: number; rot: number }>;
  bodies?: Body[];
  radius?: number;
  bodyRadius?: number;
  extra?: (x: number, y: number) => boolean;
}): (x: number, y: number) => boolean {
  const radius = opts.radius ?? WALL_RADIUS;
  const mine = opts.bodyRadius ?? 0;
  const bodies = opts.bodies || [];
  return (x, y) => {
    if (hitsWall(opts.walls, x, y, radius)) return false;
    if (hitsSolid(opts.props, opts.furniture, x, y, radius)) return false;
    if (opts.extra && opts.extra(x, y)) return false;
    for (const body of bodies) {
      if (Math.hypot(body.x - x, body.y - y) < body.r + mine - 1) return false;
    }
    return true;
  };
}

export class ToyRoom {
  private places = parseToys(null);
  private flight: Flight | null = null;
  private pinch: Pinch | null = null;
  private readonly last = new Map<string, number>();
  private readonly hits = new Map<string, number[]>();
  private readonly knocked = new Map<string, number>();
  private readonly trails = new Map<string, Array<{ t: number; x: number; y: number }>>();
  private combo = 0;

  constructor(raw?: string | null) {
    this.load(raw);
  }

  load(raw: string | null | undefined) {
    this.places = parseToys(raw);
    this.flight = null;
    this.pinch = null;
    this.last.clear();
    this.hits.clear();
    this.knocked.clear();
    this.trails.clear();
    this.combo = 0;
  }

  /** Stored form. A ball in the air is saved where it would land. */
  save(): string {
    const out: Record<string, unknown> = {};
    for (const [id, place] of this.places) {
      if (place.at === "hand") out[id] = { hand: place.id };
      else if (place.at === "floor") out[id] = { x: place.x, y: place.y };
      else if (place.at === "air" && this.flight) out[id] = { x: this.flight.drop.x, y: this.flight.drop.y };
    }
    return JSON.stringify(out);
  }

  view(only?: (id: string) => boolean): { toys: ToyView[]; combo: number } {
    const toys: ToyView[] = [];
    for (const [id, place] of this.places) {
      if (place.at === "hand") {
        if (only && !only(place.id)) toys.push({ id, at: "rack" });
        else toys.push({ id, at: "hand", holder: place.id });
      } else if (place.at === "floor") toys.push({ id, at: "floor", x: place.x, y: place.y });
      else toys.push({ id, at: place.at });
    }
    return { toys, combo: this.combo };
  }

  hand(playerId: string): ToyId | "" {
    for (const [id, place] of this.places) {
      if (place.at === "hand" && place.id === playerId) return id;
    }
    return "";
  }

  where(id: ToyId): Place {
    return this.places.get(id) || { at: "rack" };
  }

  pinchOf(playerId: string): Pinch | null {
    return this.pinch && (this.pinch.by === playerId || this.pinch.to === playerId) ? { ...this.pinch } : null;
  }

  flying(): Flight | null {
    return this.flight ? { ...this.flight, drop: { ...this.flight.drop } } : null;
  }

  /** Someone left for good: their toy goes back on the rack and any pinch or catch with them ends. */
  release(playerId: string): { toy: ToyId | ""; pinch: Pinch | null } {
    const toy = this.hand(playerId);
    if (toy) this.places.set(toy, { at: "rack" });
    let pinch: Pinch | null = null;
    if (this.pinch && (this.pinch.by === playerId || this.pinch.to === playerId)) {
      pinch = this.pinch;
      this.pinch = null;
    }
    this.trails.delete(playerId);
    return { toy, pinch };
  }

  /** Move samples from the server's accepted positions; used to tell running from walking. */
  track(playerId: string, x: number, y: number, now: number) {
    if (!finite(x, y, now)) return;
    const trail = this.trails.get(playerId) || [];
    trail.push({ t: now, x, y });
    while (trail.length && now - trail[0].t > RUN_SPAN_MS) trail.shift();
    this.trails.set(playerId, trail);
  }

  /** True when recent accepted moves average at least RUN_SPEED and the newest one is fresh. */
  running(playerId: string, now: number): boolean {
    const trail = (this.trails.get(playerId) || []).filter((point) => now - point.t <= RUN_SPAN_MS);
    if (trail.length < 3) return false;
    const first = trail[0];
    const lastPoint = trail[trail.length - 1];
    if (now - lastPoint.t > 260) return false;
    const span = lastPoint.t - first.t;
    if (span < 180) return false;
    let dist = 0;
    for (let i = 1; i < trail.length; i++) dist += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y);
    return (dist / span) * 1000 >= RUN_SPEED;
  }

  take(
    playerId: string,
    toyId: unknown,
    x: number,
    y: number,
    rack: Anchor | null,
    holdingSnack: boolean,
  ): { ok: true; toy: ToyId; returned: ToyId | "" } | Fail {
    if (!isToy(toyId)) return { ok: false, reason: "unknown" };
    if (!finite(x, y)) return { ok: false, reason: "far" };
    if (holdingSnack) return { ok: false, reason: "snack" };
    const place = this.where(toyId);
    const held = this.hand(playerId);
    if (place.at === "hand" && place.id === playerId) return { ok: true, toy: toyId, returned: "" };
    if (place.at === "rack") {
      if (!rack || Math.hypot(x - rack.x, y - rack.y) > RACK_REACH) return { ok: false, reason: "far" };
      if (held) this.places.set(held, { at: "rack" });
      this.places.set(toyId, { at: "hand", id: playerId });
      return { ok: true, toy: toyId, returned: held };
    }
    if (place.at === "floor") {
      if (Math.hypot(x - place.x, y - place.y) > PICK_REACH) return { ok: false, reason: "far" };
      if (held) return { ok: false, reason: "full" };
      this.places.set(toyId, { at: "hand", id: playerId });
      return { ok: true, toy: toyId, returned: "" };
    }
    return { ok: false, reason: "busy" };
  }

  putBack(playerId: string, x: number, y: number, rack: Anchor | null): { ok: true; toy: ToyId } | Fail {
    const toy = this.hand(playerId);
    if (!toy) return { ok: false, reason: "empty" };
    if (!rack || !finite(x, y) || Math.hypot(x - rack.x, y - rack.y) > RACK_REACH) return { ok: false, reason: "far" };
    this.places.set(toy, { at: "rack" });
    this.endPinchBy(playerId);
    return { ok: true, toy };
  }

  drop(playerId: string, x: number, y: number): { ok: true; toy: ToyId; x: number; y: number } | Fail {
    const toy = this.hand(playerId);
    if (!toy) return { ok: false, reason: "empty" };
    if (!finite(x, y)) return { ok: false, reason: "far" };
    this.places.set(toy, { at: "floor", x, y });
    this.endPinchBy(playerId);
    return { ok: true, toy, x, y };
  }

  private endPinchBy(playerId: string) {
    if (this.pinch?.by === playerId) this.pinch = null;
  }

  /** Shared checks for every effect: holding the right toy, own cooldown, target in reach, target cap. */
  private gate(by: Body, target: Body | null, toy: ToyId, reach: number, now: number): Fail | null {
    if (this.hand(by.id) !== toy) return { ok: false, reason: "wrong" };
    if (!target) return { ok: false, reason: "none" };
    if (target.id === by.id) return { ok: false, reason: "self" };
    const key = `${by.id}:${toy}`;
    const prev = this.last.get(key);
    if (prev != null && now - prev < TOY_COOLDOWN_MS[toy]) return { ok: false, reason: "cool" };
    if (!finite(by.x, by.y, target.x, target.y) || Math.hypot(by.x - target.x, by.y - target.y) > reach) {
      return { ok: false, reason: "far" };
    }
    if (this.recentHits(target.id, now).length >= TARGET_CAP) return { ok: false, reason: "capped" };
    return null;
  }

  private recentHits(targetId: string, now: number): number[] {
    const list = (this.hits.get(targetId) || []).filter((at) => now - at < TARGET_WINDOW_MS);
    if (list.length) this.hits.set(targetId, list);
    else this.hits.delete(targetId);
    return list;
  }

  private spend(by: string, toy: ToyId, targetId: string, now: number) {
    this.last.set(`${by}:${toy}`, now);
    const list = this.recentHits(targetId, now);
    list.push(now);
    this.hits.set(targetId, list);
  }

  /** Hammer bonk or pillow hit. */
  hit(by: Body, target: Body | null, toy: "hammer" | "pillow", now: number): { ok: true; to: string } | Fail {
    const reach = by.r + (target?.r ?? 0) + HIT_GAP;
    const fail = this.gate(by, target, toy, reach, now);
    if (fail || !target) return fail || { ok: false, reason: "none" };
    this.spend(by.id, toy, target.id, now);
    return { ok: true, to: target.id };
  }

  throwBall(
    by: Body,
    target: Body | null,
    now: number,
    dropFor: (target: Body, nx: number, ny: number) => Anchor,
  ): { ok: true; to: string; ms: number; drop: Anchor; combo: number } | Fail {
    const fail = this.gate(by, target, "ball", THROW_REACH, now);
    if (fail || !target) return fail || { ok: false, reason: "none" };
    if (this.flight) return { ok: false, reason: "busy" };
    this.spend(by.id, "ball", target.id, now);
    const drop = dropFor(target, target.x - by.x, target.y - by.y);
    this.places.set("ball", { at: "air" });
    this.flight = { by: by.id, to: target.id, t0: now, until: now + BALL_FLIGHT_MS + CATCH_GRACE_MS, drop, combo: this.combo };
    return { ok: true, to: target.id, ms: BALL_FLIGHT_MS, drop, combo: this.combo };
  }

  catchBall(playerId: string, now: number, holdingSnack = false): { ok: true; combo: number; by: string } | Fail {
    const flight = this.flight;
    if (!flight || flight.to !== playerId) return { ok: false, reason: "none" };
    if (holdingSnack) return { ok: false, reason: "snack" };
    if (now < flight.t0 + CATCH_OPEN_MS) return { ok: false, reason: "early" };
    if (now > flight.until) return { ok: false, reason: "late" };
    this.flight = null;
    const held = this.hand(playerId);
    if (held) this.places.set(held, { at: "rack" });
    this.places.set("ball", { at: "hand", id: playerId });
    this.combo = flight.combo + 1;
    return { ok: true, combo: this.combo, by: flight.by };
  }

  /** Ends whatever ran out of time: an uncaught ball drops, a pinch held too long lets go. */
  settle(now: number): { dropped: (Anchor & { to: string }) | null; pinch: Pinch | null } {
    let dropped: (Anchor & { to: string }) | null = null;
    let pinch: Pinch | null = null;
    if (this.flight && now > this.flight.until) {
      dropped = { ...this.flight.drop, to: this.flight.to };
      this.places.set("ball", { at: "floor", x: this.flight.drop.x, y: this.flight.drop.y });
      this.flight = null;
      this.combo = 0;
    }
    if (this.pinch && now >= this.pinch.until) {
      pinch = this.pinch;
      this.pinch = null;
    }
    return { dropped, pinch };
  }

  nextDeadline(): number | null {
    const times = [this.flight?.until, this.pinch?.until].filter((value): value is number => typeof value === "number");
    return times.length ? Math.min(...times) : null;
  }

  plane(by: Body, target: Body | null, text: string | null, now: number): { ok: true; to: string } | Fail {
    if (!text) return { ok: false, reason: "empty" };
    const fail = this.gate(by, target, "plane", PLANE_REACH, now);
    if (fail || !target) return fail || { ok: false, reason: "none" };
    this.spend(by.id, "plane", target.id, now);
    return { ok: true, to: target.id };
  }

  pinchStart(by: Body, target: Body | null, now: number): { ok: true; to: string; ms: number } | Fail {
    const reach = by.r + (target?.r ?? 0) + HIT_GAP;
    const fail = this.gate(by, target, "pinch", reach, now);
    if (fail || !target) return fail || { ok: false, reason: "none" };
    if (this.pinch) return { ok: false, reason: "busy" };
    this.spend(by.id, "pinch", target.id, now);
    this.pinch = { by: by.id, to: target.id, until: now + PINCH_MAX_MS };
    return { ok: true, to: target.id, ms: PINCH_MAX_MS };
  }

  pinchEnd(playerId: string): Pinch | null {
    if (!this.pinch || this.pinch.by !== playerId) return null;
    const ended = this.pinch;
    this.pinch = null;
    return ended;
  }

  /**
   * Running into someone with the bumper car. The knockback spot comes from `find`, which must
   * only return a position whose whole path is clear; null means the target just wobbles.
   */
  ram(
    by: Body,
    target: Body | null,
    now: number,
    find: (target: Body, nx: number, ny: number) => Anchor | null,
  ): { ok: true; to: string; spot: Anchor | null; nx: number; ny: number } | Fail {
    const reach = by.r + (target?.r ?? 0) + RAM_GAP;
    if (by.seated) return { ok: false, reason: "seated" };
    const fail = this.gate(by, target, "ram", reach, now);
    if (fail || !target) return fail || { ok: false, reason: "none" };
    if (target.seated) return { ok: false, reason: "seated" };
    if (!this.running(by.id, now)) return { ok: false, reason: "walking" };
    this.spend(by.id, "ram", target.id, now);
    let nx = target.x - by.x;
    let ny = target.y - by.y;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const prev = this.knocked.get(target.id);
    if (prev != null && now - prev < KNOCK_WINDOW_MS) return { ok: true, to: target.id, spot: null, nx, ny };
    const spot = find(target, nx, ny);
    if (spot) this.knocked.set(target.id, now);
    return { ok: true, to: target.id, spot, nx, ny };
  }
}
