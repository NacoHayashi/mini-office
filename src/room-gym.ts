// Gym: dumbbell sets on the leaderboard, yoga on the mats, the bouncy ball and the water cooler.
import { BOUNCE_GAP_MS, BUFF_MS, decorOf, GYM_META, GYM_REACH, GymRoom, inGym, LIFT_GAP_MS, onDecor } from "./gym";
import { near, propAnchor } from "./pantry";
import { type Att } from "./room-base";
import { RoomPantry } from "./room-pantry";
import { SNACK_COOLDOWN_MS } from "./snacks";

export abstract class RoomGym extends RoomPantry {
  private gymRoom: GymRoom | null = null;
  private readonly gymAt = new Map<string, number>();

  protected get gym(): GymRoom {
    if (!this.gymRoom) {
      this.gymRoom = new GymRoom();
      this.gymRoom.load(this.meta(GYM_META));
    }
    return this.gymRoom;
  }

  protected gymView(memberId: string) {
    const view = this.gym.view(Date.now(), (id) => this.socketOf(id)?.att || null);
    return { ...view, mine: this.gym.mine(memberId) };
  }

  private gymError(ws: WebSocket, message: string) {
    this.send(ws, { t: "error", message });
  }

  private handsFull(att: Att): boolean {
    return Boolean(this.toys.hand(att.id) || this.snacks.hand(att.id));
  }

  protected onGym(ws: WebSocket, att: Att, body: Record<string, unknown>) {
    const op = body.op;
    if (op === "yoga" && body.on === false) {
      if (this.gym.poses.delete(att.id)) this.broadcast({ t: "gym", op: "pose", id: att.id, on: false });
      return;
    }
    if (!inGym(att.x, att.y, this.map.zones)) return this.gymError(ws, "要在健身房裡才能用");
    const now = Date.now();
    const gap = op === "lift" ? LIFT_GAP_MS : op === "drink" ? SNACK_COOLDOWN_MS : BOUNCE_GAP_MS;
    const props = this.map.props;
    if (now - (this.gymAt.get(att.id) || 0) < gap) return this.gymError(ws, "慢一點，喘口氣");
    if (op === "lift") {
      if (!near(att.x, att.y, propAnchor(props, "gym-dumbbells"), GYM_REACH)) return this.gymError(ws, "再靠近啞鈴架一點");
      if (this.handsFull(att)) return this.gymError(ws, "先把手上的東西放下");
      this.gymAt.set(att.id, now);
      const sets = this.gym.lift(att.id, att.name, now);
      this.ctx.storage.transactionSync(() => this.setMeta(GYM_META, this.gym.save()));
      this.broadcast({ t: "gym", op: "lift", id: att.id, sets, buff: BUFF_MS, board: this.gym.top() });
    } else if (op === "yoga") {
      if (att.seat || !onDecor(att.x, att.y, decorOf(props, "gym-mats"))) return this.gymError(ws, "站到瑜珈墊上");
      if (this.handsFull(att)) return this.gymError(ws, "先把手上的東西放下");
      this.gymAt.set(att.id, now);
      this.gym.poses.set(att.id, { x: att.x, y: att.y });
      this.broadcast({ t: "gym", op: "pose", id: att.id, on: true });
    } else if (op === "bounce") {
      if (!near(att.x, att.y, propAnchor(props, "gym-ball"), GYM_REACH)) return this.gymError(ws, "再靠近彈力球一點");
      this.gymAt.set(att.id, now);
      this.broadcast({ t: "gym", op: "bounce", by: att.id });
    } else if (op === "drink") {
      if (!near(att.x, att.y, propAnchor(props, "gym-cooler"), GYM_REACH)) return this.gymError(ws, "再靠近飲水機一點");
      this.gymAt.set(att.id, now);
      this.handOver(ws, att, "water");
    }
  }

  /** Someone left the office: their pose and buff go with them. */
  protected settleGym(att: Att) {
    this.gymAt.delete(att.id);
    this.gym.forget(att.id);
  }
}
