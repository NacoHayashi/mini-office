// Signing in: office password, registering, pairing a device, guests, and sessions.
import { avatarAnimal, catalog, checkId, checkPassword, type Look, normalizeName, presetLook } from "./content";
import { passwordHash, passwordVerdict, randomToken, sha256 } from "./crypto";
import { json, readCookie } from "./http";
import { type Outcome } from "./requests";
import { freshPair, hashPairCode, judgePair, normalizeDeviceKey, normalizePairCode, randomPairCode } from "./pairing";
import {
  dropGuest,
  GUEST_MAX,
  GUEST_PREFIX,
  guestAnimal,
  guestCount,
  guestName,
  isGuest,
  reservedLoginId,
  sweepGuests,
  upgradeGuest,
} from "./guest-login";
import { TELEGRAM_MARKER } from "./telegram-login";
import {
  bearer,
  clearSessionCookie,
  incomingLook,
  MAX_MEMBERS,
  type MemberRow,
  readJson,
  RoomBase,
  SESSION_COOKIE,
  sessionCookie,
  sessionHash,
} from "./room-base";

export abstract class RoomLogin extends RoomBase {
  protected abstract spawnFor(id: string): { x: number; y: number };

  protected storePasswordHash(stored: { salt: string; hash: string; iters: string }) {
    this.setMeta("pw_salt", stored.salt);
    this.setMeta("pw_hash", stored.hash);
    this.setMeta("pw_kdf", "pbkdf2");
    this.setMeta("pw_iters", stored.iters);
  }

  protected hasPassword(): boolean {
    return Boolean(this.meta("pw_hash") && this.meta("pw_salt"));
  }

  protected async passwordOk(password: string): Promise<"legacy" | "current" | false> {
    return passwordVerdict(password, {
      salt: this.meta("pw_salt"),
      hash: this.meta("pw_hash"),
      kdf: this.meta("pw_kdf"),
      iters: this.meta("pw_iters"),
    });
  }

  protected async upgradePassword(password: string) {
    const stored = await passwordHash(password);
    this.ctx.storage.transactionSync(() => {
      this.storePasswordHash(stored);
    });
  }

