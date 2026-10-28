// Meeting room: a shared whiteboard, the big screen, raised hands and quick votes.
// Chat said inside the room only reaches people in the room; the server handles that.
import * as THREE from "./vendor/three.module.js";
import { paintScreen } from "./monitors.js";

// Keep in sync with src/meeting.ts.
export const BOARD_W = 320;
export const BOARD_H = 180;
export const BOARD_POINTS = 64;
export const NOTE_CHARS = 24;
export const TITLE_CHARS = 30;
export const QUESTION_CHARS = 30;
export const OPTION_CHARS = 12;
export const OPTIONS_MAX = 4;
export const INKS = ["#5b4a6b", "#f07a9c", "#5fb3dd", "#6fbf6a"];
export const INK_NAMES = ["墨色", "粉紅", "天藍", "草綠"];
export const SLIDES = [
  { id: "hello", title: "大家早安", tint: "#ffe2ec" },
  { id: "goal", title: "本週目標", tint: "#e2f2ff" },
  { id: "break", title: "休息一下", tint: "#e6f7df" },
  { id: "thanks", title: "謝謝大家", tint: "#fff1d6" },
];
const NOTE_TINTS = ["#fff1a8", "#ffd6e4", "#d8efff", "#e0f6d4"];
// Strokes go out one at a time a little slower than the server's pace.
const SEND_GAP_MS = 140;
// Board face of the whiteboard furniture, in its own units.
const FACE = { w: 35.6, h: 20, y: 30, z: 2.6 };

export function inMeetingRoom(map, x, y) {
  if (!map?.zones || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const tile = map.tile || 32;
  const tx = Math.floor(x / tile);
  const ty = Math.floor(y / tile);
  return map.zones.some((zone) => zone.id === "meeting" && tx >= zone.x && ty >= zone.y && tx < zone.x + zone.w && ty < zone.y + zone.h);
}

/** Drops points closer than `gap` board units so a stroke stays short. */
export function thinStroke(points, gap = 3) {
  const out = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) >= gap) out.push([Math.round(point[0]), Math.round(point[1])]);
  }
  return out;
}

/** Splits a long stroke into pieces the server accepts; pieces share their joining point. */
export function splitStroke(points, max = BOARD_POINTS) {
  if (points.length <= max) return points.length ? [points] : [];
  const parts = [];
  for (let start = 0; start < points.length - 1; start += max - 1) parts.push(points.slice(start, start + max));
  return parts;
}

export function voteTally(vote) {
  if (!vote) return { total: 0, top: [] };
  const counts = vote.counts || vote.options.map(() => 0);
  const total = counts.reduce((sum, value) => sum + value, 0);
  const best = Math.max(0, ...counts);
  const top = best > 0 ? vote.options.filter((_, index) => counts[index] === best) : [];
  return { total, top };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, max, size, weight = 800) {
  let px = size;
  ctx.font = `${weight} ${px}px "Noto Sans TC", "PingFang TC", sans-serif`;
  while (px > 10 && ctx.measureText(text).width > max) {
    px -= 2;
    ctx.font = `${weight} ${px}px "Noto Sans TC", "PingFang TC", sans-serif`;
  }
  return px;
}

/** Paints the whiteboard: strokes, then sticky notes down the right edge. */
export function paintBoard(ctx, board, width, height, pending = null) {
  const sx = width / BOARD_W;
  const sy = height / BOARD_H;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fffdfb";
  ctx.fillRect(0, 0, width, height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const line = (stroke) => {
    const points = stroke.points || [];
    if (!points.length) return;
    ctx.strokeStyle = INKS[stroke.ink] || INKS[0];
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 3 * sx;
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0][0] * sx, points[0][1] * sy, 1.6 * sx, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(points[0][0] * sx, points[0][1] * sy);
    for (const point of points.slice(1)) ctx.lineTo(point[0] * sx, point[1] * sy);
    ctx.stroke();
  };
  for (const stroke of board?.strokes || []) line(stroke);
  if (pending) line(pending);
  const notes = board?.notes || [];
  notes.forEach((note, index) => {
    const w = 104 * sx;
    const h = 19 * sy;
    const x = width - w - 6 * sx;
    const y = (5 + index * 21.5) * sy;
    ctx.fillStyle = NOTE_TINTS[index % NOTE_TINTS.length];
    roundRect(ctx, x, y, w, h, 4 * sx);
    ctx.fill();
    ctx.fillStyle = "#5b4a6b";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    fitText(ctx, note.text, w - 8 * sx, Math.round(11 * sy), 700);
    ctx.fillText(note.text, x + 4 * sx, y + h / 2 + 0.5);
  });
  ctx.restore();
}

