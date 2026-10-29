// Pantry: hot drinks from the coffee machine, the microwave, tossing snacks and fridge notes.
import {
  HOT_DRINKS,
  inPantry,
  near,
  OVEN_ITEM,
  PANTRY_META,
  PantryRoom,
  propAnchor,
  TAP_GAP_MS,
  TOSS_REACH,
} from "./pantry";
import { type Att } from "./room-base";
import { RoomMeeting } from "./room-meeting";
import { SNACK_COOLDOWN_MS, SNACK_REACH, snackItem } from "./snacks";

export abstract class RoomPantry extends RoomMeeting {
  private pantryRoom: PantryRoom | null = null;
  private readonly pantryAt = new Map<string, number>();

  protected get pantry(): PantryRoom {
    if (!this.pantryRoom) {
      this.pantryRoom = new PantryRoom();
      this.pantryRoom.load(this.meta(PANTRY_META));
    }
    return this.pantryRoom;
  }

  protected pantryView() {
    return this.pantry.view(Date.now());
  }

  private rememberPantry() {
    const data = this.pantry.save();
    this.ctx.storage.transactionSync(() => this.setMeta(PANTRY_META, data));
  }

  private pantryError(ws: WebSocket, message: string) {
    this.send(ws, { t: "error", message });
  }

  /** Hands a pantry treat to someone and shows it in their hands for everyone. */
  protected handOver(ws: WebSocket, att: Att, itemId: string): boolean {
    if (this.toys.hand(att.id)) {
      this.pantryError(ws, "先把玩具放下");
      return false;
    }
    const replaced = Boolean(this.snacks.hand(att.id));
    if (!this.snacks.give(att.id, itemId)) return false;
    this.rememberHands();
    const item = snackItem(itemId);
    this.broadcast({ t: "snacks", stock: this.snacks.view(), hold: { id: att.id, item: itemId, pose: item?.pose || "eat", replaced } });
    return true;
  }

  protected onPantry(ws: WebSocket, att: Att, body: Record<string, unknown>) {
    const op = body.op;
    const now = Date.now();
    const gap = op === "brew" ? SNACK_COOLDOWN_MS : TAP_GAP_MS;
    if (now - (this.pantryAt.get(att.id) || 0) < gap) return this.pantryError(ws, "慢一點，稍等一下");
    if (op === "brew") {
      if (!near(att.x, att.y, this.furnitureCenter("coffee-1"), SNACK_REACH)) return this.pantryError(ws, "再靠近咖啡機一點");
      if (!HOT_DRINKS.includes(body.item as (typeof HOT_DRINKS)[number])) return this.pantryError(ws, "沒有這個");
      this.pantryAt.set(att.id, now);
      this.handOver(ws, att, String(body.item));
      return;
    }
    if (!inPantry(att.x, att.y, this.map.zones)) return this.pantryError(ws, "要在茶水間裡才能用");
    this.pantryAt.set(att.id, now);
    const room = this.pantry;
    if (op === "heat" || op === "unload") {
      if (!near(att.x, att.y, propAnchor(this.map.props, "kitchenMicrowave"))) return this.pantryError(ws, "再靠近微波爐一點");
      if (op === "heat") {
        const fail = room.heat(att.id, now);
        if (fail) return this.pantryError(ws, fail);
        this.broadcast({ t: "pantry", op: "oven", oven: room.ovenView(now) });
        return;
      }
      if (this.toys.hand(att.id)) return this.pantryError(ws, "先把玩具放下");
      const fail = room.unload(att.id, now);
      if (fail) return this.pantryError(ws, fail);
      this.broadcast({ t: "pantry", op: "oven", oven: null });
      this.handOver(ws, att, OVEN_ITEM);
    } else if (op === "toss") {
      const itemId = this.snacks.hand(att.id);
      const item = snackItem(itemId);
      if (!item) return this.pantryError(ws, "手上沒有零食可以丟");
      if (item.hot) return this.pantryError(ws, "熱的不能丟喔");
      const to = typeof body.to === "string" ? body.to : "";
      const target = to && to !== att.id ? this.socketOf(to) : null;
      if (!target || !inPantry(target.att.x, target.att.y, this.map.zones)) return this.pantryError(ws, "對方要在茶水間裡");
      if (Math.hypot(target.att.x - att.x, target.att.y - att.y) > TOSS_REACH) return this.pantryError(ws, "太遠了，丟不到");
      if (this.toys.hand(to) || this.snacks.hand(to)) return this.pantryError(ws, "對方手上有東西了");
      if (!this.snacks.pass(att.id, to)) return;
      this.rememberHands();
      this.broadcast({ t: "pantry", op: "toss", from: att.id, to, item: item.id, pose: item.pose });
    } else if (op === "stick" || op === "peel") {
      if (!near(att.x, att.y, propAnchor(this.map.props, "kitchenFridge"))) return this.pantryError(ws, "再靠近冰箱一點");
      if (op === "stick") {
        const note = room.stick(att.id, body.text, body.tint);
        if (!note) return this.pantryError(ws, "便利貼要寫點字");
        this.rememberPantry();
        this.broadcast({ t: "pantry", op: "notes", notes: room.view(now).notes });
      } else {
        if (!room.peel(body.id)) return this.pantryError(ws, "這張已經被撕掉了");
        this.rememberPantry();
        this.broadcast({ t: "pantry", op: "notes", notes: room.view(now).notes });
      }
    }
  }

  /** Someone left the office: their bun leaves with them. */
  protected settlePantry(att: Att) {
    this.pantryAt.delete(att.id);
    if (this.pantry.forget(att.id)) this.broadcast({ t: "pantry", op: "oven", oven: null });
  }
}