  protected async verifyOfficePassword(
    request: Request,
    kind: "login" | "register" | "pair",
    read?: Record<string, unknown>,
  ): Promise<
    | { ok: true; body: Record<string, unknown>; ip: string; password: string; legacy: boolean }
    | { ok: false; response: Response }
  > {
    if (!this.hasPassword()) return { ok: false, response: json({ error: "管理員還沒設定辦公室密碼" }, 503) };
    const ip = this.clientIp(request);
    if (this.failureLimited(kind, ip)) return { ok: false, response: json({ error: "嘗試太多次，請稍後再試" }, 429) };
    const body = read ?? (await readJson(request));
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

  protected status(): Response {
    return json({ hasPassword: this.hasPassword() });
  }

  protected async login(request: Request): Promise<Response> {
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

  protected async register(request: Request): Promise<Response> {
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
    if (this.memberById(id.id) || reservedLoginId(id.id)) return json({ error: "這個 ID 已經有人使用" }, 409);
    if (this.memberCount() >= MAX_MEMBERS) return json({ error: "辦公室人數已滿" }, 400);
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

  protected async pairCode(request: Request): Promise<Response> {
    await readJson(request);
    const member = await this.memberFromCookie(request);
    if (!member) return this.unauthorized(request);
    if (isGuest(this.officeSql(), member.id)) return json({ error: "訪客不能加入新裝置" }, 403);
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

  protected async pair(request: Request): Promise<Response> {
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

  protected memberCount(): number {
    const count = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM members WHERE id NOT IN (SELECT member_id FROM guests)`).one();
    return Number(count?.n ?? 0);
  }

  protected freshId(prefix: string): string {
    let id = `${prefix}${randomToken(4)}`;
    while (this.memberById(id)) id = `${prefix}${randomToken(4)}`;
    return id;
  }

  protected addMember(id: string, displayName: string, animal: string | null, look: Look | null) {
    const spot = this.spawnFor(id);
    this.sql.exec(
      `INSERT INTO members
        (id, display_name, animal, accessories, pos_x, pos_y, pos_dir, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      id,
      displayName,
      animal,
      look ? JSON.stringify(look) : "{}",
      spot.x,
      spot.y,
      Date.now(),
    );
  }

  // Only the Worker reaches this, after it has checked the Telegram signature.
  protected async telegramEnter(request: Request): Promise<Response> {
    if (request.headers.get(TELEGRAM_MARKER) !== "1") return json({ error: "未授權" }, 401);
    const body = await readJson(request);
    if (!body) return json({ error: "格式不對" }, 400);
    const telegramId = typeof body.telegramId === "string" ? body.telegramId : "";
    const name = normalizeName(body.name);
    if (!/^[1-9]\d{0,19}$/.test(telegramId) || !name) return json({ error: "格式不對" }, 400);
    const deviceKey = normalizeDeviceKey(body.deviceKey);
    if (!deviceKey) return json({ error: "裝置驗證失敗，請重新整理" }, 400);
    const linked = this.sql
      .exec<MemberRow>(`SELECT m.* FROM telegram_members t JOIN members m ON m.id = t.member_id WHERE t.telegram_id = ?`, telegramId)
      .toArray()[0];
    let id = linked?.id;
    if (!id) {
      // Linking a new Telegram account needs the office password, with the same throttle as password login.
      if (!body.password) return json({ error: "第一次用 Telegram 登入，請先輸入辦公室密碼", needsPassword: true }, 401);
      const gate = await this.verifyOfficePassword(request, "login", body);
      if (!gate.ok) return gate.response;
      this.clearFailures("login", gate.ip);
      if (gate.legacy) await this.upgradePassword(gate.password);
      if (this.memberCount() >= MAX_MEMBERS) return json({ error: "辦公室人數已滿" }, 400);
      id = this.freshId("tg-");
      this.addMember(id, name, null, null);
      this.sql.exec(`DELETE FROM telegram_members WHERE telegram_id = ?`, telegramId);
      this.sql.exec(`INSERT INTO telegram_members (telegram_id, member_id, created_at) VALUES (?, ?, ?)`, telegramId, id, Date.now());
    }
    if (!this.memberByDevice(deviceKey)) this.bindDevice(id, deviceKey, Date.now());
    const token = await this.issueSession(id, deviceKey);
    const member = this.memberById(id);
    if (!member) return json({ error: "登入失敗" }, 500);
    return json({ profile: this.profile(member), catalog: catalog() }, 200, { "set-cookie": sessionCookie(token) });
  }

  // A signed-in guest switching to Telegram. Only the Worker reaches this, after
  // checking the signature; the office password is always needed here.
  protected async telegramUpgrade(request: Request): Promise<Response> {
    if (request.headers.get(TELEGRAM_MARKER) !== "1") return json({ error: "未授權" }, 401);
    const token = readCookie(request, SESSION_COOKIE);
    const session = token ? await sessionHash(token) : "";
    const before = this.memberBySession(session);
    if (!before) return this.unauthorized(request);
    if (!isGuest(this.officeSql(), before.id)) return json({ error: "只有訪客可以改用 Telegram" }, 403);
    const body = await readJson(request);
    if (!body) return json({ error: "格式不對" }, 400);
    const telegramId = typeof body.telegramId === "string" ? body.telegramId : "";
    if (!/^[1-9]\d{0,19}$/.test(telegramId) || !normalizeName(body.name)) return json({ error: "格式不對" }, 400);
    const deviceKey = normalizeDeviceKey(body.deviceKey);
    if (!deviceKey) return json({ error: "裝置驗證失敗，請重新整理" }, 400);
    if (!body.password) return json({ error: "請先輸入辦公室密碼", needsPassword: true }, 401);
    const gate = await this.verifyOfficePassword(request, "login", body);
    if (!gate.ok) return gate.response;
    this.clearFailures("login", gate.ip);
    if (gate.legacy) await this.upgradePassword(gate.password);
    // Checked again after the awaits: the guest may have clocked out meanwhile.
    const guest = this.memberBySession(session);
    if (!guest || !isGuest(this.officeSql(), guest.id)) return this.unauthorized(request);
    const linked = this.sql.exec(`SELECT member_id FROM telegram_members t JOIN members m ON m.id = t.member_id WHERE t.telegram_id = ?`, telegramId).toArray()[0];
    if (!linked && this.memberCount() >= MAX_MEMBERS) return json({ error: "辦公室人數已滿" }, 400);
    const sockets = this.ctx.getWebSockets(guest.id);
    // Save where the guest is standing so a new account keeps the spot.
    for (const ws of sockets) {
      const att = this.attOf(ws);
      if (att) this.persist(att);
    }
    const id = upgradeGuest(this.officeSql(), guest.id, telegramId, this.freshId("tg-"));
    for (const ws of sockets) this.goodbye(ws, "upgraded");
    if (!this.memberByDevice(deviceKey)) this.bindDevice(id, deviceKey, Date.now());
    const fresh = await this.issueSession(id, deviceKey);
    const member = this.memberById(id);
    if (!member) return json({ error: "登入失敗" }, 500);
    return json({ profile: this.profile(member), catalog: catalog() }, 200, { "set-cookie": sessionCookie(fresh) });
  }

  protected async guestLogin(request: Request): Promise<Response> {
    const gate = await this.verifyOfficePassword(request, "login");
    if (!gate.ok) return gate.response;
    this.clearFailures("login", gate.ip);
    if (gate.legacy) await this.upgradePassword(gate.password);
    const sql = this.officeSql();
    const ip = gate.ip;
    sweepGuests(sql, (id) => this.ctx.getWebSockets(id).length > 0);
    if (this.failureLimited("guest", ip) || guestCount(sql) >= GUEST_MAX) {
      return json({ error: "訪客太多了，請稍後再試" }, 429);
    }
    this.noteFailure("guest", ip);
    const taken = new Set(this.sql.exec<{ display_name: string }>(`SELECT display_name FROM members`).toArray().map((row) => row.display_name));
    const id = this.freshId(GUEST_PREFIX);
    const animal = guestAnimal();
    const now = Date.now();
    this.addMember(id, guestName(taken), animal, presetLook(animal));
    this.sql.exec(`INSERT INTO guests (member_id, created_at, last_seen) VALUES (?, ?, ?)`, id, now, now);
    // Guests get a throwaway device key so they never touch a member's device.
    const token = await this.issueSession(id, randomToken(24));
    const member = this.memberById(id);
    if (!member) return json({ error: "登入失敗" }, 500);
    return json({ profile: this.profile(member), catalog: catalog() }, 200, { "set-cookie": sessionCookie(token) });
  }

  protected bindDevice(memberId: string, deviceKey: string, now: number) {
    this.sql.exec(
      `INSERT INTO member_devices (id, device_key, member_id, created_at, last_seen) VALUES (?, ?, ?, ?, ?)`,
      randomToken(8),
      deviceKey,
      memberId,
      now,
      now,
    );
  }

  protected async adoptSession(request: Request): Promise<Response> {
    await readJson(request);
    const token = bearer(request);
    const member = await this.memberByToken(token);
    if (!member) return json({ error: "登入已失效" }, 401);
    return json({ profile: this.profile(member), catalog: catalog() }, 200, { "set-cookie": sessionCookie(token) });
  }

  protected async logout(request: Request): Promise<Response> {
    await readJson(request);
    const token = readCookie(request, SESSION_COOKIE);
    const member = token ? await this.memberByToken(token) : null;
    if (member) {
      this.broadcast({ t: "notice", text: `${member.display_name} 下班了` });
      this.dropSessions(member.id);
      for (const ws of this.ctx.getWebSockets(member.id)) this.goodbye(ws, "logout");
      if (isGuest(this.officeSql(), member.id)) dropGuest(this.officeSql(), member.id);
    }
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }

  protected unauthorized(request: Request): Response {
    const extra = readCookie(request, SESSION_COOKIE) ? { "set-cookie": clearSessionCookie() } : undefined;
    return json({ error: "登入已失效" }, 401, extra);
  }

  protected async memberFromCookie(request: Request): Promise<(MemberRow & { bound_device: string }) | null> {
    const token = readCookie(request, SESSION_COOKIE);
    if (!token) return null;
    return this.memberByToken(token);
  }

  protected async me(request: Request): Promise<Response> {
    const member = await this.memberFromCookie(request);
    if (!member) return this.unauthorized(request);
    return json({ profile: this.profile(member), catalog: catalog() });
  }

  protected firstLook(member: MemberRow, body: Record<string, unknown> | null): Outcome {
    if (!body) return { status: 400, data: { error: "格式不對" } };
    if (body.displayName !== undefined) {
      const name = normalizeName(body.displayName);
      if (!name) return { status: 400, data: { error: "顯示名稱不可空白" } };
      this.sql.exec(`UPDATE members SET display_name = ? WHERE id = ?`, name, member.id);
    }
    if (body.animal !== undefined || body.look !== undefined) {
      if (member.animal) return { status: 403, data: { error: "請到廁所更換造型" } };
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

  protected dropSessions(memberId: string) {
    this.sql.exec(`DELETE FROM member_sessions WHERE member_id = ?`, memberId);
  }

  protected async issueSession(id: string, deviceKey: string): Promise<string> {
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

  protected async memberByToken(token: string): Promise<(MemberRow & { bound_device: string }) | null> {
    if (!token) return null;
    return this.memberBySession(await sessionHash(token));
  }

  // The same check every cookie request gets: the session row still exists for
  // the current office password epoch.
  protected memberBySession(stored: string): (MemberRow & { bound_device: string }) | null {
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
}