/** Paints what the big screen shows; a soft pastel card with one big line. */
export function paintSlide(ctx, projector, width, height) {
  const slide = SLIDES.find((item) => item.id === projector?.slide);
  const title = slide ? slide.title : projector?.title || "";
  ctx.save();
  ctx.fillStyle = slide?.tint || "#f3ecff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  roundRect(ctx, width * 0.06, height * 0.12, width * 0.88, height * 0.76, height * 0.1);
  ctx.fill();
  // Little stars in the corners, Chiikawa-sticker style.
  ctx.fillStyle = "#ffd36e";
  for (const [x, y, r] of [[0.1, 0.18, 0.05], [0.9, 0.82, 0.045], [0.88, 0.2, 0.03]]) {
    const cx = width * x;
    const cy = height * y;
    const rr = height * r;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 ? rr * 0.45 : rr;
      ctx.lineTo(cx + Math.cos(angle) * rad, cy + Math.sin(angle) * rad);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = "#5b4a6b";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  fitText(ctx, title, width * 0.8, Math.round(height * 0.26));
  ctx.fillText(title, width / 2, height / 2);
  ctx.restore();
}

function canvasPlane(width, height, w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  mesh.userData.canvas = canvas;
  mesh.userData.texture = texture;
  return mesh;
}

export function attachMeeting(env) {
  const { state, world, $, send } = env;
  let board = { strokes: [], notes: [] };
  let projector = { on: false, slide: "", title: "", by: "" };
  let vote = null;
  state.hands = new Set();
  let here = false;
  let bar = null;
  let panel = null;
  let tool = "";
  let ink = 0;
  let drawing = null;
  const outbox = [];
  let outTimer = 0;
  let lastSent = 0;
  let boardVersion = 1;
  let screenVersion = 1;
  // Wiping asks once more and waits for an answer; no clock is involved, so a slow phone cannot miss it.
  let clearAsked = false;
  let paintedBoard = { mesh: null, version: 0 };
  let paintedScreen = { mesh: null, version: 0 };

  // ---- state from the server ------------------------------------------------

  function applyView(view) {
    if (!view || typeof view !== "object") return;
    board = { strokes: Array.isArray(view.board?.strokes) ? view.board.strokes : [], notes: Array.isArray(view.board?.notes) ? view.board.notes : [] };
    if (view.projector) projector = { ...view.projector };
    vote = view.vote || null;
    state.hands = new Set(Array.isArray(view.hands) ? view.hands : []);
    boardVersion += 1;
    screenVersion += 1;
    repaint();
  }

  function onNet(message) {
    if (message.t === "welcome") {
      applyView(message.meeting);
      return;
    }
    if (message.t === "leave" && typeof message.id === "string") {
      state.hands.delete(message.id);
      return;
    }
    if (message.t !== "meeting") return;
    if (message.op === "draw" && message.stroke) {
      board.strokes.push(message.stroke);
      if (board.strokes.length > 80) board.strokes.splice(0, board.strokes.length - 80);
      boardVersion += 1;
    } else if (message.op === "note" && message.note) {
      board.notes.push(message.note);
      if (board.notes.length > 8) board.notes.splice(0, board.notes.length - 8);
      boardVersion += 1;
    } else if (message.op === "clear") {
      board = { strokes: [], notes: [] };
      if (clearAsked) askClear(false);
      boardVersion += 1;
    } else if (message.op === "project" && message.projector) {
      projector = { ...message.projector };
      screenVersion += 1;
    } else if (message.op === "hand" && typeof message.id === "string") {
      if (message.up) state.hands.add(message.id);
      else state.hands.delete(message.id);
    } else if (message.op === "vote") {
      vote = message.vote || null;
    }
    repaint();
  }

  // ---- toolbar and panel ----------------------------------------------------

  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "meet-bar";
    bar.hidden = true;
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "會議室");
    bar.innerHTML = '<button type="button" data-tool="board">白板</button><button type="button" data-tool="screen">螢幕</button><button type="button" data-tool="hand">舉手</button><button type="button" data-tool="vote">投票</button>';
    bar.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("button[data-tool]") : null;
      if (!button) return;
      const pick = button.dataset.tool;
      if (pick === "hand") {
        raiseHand(!state.hands.has(state.me?.id));
        return;
      }
      open(tool === pick ? "" : pick);
    });
    document.body.appendChild(bar);
    return bar;
  }

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = "meet-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-labelledby", "meet-title");
    panel.innerHTML = '<div class="meet-head"><b id="meet-title"></b><button type="button" class="ghost" id="meet-close">關閉</button></div><div class="meet-body"></div>';
    document.body.appendChild(panel);
    panel.querySelector("#meet-close").addEventListener("click", () => open(""));
    window.addEventListener("keydown", (event) => {
      if (!isOpen() || event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      open("");
    }, true);
    return panel;
  }

  function el(tag, props = {}, kids = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === "text") node.textContent = value;
      else if (key === "on") for (const [type, fn] of Object.entries(value)) node.addEventListener(type, fn);
      else if (key === "data") Object.assign(node.dataset, value);
      else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? "" : value);
    }
    node.append(...kids);
    return node;
  }

  function askClear(ask) {
    clearAsked = ask;
    const button = panel?.querySelector("#meet-clear");
    if (button) {
      button.textContent = ask ? "確定擦掉" : "擦乾淨";
      button.classList.toggle("ghost", !ask);
      button.classList.toggle("warn", ask);
    }
    const back = panel?.querySelector("#meet-clear-no");
    if (back) back.hidden = !ask;
  }

  function open(next) {
    clearAsked = false;
    tool = next;
    const box = ensurePanel();
    box.hidden = !next;
    box.dataset.tool = next;
    if (!next) {
      drawing = null;
      paintBar();
      return;
    }
    const title = { board: "白板", screen: "會議螢幕", vote: "投票" }[next] || "";
    box.querySelector("#meet-title").textContent = title;
    const body = box.querySelector(".meet-body");
    body.replaceChildren();
    if (next === "board") buildBoard(body);
    else if (next === "screen") buildScreen(body);
    else if (next === "vote") buildVote(body);
    paintBar();
  }

  function buildBoard(body) {
    const canvas = el("canvas", { id: "meet-canvas", width: BOARD_W * 2, height: BOARD_H * 2, "aria-label": "白板，可以用手指或滑鼠畫" });
    canvas.style.touchAction = "none";
    const toBoard = (event) => {
      const rect = canvas.getBoundingClientRect();
      return [
        Math.max(0, Math.min(BOARD_W, ((event.clientX - rect.left) / rect.width) * BOARD_W)),
        Math.max(0, Math.min(BOARD_H, ((event.clientY - rect.top) / rect.height) * BOARD_H)),
      ];
    };
    canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      canvas.setPointerCapture?.(event.pointerId);
      drawing = { ink, points: [toBoard(event)], pointer: event.pointerId };
      paintPanelBoard();
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drawing || drawing.pointer !== event.pointerId) return;
      drawing.points.push(toBoard(event));
      paintPanelBoard();
    });
    const finish = (event) => {
      if (!drawing || drawing.pointer !== event.pointerId) return;
      const points = thinStroke(drawing.points);
      const used = drawing.ink;
      drawing = null;
      for (const part of splitStroke(points)) queueStroke(used, part);
      paintPanelBoard();
    };
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
    const inks = el("div", { class: "meet-inks", role: "group", "aria-label": "筆的顏色" });
    INKS.forEach((color, index) => {
      const swatch = el("button", { type: "button", class: "ink", "aria-label": INK_NAMES[index], "aria-pressed": String(index === ink), data: { ink: String(index) } });
      swatch.style.setProperty("--ink", color);
      swatch.addEventListener("click", () => {
        ink = index;
        for (const node of inks.querySelectorAll("button")) node.setAttribute("aria-pressed", String(node === swatch));
      });
      inks.append(swatch);
    });
    const clear = el("button", { type: "button", class: "ghost", id: "meet-clear", text: "擦乾淨" });
    // The first tap only asks; the board is wiped by tapping 確定擦掉, or kept with 先不要.
    clear.addEventListener("click", () => {
      if (!clearAsked) {
        askClear(true);
        return;
      }
      askClear(false);
      send({ t: "meeting", op: "clear" });
    });
    const keep = el("button", { type: "button", class: "ghost", id: "meet-clear-no", text: "先不要", hidden: true });
    keep.addEventListener("click", () => askClear(false));
    const tools = el("div", { class: "meet-row" }, [inks, clear, keep]);
    const input = el("input", { id: "meet-note", maxlength: String(NOTE_CHARS), placeholder: "寫一張便利貼…", autocomplete: "off", "aria-label": "便利貼內容" });
    const form = el("form", { class: "meet-row", id: "meet-note-form" }, [input, el("button", { type: "submit", text: "貼上" })]);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      send({ t: "meeting", op: "note", text });
      input.value = "";
    });
    body.append(canvas, tools, form);
    paintPanelBoard();
  }

  function buildScreen(body) {
    const preview = el("canvas", { id: "meet-slide", width: 320, height: 180, "aria-label": "螢幕預覽" });
    const power = el("button", { type: "button", id: "meet-power" });
    power.addEventListener("click", () => send({ t: "meeting", op: "project", on: !projector.on }));
    const slides = el("div", { class: "meet-grid" });
    for (const slide of SLIDES) {
      const button = el("button", { type: "button", class: "item", text: slide.title, data: { slide: slide.id } });
      button.style.setProperty("--tint", slide.tint);
      button.addEventListener("click", () => send({ t: "meeting", op: "project", slide: slide.id }));
      slides.append(button);
    }
    const input = el("input", { id: "meet-title-input", maxlength: String(TITLE_CHARS), placeholder: "或打一句話放上螢幕…", autocomplete: "off", "aria-label": "螢幕上的文字" });
    const form = el("form", { class: "meet-row", id: "meet-title-form" }, [input, el("button", { type: "submit", text: "放上螢幕" })]);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      send({ t: "meeting", op: "project", title });
      input.value = "";
    });
    body.append(preview, el("div", { class: "meet-row" }, [power]), slides, form);
    paintPanelScreen();
  }

  function buildVote(body) {
    body.append(el("div", { class: "meet-vote" }));
    paintPanelVote();
  }

  function paintPanelBoard() {
    if (tool !== "board" || !panel) return;
    const canvas = panel.querySelector("#meet-canvas");
    if (!canvas) return;
    const pending = drawing ? { ink: drawing.ink, points: drawing.points } : null;
    const queued = { strokes: [...board.strokes, ...outbox.map((row) => ({ ink: row.ink, points: row.points }))], notes: board.notes };
    paintBoard(canvas.getContext("2d"), queued, canvas.width, canvas.height, pending);
  }

  function paintPanelScreen() {
    if (tool !== "screen" || !panel) return;
    const preview = panel.querySelector("#meet-slide");
    const ctx = preview?.getContext("2d");
    if (ctx) {
      if (projector.on) paintSlide(ctx, projector, preview.width, preview.height);
      else {
        ctx.fillStyle = "#3a3346";
        ctx.fillRect(0, 0, preview.width, preview.height);
        ctx.fillStyle = "#cbbfd8";
        ctx.font = '700 18px "Noto Sans TC", sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("螢幕關著", preview.width / 2, preview.height / 2);
      }
    }
    const power = panel.querySelector("#meet-power");
    if (power) {
      power.textContent = projector.on ? "關掉螢幕" : "打開螢幕";
      power.setAttribute("aria-pressed", String(projector.on));
    }
    for (const button of panel.querySelectorAll("[data-slide]")) {
      button.setAttribute("aria-pressed", String(projector.on && projector.slide === button.dataset.slide));
    }
  }

  function paintPanelVote() {
    if (tool !== "vote" || !panel) return;
    const box = panel.querySelector(".meet-vote");
    if (!box) return;
    // Keep what someone is typing while votes come in.
    if (!vote?.open && box.dataset.mode === "ask" && box.querySelector("form")) {
      paintResult(box.querySelector(".meet-last"));
      return;
    }
    box.replaceChildren();
    const me = state.me?.id;
    if (vote?.open) {
      box.dataset.mode = "open";
      box.append(el("p", { class: "meet-question", text: vote.question }));
      const mine = vote.ballots ? vote.ballots[me] : undefined;
      const { total } = voteTally(vote);
      const grid = el("div", { class: "meet-options" });
      vote.options.forEach((option, index) => {
        const count = vote.counts?.[index] || 0;
        const share = total ? Math.round((count / total) * 100) : 0;
        const button = el("button", { type: "button", class: "item", "aria-pressed": String(mine === index), data: { pick: String(index) } }, [
          el("span", { text: option }),
          el("span", { class: "count", text: `${count} 票` }),
        ]);
        button.style.setProperty("--share", `${share}%`);
        button.addEventListener("click", () => send({ t: "meeting", op: "pick", pick: index }));
        grid.append(button);
      });
      box.append(grid, el("p", { class: "muted", text: `@${vote.by} 發起，已有 ${total} 人投票` }));
      const end = el("button", { type: "button", class: "ghost", id: "meet-end", text: "結束投票" });
      end.addEventListener("click", () => send({ t: "meeting", op: "end" }));
      box.append(el("div", { class: "meet-row" }, [end]));
      return;
    }
    box.dataset.mode = "ask";
    const question = el("input", { id: "meet-question", maxlength: String(QUESTION_CHARS), placeholder: "想問大家什麼？", autocomplete: "off", "aria-label": "投票問題" });
    const options = [];
    for (let i = 0; i < OPTIONS_MAX; i++) {
      options.push(el("input", { class: "meet-option", maxlength: String(OPTION_CHARS), placeholder: i < 2 ? `選項 ${i + 1}` : `選項 ${i + 1}（可不填）`, autocomplete: "off", "aria-label": `選項 ${i + 1}` }));
    }
    const form = el("form", { id: "meet-ask" }, [question, el("div", { class: "meet-grid" }, options), el("div", { class: "meet-row" }, [el("button", { type: "submit", text: "開始投票" })])]);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      send({ t: "meeting", op: "ask", question: question.value.trim(), options: options.map((input) => input.value.trim()).filter(Boolean) });
    });
    const last = el("div", { class: "meet-last" });
    box.append(form, last);
    paintResult(last);
  }

  function paintResult(node) {
    if (!node) return;
    node.replaceChildren();
    if (!vote || vote.open) return;
    const { total, top } = voteTally(vote);
    node.append(el("p", { class: "meet-question", text: `上一題：${vote.question}` }));
    const list = el("ul", { class: "meet-results" });
    vote.options.forEach((option, index) => {
      list.append(el("li", { text: `${option}　${vote.counts?.[index] || 0} 票` }));
    });
    node.append(list, el("p", { class: "muted", text: total ? `最多人選：${top.join("、")}` : "沒有人投票" }));
  }

  function paintBar() {
    if (!bar) return;
    const raised = state.hands.has(state.me?.id);
    for (const button of bar.querySelectorAll("button[data-tool]")) {
      const pick = button.dataset.tool;
      if (pick === "hand") {
        button.textContent = raised ? "放下手" : "舉手";
        button.setAttribute("aria-pressed", String(raised));
      } else {
        button.setAttribute("aria-pressed", String(tool === pick));
        if (pick === "vote") button.classList.toggle("live", Boolean(vote?.open));
      }
    }
  }

  function repaint() {
    paintBar();
    paintPanelBoard();
    paintPanelScreen();
    paintPanelVote();
  }

  // ---- sending --------------------------------------------------------------

  function queueStroke(useInk, points) {
    if (!points.length) return;
    outbox.push({ ink: useInk, points });
    pump();
  }

  function pump() {
    if (outTimer || !outbox.length) return;
    const wait = Math.max(0, lastSent + SEND_GAP_MS - performance.now());
    outTimer = setTimeout(() => {
      outTimer = 0;
      const next = outbox.shift();
      if (next) {
        lastSent = performance.now();
        send({ t: "meeting", op: "draw", ink: next.ink, points: next.points });
      }
      pump();
    }, wait);
  }

  function raiseHand(up) {
    if (!state.me) return;
    send({ t: "meeting", op: "hand", up });
  }

  // ---- the room in 3D -------------------------------------------------------

  function dressBoard(mesh) {
    let plane = mesh.userData.meetBoard;
    if (!plane) {
      plane = canvasPlane(BOARD_W * 2, BOARD_H * 2, FACE.w, FACE.h);
      plane.position.set(0, FACE.y, FACE.z);
      plane.name = "meetBoard";
      mesh.add(plane);
      mesh.userData.meetBoard = plane;
    }
    if (paintedBoard.mesh !== plane || paintedBoard.version !== boardVersion) {
      paintBoard(plane.userData.canvas.getContext("2d"), board, plane.userData.canvas.width, plane.userData.canvas.height);
      plane.userData.texture.needsUpdate = true;
      paintedBoard = { mesh: plane, version: boardVersion };
    }
  }

  function dressScreen(group) {
    let plane = group.userData.meetScreen;
    if (!plane) {
      group.updateMatrixWorld(true);
      const box = new THREE.Box3();
      group.traverse((node) => {
        if (node.isMesh && node.userData.screen) box.expandByObject(node);
      });
      if (box.isEmpty()) return;
      const inverse = group.matrixWorld.clone().invert();
      box.applyMatrix4(inverse);
      const w = box.max.x - box.min.x;
      const h = box.max.y - box.min.y;
      plane = canvasPlane(512, Math.max(64, Math.round((512 * h) / Math.max(1, w))), w * 0.98, h * 0.97);
      plane.position.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.max.z + 0.25);
      plane.name = "meetScreen";
      group.add(plane);
      group.userData.meetScreen = plane;
    }
    paintScreen(group, projector.on);
    plane.visible = projector.on;
    if (projector.on && (paintedScreen.mesh !== plane || paintedScreen.version !== screenVersion)) {
      paintSlide(plane.userData.canvas.getContext("2d"), projector, plane.userData.canvas.width, plane.userData.canvas.height);
      plane.userData.texture.needsUpdate = true;
      paintedScreen = { mesh: plane, version: screenVersion };
    }
  }

  function dress(furnMeshes, propGroup) {
    for (const [, mesh] of furnMeshes) {
      if (mesh.userData.kind === "board") dressBoard(mesh);
    }
    for (const group of propGroup?.children || []) {
      if (group.userData.propKind === "screen") dressScreen(group);
    }
  }

  world.setMeetingHook?.(dress);

  // ---- every frame -----------------------------------------------------------

  /** Shows the toolbar inside the room; returns true when stepping in or out. */
  function frame(blocked) {
    const now = Boolean(state.me && inMeetingRoom(state.map, state.me.x, state.me.y));
    const changed = now !== here;
    here = now;
    state.inMeeting = now;
    const box = ensureBar();
    const show = now && !blocked;
    if (box.hidden === show) box.hidden = !show;
    if ((!now || blocked) && tool) open("");
    if (changed) paintBar();
    return changed;
  }

  function isOpen() {
    return Boolean(panel && !panel.hidden);
  }

  function close() {
    if (tool) open("");
    if (bar) bar.hidden = true;
  }

  function view() {
    return {
      inRoom: here,
      tool,
      board: { strokes: board.strokes.length, notes: board.notes.map((note) => note.text) },
      projector: { ...projector },
      hands: [...state.hands].sort(),
      vote: vote ? { ...vote, counts: [...(vote.counts || [])] } : null,
      outbox: outbox.length,
      boardShown: Boolean(paintedBoard.mesh?.parent),
      screenShown: Boolean(paintedScreen.mesh?.parent && paintedScreen.mesh.visible),
    };
  }

  return { onNet, frame, isOpen, close, open, view, raiseHand };
}
