// Toys and bumping into each other.
import { bodyRadiusOf, WALL_RADIUS } from "./content";
import { LALA_REACH } from "./snacks";
import { type Body, BUMP_DISTANCES, isPlayToy, KNOCK_DISTANCES, knockSpot, openFloor, TOY_META, TOY_RACK_ID, type ToyFail } from "./toys";
import { type Att } from "./room-base";
import { RoomSeats } from "./room-seats";

export abstract class RoomToys extends RoomSeats {
  protected abstract furnitureCenter(id: string): { x: number; y: number } | null;

  protected onToy(ws: WebSocket, att: Att, body: Record<string, unknown>) {
    const now = Date.now();
    this.settleToys(now);
    const op = body.op;
    const snack = Boolean(this.snacks.hand(att.id));
    if (op === "take") {
      const result = this.toys.take(att.id, body.toy, att.x, att.y, this.furnitureCenter(TOY_RACK_ID), snack);
      if (!result.ok) return this.toyError(ws, result.reason);
      this.rememberToys();
      this.broadcastToys({ kind: "hold", by: att.id, toy: result.toy });
      return;
    }
    if (op === "back") {
      const result = this.toys.putBack(att.id, att.x, att.y, this.furnitureCenter(TOY_RACK_ID));
      if (!result.ok) return this.toyError(ws, result.reason);
      this.rememberToys();
      this.broadcastToys({ kind: "back", by: att.id, toy: result.toy });
      return;
    }
    if (op === "drop") {
      const result = this.toys.drop(att.id, att.x, att.y);
      if (!result.ok) return this.toyError(ws, result.reason);
      this.rememberToys();
      this.broadcastToys({ kind: "drop", by: att.id, toy: result.toy, x: result.x, y: result.y });
      return;
    }
    if (op === "catch") {
      const result = this.toys.catchBall(att.id, now, snack);
      if (!result.ok) return this.toyError(ws, result.reason);
      this.rememberToys();
      this.broadcastToys({ kind: "catch", by: att.id, from: result.by, combo: result.combo });
      this.scheduleToys();
      return;
    }
    if (op === "pinch" && body.on === false) {
      const ended = this.toys.pinchEnd(att.id);
      if (ended) this.broadcastToys({ kind: "pinch", by: ended.by, to: ended.to, on: false });
      this.scheduleToys();
      return;
    }
    if (op === "tidy") {
      if (Math.hypot(att.x - this.map.lala.x, att.y - this.map.lala.y) > LALA_REACH) {
        this.send(ws, { t: "error", message: "要先靠近 Lala 小姐才能請她收玩具" });
        return;
      }
      const moved = this.toys.tidy((id) => this.ctx.getWebSockets(id).some((socket) => this.attOf(socket)));
      if (moved.length) this.rememberToys();
      this.broadcastToys({ kind: "tidy", by: att.id, count: moved.length });
      return;
    }
    const me = this.toyBody(att);
    const other = typeof body.to === "string" && body.to !== att.id ? this.attachment(body.to) : null;
    const target = other ? this.toyBody(other) : null;
    const toy = this.toys.hand(att.id);
    if (op === "ram" || op === "bump") {
      const find = (who: Body, nx: number, ny: number) => this.knockFor(who, nx, ny, op === "bump");
      const result = op === "ram" ? this.toys.ram(me, target, now, find) : this.toys.bump(me, target, now, find);
      if (!result.ok || !other) {
        // The bumper car fires on every touch, so only a bump by hand says why it did nothing.
        if (op === "bump") this.toyError(ws, result.ok ? "none" : result.reason);
        return;
      }
      if (result.spot) this.knockTo(other.id, result.spot, now);
      this.broadcastToys({
        kind: op,
        by: att.id,
        to: result.to,
        nx: result.nx,
        ny: result.ny,
        knock: Boolean(result.spot),
        x: result.spot?.x ?? other.x,
        y: result.spot?.y ?? other.y,
      });
      return;
    }
    // Pinching starts with { op: "pinch", on: true } and ends with on: false. It needs no toy.
    if (op === "pinch" && body.on === true) {
      const result = this.toys.pinchStart(me, target, now);
      if (!result.ok) return this.toyError(ws, result.reason);
      this.broadcastToys({ kind: "pinch", by: att.id, to: result.to, on: true, ms: result.ms });
      this.scheduleToys();
      return;
    }
    if (op !== "use") return;
    if (!toy) return this.toyError(ws, "empty");
    if (toy === "ball") {
      const result = this.toys.throwBall(me, target, now, (who, nx, ny) => this.ballLanding(who, nx, ny));
      if (!result.ok) return this.toyError(ws, result.reason);
      this.rememberToys();
      this.broadcastToys({ kind: "throw", by: att.id, to: result.to, ms: result.ms, x: result.drop.x, y: result.drop.y, combo: result.combo });
      this.scheduleToys();
    } else if (isPlayToy(toy)) {
      const result = this.toys.play(me, target, toy, now);
      if (!result.ok) return this.toyError(ws, result.reason);
      const kind = toy === "hammer" ? "bonk" : toy;
      this.broadcastToys({ kind, by: att.id, to: result.to });
    } else {
      this.toyError(ws, "wrong");
    }
  }

