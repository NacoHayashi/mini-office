import {
  avatarAnimal,
  bodyRadiusOf,
  catalog,
  isRestroom,
  normalizeChat,
  normalizeName,
  palette,
  publicMap,
  readStoredLook,
  WALL_RADIUS,
} from "./content";
import { json, readCookie } from "./http";
import { reply, requestBody, requestId, requestKind, type RequestKind } from "./requests";
import { guestBlocks, isGuest, sweepGuests, touchGuest } from "./guest-login";
import {
  type Att,
  incomingLook,
  type MemberRow,
  type Pending,
  readHeading,
  SESSION_COOKIE,
  sessionHash,
  unpackHeading,
  WHISPER_FAR,
  WS_MAX_CHARS,
} from "./room-base";
import { RoomPantry } from "./room-pantry";
export { bearer, type Env } from "./room-base";

export class OfficeRoom extends RoomPantry implements DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (path === "/api/office/status" && request.method === "GET") return this.status();
      if (path === "/api/office/login" && request.method === "POST") return await this.login(request);
      if (path === "/api/office/register" && request.method === "POST") return await this.register(request);
      if (path === "/api/office/pair" && request.method === "POST") return await this.pair(request);
      if (path === "/api/office/pair/code" && request.method === "POST") return await this.pairCode(request);
      if (path === "/api/office/guest" && request.method === "POST") return await this.guestLogin(request);
      if (path === "/api/office/telegram/enter" && request.method === "POST") return await this.telegramEnter(request);
      if (path === "/api/office/telegram/upgrade" && request.method === "POST") return await this.telegramUpgrade(request);
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
    const guestNo = att.guest ? guestBlocks(kind, body, att.name) : null;
    if (guestNo) {
      this.send(ws, { t: "error", message: guestNo });
      return;
    }
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
    else if (kind === "toy") this.onToy(ws, att, body);
    else if (kind === "meeting") this.onMeeting(ws, att, body);
    else if (kind === "pantry") this.onPantry(ws, att, body);
    else if (kind === "reset") this.onReset(ws, att);
    this.settleHand(att);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const att = this.attOf(ws);
    if (!att) return;
    if (att.guest) touchGuest(this.officeSql(), att.id);
    const still = this.ctx.getWebSockets(att.id).some((other) => other !== ws);
    if (still) return;
    this.releaseSeat(att.id);
    if (this.snacks.release(att.id)) this.rememberHands();
    const toyLeft = this.toys.release(att.id);
    if (toyLeft.toy || toyLeft.pinch) {
      this.rememberToys();
      this.broadcastToys(toyLeft.pinch ? { kind: "pinch", by: toyLeft.pinch.by, to: toyLeft.pinch.to, on: false } : null);
    }
    this.dropWhisper(att, ws);
    this.settleHand(att, true);
    this.settlePantry(att);
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

  protected async upgrade(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "需要 WebSocket" }, 426);
    }
    sweepGuests(this.officeSql(), (id) => this.ctx.getWebSockets(id).length > 0);
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

  protected enter(server: WebSocket, member: MemberRow & { bound_device: string }, session: string) {
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
      guest: isGuest(this.officeSql(), member.id),
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
      toys: this.toys.view((id) => id === member.id || this.ctx.getWebSockets(id).some((ws) => this.attOf(ws))),
      meeting: this.meetingView(),
      pantry: this.pantryView(),
    });
    this.broadcast({ t: "join", player: this.player(att) }, server);
    const held = this.snacks.handsView((id) => id === member.id)[0];
    if (held) this.broadcast({ t: "snacks", hold: { id: held.id, item: held.item, pose: held.pose, replaced: false } }, server);
  }

  // Socket requests get the same session check, validation and score pacing
  // the cookie routes had; the socket only replaces the transport.
  protected onRequest(ws: WebSocket, held: Att | Pending, kind: RequestKind, rid: string, raw: unknown) {
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
        this.send(ws, reply(rid, { status: 403, data: { error: "請到廁所更換造型" } }));
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

  protected rejectMove(ws: WebSocket, att: Att) {
    this.send(ws, { t: "snap", x: att.x, y: att.y, dir: att.dir });
  }

  protected onMove(ws: WebSocket, att: Att, body: Record<string, unknown>) {
    if (att.seat) return;
    const x = body.x;
    const y = body.y;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const now = Date.now();
    if (att.lastMove && now - att.lastMove < 30) return;
    // Moves sent before a knockback reached this player still start from the old spot; drop them quietly.
    if (att.knockAt && now - att.knockAt < 600 && Math.hypot(x - att.x, y - att.y) > 40) return;
    const dt = Math.min(2, Math.max(0.04, att.lastMove ? (now - att.lastMove) / 1000 : 0.04));
    // Stall walls, doors and toilets keep the whole body out, so nobody pokes through a
    // closed stall. Someone already overlapping one (say, after a new look) can still walk free.
    const fit = bodyRadiusOf(att.look);
    const stallRadius = this.stalls.blocks(att.x, att.y, fit) ? WALL_RADIUS : fit;
    if (Math.hypot(x - att.x, y - att.y) > 340 * dt + 28 || this.inWall(x, y) || this.stalls.blocks(x, y, stallRadius)) {
      this.rejectMove(ws, att);
      return;
    }
    const heading = readHeading(body.dir);
    if (heading != null) att.dir = heading;
    att.x = x;
    att.y = y;
    att.lastMove = now;
    this.toys.track(att.id, x, y, now);
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

  protected onChat(ws: WebSocket, att: Att, body: Record<string, unknown>) {
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
    if (this.roomChat(att, text, now)) return;
    this.broadcast({ t: "chat", id: att.id, text, at: now });
  }

  protected onProfile(ws: WebSocket, att: Att, body: Record<string, unknown>) {
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
        this.send(ws, { t: "error", message: "請到廁所更換造型" });
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

  protected onFace(ws: WebSocket, att: Att, body: Record<string, unknown>) {
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
}
