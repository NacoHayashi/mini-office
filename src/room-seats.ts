// Chairs: sitting, standing up, gliding, and putting chairs back.
import {
  bodyRadiusOf,
  chairHomeRotation,
  type Furn,
  furnitureFits,
  furnitureSize,
  hitsSolid,
  type Look,
  quarterRot,
  restoreChairOccupants,
} from "./content";
import { type Att, type ChairLive, GLIDE_SAVE_MS, RESET_COOLDOWN_MS } from "./room-base";
import { RoomScores } from "./room-scores";

export abstract class RoomSeats extends RoomScores {
  protected abstract keepWhisper(ws: WebSocket, att: Att): void;

  protected onSit(ws: WebSocket, att: Att, body: Record<string, unknown>) {
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

  protected onReset(ws: WebSocket, att: Att) {
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

  protected onRise(ws: WebSocket, att: Att) {
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

  protected onGlide(ws: WebSocket, att: Att, body: Record<string, unknown>) {
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

  protected glideState(id: string, chair: ChairLive, snap: boolean) {
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

  protected ensureChairs() {
    if (this.chairsReady) return;
    this.chairsReady = true;
    for (const row of this.sql.exec<Furn>(`SELECT id, kind, x, y, rot FROM furniture`).toArray()) {
      if (row.kind !== "chair") continue;
      this.rememberChair({ id: String(row.id), x: Number(row.x), y: Number(row.y), rot: Number(row.rot) || 0 });
    }
  }

  protected rememberChair(row: { id: string; x: number; y: number; rot: number }) {
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

  protected chairLive(id: string): ChairLive | null {
    this.ensureChairs();
    return this.chairs.get(id) ?? null;
  }

  protected chairCenter(chair: ChairLive): { x: number; y: number } {
    return { x: chair.x + 16, y: chair.y + 13 };
  }

  protected attachment(id: string): Att | null {
    for (const ws of this.ctx.getWebSockets(id)) {
      const att = this.attOf(ws);
      if (att) return att;
    }
    return null;
  }

  protected releaseSeat(id: string) {
    this.ensureChairs();
    for (const chair of this.chairs.values()) {
      if (chair.occupant === id) {
        chair.occupant = null;
        chair.vx = 0;
        chair.vy = 0;
      }
    }
  }

  protected resetChairs(force: boolean) {
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

  protected freeBeside(chair: ChairLive, att: Att): { x: number; y: number } {
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

  protected spawnFor(id: string): { x: number; y: number } {
    let hash = 0;
    for (const char of id) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
    const col = (hash % 7) - 3;
    const x = this.map.spawn.x + col * 72;
    const y = this.map.spawn.y;
    if (this.inWall(x, y)) return { x: this.map.spawn.x, y: this.map.spawn.y };
    return { x, y };
  }

  protected separateFrom(
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

  protected solidFurniture(): Array<{ kind: string; x: number; y: number; rot: number }> {
    return this.sql
      .exec<{ kind: string; x: number; y: number; rot: number }>(`SELECT kind, x, y, rot FROM furniture WHERE kind != 'chair'`)
      .toArray()
      .map((row) => ({ kind: String(row.kind), x: Number(row.x), y: Number(row.y), rot: Number(row.rot) || 0 }));
  }

  protected restoreOccupants() {
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
}
