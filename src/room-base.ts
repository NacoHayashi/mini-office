// Shared room state, storage, and the small helpers every other room file uses.
import {
  buildOffice,
  hitsWall,
  type Look,
  normalizeLook,
  type OfficeMap,
  presetLook,
  readStoredLook,
  scoreSpecs,
  WALL_RADIUS,
} from "./content";
import { SnackRoom } from "./snacks";
import { STALL_META, StallDoors } from "./stalls";
import { TOY_META, ToyRoom } from "./toys";
import { readMeta, sha256, writeMeta } from "./crypto";
import { type OfficeSql, runMigrations } from "./migrations";
import { AUTH_LIMIT, AUTH_WINDOW_MS } from "./pairing";

export interface Env {
  OFFICE: DurableObjectNamespace;
  ASSETS: Fetcher;
  APP_SEED?: string;
  APP_SLUG?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_BOT_USERNAME?: string;
}

export type MemberRow = {
  id: string;
  display_name: string;
  animal: string | null;
  accessories: string;
  pos_x: number;
  pos_y: number;
  pos_dir: number;
  created_at: number;
};

export type Att = {
  id: string;
  name: string;
  animal: string;
  look: Look;
  x: number;
  y: number;
  dir: number;
  editing: boolean;
  seat: string | null;
  whisper: string | null;
  lastMove: number;
  lastFace: number;
  lastChat: number;
  lastStall?: number;
  lastReset?: number;
  knockAt?: number;
  lastPersist: number;
  deviceKey: string;
  session: string;
  guest?: boolean;
};

// A member who has not picked an animal yet keeps a socket open only to send
// that first choice. It is not in the room until the choice is saved.
export type Pending = {
  setup: true;
  id: string;
  deviceKey: string;
  session: string;
};

export type ChairLive = {
  id: string;
  /** "chair" rolls around; "stool" is fixed in place. */
  kind: string;
  x: number;
  y: number;
  rot: number;
  vx: number;
  vy: number;
  occupant: string | null;
  lastNet: number;
  lastSave: number;
};

export type ByeReason = "removed" | "kicked" | "password" | "replaced" | "elsewhere" | "logout" | "device" | "restored" | "upgraded";

export const OFFICE = buildOffice();

export function readHeading(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.atan2(Math.sin(value), Math.cos(value));
}

export function packHeading(radians: number): number {
  const deg = Math.round((radians * 180) / Math.PI);
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped + 360;
}

export function unpackHeading(stored: number): number {
  if (stored === -1) return Math.PI;
  if (!Number.isFinite(stored) || stored === 0 || stored === 1) return 0;
  const deg = stored >= 360 && stored < 720 ? stored - 360 : ((stored % 360) + 360) % 360;
  return (deg * Math.PI) / 180;
}
export const MAX_MEMBERS = 40;
export const WHISPER_NEAR = 112;
export const WHISPER_FAR = 176;
export const WHISPER_CAP = 6;
export const WHISPER_ASK_MS = 12000;

export const SESSION_COOKIE = "office_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function bearer(request: Request): string {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (!text) return {};
  if (text.length > 8000) return null;
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function sessionHash(token: string): Promise<string> {
  return `sha256:${await sha256(token)}`;
}

export function incomingLook(body: Record<string, unknown>, animal: string | null): Look | null {
  if (body.look !== undefined) return normalizeLook(body.look);
  if (typeof body.animal === "string") {
    const preset = presetLook(body.animal);
    if (!preset) return null;
    return preset;
  }
  if (animal) return readStoredLook(animal, null);
  return null;
}

export const SCORE_GAMES = scoreSpecs();
export const FURN_MOVE_MS = 150;
export const GLIDE_SAVE_MS = 4000;
export const RESET_COOLDOWN_MS = 1500;
export const WS_MAX_CHARS = 4096;
export const WS_BURST = 30;
export const WS_BURST_MS = 1000;

export abstract class RoomBase {
  protected abstract loadSnacks(): void;
  protected abstract restoreOccupants(): void;

  protected readonly map: OfficeMap = OFFICE;
  protected readonly chairs = new Map<string, ChairLive>();
  protected readonly bumpAt = new Map<string, number>();
  protected readonly whisperAsks = new Map<string, { group: string; until: number }>();
  protected readonly msgHits = new Map<string, number[]>();
  protected readonly furnMoveAt = new Map<string, number>();
  protected readonly snacks = new SnackRoom();
  protected readonly stalls = new StallDoors();
  protected readonly toys = new ToyRoom();
  protected toyTimer: ReturnType<typeof setTimeout> | null = null;
  protected chairsReady = false;

