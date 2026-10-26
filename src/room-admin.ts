// The admin page: overview, members, office password, and import.
import { checkId, checkNewPassword } from "./content";
import { STALL_META } from "./stalls";
import { TOY_META } from "./toys";
import { adminSessionHash, adminSessionRecord, adminSessionState } from "./admin-session";
import { passwordHash, randomToken, sha256 } from "./crypto";
import { json } from "./http";
import { clearLiveOffice, deleteMemberData, exportOffice, restoreOffice, runMigrations } from "./migrations";
import { type Att, type MemberRow, readJson } from "./room-base";
import { RoomLogin } from "./room-login";

export abstract class RoomAdmin extends RoomLogin {
  protected async admin(request: Request, path: string): Promise<Response> {
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

  protected overview() {
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

  protected async adminSessionIssue(): Promise<Response> {
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

  protected async adminSessionCheck(request: Request): Promise<Response> {
    const body = await readJson(request);
    const token = typeof body?.token === "string" ? body.token : "";
    const state = await this.adminSessionLookup(token);
    if (state === "ok") return json({ ok: true });
    return json({ error: "未授權", reason: state }, 401);
  }

  protected async adminSessionDrop(request: Request): Promise<Response> {
    const body = await readJson(request);
    const token = typeof body?.token === "string" ? body.token : "";
    if (token) {
      this.sql.exec(`DELETE FROM admin_sessions WHERE token_hash = ?`, await adminSessionHash(token));
    }
    return json({ ok: true });
  }

  protected revokeAdminSessions() {
    this.sql.exec(`DELETE FROM admin_sessions`);
  }

  protected async adminSessionLookup(token: string): Promise<"ok" | "expired" | "missing"> {
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

  protected async setPassword(request: Request): Promise<Response> {
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

  protected async kick(request: Request): Promise<Response> {
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

  protected async importOffice(request: Request): Promise<Response> {
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
      reloadMeta: () => {
        this.loadSnacks();
        this.toys.load(this.meta(TOY_META));
      },
    });
    for (const ws of this.ctx.getWebSockets()) this.goodbye(ws, "restored");
    return json({ ok: true });
  }

  protected remove(id: string): Response {
    const checked = checkId(id);
    if (!checked.ok || !this.memberById(checked.id)) return json({ error: "找不到這個 ID" }, 404);
    deleteMemberData(this.officeSql(), checked.id);
    for (const ws of this.ctx.getWebSockets(checked.id)) this.goodbye(ws, "removed");
    return json({ ok: true });
  }

  protected removeDevice(memberId: string, deviceId: string): Response {
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

  protected async adminGate(request: Request): Promise<Response> {
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
}