  /** Moves someone to a knockback spot the server already checked is clear. */
  protected knockTo(id: string, spot: { x: number; y: number }, now: number) {
    const hit = this.socketOf(id);
    if (!hit) return;
    hit.att.x = spot.x;
    hit.att.y = spot.y;
    hit.att.lastMove = now;
    hit.att.knockAt = now;
    hit.ws.serializeAttachment(hit.att);
    this.keepWhisper(hit.ws, hit.att);
    this.persist(hit.att);
    // Every other socket of the same person follows too.
    for (const socket of this.ctx.getWebSockets(id)) {
      if (socket === hit.ws) continue;
      const att = this.attOf(socket);
      if (!att) continue;
      att.x = spot.x;
      att.y = spot.y;
      att.lastMove = now;
      att.knockAt = now;
      socket.serializeAttachment(att);
    }
  }

  protected toyBody(att: Att): Body {
    return { id: att.id, x: att.x, y: att.y, r: bodyRadiusOf(att.look), seated: Boolean(att.seat) };
  }

  protected toyError(ws: WebSocket, reason: ToyFail) {
    const messages: Partial<Record<ToyFail, string>> = {
      far: "再靠近一點",
      busy: "現在拿不到",
      full: "手上已經有玩具了",
      snack: "先把手上的零食吃完",
      empty: "手上沒有玩具",
      cool: "慢一點，等一下再玩",
      capped: "對方玩得夠多了，讓他休息一下",
      wrong: "手上的玩具不能這樣用",
      none: "旁邊沒有同事",
      seated: "坐著的人撞不動",
      early: "球還沒到",
      late: "沒接到",
      unknown: "沒有這個玩具",
    };
    const message = messages[reason];
    if (message) this.send(ws, { t: "error", message, toy: reason });
  }

  protected toyFloor(bodies: Body[], bodyRadius: number, radius = WALL_RADIUS) {
    return openFloor({
      walls: this.map.walls,
      props: this.map.props.filter((prop) => prop.kind !== "stalldoor"),
      furniture: this.solidFurniture(),
      bodies,
      bodyRadius,
      radius,
      extra: (x, y) => this.stalls.blocks(x, y, radius),
    });
  }

  // Knockback lands only where the whole slide is clear of walls, furniture, the map edge and other people.
  protected knockFor(target: Body, nx: number, ny: number, far = false) {
    const bodies: Body[] = [{ id: "lala", x: this.map.lala.x, y: this.map.lala.y, r: bodyRadiusOf({ body: "bean" }) }];
    for (const socket of this.ctx.getWebSockets()) {
      const other = this.attOf(socket);
      if (!other || other.id === target.id) continue;
      bodies.push({ id: other.id, x: other.x, y: other.y, r: bodyRadiusOf(other.look) });
    }
    this.ensureChairs();
    for (const chair of this.chairs.values()) {
      const center = this.chairCenter(chair);
      bodies.push({ id: chair.id, x: center.x, y: center.y, r: 18 });
    }
    return knockSpot(target, nx, ny, this.toyFloor(bodies, target.r), far ? BUMP_DISTANCES : KNOCK_DISTANCES);
  }

  protected ballLanding(target: Body, nx: number, ny: number) {
    const spot = knockSpot(target, nx, ny, this.toyFloor([], 0, WALL_RADIUS + 1), [40, 28, 16]);
    return spot || { x: target.x, y: target.y };
  }

  protected settleToys(now: number) {
    const done = this.toys.settle(now);
    if (done.dropped) {
      this.rememberToys();
      this.broadcastToys({ kind: "fall", to: done.dropped.to, x: done.dropped.x, y: done.dropped.y });
    }
    if (done.pinch) this.broadcastToys({ kind: "pinch", by: done.pinch.by, to: done.pinch.to, on: false });
    this.scheduleToys();
  }

  protected scheduleToys() {
    if (this.toyTimer) clearTimeout(this.toyTimer);
    this.toyTimer = null;
    const deadline = this.toys.nextDeadline();
    if (deadline == null) return;
    this.toyTimer = setTimeout(() => {
      this.toyTimer = null;
      this.settleToys(Date.now());
    }, Math.max(0, deadline - Date.now()) + 20);
  }

  protected broadcastToys(fx: Record<string, unknown> | null) {
    const view = this.toys.view((id) => this.ctx.getWebSockets(id).some((ws) => this.attOf(ws)));
    this.broadcast(fx ? { t: "toys", ...view, fx } : { t: "toys", ...view });
  }

  protected rememberToys() {
    this.setMeta(TOY_META, this.toys.save());
  }

  protected onBump(ws: WebSocket, att: Att, body: Record<string, unknown>) {
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
}
