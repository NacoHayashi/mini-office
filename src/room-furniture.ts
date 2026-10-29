// Furniture edit mode: adding, moving, and removing furniture.
import { FURNITURE, type Furn, furnitureFits, furnitureSize, isSeatKind, quarterRot } from "./content";
import { isFixedId } from "./snacks";
import { TOY_RACK_ID } from "./toys";
import { randomToken } from "./crypto";
import { type Att, FURN_MOVE_MS } from "./room-base";
import { RoomWhisper } from "./room-whisper";

export abstract class RoomFurniture extends RoomWhisper {
  protected onEdit(ws: WebSocket, att: Att, body: Record<string, unknown>) {
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

  protected onFurniture(ws: WebSocket, att: Att, body: Record<string, unknown>) {
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
      if (this.fixedFurniture(id)) {
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
      if (FURNITURE[kind]?.fixed) {
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
      if (this.fixedFurniture(id)) {
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

  /** Machines, the toy rack and the pantry stools never move. */
  private fixedFurniture(id: string): boolean {
    if (isFixedId(id) || id === TOY_RACK_ID) return true;
    const row = this.sql.exec<{ kind: string }>(`SELECT kind FROM furniture WHERE id = ?`, id).toArray()[0];
    return Boolean(row && FURNITURE[String(row.kind)]?.fixed);
  }

  protected furniture(): Array<Furn & { seat: string | null }> {
    this.ensureChairs();
    return this.sql.exec<Furn>(`SELECT id, kind, x, y, rot FROM furniture`).toArray().map((row) => {
      const id = String(row.id);
      const chair = isSeatKind(row.kind) ? this.chairs.get(id) : null;
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
}
