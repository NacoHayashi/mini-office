import {
  acceptScore,
  admitScoreHit,
  avatarAnimal,
  bodyRadiusOf,
  buildOffice,
  catalog,
  checkId,
  checkNewPassword,
  checkPassword,
  chairHomeRotation,
  furnitureFits,
  furnitureSize,
  hitsSolid,
  hitsWall,
  quarterRot,
  isRestroom,
  normalizeChat,
  normalizeLook,
  normalizeName,
  palette,
  presetLook,
  publicMap,
  readStoredLook,
  restoreChairOccupants,
  scorePace,
  scoreSpecs,
  WALL_RADIUS,
  type Furn,
  type Look,
  type OfficeMap,
} from "./content";
import { HANDS_META, isFixedId, isFixedKind, MACHINE_ID, SnackRoom, SNACK_META, type SnackMachine } from "./snacks";
import { STALL_COOLDOWN_MS, STALL_META, StallDoors } from "./stalls";
import { adminSessionHash, adminSessionRecord, adminSessionState } from "./admin-session";
import { passwordHash, passwordVerdict, randomToken, readMeta, sha256, writeMeta } from "./crypto";
import { json, readCookie } from "./http";
import { reply, requestBody, requestId, requestKind, type Outcome, type RequestKind } from "./requests";
import {
  clearLiveOffice,
  deleteMemberData,
  exportOffice,
  restoreOffice,
  runMigrations,
  type OfficeSql,
} from "./migrations";
import {
  AUTH_LIMIT,
  AUTH_WINDOW_MS,
  freshPair,
  hashPairCode,
  judgePair,
  normalizeDeviceKey,
  normalizePairCode,
  randomPairCode,
} from "./pairing";

export interface Env {
  OFFICE: DurableObjectNamespace;
  ASSETS: Fetcher;
  APP_SEED?: string;
  APP_SLUG?: string;
}

type MemberRow = {
  id: string;
  display_name: string;
  animal: string | null;
  accessories: string;
  pos_x: number;
  pos_y: number;
  pos_dir: number;
  created_at: number;
};

type Att = {
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
  lastPersist: number;
  deviceKey: string;
  session: string;
};

// A member who has not picked an animal yet keeps a socket open only to send
// that first choice. It is not in the room until the choice is saved.
type Pending = {
  setup: true;
  id: string;
  deviceKey: string;
  session: string;
};

type ChairLive = {
  id: string;
  x: number;
  y: number;
  rot: number;
  vx: number;
  vy: number;
  occupant: string | null;
  lastNet: number;
  lastSave: number;
};

type ByeReason = "removed" | "kicked" | "password" | "replaced" | "elsewhere" | "logout" | "device" | "restored";

const OFFICE = buildOffice();

