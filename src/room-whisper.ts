// Whisper groups.
import { randomToken } from "./crypto";
import { type Att, WHISPER_ASK_MS, WHISPER_CAP, WHISPER_FAR, WHISPER_NEAR } from "./room-base";
import { RoomSnacks } from "./room-snacks";

export abstract class RoomWhisper extends RoomSnacks {
  protected onHush(ws: WebSocket, att: Att, body: Record<string, unknown>) {
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

  protected activeHush(): Array<{ group: string; members: string[] }> {
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

  protected membersOf(group: string): Array<{ ws: WebSocket; att: Att }> {
    const list: Array<{ ws: WebSocket; att: Att }> = [];
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attOf(ws);
      if (att?.whisper === group) list.push({ ws, att });
    }
    return list;
  }

  protected requestWhisper(ws: WebSocket, att: Att, group: string) {
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

  protected acceptWhisper(ws: WebSocket, att: Att, requesterId: string) {
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

  protected leaveWhisper(att: Att, ws: WebSocket | null) {
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

  protected dropWhisper(att: Att, ws: WebSocket) {
    this.leaveWhisper(att, ws);
  }

  protected keepWhisper(ws: WebSocket, att: Att) {
    if (!att.whisper) return;
    const others = this.membersOf(att.whisper).filter((member) => member.att.id !== att.id);
    const close = others.some((member) => Math.hypot(att.x - member.att.x, att.y - member.att.y) <= WHISPER_FAR);
    if (!others.length || !close) this.leaveWhisper(att, ws);
  }
}
