// Meeting room: whiteboard, projector, raised hands, quick votes and room-only chat.
import { DRAW_GAP_MS, inMeeting, MEETING_META, MeetingRoom, TAP_GAP_MS } from "./meeting";
import { type Att } from "./room-base";
import { RoomFurniture } from "./room-furniture";

export abstract class RoomMeeting extends RoomFurniture {
  private meetingRoom: MeetingRoom | null = null;
  private readonly meetingAt = new Map<string, number>();

  protected get meeting(): MeetingRoom {
    if (!this.meetingRoom) {
      this.meetingRoom = new MeetingRoom();
      this.meetingRoom.load(this.meta(MEETING_META));
    }
    return this.meetingRoom;
  }

  protected inMeetingRoom(att: Att): boolean {
    return inMeeting(att.x, att.y, this.map.zones);
  }

  protected meetingView() {
    return this.meeting.view((id) => this.ctx.getWebSockets(id).some((ws) => this.attOf(ws)));
  }

  private rememberMeeting() {
    const data = this.meeting.save();
    this.ctx.storage.transactionSync(() => this.setMeta(MEETING_META, data));
  }

  private meetingError(ws: WebSocket, message: string) {
    this.send(ws, { t: "error", message });
  }

  protected onMeeting(ws: WebSocket, att: Att, body: Record<string, unknown>) {
    const op = body.op;
    if (!this.inMeetingRoom(att)) return this.meetingError(ws, "要在會議室裡才能用");
    const now = Date.now();
    // Drawing and button taps keep separate paces, so a stroke still on its way never swallows a tap.
    const gap = op === "draw" ? DRAW_GAP_MS : TAP_GAP_MS;
    const pace = `${att.id}:${op === "draw" ? "draw" : "tap"}`;
    if (now - (this.meetingAt.get(pace) || 0) < gap) return this.meetingError(ws, "太快了，稍等一下");
    this.meetingAt.set(pace, now);
    const room = this.meeting;
    if (op === "draw") {
      const stroke = room.draw(att.id, body.points, body.ink);
      if (!stroke) return;
      this.rememberMeeting();
      this.broadcast({ t: "meeting", op: "draw", stroke });
    } else if (op === "note") {
      const note = room.note(att.id, body.text);
      if (!note) return this.meetingError(ws, "便利貼要寫點字");
      this.rememberMeeting();
      this.broadcast({ t: "meeting", op: "note", note });
    } else if (op === "clear") {
      // An already-empty board still answers, so the asker's copy ends up empty too.
      if (!room.clearBoard()) return this.send(ws, { t: "meeting", op: "clear", by: att.id });
      this.rememberMeeting();
      this.broadcast({ t: "meeting", op: "clear", by: att.id });
    } else if (op === "project") {
      const fail = room.project(att.id, body);
      if (fail) return this.meetingError(ws, fail);
      this.rememberMeeting();
      this.broadcast({ t: "meeting", op: "project", projector: { ...room.projector } });
    } else if (op === "hand") {
      if (room.raise(att.id, Boolean(body.up))) this.broadcast({ t: "meeting", op: "hand", id: att.id, up: Boolean(body.up) });
    } else if (op === "ask") {
      const fail = room.startVote(att.id, body.question, body.options);
      if (fail) return this.meetingError(ws, fail);
      this.rememberMeeting();
      this.broadcast({ t: "meeting", op: "vote", vote: room.voteView() });
    } else if (op === "pick") {
      const fail = room.cast(att.id, body.pick);
      if (fail) return this.meetingError(ws, fail);
      this.rememberMeeting();
      this.broadcast({ t: "meeting", op: "vote", vote: room.voteView() });
    } else if (op === "end") {
      const asker = room.vote ? this.socketOf(room.vote.by) : null;
      const fail = room.endVote(att.id, Boolean(asker && this.inMeetingRoom(asker.att)));
      if (fail) return this.meetingError(ws, fail);
      this.rememberMeeting();
      this.broadcast({ t: "meeting", op: "vote", vote: room.voteView() });
    }
  }

  /** A raised hand goes down once its owner walks out of the room or leaves. */
  protected settleHand(att: Att, gone = false) {
    if (gone) {
      this.meetingAt.delete(`${att.id}:draw`);
      this.meetingAt.delete(`${att.id}:tap`);
    }
    if (!this.meeting.hands.has(att.id)) return;
    if (!gone && this.inMeetingRoom(att)) return;
    this.meeting.raise(att.id, false);
    this.broadcast({ t: "meeting", op: "hand", id: att.id, up: false });
  }

  /** Chat said inside the meeting room stays there. Returns false for chat elsewhere. */
  protected roomChat(att: Att, text: string, at: number): boolean {
    if (!this.inMeetingRoom(att)) return false;
    const payload = { t: "chat", id: att.id, text, at, room: "meeting" };
    for (const socket of this.ctx.getWebSockets()) {
      const other = this.attOf(socket);
      if (other && (other.id === att.id || this.inMeetingRoom(other))) this.send(socket, payload);
    }
    return true;
  }
}