function readHeading(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function packHeading(radians: number): number {
  const deg = Math.round((radians * 180) / Math.PI);
  const wrapped = ((deg % 360) + 360) % 360;
  return wrapped + 360;
}

function unpackHeading(stored: number): number {
  if (stored === -1) return Math.PI;
  if (!Number.isFinite(stored) || stored === 0 || stored === 1) return 0;
  const deg = stored >= 360 && stored < 720 ? stored - 360 : ((stored % 360) + 360) % 360;
  return (deg * Math.PI) / 180;
}
const MAX_MEMBERS = 40;
const WHISPER_NEAR = 112;
const WHISPER_FAR = 176;
const WHISPER_CAP = 6;
const WHISPER_ASK_MS = 12000;

const SESSION_COOKIE = "office_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}`;
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function bearer(request: Request): string {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
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

async function sessionHash(token: string): Promise<string> {
  return `sha256:${await sha256(token)}`;
}

function incomingLook(body: Record<string, unknown>, animal: string | null): Look | null {
  if (body.look !== undefined) return normalizeLook(body.look);
  if (typeof body.animal === "string") {
    const preset = presetLook(body.animal);
    if (!preset) return null;
    return preset;
  }
  if (animal) return readStoredLook(animal, null);
  return null;
}

const SCORE_GAMES = scoreSpecs();
const FURN_MOVE_MS = 150;
const GLIDE_SAVE_MS = 4000;
const RESET_COOLDOWN_MS = 1500;
const WS_MAX_CHARS = 4096;
const WS_BURST = 30;
const WS_BURST_MS = 1000;

export class OfficeRoom implements DurableObject {
  private readonly map: OfficeMap = OFFICE;
  private readonly chairs = new Map<string, ChairLive>();
  private readonly bumpAt = new Map<string, number>();
  private readonly whisperAsks = new Map<string, { group: string; until: number }>();
  private readonly msgHits = new Map<string, number[]>();
  private readonly furnMoveAt = new Map<string, number>();
  private readonly snacks = new SnackRoom();
  private readonly stalls = new StallDoors();
  private chairsReady = false;

  constructor(
    private readonly ctx: DurableObjectState,
    env: Env,
  ) {
    void env;
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.blockConcurrencyWhile(async () => {
      await this.bootStorage();
    });
  }

  private get sql() {
    return this.ctx.storage.sql;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/api/office/status" && request.method === "GET") return this.status();
      if (path === "/api/office/login" && request.method === "POST") return await this.login(request);
      if (path === "/api/office/register" && request.method === "POST") return await this.register(request);
      if (path === "/api/office/pair" && request.method === "POST") return await this.pair(request);
      if (path === "/api/office/pair/code" && request.method === "POST") return await this.pairCode(request);
      if (path === "/api/office/session" && request.method === "POST") return await this.adoptSession(request);
      if (path === "/api/office/logout" && request.method === "POST") return await this.logout(request);
      if (path === "/api/office/me" && request.method === "GET") return await this.me(request);
      if (path === "/api/office/ws" && request.method === "GET") return await this.upgrade(request);
      if (path === "/api/office/admin/gate" && request.method === "POST") return await this.adminGate(request);
      if (path === "/api/office/admin/session/check" && request.method === "POST") return await this.adminSessionCheck(request);
      if (path === "/api/office/admin/session/drop" && request.method === "POST") return await this.adminSessionDrop(request);
      if (path.startsWith("/api/office/admin/")) return await this.admin(request, path);
      return json({ error: "找不到" }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: "辦公室暫時沒有回應" }, 500);
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message === "ping") return;
    if (message.length > WS_MAX_CHARS) return;
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(message) as unknown;
      if (!parsed || typeof parsed !== "object") return;
      body = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    const held = ws.deserializeAttachment() as Att | Pending | null;
    if (!held) {
      try {
        ws.close(4001, "missing");
      } catch {
        /* ignore */
      }
      return;
    }
    const ask = requestKind(body.t);
    const rid = ask ? requestId(body.rid) : null;
    if (!this.allowBurst(held.id)) {
      if (rid) this.send(ws, reply(rid, { status: 429, data: { error: "太快了，稍等一下" } }));
      return;
    }
    if ("setup" in held && !ask) return;
    this.restoreOccupants();
    if (ask) {
      if (rid) this.onRequest(ws, held, ask, rid, body.body);
      return;
    }
    if ("setup" in held) return;
    const att = held;
    const kind = body.t;
    if (kind === "move") this.onMove(ws, att, body);
    else if (kind === "face") this.onFace(ws, att, body);
    else if (kind === "chat") this.onChat(ws, att, body);
    else if (kind === "hush") this.onHush(ws, att, body);
    else if (kind === "profile") this.onProfile(ws, att, body);
    else if (kind === "edit") this.onEdit(ws, att, body);
    else if (kind === "furn") this.onFurniture(ws, att, body);
    else if (kind === "bump") this.onBump(ws, att, body);
    else if (kind === "sit") this.onSit(ws, att, body);
    else if (kind === "rise") this.onRise(ws, att);
    else if (kind === "glide") this.onGlide(ws, att, body);
    else if (kind === "snack") this.onSnack(ws, att, body);
    else if (kind === "stall") this.onStall(ws, att, body);
    else if (kind === "reset") this.onReset(ws, att);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const att = this.attOf(ws);
    if (!att) return;
    const still = this.ctx.getWebSockets(att.id).some((other) => other !== ws);
    if (still) return;
    this.releaseSeat(att.id);
    if (this.snacks.release(att.id)) this.rememberHands();
    this.dropWhisper(att, ws);
    this.persist(att);
    this.broadcast({ t: "leave", id: att.id });
    if (this.ctx.getWebSockets().every((socket) => socket === ws)) this.resetChairs(true);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, "error");
    } catch {
      /* ignore */
    }
  }

  private async bootStorage() {
    await runMigrations(this.officeSql(), this.map.furniture, sha256);
    this.loadSnacks();
    this.stalls.load(this.meta(STALL_META));
    this.restoreOccupants();
    this.sweepLimits();
  }

  private officeSql(): OfficeSql {
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


  private meta(key: string): string | null {
    return readMeta(this.officeSql(), key);
  }

  private setMeta(key: string, value: string) {
    writeMeta(this.officeSql(), key, value);
  }

  private storePasswordHash(stored: { salt: string; hash: string; iters: string }) {
    this.setMeta("pw_salt", stored.salt);
    this.setMeta("pw_hash", stored.hash);
    this.setMeta("pw_kdf", "pbkdf2");
    this.setMeta("pw_iters", stored.iters);
  }

  private epoch(): number {
    return Number(this.meta("epoch") || "1");
  }

  private hasPassword(): boolean {
    return Boolean(this.meta("pw_hash") && this.meta("pw_salt"));
  }

  private async passwordOk(password: string): Promise<"legacy" | "current" | false> {
    return passwordVerdict(password, {
      salt: this.meta("pw_salt"),
      hash: this.meta("pw_hash"),
      kdf: this.meta("pw_kdf"),
      iters: this.meta("pw_iters"),
    });
  }

  private async upgradePassword(password: string) {
    const stored = await passwordHash(password);
    this.ctx.storage.transactionSync(() => {
      this.storePasswordHash(stored);
    });
  }

  private async verifyOfficePassword(
    request: Request,
    kind: "login" | "register" | "pair",
  ): Promise<
    | { ok: true; body: Record<string, unknown>; ip: string; password: string; legacy: boolean }
    | { ok: false; response: Response }
  > {
    if (!this.hasPassword()) return { ok: false, response: json({ error: "管理員還沒設定辦公室密碼" }, 503) };
    const ip = this.clientIp(request);
    if (this.failureLimited(kind, ip)) return { ok: false, response: json({ error: "嘗試太多次，請稍後再試" }, 429) };
    const body = await readJson(request);
    if (!body) return { ok: false, response: json({ error: "格式不對" }, 400) };
    const password = checkPassword(body.password);
    if (!password.ok) {
      this.noteFailure(kind, ip);
      return { ok: false, response: json({ error: "密碼不正確" }, 401) };
    }
    const verdict = await this.passwordOk(password.password);
    if (!verdict) {
      this.noteFailure(kind, ip);
      return { ok: false, response: json({ error: "密碼不正確" }, 401) };
    }
    return { ok: true, body, ip, password: password.password, legacy: verdict === "legacy" };
  }

  private clientIp(request: Request): string {
    return (request.headers.get("x-office-ip") || "local").slice(0, 80);
  }

  private lastSweep = 0;

  private sweepLimits(now = Date.now()) {
    if (this.lastSweep && now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    this.sql.exec(`DELETE FROM score_hits WHERE at < ?`, now - 60_000);
    this.sql.exec(`DELETE FROM admin_sessions WHERE expires_at <= ?`, now);
  }

  private failureLimited(kind: string, subject: string): boolean {
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

  private noteFailure(kind: string, subject: string) {
    this.sql.exec(`INSERT INTO auth_failures (kind, subject, at) VALUES (?, ?, ?)`, kind, subject, Date.now());
  }

  private clearFailures(kind: string, subject: string) {
    this.sql.exec(`DELETE FROM auth_failures WHERE kind = ? AND subject = ?`, kind, subject);
  }

  private status(): Response {
    return json({ hasPassword: this.hasPassword() });
  }

  private async login(request: Request): Promise<Response> {
    const gate = await this.verifyOfficePassword(request, "login");
    if (!gate.ok) return gate.response;
    this.clearFailures("login", gate.ip);
    if (gate.legacy) await this.upgradePassword(gate.password);
    const deviceKey = normalizeDeviceKey(gate.body.deviceKey);
    if (!deviceKey) return json({ ok: true, needsRegistration: true, catalog: catalog() });
    const found = this.memberByDevice(deviceKey);
    if (!found) return json({ ok: true, needsRegistration: true, catalog: catalog() });
    const token = await this.issueSession(found.id, deviceKey);
    const fresh = this.memberById(found.id);
    return json(
      { profile: fresh ? this.profile(fresh) : this.profile(found), catalog: catalog() },
      200,
      { "set-cookie": sessionCookie(token) },
    );
  }

  private async register(request: Request): Promise<Response> {
    const gate = await this.verifyOfficePassword(request, "register");
    if (!gate.ok) return gate.response;
    this.clearFailures("register", gate.ip);
    if (gate.legacy) await this.upgradePassword(gate.password);
    const body = gate.body;
    const deviceKey = normalizeDeviceKey(body.deviceKey);
    if (!deviceKey) return json({ error: "裝置驗證失敗，請重新整理" }, 400);
    if (this.memberByDevice(deviceKey)) return json({ error: "這台裝置已經登記過了" }, 409);
    const id = checkId(body.id);
    if (!id.ok) return json({ error: id.error }, 400);
    const displayName = normalizeName(body.displayName);
    if (!displayName) return json({ error: "請輸入顯示名稱" }, 400);
    if (this.memberById(id.id)) return json({ error: "這個 ID 已經有人使用" }, 409);
    const count = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM members`).one();
    if (Number(count?.n ?? 0) >= MAX_MEMBERS) return json({ error: "辦公室人數已滿" }, 400);
    const spot = this.spawnFor(id.id);
    const now = Date.now();
    const token = randomToken(32);
    const stored = `sha256:${await sha256(token)}`;
    const epoch = this.epoch();
    this.sql.exec(
      `INSERT INTO members
        (id, display_name, animal, accessories, pos_x, pos_y, pos_dir, created_at)
       VALUES (?, ?, NULL, '{}', ?, ?, 1, ?)`,
      id.id,
      displayName,
      spot.x,
      spot.y,
      now,
    );
    this.bindDevice(id.id, deviceKey, now);
    this.sql.exec(
      `INSERT INTO member_sessions (token_hash, member_id, device_key, epoch, created_at) VALUES (?, ?, ?, ?, ?)`,
      stored,
      id.id,
      deviceKey,
      epoch,
      now,
    );
    const member = this.memberById(id.id);
    if (!member) return json({ error: "登記失敗" }, 500);
    return json({ profile: this.profile(member), catalog: catalog() }, 200, { "set-cookie": sessionCookie(token) });
  }

  private async pairCode(request: Request): Promise<Response> {
    await readJson(request);
    const member = await this.memberFromCookie(request);
    if (!member) return this.unauthorized(request);
    const code = randomPairCode();
    const ticket = freshPair(await hashPairCode(code), Date.now());
    this.sql.exec(`DELETE FROM pair_codes WHERE member_id = ?`, member.id);
    this.sql.exec(
      `INSERT INTO pair_codes (member_id, code_hash, expires_at) VALUES (?, ?, ?)`,
      member.id,
      ticket.hash,
      ticket.expiresAt,
    );
    return json({ code });
  }

  private async pair(request: Request): Promise<Response> {
    const gate = await this.verifyOfficePassword(request, "pair");
    if (!gate.ok) return gate.response;
    if (gate.legacy) await this.upgradePassword(gate.password);
    const body = gate.body;
    const deviceKey = normalizeDeviceKey(body.deviceKey);
    if (!deviceKey) return json({ error: "裝置驗證失敗，請重新整理" }, 400);
    if (this.memberByDevice(deviceKey)) return json({ error: "這台裝置已經登記過了" }, 409);
    const id = checkId(body.id);
    if (!id.ok) return json({ error: id.error }, 400);
    const subject = `id:${id.id}`;
    if (this.failureLimited("pair", subject)) return json({ error: "嘗試太多次，請稍後再試" }, 429);
    const member = this.memberById(id.id);
    const code = normalizePairCode(body.code);
    const submitted = await hashPairCode(code || "000000");
    const rows = member
      ? this.sql
          .exec<{ code_hash: string; expires_at: number }>(
            `SELECT code_hash, expires_at FROM pair_codes WHERE member_id = ?`,
            member.id,
          )
          .toArray()
      : [];
    const ticket = rows[0] ? { hash: rows[0].code_hash, expiresAt: Number(rows[0].expires_at) } : null;
    const result = judgePair(member ? ticket : null, submitted, Date.now());
    if (!member || result !== "ok") {
      this.noteFailure("pair", gate.ip);
      this.noteFailure("pair", subject);
      return json({ error: "代碼不正確或已失效" }, 401);
    }
    this.clearFailures("pair", gate.ip);
    this.clearFailures("pair", subject);
    const now = Date.now();
    this.sql.exec(`DELETE FROM pair_codes WHERE member_id = ?`, member.id);
    this.bindDevice(member.id, deviceKey, now);
    const token = await this.issueSession(member.id, deviceKey);
    const fresh = this.memberById(member.id);
    return json(
      { profile: fresh ? this.profile(fresh) : this.profile(member), catalog: catalog() },
      200,
      { "set-cookie": sessionCookie(token) },
    );
  }

  private bindDevice(memberId: string, deviceKey: string, now: number) {
    this.sql.exec(
      `INSERT INTO member_devices (id, device_key, member_id, created_at, last_seen) VALUES (?, ?, ?, ?, ?)`,
      randomToken(8),
      deviceKey,
      memberId,
      now,
      now,
    );
  }

  private async adoptSession(request: Request): Promise<Response> {
    await readJson(request);
    const token = bearer(request);
    const member = await this.memberByToken(token);
    if (!member) return json({ error: "登入已失效" }, 401);
    return json({ profile: this.profile(member), catalog: catalog() }, 200, { "set-cookie": sessionCookie(token) });
  }

  private async logout(request: Request): Promise<Response> {
    await readJson(request);
    const token = readCookie(request, SESSION_COOKIE);
    const member = token ? await this.memberByToken(token) : null;
    if (member) {
      this.broadcast({ t: "notice", text: `${member.display_name} 下班了` });
      this.dropSessions(member.id);
      for (const ws of this.ctx.getWebSockets(member.id)) this.goodbye(ws, "logout");
    }
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }

  private unauthorized(request: Request): Response {
    const extra = readCookie(request, SESSION_COOKIE) ? { "set-cookie": clearSessionCookie() } : undefined;
    return json({ error: "登入已失效" }, 401, extra);
  }

  private async memberFromCookie(request: Request): Promise<(MemberRow & { bound_device: string }) | null> {
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) return null;
    return this.memberByToken(token);
  }

  private async me(request: Request): Promise<Response> {
    const member = await this.memberFromCookie(request);
    if (!member) return this.unauthorized(request);
    return json({ profile: this.profile(member), catalog: catalog() });
  }

  private firstLook(member: MemberRow, body: Record<string, unknown> | null): Outcome {
    if (!body) return { status: 400, data: { error: "格式不對" } };
    if (body.displayName !== undefined) {
      const name = normalizeName(body.displayName);
      if (!name) return { status: 400, data: { error: "顯示名稱不可空白" } };
      this.sql.exec(`UPDATE members SET display_name = ? WHERE id = ?`, name, member.id);
    }
    if (body.animal !== undefined || body.look !== undefined) {
      if (member.animal) return { status: 403, data: { error: "請到男廁或女廁更換造型" } };
      const look = incomingLook(body, null);
      if (!look) return { status: 400, data: { error: "造型不正確" } };
      const animal = avatarAnimal(body.animal, look);
      this.sql.exec(
        `UPDATE members SET animal = ?, accessories = ? WHERE id = ?`,
        animal,
        JSON.stringify(look),
        member.id,
      );
    }
    const fresh = this.memberById(member.id);
    return { status: 200, data: { profile: fresh ? this.profile(fresh) : this.profile(member), catalog: catalog() } };
  }

  private async upgrade(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "需要 WebSocket" }, 426);
    }
    const token = readCookie(request, SESSION_COOKIE);
    const session = token ? await sessionHash(token) : "";
    const member = this.memberBySession(session);
    if (!member) return this.unauthorized(request);
    const deviceKey = member.bound_device;
    if (member.animal && !readStoredLook(member.animal, member.accessories)) return json({ error: "請先選擇造型" }, 403);
    for (const old of this.ctx.getWebSockets(member.id)) {
      const previous = old.deserializeAttachment() as Att | null;
      this.goodbye(old, previous?.deviceKey === deviceKey ? "replaced" : "elsewhere");
    }
    this.sql.exec(`UPDATE member_devices SET last_seen = ? WHERE device_key = ?`, Date.now(), deviceKey);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [member.id]);
    if (member.animal) this.enter(server, member, session);
    else {
      const pending: Pending = { setup: true, id: member.id, deviceKey, session };
      server.serializeAttachment(pending);
      this.send(server, { t: "setup" });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private enter(server: WebSocket, member: MemberRow & { bound_device: string }, session: string) {
    const look = readStoredLook(member.animal, member.accessories);
    if (!member.animal || !look) return;
    const spot = this.separateFrom(member.id, member.pos_x, member.pos_y, look);
    if (spot.x !== member.pos_x || spot.y !== member.pos_y) {
      this.sql.exec(`UPDATE members SET pos_x = ?, pos_y = ? WHERE id = ?`, spot.x, spot.y, member.id);
    }
    const att: Att = {
      id: member.id,
      name: member.display_name,
      animal: member.animal,
      look,
      x: spot.x,
      y: spot.y,
      dir: unpackHeading(Number(member.pos_dir)),
      lastFace: 0,
      editing: false,
      seat: null,
      whisper: null,
      lastMove: 0,
      lastChat: 0,
      lastPersist: Date.now(),
      deviceKey: member.bound_device,
      session,
    };
    server.serializeAttachment(att);
    const others = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === server) continue;
      const other = this.attOf(ws);
      if (!other || other.id === member.id) continue;
      others.push(this.player(other));
    }
    this.send(server, {
      t: "welcome",
      you: this.player(att),
      others,
      furniture: this.furniture(),
      map: publicMap(this.map),
      palette: palette(),
      catalog: catalog(),
      hush: this.activeHush(),
      stock: this.snacks.view(),
      hands: this.snacks.handsView((id) => id === member.id || this.ctx.getWebSockets(id).some((ws) => this.attOf(ws))),
      doors: this.stalls.view(),
    });
    this.broadcast({ t: "join", player: this.player(att) }, server);
    const held = this.snacks.handsView((id) => id === member.id)[0];
    if (held) this.broadcast({ t: "snacks", hold: { id: held.id, item: held.item, pose: held.pose, replaced: false } }, server);
  }

  // Socket requests get the same session check, validation and score pacing
  // the cookie routes had; the socket only replaces the transport.
  private onRequest(ws: WebSocket, held: Att | Pending, kind: RequestKind, rid: string, raw: unknown) {
    const member = this.memberBySession(held.session);
    if (!member || member.id !== held.id) {
      this.send(ws, reply(rid, { status: 401, data: { error: "登入已失效" } }));
      try {
        ws.close(1008, "session");
      } catch {
        /* ignore */
      }
      return;
    }
    const body = requestBody(raw);
    if (kind === "setup") {
      if (!("setup" in held)) {
        this.send(ws, reply(rid, { status: 403, data: { error: "請到男廁或女廁更換造型" } }));
        return;
      }
      const outcome = this.firstLook(member, body);
      this.send(ws, reply(rid, outcome));
      const fresh = outcome.status < 400 ? this.memberBySession(held.session) : null;
      if (fresh?.animal) this.enter(ws, fresh, held.session);
      return;
    }
    if ("setup" in held) {
      this.send(ws, reply(rid, { status: 403, data: { error: "請先選擇造型" } }));
      return;
    }
    this.send(ws, reply(rid, kind === "score" ? this.submitScore(member, body) : this.leaderboard(member)));
  }

  private scoreOf(memberId: string, game: string): number {
    const rows = this.sql
      .exec<{ score: number }>(`SELECT score FROM scores WHERE member_id = ? AND game = ?`, memberId, game)
      .toArray();
    return rows[0] ? Number(rows[0].score) : 0;
  }

  private allowScore(memberId: string, game: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    this.sweepLimits(now);
    const hits = this.sql
      .exec<{ at: number }>(
        `SELECT at FROM score_hits WHERE member_id = ? AND game = ? AND at >= ?`,
        memberId,
        game,
        now - windowMs,
      )
      .toArray()
      .map((row) => Number(row.at));
    if (!admitScoreHit(hits, now, limit, windowMs).ok) return false;
    this.sql.exec(`INSERT INTO score_hits (member_id, game, at) VALUES (?, ?, ?)`, memberId, game, now);
    return true;
  }

  private writeScore(memberId: string, game: string, score: number) {
    this.sql.exec(`DELETE FROM scores WHERE member_id = ? AND game = ?`, memberId, game);
    this.sql.exec(
      `INSERT INTO scores (member_id, game, score, updated_at) VALUES (?, ?, ?, ?)`,
      memberId,
      game,
      score,
      Date.now(),
    );
  }

  private submitScore(member: MemberRow, body: Record<string, unknown> | null): Outcome {
    if (!body) return { status: 400, data: { error: "格式不對" } };
    const game = typeof body.game === "string" ? body.game : "";
    const spec = SCORE_GAMES[game];
    if (!spec) return { status: 400, data: { error: "沒有這個遊戲" } };
    const current = this.scoreOf(member.id, game);
    const accepted = acceptScore(spec, current, body);
    if (!accepted.ok) return { status: 400, data: { error: "分數不對" } };
    if (!accepted.changed) return { status: 200, data: { game, score: current } };
    const pace = scorePace(spec.mode);
    if (!this.allowScore(member.id, game, pace.limit, pace.windowMs)) return { status: 429, data: { error: "太快了，稍等一下" } };
    this.writeScore(member.id, game, accepted.score);
    this.broadcast({ t: "score", game });
    return { status: 200, data: { game, score: accepted.score } };
  }

  private leaderboard(member: MemberRow): Outcome {
    const games = Object.entries(SCORE_GAMES).map(([id, spec]) => {
      const rows = this.sql
        .exec<{ member_id: string; display_name: string; score: number }>(
          `SELECT s.member_id, m.display_name, s.score
           FROM scores s JOIN members m ON m.id = s.member_id
           WHERE s.game = ?
           ORDER BY s.score DESC, s.updated_at ASC, s.member_id ASC`,
          id,
        )
        .toArray();
      const ranked = rows.map((row, index) => ({
        rank: index + 1,
        id: row.member_id,
        displayName: row.display_name,
        score: Number(row.score),
      }));
      const mine = ranked.find((row) => row.id === member.id) || null;
      return {
        id,
        title: spec.title,
        unit: spec.unit,
        top: ranked.slice(0, 10),
        me: mine ? { rank: mine.rank, score: mine.score } : null,
      };
    });
    return { status: 200, data: { games } };
  }

  private async admin(request: Request, path: string): Promise<Response> {
    // Worker secrets are not visible on this Durable Object. The top-level
    // Worker checks APP_SEED and only then sets this header.
    if (request.headers.get("x-office-admin") !== "1") {
      return json({ error: "未授權" }, 401);
    }
    if (path === "/api/office/admin/overview" && request.method === "GET") return json(this.overview());
    if (path === "/api/office/admin/export" && request.method === "GET") {
      return json(exportOffice(this.officeSql()));
    }
    if (path === "/api/office/admin/import" && request.method === "POST") return await this.importOffice(request);
    if (path === "/api/office/admin/password" && request.method === "POST") return await this.setPassword(request);
    if (path === "/api/office/admin/session/issue" && request.method === "POST") return await this.adminSessionIssue();
    if (path === "/api/office/admin/sessions/revoke" && request.method === "POST") {
      this.revokeAdminSessions();
      return json({ ok: true });
    }
    if (path === "/api/office/admin/kick" && request.method === "POST") return await this.kick(request);
    const device = path.match(/^\/api\/office\/admin\/members\/([a-z0-9_-]+)\/devices\/([a-z0-9_-]+)$/);
    if (device && request.method === "DELETE") return this.removeDevice(device[1], device[2]);
    const remove = path.match(/^\/api\/office\/admin\/members\/([a-z0-9_-]+)$/);
    if (remove && request.method === "DELETE") return this.remove(remove[1]);
    return json({ error: "找不到" }, 404);
  }

  private overview() {
    const online = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attOf(ws);
      if (att?.id) online.add(att.id);
    }
    const rows = this.sql
      .exec<MemberRow>(`SELECT id, display_name, animal FROM members ORDER BY id`)
      .toArray();
    const devices = this.sql
      .exec<{ id: string; member_id: string; created_at: number; last_seen: number }>(
        `SELECT id, member_id, created_at, last_seen FROM member_devices ORDER BY created_at ASC`,
      )
      .toArray();
    const members = rows
      .map((row) => ({
        id: row.id,
        displayName: row.display_name,
        animal: row.animal,
        online: online.has(row.id),
        devices: devices
          .filter((device) => device.member_id === row.id)
          .map((device) => ({
            id: device.id,
            createdAt: Number(device.created_at),
            lastSeen: Number(device.last_seen),
          })),
      }))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.id.localeCompare(b.id));
    return { hasPassword: this.hasPassword(), members };
  }

  private async adminSessionIssue(): Promise<Response> {
    const token = randomToken(32);
    const now = Date.now();
    const record = adminSessionRecord(await adminSessionHash(token), now);
    this.sql.exec(
      `INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)`,
      record.hash,
      record.createdAt,
      record.expiresAt,
    );
    return json({ token });
  }

  private async adminSessionCheck(request: Request): Promise<Response> {
    const body = await readJson(request);
    const token = typeof body?.token === "string" ? body.token : "";
    const state = await this.adminSessionLookup(token);
    if (state === "ok") return json({ ok: true });
    return json({ error: "未授權", reason: state }, 401);
  }

  private async adminSessionDrop(request: Request): Promise<Response> {
    const body = await readJson(request);
    const token = typeof body?.token === "string" ? body.token : "";
    if (token) {
      this.sql.exec(`DELETE FROM admin_sessions WHERE token_hash = ?`, await adminSessionHash(token));
    }
    return json({ ok: true });
  }

  private revokeAdminSessions() {
    this.sql.exec(`DELETE FROM admin_sessions`);
  }

  private async adminSessionLookup(token: string): Promise<"ok" | "expired" | "missing"> {
    if (!token) return "missing";
    const hash = await adminSessionHash(token);
    const rows = this.sql
      .exec<{ expires_at: number }>(`SELECT expires_at FROM admin_sessions WHERE token_hash = ?`, hash)
      .toArray();
    const row = rows[0];
    const state = adminSessionState(row ? { expiresAt: Number(row.expires_at) } : null, Date.now());
    if (state === "expired") this.sql.exec(`DELETE FROM admin_sessions WHERE token_hash = ?`, hash);
    return state;
  }

  private async setPassword(request: Request): Promise<Response> {
    const body = await readJson(request);
    if (!body) return json({ error: "格式不對" }, 400);
    const password = checkNewPassword(body.password);
    if (!password.ok) return json({ error: password.error }, 400);
    const stored = await passwordHash(password.password);
    const next = this.epoch() + 1;
    this.ctx.storage.transactionSync(() => {
      this.storePasswordHash(stored);
      this.setMeta("epoch", String(next));
      this.sql.exec(`DELETE FROM member_sessions`);
      this.sql.exec(`DELETE FROM pair_codes`);
      this.sql.exec(`DELETE FROM admin_sessions`);
    });
    for (const ws of this.ctx.getWebSockets()) this.goodbye(ws, "password");
    return json({ ok: true, hasPassword: true });
  }

  private async kick(request: Request): Promise<Response> {
    const body = await readJson(request);
    if (!body) return json({ error: "格式不對" }, 400);
    const id = checkId(body.id);
    if (!id.ok) return json({ error: "找不到這個 ID" }, 404);
    if (!this.memberById(id.id)) return json({ error: "找不到這個 ID" }, 404);
    this.dropSessions(id.id);
    this.sql.exec(`DELETE FROM pair_codes WHERE member_id = ?`, id.id);
    for (const ws of this.ctx.getWebSockets(id.id)) this.goodbye(ws, "kicked");
    return json({ ok: true });
  }

  private async importOffice(request: Request): Promise<Response> {
    const text = await request.text();
    if (text.length > 2_000_000) return json({ error: "備份太大" }, 400);
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      return json({ error: "備份格式不對" }, 400);
    }
    const restored = restoreOffice(this.officeSql(), raw);
    if (!restored.ok) return json({ error: restored.error }, 400);
    await runMigrations(this.officeSql(), this.map.furniture, sha256);
    this.stalls.load(this.meta(STALL_META));
    clearLiveOffice({
      chairs: this.chairs,
      bumpAt: this.bumpAt,
      whisperAsks: this.whisperAsks,
      msgHits: this.msgHits,
      furnMoveAt: this.furnMoveAt,
      setChairsReady: (ready) => {
        this.chairsReady = ready;
      },
      reloadMeta: () => this.loadSnacks(),
    });
    for (const ws of this.ctx.getWebSockets()) this.goodbye(ws, "restored");
    return json({ ok: true });
  }

  private remove(id: string): Response {
    const checked = checkId(id);
    if (!checked.ok || !this.memberById(checked.id)) return json({ error: "找不到這個 ID" }, 404);
    deleteMemberData(this.officeSql(), checked.id);
    for (const ws of this.ctx.getWebSockets(checked.id)) this.goodbye(ws, "removed");
    return json({ ok: true });
  }

  private removeDevice(memberId: string, deviceId: string): Response {
    const checked = checkId(memberId);
    if (!checked.ok) return json({ error: "找不到這個 ID" }, 404);
    const rows = this.sql
      .exec<{ device_key: string }>(
        `SELECT device_key FROM member_devices WHERE id = ? AND member_id = ?`,
        deviceId,
        checked.id,
      )
      .toArray();
    const device = rows[0];
    if (!device) return json({ error: "找不到這台裝置" }, 404);
    this.sql.exec(`DELETE FROM member_sessions WHERE device_key = ?`, device.device_key);
    this.sql.exec(`DELETE FROM member_devices WHERE id = ? AND member_id = ?`, deviceId, checked.id);
    for (const ws of this.ctx.getWebSockets(checked.id)) {
      const att = ws.deserializeAttachment() as Att | null;
      if (att?.deviceKey === device.device_key) this.goodbye(ws, "device");
    }
    return json({ ok: true });
  }

  private rejectMove(ws: WebSocket, att: Att) {
    this.send(ws, { t: "snap", x: att.x, y: att.y, dir: att.dir });
  }

  private onMove(ws: WebSocket, att: Att, body: Record<string, unknown>) {
    if (att.seat) return;
    const x = body.x;
    const y = body.y;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const now = Date.now();
    if (att.lastMove && now - att.lastMove < 30) return;
    const dt = Math.min(2, Math.max(0.04, att.lastMove ? (now - att.lastMove) / 1000 : 0.04));
    if (Math.hypot(x - att.x, y - att.y) > 340 * dt + 28 || this.inWall(x, y) || this.stalls.blocks(x, y, WALL_RADIUS)) {
      this.rejectMove(ws, att);
      return;
    }
    const heading = readHeading(body.dir);
    if (heading != null) att.dir = heading;
    att.x = x;
    att.y = y;
    att.lastMove = now;
    if (att.editing && Math.hypot(att.x - this.map.lala.x, att.y - this.map.lala.y) > 220) {
      att.editing = false;
      this.send(ws, { t: "edit", on: false });
    }
    ws.serializeAttachment(att);
    this.keepWhisper(ws, att);
    this.broadcast({ t: "move", id: att.id, x, y, dir: att.dir }, ws);
    if (now - att.lastPersist > 4000) {
      this.persist(att);
      att.lastPersist = now;
      ws.serializeAttachment(att);
    }
  }

  private onChat(ws: WebSocket, att: Att, body: Record<string, unknown>) {
    const text = normalizeChat(body.text);
    if (!text) return;
    const now = Date.now();
    if (now - att.lastChat < 350) {
      this.send(ws, { t: "error", message: "說得太快了，稍等一下" });
      return;
    }
    att.lastChat = now;
    ws.serializeAttachment(att);
    if (att.whisper || body.whisper === true) {
      const members = att.whisper ? this.membersOf(att.whisper).filter((member) => member.att.id !== att.id) : [];
      const close = members.some((member) => Math.hypot(att.x - member.att.x, att.y - member.att.y) <= WHISPER_FAR);
      if (!att.whisper || !members.length || !close) {
        if (att.whisper) this.leaveWhisper(att, ws);
        this.send(ws, { t: "error", message: "悄悄話已經結束了" });
        return;
      }
      const payload = { t: "chat", id: att.id, text, whisper: true, at: now };
      this.send(ws, payload);
      for (const member of members) this.send(member.ws, payload);
      return;
    }
    this.broadcast({ t: "chat", id: att.id, text, at: now });
  }

  private onHush(ws: WebSocket, att: Att, body: Record<string, unknown>) {
    if (body.off) {
      this.leaveWhisper(att, ws);
      return;
    }
    if (typeof body.ask === "string") {
      this.acceptWhisper(ws, att, body.ask);
      return;
    }
    const id = typeof body.id === "string" ? body.id : "";
    if (!id || id === att.id) return;
    if (att.whisper) {
      this.send(ws, { t: "error", message: "先離開現在的悄悄話" });
      return;
    }
    const other = this.socketOf(id);
    if (!other) {
      this.send(ws, { t: "error", message: "對方不在辦公室" });
      return;
    }
    if (Math.hypot(att.x - other.att.x, att.y - other.att.y) > WHISPER_NEAR) {
      this.send(ws, { t: "error", message: "再靠近一點才能說悄悄話" });
      return;
    }
    if (other.att.whisper) {
      this.requestWhisper(ws, att, other.att.whisper);
      return;
    }
    const group = `g${randomToken(8)}`;
    att.whisper = group;
    other.att.whisper = group;
    ws.serializeAttachment(att);
    other.ws.serializeAttachment(other.att);
    this.broadcast({ t: "hush", group, members: [att.id, other.att.id], by: att.id });
  }

  private onProfile(ws: WebSocket, att: Att, body: Record<string, unknown>) {
    let name = att.name;
    if (body.displayName !== undefined) {
      const next = normalizeName(body.displayName);
      if (!next) {
        this.send(ws, { t: "error", message: "顯示名稱不可空白" });
        return;
      }
      name = next;
    }
    let animal = att.animal;
    let look = att.look;
    if (body.animal !== undefined || body.look !== undefined) {
      if (!isRestroom(att.x, att.y, this.map.zones)) {
        this.send(ws, { t: "error", message: "請到男廁或女廁更換造型" });
        return;
      }
      const next = incomingLook(body, att.animal);
      if (!next) {
        this.send(ws, { t: "error", message: "造型不正確" });
        return;
      }
      look = next;
      animal = avatarAnimal(body.animal, look);
    }
    this.sql.exec(
      `UPDATE members SET display_name = ?, animal = ?, accessories = ? WHERE id = ?`,
      name,
      animal,
      JSON.stringify(look),
      att.id,
    );
    att.name = name;
    att.animal = animal;
    att.look = look;
    ws.serializeAttachment(att);
    this.broadcast({
      t: "profile",
      id: att.id,
      displayName: name,
      animal,
      look,
    });
  }

  private onEdit(ws: WebSocket, att: Att, body: Record<string, unknown>) {
    const on = Boolean(body.on);
    if (on) {
      const dist = Math.hypot(att.x - this.map.lala.x, att.y - this.map.lala.y);
      if (dist > 120) {
        this.send(ws, { t: "error", message: "要先靠近 Lala 小姐才能調整設備" });
        return;
      }
      for (const socket of this.ctx.getWebSockets()) {
        if (socket === ws) continue;
        const other = this.attOf(socket);
        if (other?.editing) {
          this.send(ws, { t: "error", message: "已經有人在調整設備" });
          return;
        }
      }
    }
    att.editing = on;
    ws.serializeAttachment(att);
    this.send(ws, { t: "edit", on });
  }

  private onFurniture(ws: WebSocket, att: Att, body: Record<string, unknown>) {
    if (!att.editing) {
      this.send(ws, { t: "error", message: "請先跟 Lala 小姐說話", furniture: this.furniture() });
      return;
    }
    const op = body.op;
    if (op === "move") {
      const now = Date.now();
      const last = this.furnMoveAt.get(att.id) || 0;
      if (now - last < FURN_MOVE_MS) return;
      this.furnMoveAt.set(att.id, now);
    }
    let changed: Furn | null = null;
    let removed = "";
    let replaced = false;
    if (op === "move" || op === "rot") {
      const id = typeof body.id === "string" ? body.id : "";
      if (isFixedId(id)) {
        this.send(ws, { t: "error", message: "這個設備是固定的", furniture: this.furniture() });
        return;
      }
      const rows = this.sql.exec<Furn>(`SELECT id, kind, x, y, rot FROM furniture WHERE id = ?`, id).toArray();
      const item = rows[0];
      if (!item) {
        this.send(ws, { t: "error", message: "找不到這個設備", furniture: this.furniture() });
        return;
      }
      let x = Number(item.x);
      let y = Number(item.y);
      let rot = Number(item.rot) || 0;
      if (op === "move") {
        if (typeof body.x !== "number" || typeof body.y !== "number") return;
        x = Math.round(body.x / 4) * 4;
        y = Math.round(body.y / 4) * 4;
      } else {
        const size = furnitureSize(String(item.kind), rot);
        const next = (rot + 90) % 360;
        const swapped = furnitureSize(String(item.kind), next);
        if (!size || !swapped) return;
        const cx = x + size.w / 2;
        const cy = y + size.h / 2;
        x = Math.round((cx - swapped.w / 2) / 4) * 4;
        y = Math.round((cy - swapped.h / 2) / 4) * 4;
        rot = next;
      }
      if (!furnitureFits(this.map.walls, String(item.kind), x, y, rot)) {
        this.send(ws, { t: "error", message: "那裡是牆壁，放不進去", furniture: this.furniture() });
        return;
      }
      const seated = this.chairLive(id);
      if (seated?.occupant) {
        this.send(ws, { t: "error", message: "有人坐在這張椅子上", furniture: this.furniture() });
        return;
      }
      this.sql.exec(`UPDATE furniture SET x = ?, y = ?, rot = ? WHERE id = ?`, x, y, rot, id);
      if (seated) {
        seated.x = x;
        seated.y = y;
        seated.rot = rot;
        seated.vx = 0;
        seated.vy = 0;
      }
      changed = { id, kind: String(item.kind), x, y, rot };
    } else if (op === "add") {
      const kind = typeof body.kind === "string" ? body.kind : "";
      if (isFixedKind(kind)) {
        this.send(ws, { t: "error", message: "這個設備是固定的", furniture: this.furniture() });
        return;
      }
      const rot = quarterRot(body.rot, 0);
      if (!furnitureSize(kind, rot)) {
        this.send(ws, { t: "error", message: "沒有這個設備", furniture: this.furniture() });
        return;
      }
      if (typeof body.x !== "number" || typeof body.y !== "number") return;
      const x = Math.round(body.x / 4) * 4;
      const y = Math.round(body.y / 4) * 4;
      if (!furnitureFits(this.map.walls, kind, x, y, rot)) {
        this.send(ws, { t: "error", message: "那裡是牆壁，放不進去", furniture: this.furniture() });
        return;
      }
      const count = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM furniture`).one();
      if (Number(count?.n ?? 0) >= 120) {
        this.send(ws, { t: "error", message: "設備太多了", furniture: this.furniture() });
        return;
      }
      const id = `item-${randomToken(6)}`;
      this.sql.exec(`INSERT INTO furniture (id, kind, x, y, rot) VALUES (?, ?, ?, ?, ?)`, id, kind, x, y, rot);
      if (kind === "chair") this.rememberChair({ id, x, y, rot });
      changed = { id, kind, x, y, rot };
    } else if (op === "remove") {
      const id = typeof body.id === "string" ? body.id : "";
      if (isFixedId(id)) {
        this.send(ws, { t: "error", message: "這個設備是固定的", furniture: this.furniture() });
        return;
      }
      const seated = this.chairLive(id);
      if (seated?.occupant) {
        this.send(ws, { t: "error", message: "有人坐在這張椅子上", furniture: this.furniture() });
        return;
      }
      this.sql.exec(`DELETE FROM furniture WHERE id = ?`, id);
      this.chairs.delete(id);
      removed = id;
    } else if (op === "home") {
      this.resetChairs(false);
      replaced = true;
    } else {
      return;
    }
    if (replaced) this.broadcast({ t: "furniture", items: this.furniture() });
    else if (removed) this.broadcast({ t: "furniture", remove: removed });
    else if (changed) this.broadcast({ t: "furniture", item: changed });
  }

  private onStall(ws: WebSocket, att: Att, body: Record<string, unknown>) {
    const now = Date.now();
    if (now - (att.lastStall || 0) < STALL_COOLDOWN_MS) return;
    att.lastStall = now;
    ws.serializeAttachment(att);
    const id = typeof body.id === "string" ? body.id : "";
    const bodies: Array<{ x: number; y: number }> = [];
    for (const socket of this.ctx.getWebSockets()) {
      const other = socket.deserializeAttachment() as Att | null;
      if (other && !other.seat) bodies.push({ x: other.x, y: other.y });
    }
    const result = this.stalls.toggle(id, att.x, att.y, bodies, WALL_RADIUS);
    if (!result.ok) {
      const message = result.reason === "busy" ? "門口有人，等一下再試" : "再靠近門一點";
      this.send(ws, { t: "error", message, stall: id });
      return;
    }
    this.ctx.storage.transactionSync(() => {
      this.setMeta(STALL_META, this.stalls.save());
    });
    this.broadcast({ t: "stalls", doors: this.stalls.view() });
  }

  private onSnack(ws: WebSocket, att: Att, body: Record<string, unknown>) {
    const now = Date.now();
    if (body.restock === true) {
      const result = this.snacks.restock(att.x, att.y, this.map.lala);
      if (!result.ok) {
        this.send(ws, { t: "error", message: "要先靠近 Lala 小姐才能補貨" });
        return;
      }
      if (result.changed) this.rememberSnacks();
      this.broadcast({ t: "snacks", stock: result.stock, line: result.line });
      return;
    }
    if (body.use === true) {
      const result = this.snacks.use(att.id);
      if (!result.ok) {
        this.send(ws, { t: "error", message: "手上沒有可以吃的" });
        return;
      }
      this.rememberHands();
      this.broadcast({
        t: "snacks",
        stock: result.stock,
        use: { id: att.id, item: result.itemId, pose: result.pose },
      });
      return;
    }
    const result = this.snacks.take(
      att.id,
      body.item,
      att.x,
      att.y,
      (machine) => this.machineAnchor(machine),
      now,
    );
    if (!result.ok) {
      const message = result.reason === "cool"
        ? "慢一點，才剛拿過"
        : result.reason === "empty"
          ? "已經沒了"
          : result.reason === "far"
            ? "再靠近一點"
            : "沒有這個";
      this.send(ws, { t: "error", message });
      return;
    }
    this.rememberSnacks();
    this.broadcast({
      t: "snacks",
      stock: result.stock,
      hold: { id: att.id, item: result.itemId, pose: result.pose, replaced: result.replaced },
    });
  }

  private loadSnacks() {
    this.snacks.load(this.meta(SNACK_META), this.meta(HANDS_META));
  }

  private rememberSnacks() {
    const saved = this.snacks.save();
    const hands = this.snacks.saveHands();
    this.ctx.storage.transactionSync(() => {
      this.setMeta(SNACK_META, saved);
      this.setMeta(HANDS_META, hands);
    });
  }

  private rememberHands() {
    this.setMeta(HANDS_META, this.snacks.saveHands());
  }

  private machineAnchor(machine: SnackMachine): { x: number; y: number } | null {
    const id = MACHINE_ID[machine];
    const rows = this.sql
      .exec<{ kind: string; x: number; y: number; rot: number }>(
        `SELECT kind, x, y, rot FROM furniture WHERE id = ?`,
        id,
      )
      .toArray();
    const row = rows[0];
    if (!row) return null;
    const size = furnitureSize(String(row.kind), Number(row.rot) || 0);
    if (!size) return null;
    return { x: Number(row.x) + size.w / 2, y: Number(row.y) + size.h / 2 };
  }

  private onFace(ws: WebSocket, att: Att, body: Record<string, unknown>) {
    const heading = readHeading(body.dir);
    if (heading == null) return;
    const now = Date.now();
    if (att.lastFace && now - att.lastFace < 120) return;
    const prev = Number.isFinite(att.dir) ? att.dir : 0;
    const delta = Math.abs(Math.atan2(Math.sin(heading - prev), Math.cos(heading - prev)));
    if (delta < (8 * Math.PI) / 180) return;
    att.dir = heading;
    att.lastFace = now;
    ws.serializeAttachment(att);
    this.broadcast({ t: "face", id: att.id, dir: heading }, ws);
    if (now - att.lastPersist > 4000) {
      this.persist(att);
      att.lastPersist = now;
      ws.serializeAttachment(att);
    }
  }

  private persist(att: Att) {
    this.sql.exec(
      `UPDATE members SET pos_x = ?, pos_y = ?, pos_dir = ? WHERE id = ?`,
      att.x,
      att.y,
      packHeading(att.dir),
      att.id,
    );
  }

  private inWall(x: number, y: number): boolean {
    return hitsWall(this.map.walls, x, y, WALL_RADIUS);
  }

  private onBump(ws: WebSocket, att: Att, body: Record<string, unknown>) {
    const otherId = typeof body.other === "string" ? body.other : "";
    const nx = typeof body.nx === "number" ? body.nx : 0;
    const ny = typeof body.ny === "number" ? body.ny : 0;
    if (!otherId || !Number.isFinite(nx) || !Number.isFinite(ny)) return;
    let ox = this.map.lala.x;
    let oy = this.map.lala.y;
    let otherRadius = bodyRadiusOf({ body: "bean" });
    if (otherId !== "lala") {
      const other = this.attachment(otherId);
      if (!other) return;
      ox = other.x;
      oy = other.y;
      otherRadius = bodyRadiusOf(other.look);
    }
    const reach = bodyRadiusOf(att.look) + otherRadius + 28;
    if (Math.hypot(att.x - ox, att.y - oy) > reach) return;
    const key = [att.id, otherId].sort().join(":");
    const now = Date.now();
    for (const [stamp, at] of this.bumpAt) {
      if (now - at > 2000) this.bumpAt.delete(stamp);
    }
    if (now - (this.bumpAt.get(key) || 0) < 420) return;
    this.bumpAt.set(key, now);
    this.broadcast({ t: "bump", id: att.id, other: otherId, nx, ny }, ws);
  }

  private onSit(ws: WebSocket, att: Att, body: Record<string, unknown>) {
    if (att.seat || att.editing) return;
    const id = typeof body.id === "string" ? body.id : "";
    const chair = this.chairLive(id);
    if (!chair || chair.occupant) {
      this.send(ws, { t: "error", message: "這張椅子有人坐了" });
      return;
    }
    const center = this.chairCenter(chair);
    if (Math.hypot(att.x - center.x, att.y - center.y) > 78) {
      this.send(ws, { t: "error", message: "再靠近一點才能坐下" });
      return;
    }
    chair.occupant = att.id;
    chair.vx = 0;
    chair.vy = 0;
    att.seat = chair.id;
    att.x = center.x;
    att.y = center.y;
    ws.serializeAttachment(att);
    this.keepWhisper(ws, att);
    this.broadcast({
      t: "sit",
      id: att.id,
      chair: chair.id,
      x: chair.x,
      y: chair.y,
      rot: chair.rot,
      cx: center.x,
      cy: center.y,
    });
  }

  private onReset(ws: WebSocket, att: Att) {
    const now = Date.now();
    if (att.lastReset && now - att.lastReset < RESET_COOLDOWN_MS) {
      this.send(ws, { t: "error", message: "剛剛才急救過，稍等一下" });
      return;
    }
    att.lastReset = now;
    const chairId = att.seat;
    if (chairId) {
      const chair = this.chairLive(chairId);
      if (chair && chair.occupant === att.id) {
        chair.occupant = null;
        chair.vx = 0;
        chair.vy = 0;
        this.sql.exec(`UPDATE furniture SET x = ?, y = ?, rot = ? WHERE id = ?`, chair.x, chair.y, chair.rot, chair.id);
        chair.lastSave = now;
      }
      att.seat = null;
    }
    const base = this.spawnFor(att.id);
    const spot = this.separateFrom(att.id, base.x, base.y, att.look, true);
    att.x = spot.x;
    att.y = spot.y;
    att.lastMove = now;
    if (att.editing) {
      att.editing = false;
      this.send(ws, { t: "edit", on: false });
    }
    ws.serializeAttachment(att);
    this.keepWhisper(ws, att);
    this.persist(att);
    this.broadcast({ t: "reset", id: att.id, x: att.x, y: att.y, chair: chairId || null });
    this.send(ws, { t: "notice", text: "已回到安全位置" });
  }

  private onRise(ws: WebSocket, att: Att) {
    if (!att.seat) return;
    const chair = this.chairLive(att.seat);
    if (chair && chair.occupant === att.id) {
      chair.occupant = null;
      chair.vx = 0;
      chair.vy = 0;
      this.sql.exec(`UPDATE furniture SET x = ?, y = ?, rot = ? WHERE id = ?`, chair.x, chair.y, chair.rot, chair.id);
      chair.lastSave = Date.now();
      const spot = this.freeBeside(chair, att);
      att.x = spot.x;
      att.y = spot.y;
    }
    const chairId = att.seat;
    att.seat = null;
    ws.serializeAttachment(att);
    this.keepWhisper(ws, att);
    this.persist(att);
    this.broadcast({ t: "rise", id: att.id, chair: chairId, x: att.x, y: att.y });
  }

  private onGlide(ws: WebSocket, att: Att, body: Record<string, unknown>) {
    const id = typeof body.id === "string" ? body.id : att.seat || "";
    const chair = this.chairLive(id);
    if (!chair || chair.occupant !== att.id) return;
    const x = body.x;
    const y = body.y;
    const rot = quarterRot(body.rot, chair.rot);
    const vx = body.vx;
    const vy = body.vy;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const size = furnitureSize("chair", rot);
    if (!size) return;
    const cx = x + size.w / 2;
    const cy = y + size.h / 2;
    if (this.inWall(cx, cy) || !furnitureFits(this.map.walls, "chair", x, y, rot)) {
      this.send(ws, this.glideState(att.id, chair, true));
      return;
    }
    const now = Date.now();
    const dt = Math.min(0.45, Math.max(0.03, chair.lastNet ? (now - chair.lastNet) / 1000 : 0.08));
    if (Math.hypot(x - chair.x, y - chair.y) > 280 * dt + 36) {
      this.send(ws, this.glideState(att.id, chair, true));
      return;
    }
    chair.x = x;
    chair.y = y;
    chair.rot = rot;
    chair.vx = typeof vx === "number" && Number.isFinite(vx) ? vx : 0;
    chair.vy = typeof vy === "number" && Number.isFinite(vy) ? vy : 0;
    chair.lastNet = now;
    att.x = cx;
    att.y = cy;
    ws.serializeAttachment(att);
    this.keepWhisper(ws, att);
    if (now - chair.lastSave > GLIDE_SAVE_MS) {
      this.sql.exec(`UPDATE furniture SET x = ?, y = ?, rot = ? WHERE id = ?`, chair.x, chair.y, chair.rot, chair.id);
      chair.lastSave = now;
      this.persist(att);
    }
    this.broadcast(this.glideState(att.id, chair, false), ws);
  }

  private glideState(id: string, chair: ChairLive, snap: boolean) {
    const center = this.chairCenter(chair);
    return {
      t: "glide",
      id,
      chair: chair.id,
      x: chair.x,
      y: chair.y,
      rot: chair.rot,
      vx: snap ? 0 : chair.vx,
      vy: snap ? 0 : chair.vy,
      cx: center.x,
      cy: center.y,
      snap,
    };
  }

  private ensureChairs() {
    if (this.chairsReady) return;
    this.chairsReady = true;
    for (const row of this.sql.exec<Furn>(`SELECT id, kind, x, y, rot FROM furniture`).toArray()) {
      if (row.kind !== "chair") continue;
      this.rememberChair({ id: String(row.id), x: Number(row.x), y: Number(row.y), rot: Number(row.rot) || 0 });
    }
  }

  private rememberChair(row: { id: string; x: number; y: number; rot: number }) {
    const prev = this.chairs.get(row.id);
    this.chairs.set(row.id, {
      id: row.id,
      x: row.x,
      y: row.y,
      rot: row.rot,
      vx: 0,
      vy: 0,
      occupant: prev?.occupant ?? null,
      lastNet: prev?.lastNet ?? 0,
      lastSave: prev?.lastSave ?? 0,
    });
  }

  private chairLive(id: string): ChairLive | null {
    this.ensureChairs();
    return this.chairs.get(id) ?? null;
  }

  private chairCenter(chair: ChairLive): { x: number; y: number } {
    return { x: chair.x + 16, y: chair.y + 13 };
  }

  private attachment(id: string): Att | null {
    for (const ws of this.ctx.getWebSockets(id)) {
      const att = this.attOf(ws);
      if (att) return att;
    }
    return null;
  }

  private releaseSeat(id: string) {
    this.ensureChairs();
    for (const chair of this.chairs.values()) {
      if (chair.occupant === id) {
        chair.occupant = null;
        chair.vx = 0;
        chair.vy = 0;
      }
    }
  }

  private resetChairs(force: boolean) {
    this.ensureChairs();
    const desks = this.map.props.filter((prop) => prop.kind === "desk");
    for (const item of this.map.furniture) {
      if (item.kind !== "chair") continue;
      const live = this.chairs.get(item.id);
      if (live?.occupant && !force) continue;
      const rot = chairHomeRotation(item, desks, this.map.walls);
      this.sql.exec(`UPDATE furniture SET x = ?, y = ?, rot = ? WHERE id = ?`, item.x, item.y, rot, item.id);
      this.chairs.set(item.id, {
        id: item.id,
        x: item.x,
        y: item.y,
        rot,
        vx: 0,
        vy: 0,
        occupant: force ? null : (live?.occupant ?? null),
        lastNet: 0,
        lastSave: Date.now(),
      });
    }
  }

  private freeBeside(chair: ChairLive, att: Att): { x: number; y: number } {
    const center = this.chairCenter(chair);
    const radius = bodyRadiusOf(att.look);
    for (let ring = 1; ring <= 6; ring++) {
      const step = 22 + ring * 16;
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const x = center.x + Math.cos(angle) * step;
        const y = center.y + Math.sin(angle) * step;
        if (this.separateFrom(att.id, x, y, att.look).x === x && this.separateFrom(att.id, x, y, att.look).y === y && !this.inWall(x, y)) {
          if (Math.hypot(x - center.x, y - center.y) >= radius * 0.45) return { x, y };
        }
      }
    }
    return { x: center.x + 48, y: center.y + 36 };
  }

  private spawnFor(id: string): { x: number; y: number } {
    let hash = 0;
    for (const char of id) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
    const col = (hash % 7) - 3;
    const x = this.map.spawn.x + col * 72;
    const y = this.map.spawn.y;
    if (this.inWall(x, y)) return { x: this.map.spawn.x, y: this.map.spawn.y };
    return { x, y };
  }

  private separateFrom(
    id: string,
    x: number,
    y: number,
    look: Look | null,
    avoidSolids = false,
  ): { x: number; y: number } {
    const mine = bodyRadiusOf(look);
    // Emergency reset must not drop someone inside a table or shelf that was moved onto the spawn.
    const solids = avoidSolids ? this.solidFurniture() : [];
    const occupied: Array<{ x: number; y: number; r: number }> = [
      { x: this.map.lala.x, y: this.map.lala.y, r: bodyRadiusOf({ body: "bean" }) },
    ];
    for (const ws of this.ctx.getWebSockets()) {
      const other = this.attOf(ws);
      if (!other || other.id === id) continue;
      occupied.push({ x: other.x, y: other.y, r: bodyRadiusOf(other.look) });
    }
    this.ensureChairs();
    for (const chair of this.chairs.values()) {
      if (chair.occupant === id) continue;
      const center = this.chairCenter(chair);
      occupied.push({ x: center.x, y: center.y, r: 18 });
    }
    const clear = (px: number, py: number) =>
      !this.inWall(px, py)
      && (!avoidSolids || !hitsSolid(this.map.props, solids, px, py, mine))
      && occupied.every((person) => Math.hypot(person.x - px, person.y - py) >= mine + person.r - 1);
    if (clear(x, y)) return { x, y };
    const base = this.spawnFor(id);
    for (let ring = 0; ring <= (avoidSolids ? 9 : 5); ring++) {
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + ring;
        const px = base.x + Math.cos(angle) * (36 + ring * 28);
        const py = base.y + Math.sin(angle) * (28 + ring * 22);
        if (clear(px, py)) return { x: px, y: py };
      }
    }
    return { x: base.x, y: base.y };
  }

  private solidFurniture(): Array<{ kind: string; x: number; y: number; rot: number }> {
    return this.sql
      .exec<{ kind: string; x: number; y: number; rot: number }>(`SELECT kind, x, y, rot FROM furniture WHERE kind != 'chair'`)
      .toArray()
      .map((row) => ({ kind: String(row.kind), x: Number(row.x), y: Number(row.y), rot: Number(row.rot) || 0 }));
  }

  private dropSessions(memberId: string) {
    this.sql.exec(`DELETE FROM member_sessions WHERE member_id = ?`, memberId);
  }

  private async issueSession(id: string, deviceKey: string): Promise<string> {
    const token = randomToken(32);
    const stored = `sha256:${await sha256(token)}`;
    const key = deviceKey.toLowerCase();
    const now = Date.now();
    this.sql.exec(`DELETE FROM member_sessions WHERE device_key = ?`, key);
    this.sql.exec(
      `INSERT INTO member_sessions (token_hash, member_id, device_key, epoch, created_at) VALUES (?, ?, ?, ?, ?)`,
      stored,
      id,
      key,
      this.epoch(),
      now,
    );
    this.sql.exec(`UPDATE member_devices SET last_seen = ? WHERE device_key = ?`, now, key);
    return token;
  }

  private async memberByToken(token: string): Promise<(MemberRow & { bound_device: string }) | null> {
    if (!token) return null;
    return this.memberBySession(await sessionHash(token));
  }

  // The same check every cookie request gets: the session row still exists for
  // the current office password epoch.
  private memberBySession(stored: string): (MemberRow & { bound_device: string }) | null {
    if (!stored) return null;
    const rows = this.sql
      .exec<MemberRow & { bound_device: string }>(
        `SELECT m.*, s.device_key AS bound_device
         FROM member_sessions s JOIN members m ON m.id = s.member_id
         WHERE s.token_hash = ? AND s.epoch = ?`,
        stored,
        this.epoch(),
      )
      .toArray();
    return rows[0] ?? null;
  }

  private allowBurst(id: string): boolean {
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

  private restoreOccupants() {
    this.ensureChairs();
    let people: Array<{ id: string; seat: string | null }> = [];
    try {
      people = this.ctx
        .getWebSockets()
        .map((socket) => {
          const att = this.attOf(socket);
          return { id: att?.id || "", seat: att?.seat ?? null };
        })
        .filter((person) => person.id);
    } catch {
      return;
    }
    const restored = restoreChairOccupants([...this.chairs.values()], people);
    for (const chair of restored) {
      const live = this.chairs.get(chair.id);
      if (live && chair.occupant) live.occupant = chair.occupant;
    }
  }

  private async adminGate(request: Request): Promise<Response> {
    if (request.headers.get("x-office-gate") !== "1") return json({ error: "未授權" }, 401);
    const body = await readJson(request);
    if (!body) return json({ error: "格式不對" }, 400);
    const ip = this.clientIp(request);
    const event = body.event;
    if (event === "check") {
      if (this.failureLimited("admin", ip)) return json({ error: "嘗試太多次，請稍後再試" }, 429);
      return json({ ok: true });
    }
    if (event === "fail") {
      this.noteFailure("admin", ip);
      if (this.failureLimited("admin", ip)) return json({ error: "嘗試太多次，請稍後再試" }, 429);
      return json({ ok: true });
    }
    if (event === "ok") {
      this.clearFailures("admin", ip);
      return json({ ok: true });
    }
    return json({ error: "格式不對" }, 400);
  }

  private memberByDevice(deviceKey: string): MemberRow | null {
    const rows = this.sql
      .exec<MemberRow>(
        `SELECT m.* FROM member_devices d JOIN members m ON m.id = d.member_id WHERE d.device_key = ?`,
        deviceKey.toLowerCase(),
      )
      .toArray();
    return rows[0] ?? null;
  }

  private memberById(id: string): MemberRow | null {
    const rows = this.sql.exec<MemberRow>(`SELECT * FROM members WHERE id = ?`, id).toArray();
    return rows[0] ?? null;
  }

  private profile(member: MemberRow) {
    return {
      id: member.id,
      displayName: member.display_name,
      animal: member.animal,
      look: readStoredLook(member.animal, member.accessories),
    };
  }

  private player(att: Att) {
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

  private furniture(): Array<Furn & { seat: string | null }> {
    this.ensureChairs();
    return this.sql.exec<Furn>(`SELECT id, kind, x, y, rot FROM furniture`).toArray().map((row) => {
      const id = String(row.id);
      const chair = row.kind === "chair" ? this.chairs.get(id) : null;
      return {
        id,
        kind: String(row.kind),
        x: chair ? chair.x : Number(row.x),
        y: chair ? chair.y : Number(row.y),
        rot: chair ? chair.rot : Number(row.rot) || 0,
        seat: chair?.occupant ?? null,
      };
    });
  }

  private goodbye(ws: WebSocket, reason: ByeReason) {
    const code = {
      removed: 4001,
      kicked: 4002,
      password: 4003,
      restored: 4007,
      replaced: 4000,
      elsewhere: 4004,
      logout: 4005,
      device: 4006,
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

  private socketOf(id: string): { ws: WebSocket; att: Att } | null {
    for (const ws of this.ctx.getWebSockets(id)) {
      const att = this.attOf(ws);
      if (att) return { ws, att };
    }
    return null;
  }

  private activeHush(): Array<{ group: string; members: string[] }> {
    const groups = new Map<string, string[]>();
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attOf(ws);
      if (!att?.whisper) continue;
      const list = groups.get(att.whisper) || [];
      list.push(att.id);
      groups.set(att.whisper, list);
    }
    return [...groups.entries()]
      .filter(([, members]) => members.length >= 2)
      .map(([group, members]) => ({ group, members }));
  }

  private membersOf(group: string): Array<{ ws: WebSocket; att: Att }> {
    const list: Array<{ ws: WebSocket; att: Att }> = [];
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attOf(ws);
      if (att?.whisper === group) list.push({ ws, att });
    }
    return list;
  }

  private requestWhisper(ws: WebSocket, att: Att, group: string) {
    const members = this.membersOf(group);
    if (members.length >= WHISPER_CAP) {
      this.send(ws, { t: "error", message: "這一圈悄悄話已經滿了" });
      return;
    }
    const until = Date.now() + WHISPER_ASK_MS;
    this.whisperAsks.set(att.id, { group, until });
    const ask = { t: "ask", id: att.id, group, until };
    for (const member of members) this.send(member.ws, ask);
    this.send(ws, { ...ask, pending: true });
  }

  private acceptWhisper(ws: WebSocket, att: Att, requesterId: string) {
    const ask = this.whisperAsks.get(requesterId);
    if (!ask || ask.until < Date.now()) {
      this.whisperAsks.delete(requesterId);
      this.send(ws, { t: "error", message: "加入請求已經過期" });
      return;
    }
    if (att.whisper !== ask.group) return;
    const members = this.membersOf(ask.group);
    if (members.length >= WHISPER_CAP) {
      this.send(ws, { t: "error", message: "這一圈悄悄話已經滿了" });
      return;
    }
    const requester = this.socketOf(requesterId);
    if (!requester || requester.att.whisper) {
      this.whisperAsks.delete(requesterId);
      this.send(ws, { t: "error", message: "對方現在不能加入" });
      return;
    }
    const close = members.some((member) => Math.hypot(requester.att.x - member.att.x, requester.att.y - member.att.y) <= WHISPER_NEAR);
    if (!close) {
      this.send(ws, { t: "error", message: "對方走遠了" });
      return;
    }
    requester.att.whisper = ask.group;
    requester.ws.serializeAttachment(requester.att);
    this.whisperAsks.delete(requesterId);
    const next = this.membersOf(ask.group);
    this.broadcast({ t: "hush", group: ask.group, members: next.map((member) => member.att.id), by: requesterId });
    for (const member of next) this.send(member.ws, { t: "ask", id: requesterId, off: true });
  }

  private leaveWhisper(att: Att, ws: WebSocket | null) {
    const group = att.whisper;
    if (!group) return;
    att.whisper = null;
    if (ws) ws.serializeAttachment(att);
    this.whisperAsks.delete(att.id);
    const rest = this.membersOf(group);
    if (rest.length < 2) {
      for (const member of rest) {
        member.att.whisper = null;
        member.ws.serializeAttachment(member.att);
      }
      this.broadcast({ t: "hush", group, members: [] });
      return;
    }
    this.broadcast({ t: "hush", group, members: rest.map((member) => member.att.id) });
  }

  private dropWhisper(att: Att, ws: WebSocket) {
    this.leaveWhisper(att, ws);
  }

  private keepWhisper(ws: WebSocket, att: Att) {
    if (!att.whisper) return;
    const others = this.membersOf(att.whisper).filter((member) => member.att.id !== att.id);
    const close = others.some((member) => Math.hypot(att.x - member.att.x, att.y - member.att.y) <= WHISPER_FAR);
    if (!others.length || !close) this.leaveWhisper(att, ws);
  }

  private attOf(ws: WebSocket): Att | null {
    const held = ws.deserializeAttachment() as Att | Pending | null;
    return held && !("setup" in held) ? held : null;
  }

  private broadcast(data: unknown, except?: WebSocket) {
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

  private send(ws: WebSocket, data: unknown) {
    try {
      ws.send(JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }
}
