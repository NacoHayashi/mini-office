// Meeting room: whiteboard, projector, raised hands and a quick vote.
// Everything here is plain data so it can be tested without a room.
import { normalizeChat, type Zone, zoneAt } from "./content";

export const MEETING_META = "meeting";
export const MEETING_ZONE = "meeting";
export const BOARD_W = 320;
export const BOARD_H = 180;
export const BOARD_STROKES = 80;
export const BOARD_POINTS = 64;
export const BOARD_NOTES = 8;
export const NOTE_CHARS = 24;
export const INKS = ["#5b4a6b", "#f07a9c", "#5fb3dd", "#6fbf6a"];
export const TITLE_CHARS = 30;
export const QUESTION_CHARS = 30;
export const OPTION_CHARS = 12;
export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 4;
// Drawing sends one finished stroke at a time; everything else is a tap.
export const DRAW_GAP_MS = 120;
export const TAP_GAP_MS = 300;

export const SLIDES = [
  { id: "hello", title: "大家早安", tint: "#ffe2ec" },
  { id: "goal", title: "本週目標", tint: "#e2f2ff" },
  { id: "break", title: "休息一下", tint: "#e6f7df" },
  { id: "thanks", title: "謝謝大家", tint: "#fff1d6" },
] as const;

export type Stroke = { ink: number; points: [number, number][]; by: string };
export type Note = { text: string; by: string };
export type Projector = { on: boolean; slide: string; title: string; by: string };
export type Vote = { question: string; options: string[]; by: string; open: boolean; ballots: Record<string, number> };

export function inMeeting(x: number, y: number, zones: Zone[]): boolean {
  return zoneAt(x, y, zones)?.id === MEETING_ZONE;
}

export function cleanLine(raw: unknown, max: number): string | null {
  const text = normalizeChat(raw);
  if (!text) return null;
  const cut = [...text].slice(0, max).join("").trim();
  return cut.length ? cut : null;
}

export function readStroke(raw: unknown, inkRaw: unknown): [number, number][] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > BOARD_POINTS) return null;
  if (!Number.isInteger(inkRaw) || (inkRaw as number) < 0 || (inkRaw as number) >= INKS.length) return null;
  const points: [number, number][] = [];
  for (const point of raw) {
    if (!Array.isArray(point) || point.length !== 2) return null;
    const [x, y] = point;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push([Math.max(0, Math.min(BOARD_W, Math.round(x))), Math.max(0, Math.min(BOARD_H, Math.round(y)))]);
  }
  return points;
}

export function readOptions(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const options: string[] = [];
  for (const item of raw) {
    const text = cleanLine(item, OPTION_CHARS);
    if (text && !options.includes(text)) options.push(text);
  }
  if (options.length < OPTIONS_MIN || options.length > OPTIONS_MAX) return null;
  return options;
}

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 40;

export class MeetingRoom {
  strokes: Stroke[] = [];
  notes: Note[] = [];
  projector: Projector = { on: false, slide: "", title: "", by: "" };
  vote: Vote | null = null;
  readonly hands = new Set<string>();

  load(raw: string | null) {
    this.strokes = [];
    this.notes = [];
    this.projector = { on: false, slide: "", title: "", by: "" };
    this.vote = null;
    if (!raw) return;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    if (!data || typeof data !== "object") return;
    if (Array.isArray(data.strokes)) {
      for (const row of data.strokes.slice(-BOARD_STROKES)) {
        const points = readStroke(row?.points, row?.ink);
        if (points && isId(row.by)) this.strokes.push({ ink: row.ink, points, by: row.by });
      }
    }
    if (Array.isArray(data.notes)) {
      for (const row of data.notes.slice(-BOARD_NOTES)) {
        const text = cleanLine(row?.text, NOTE_CHARS);
        if (text && isId(row.by)) this.notes.push({ text, by: row.by });
      }
    }
    const projector = data.projector as Record<string, unknown> | undefined;
    if (projector && typeof projector === "object") {
      const slide = SLIDES.some((item) => item.id === projector.slide) ? String(projector.slide) : "";
      const title = slide ? "" : cleanLine(projector.title, TITLE_CHARS) || "";
      this.projector = { on: Boolean(projector.on), slide, title, by: isId(projector.by) ? projector.by : "" };
    }
    const vote = data.vote as Record<string, unknown> | undefined;
    if (vote && typeof vote === "object") {
      const question = cleanLine(vote.question, QUESTION_CHARS);
      const options = readOptions(vote.options);
      if (question && options && isId(vote.by)) {
        const ballots: Record<string, number> = {};
        if (vote.ballots && typeof vote.ballots === "object") {
          for (const [id, pick] of Object.entries(vote.ballots as Record<string, unknown>)) {
            if (isId(id) && Number.isInteger(pick) && (pick as number) >= 0 && (pick as number) < options.length) ballots[id] = pick as number;
          }
        }
        this.vote = { question, options, by: vote.by, open: Boolean(vote.open), ballots };
      }
    }
  }