  constructor(
    protected readonly ctx: DurableObjectState,
    env: Env,
  ) {
    void env;
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      await this.bootStorage();
    });
  }

  protected get sql() {
    return this.ctx.storage.sql;
  }

  protected async bootStorage() {
    await runMigrations(this.officeSql(), this.map.furniture, sha256);
    this.loadSnacks();
    this.toys.load(this.meta(TOY_META));
    this.stalls.load(this.meta(STALL_META));
    this.restoreOccupants();
    this.sweepLimits();
  }

  protected officeSql(): OfficeSql {
    return {
      exec: (query, ...bindings) => {
        const cursor = this.sql.exec(query, ...bindings);
        return {
          toArray: () => cursor.toArray() as Array<Record<string, unknown>>,
          one: () => (cursor.one() as Record<string, unknown> | undefined) ?? null,
        };
      },
      transaction: (run) => {
        this.ctx.storage.transactionSync(run);
      },
    };
  }


  protected meta(key: string): string | null {
    return readMeta(this.officeSql(), key);
  }

  protected setMeta(key: string, value: string) {
    writeMeta(this.officeSql(), key, value);
  }

  protected epoch(): number {
    return Number(this.meta("epoch") || "1");
  }

  protected clientIp(request: Request): string {
    return (request.headers.get("x-office-ip") || "local").slice(0, 80);
  }

  protected lastSweep = 0;

  protected sweepLimits(now = Date.now()) {
    if (this.lastSweep && now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    this.sql.exec(`DELETE FROM score_hits WHERE at < ?`, now - 60_000);
    this.sql.exec(`DELETE FROM admin_sessions WHERE expires_at <= ?`, now);
  }

  protected failureLimited(kind: string, subject: string): boolean {
    const since = Date.now() - AUTH_WINDOW_MS;
    this.sweepLimits();
    this.sql.exec(`DELETE FROM auth_failures WHERE at < ?`, since);
    const row = this.sql
      .exec<{ n: number }>(
        `SELECT COUNT(*) AS n FROM auth_failures WHERE kind = ? AND subject = ? AND at >= ?`,
        kind,
        subject,
        since,
      )
      .one();
    return Number(row?.n ?? 0) >= AUTH_LIMIT;
  }

  protected noteFailure(kind: string, subject: string) {
    this.sql.exec(`INSERT INTO auth_failures (kind, subject, at) VALUES (?, ?, ?)`, kind, subject, Date.now());
  }

  protected clearFailures(kind: string, subject: string) {
    this.sql.exec(`DELETE FROM auth_failures WHERE kind = ? AND subject = ?`, kind, subject);
  }

  protected persist(att: Att) {
    this.sql.exec(
      `UPDATE members SET pos_x = ?, pos_y = ?, pos_dir = ? WHERE id = ?`,
      att.x,
      att.y,
      packHeading(att.dir),
      att.id,
    );
  }

  protected inWall(x: number, y: number): boolean {
    return hitsWall(this.map.walls, x, y, WALL_RADIUS);
  }

  protected allowBurst(id: string): boolean {
    const now = Date.now();
    const hits = (this.msgHits.get(id) || []).filter((at) => now - at < WS_BURST_MS);
    if (hits.length >= WS_BURST) {
      this.msgHits.set(id, hits);
      return false;
    }
    hits.push(now);
    this.msgHits.set(id, hits);
    return true;
  }

  protected memberByDevice(deviceKey: string): MemberRow | null {
    const rows = this.sql
      .exec<MemberRow>(
        `SELECT m.* FROM member_devices d JOIN members m ON m.id = d.member_id WHERE d.device_key = ?`,
        deviceKey.toLowerCase(),
      )
      .toArray();
    return rows[0] ?? null;
  }

  protected memberById(id: string): MemberRow | null {
    const rows = this.sql.exec<MemberRow>(`SELECT * FROM members WHERE id = ?`, id).toArray();
    return rows[0] ?? null;
  }

  protected profile(member: MemberRow) {
    return {
      id: member.id,
      displayName: member.display_name,
      animal: member.animal,
      look: readStoredLook(member.animal, member.accessories),
    };
  }

  protected player(att: Att) {
    return {
      id: att.id,
      displayName: att.name,
      animal: att.animal,
      look: att.look,
      seat: att.seat,
      x: att.x,
      y: att.y,
      dir: att.dir,
    };
  }

  protected goodbye(ws: WebSocket, reason: ByeReason) {
    const code = {
      removed: 4001,
      kicked: 4002,
      password: 4003,
      restored: 4007,
      replaced: 4000,
      elsewhere: 4004,
      logout: 4005,
      device: 4006,
      upgraded: 4008,
    }[reason];
    try {
      ws.send(JSON.stringify({ t: "bye", reason }));
    } catch {
      /* ignore */
    }
    try {
      ws.close(code, reason);
    } catch {
      /* ignore */
    }
  }

  protected socketOf(id: string): { ws: WebSocket; att: Att } | null {
    for (const ws of this.ctx.getWebSockets(id)) {
      const att = this.attOf(ws);
      if (att) return { ws, att };
    }
    return null;
  }

  protected attOf(ws: WebSocket): Att | null {
    const held = ws.deserializeAttachment() as Att | Pending | null;
    return held && !("setup" in held) ? held : null;
  }

  protected broadcast(data: unknown, except?: WebSocket) {
    const text = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || !this.attOf(ws)) continue;
      try {
        ws.send(text);
      } catch {
        /* ignore */
      }
    }
  }

  protected send(ws: WebSocket, data: unknown) {
    try {
      ws.send(JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }
}
