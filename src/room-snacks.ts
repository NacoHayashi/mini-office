// The snack machine and the restroom stalls.
import { furnitureSize, WALL_RADIUS } from "./content";
import { HANDS_META, MACHINE_ID, SNACK_META, type SnackMachine } from "./snacks";
import { STALL_COOLDOWN_MS, STALL_META } from "./stalls";
import { type Att } from "./room-base";
import { RoomToys } from "./room-toys";

export abstract class RoomSnacks extends RoomToys {
  protected onStall(ws: WebSocket, att: Att, body: Record<string, unknown>) {
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

  protected onSnack(ws: WebSocket, att: Att, body: Record<string, unknown>) {
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
    if (this.toys.hand(att.id)) {
      this.send(ws, { t: "error", message: "先把玩具放下" });
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

  protected loadSnacks() {
    this.snacks.load(this.meta(SNACK_META), this.meta(HANDS_META));
  }

  protected rememberSnacks() {
    const saved = this.snacks.save();
    const hands = this.snacks.saveHands();
    this.ctx.storage.transactionSync(() => {
      this.setMeta(SNACK_META, saved);
      this.setMeta(HANDS_META, hands);
    });
  }

  protected rememberHands() {
    this.setMeta(HANDS_META, this.snacks.saveHands());
  }

  protected machineAnchor(machine: SnackMachine): { x: number; y: number } | null {
    return this.furnitureCenter(MACHINE_ID[machine]);
  }

  protected furnitureCenter(id: string): { x: number; y: number } | null {
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
}