  save(): string {
    return JSON.stringify({ strokes: this.strokes, notes: this.notes, projector: this.projector, vote: this.vote });
  }

  boardView() {
    return { strokes: this.strokes.map((row) => ({ ...row, points: row.points.map((p) => [...p]) })), notes: this.notes.map((row) => ({ ...row })) };
  }

  voteView() {
    if (!this.vote) return null;
    const counts = this.vote.options.map(() => 0);
    for (const pick of Object.values(this.vote.ballots)) counts[pick] += 1;
    return { question: this.vote.question, options: [...this.vote.options], by: this.vote.by, open: this.vote.open, counts, ballots: { ...this.vote.ballots } };
  }

  view(present: (id: string) => boolean = () => true) {
    return {
      board: this.boardView(),
      projector: { ...this.projector },
      hands: [...this.hands].filter(present),
      vote: this.voteView(),
    };
  }

  draw(by: string, rawPoints: unknown, ink: unknown): Stroke | null {
    const points = readStroke(rawPoints, ink);
    if (!points) return null;
    const stroke = { ink: ink as number, points, by };
    this.strokes.push(stroke);
    if (this.strokes.length > BOARD_STROKES) this.strokes.splice(0, this.strokes.length - BOARD_STROKES);
    return stroke;
  }

  note(by: string, raw: unknown): Note | null {
    const text = cleanLine(raw, NOTE_CHARS);
    if (!text) return null;
    const note = { text, by };
    this.notes.push(note);
    if (this.notes.length > BOARD_NOTES) this.notes.splice(0, this.notes.length - BOARD_NOTES);
    return note;
  }

  clearBoard(): boolean {
    if (!this.strokes.length && !this.notes.length) return false;
    this.strokes = [];
    this.notes = [];
    return true;
  }

  /** Turns the projector on or off, or shows a preset slide or a short title. */
  project(by: string, body: Record<string, unknown>): string | null {
    if (body.on === false) {
      this.projector = { ...this.projector, on: false, by };
      return null;
    }
    if (typeof body.slide === "string" && body.slide) {
      if (!SLIDES.some((item) => item.id === body.slide)) return "沒有這張投影片";
      this.projector = { on: true, slide: body.slide, title: "", by };
      return null;
    }
    if (body.title !== undefined) {
      const title = cleanLine(body.title, TITLE_CHARS);
      if (!title) return "請輸入要投影的文字";
      this.projector = { on: true, slide: "", title, by };
      return null;
    }
    if (body.on === true) {
      this.projector = { ...this.projector, on: true, by };
      return null;
    }
    return "不知道要投影什麼";
  }

  raise(id: string, up: boolean): boolean {
    if (up === this.hands.has(id)) return false;
    if (up) this.hands.add(id);
    else this.hands.delete(id);
    return true;
  }

  startVote(by: string, question: unknown, options: unknown): string | null {
    if (this.vote?.open) return "已經有投票在進行";
    const ask = cleanLine(question, QUESTION_CHARS);
    if (!ask) return "請寫下要問的問題";
    const picks = readOptions(options);
    if (!picks) return `選項要 ${OPTIONS_MIN} 到 ${OPTIONS_MAX} 個，而且不能重複`;
    this.vote = { question: ask, options: picks, by, open: true, ballots: {} };
    return null;
  }

  cast(id: string, pick: unknown): string | null {
    if (!this.vote?.open) return "現在沒有投票";
    if (!Number.isInteger(pick) || (pick as number) < 0 || (pick as number) >= this.vote.options.length) return "沒有這個選項";
    this.vote.ballots[id] = pick as number;
    return null;
  }

  /** The person who asked can close the vote; anyone can once they have left the room. */
  endVote(id: string, askerHere: boolean): string | null {
    if (!this.vote?.open) return "現在沒有投票";
    if (this.vote.by !== id && askerHere) return "只有發起人可以結束投票";
    this.vote.open = false;
    return null;
  }
}
