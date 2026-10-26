// Server connection: HTTP calls, the WebSocket, and incoming messages.
import { createRequests } from "./requests.js";
import { closeArcade, closeBoard, refreshBoard } from "./arcade.js";
import { buildPalette, clearArmed, clearPendingAdd, paintTools, pendingAdd, setEditing } from "./edit-mode.js";
import { ensureLoop, resize, snacks, stalls, toys } from "./game.js";
import { loginOptions, showElsewhere, stopParkWatch } from "./login.js";
import { showAvatar } from "./look-editor.js";
import { $, setHint, state, world } from "./office-state.js";
import { renderOnline } from "./people.js";
import { applyGroup, forgetMember, paintAsks, paintWhisper } from "./whisper.js";

let wsGen = 0;

export const requests = createRequests();

export async function api(path, options = {}) {
  const headers = {};
  if (options.body) headers["content-type"] = "application/json";
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  try {
    const response = await fetch(path, {
      method: options.method || "GET",
      headers,
      credentials: "same-origin",
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, ...data };
  } catch {
    return { ok: false, error: "連不上辦公室" };
  }
}

export function setConn(text, warn = false) {
  const node = $("conn");
  const label = $("conn-text");
  if (label) label.textContent = text;
  else node.textContent = text;
  node.classList.toggle("warn", warn);
  node.classList.toggle("ok", !warn);
}

export function showGate(message, options = {}) {
  wsGen += 1;
  requests.drop();
  state.gate = true;
  state.connected = false;
  state.editing = false;
  try { state.socket?.close(); } catch { /* ignore */ }
  state.socket = null;
  $("gate").hidden = false;
  $("avatar").hidden = true;
  $("hud").hidden = true;
  $("chatbar").hidden = true;
  $("dialogue").hidden = true;
  $("editbar").hidden = true;
  $("help").hidden = true;
  snacks.close();
  toys.close();
  closeArcade();
  closeBoard();
  $("form-password").hidden = false;
  $("form-register").hidden = true;
  $("form-pair").hidden = true;
  $("pair-dialog").hidden = true;
  $("elsewhere").hidden = true;
  state.parked = false;
  stopParkWatch();
  $("gate-msg").textContent = message || "輸入管理員給大家的辦公室密碼。這台裝置會記住你。";
  $("gate-error").textContent = "";
  if (!options.keepPassword) $("office-password").value = "";
}

export function applySession(data) {
  state.profile = data.profile;
  state.catalog = data.catalog;
  world.setRadii?.(data.catalog?.radii);
  if (!data.profile.animal) {
    showAvatar("first");
    connect();
  } else startGame();
}

// The first look is picked before entering, but it is already sent over the
// socket, so the socket may open while the avatar dialog is still up.
function linkable() {
  return !state.gate || (state.avatarMode === "first" && !$("avatar").hidden);
}

export function socketLive() {
  return Boolean(state.socket && state.socket.readyState <= 1);
}

export function startGame() {
  state.gate = false;
  state.password = "";
  $("gate").hidden = true;
  $("avatar").hidden = true;
  $("hud").hidden = false;
  $("chatbar").hidden = false;
  world.start?.();
  ensureLoop();
  if (!socketLive()) connect();
}

export function connect() {
  if (!linkable()) return;
  const gen = ++wsGen;
  requests.close();
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${proto}//${location.host}/api/office/ws`);
  state.socket = socket;
  setConn("連線中…", true);
  let settled = false;
  const recover = async () => {
    if (state.clocked || state.parked || settled || gen !== wsGen || !linkable()) return;
    settled = true;
    state.connected = false;
    const me = await api("/api/office/me");
    if (gen !== wsGen || !linkable()) return;
    if (!me.ok) {
      if (!state.clocked) showGate("登入已失效，請重新輸入辦公室密碼。");
      return;
    }
    setConn("重新連線中…", true);
    const wait = state.backoff;
    state.backoff = Math.min(8000, state.backoff * 2);
    setTimeout(() => {
      if (gen !== wsGen || !linkable()) return;
      connect();
    }, wait);
  };
  socket.onopen = () => {
    if (gen !== wsGen) return;
    requests.open((payload) => {
      if (socket.readyState !== 1) throw new Error("closed");
      socket.send(JSON.stringify(payload));
    });
  };
  socket.onmessage = (event) => {
    if (gen !== wsGen || typeof event.data !== "string" || event.data === "pong") return;
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (requests.settle(message)) return;
    onNet(message);
  };
  socket.onclose = (event) => {
    if (gen !== wsGen) return;
    requests.close();
    if (event.code === 4004) {
      showElsewhere();
      return;
    }
    if (event.code === 4005) {
      showGate("已在其他裝置下班。下次輸入辦公室密碼就能回來。");
      return;
    }
    if (event.code === 4006) {
      showGate("這台裝置已移除。請用代碼再加入。");
      return;
    }
    // Another tab switched this guest to Telegram; wait for the new cookie.
    if (event.code === 4008) {
      setTimeout(() => { void recover(); }, 1500);
      return;
    }
    void recover();
  };
  const nativeClose = socket.close.bind(socket);
  socket.close = (...args) => {
    try { nativeClose(...args); } catch { /* already closing */ }
    setTimeout(() => {
      if (state.parked || !linkable() || state.clocked || gen !== wsGen) return;
      if (socket.readyState === WebSocket.CLOSING) void recover();
    }, 600);
  };
}

function bubbleLife(text) {
  const count = [...String(text || "")].length;
  return Math.min(15000, 6000 + count * 250);
}

function finiteDir(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function rememberFace(person) {
  const face = finiteDir(person?.dir);
  if (face != null) person.face = face;
  return person;
}

export function onNet(message) {
  snacks.onNet(message);
  stalls.onNet(message);
  toys.onNet(message);
  if (message.t === "welcome") {
    state.map = message.map;
    state.furniture = message.furniture || [];
    state.specs = new Map((message.palette || []).map((item) => [item.kind, item]));
    state.me = { ...message.you };
    rememberFace(state.me);
    state.me.dir = 1;
    state.seat = message.you.seat || null;
    state.profile = {
      id: message.you.id,
      displayName: message.you.displayName,
      animal: message.you.animal,
      look: message.you.look,
    };
    loginOptions.paint();
    state.sentX = state.me.x;
    state.sentY = state.me.y;
    state.sentFace = null;
    state.sentFaceAt = 0;
    world.forgetFace?.();
    state.others.clear();
    state.whisper = null;
    state.groups = new Map();
    state.memberGroup = new Map();
    state.asks = [];
    state.whisperArm = false;
    for (const player of message.others || []) {
      const person = { ...player, tx: player.x, ty: player.y };
      rememberFace(person);
      state.others.set(player.id, person);
    }
    for (const group of message.hush || []) applyGroup(group.group, group.members);
    if (message.catalog) {
      state.catalog = message.catalog;
      world.setRadii?.(message.catalog.radii);
    }
    state.connected = true;
    state.parked = false;
    stopParkWatch();
    $("elsewhere").hidden = true;
    state.backoff = 700;
    state.editing = false;
    $("editbar").hidden = true;
    $("dialogue").hidden = true;
    setConn("已連線");
    buildPalette();
    renderOnline();
    paintWhisper();
    resize();
    return;
  }
  if (message.t === "join") {
    const player = message.player;
    if (player.id === state.me?.id) return;
    const person = { ...player, tx: player.x, ty: player.y };
    rememberFace(person);
    state.others.set(player.id, person);
    renderOnline();
  } else if (message.t === "leave") {
    forgetMember(message.id);
    state.others.delete(message.id);
    state.bubbles.delete(message.id);
    renderOnline();
  } else if (message.t === "snap") {
    if (!state.me || state.seat) return;
    state.me.x = message.x;
    state.me.y = message.y;
    const face = finiteDir(message.dir);
    if (face != null) state.me.face = face;
    state.path = [];
    state.sentX = message.x;
    state.sentY = message.y;
    state.dirty = false;
  } else if (message.t === "move") {
    const other = state.others.get(message.id);
    if (!other) return;
    other.tx = message.x;
    other.ty = message.y;
    const face = finiteDir(message.dir);
    if (face != null) {
      other.face = face;
      other.dir = face;
    }
    const at = performance.now();
    if (Math.hypot(other.tx - other.x, other.ty - other.y) > 180) {
      other.x = other.tx;
      other.y = other.ty;
      other.track = [];
    }
    const track = other.track || (other.track = []);
    // After a pause, start the glide from where they are drawn now instead of from the old sample.
    if (!track.length || at - track[track.length - 1].at > 250) track.splice(0, track.length, { x: other.x, y: other.y, at: at - 100 });
    track.push({ x: message.x, y: message.y, at });
    if (track.length > 8) track.shift();
  } else if (message.t === "face") {
    const other = state.others.get(message.id);
    const face = finiteDir(message.dir);
    if (!other || face == null) return;
    other.face = face;
    other.dir = face;
  } else if (message.t === "chat") {
    if (state.tape.length > 60) state.tape.shift();
    state.tape.push({ t: "chat", id: message.id, text: message.text, whisper: Boolean(message.whisper) });
    state.bubbles.set(message.id, { text: message.text, until: performance.now() + bubbleLife(message.text), whisper: Boolean(message.whisper) });
  } else if (message.t === "hush") {
    if (state.tape.length > 60) state.tape.shift();
    state.tape.push({ t: "hush", group: message.group, members: message.members || [] });
    applyGroup(message.group, message.members, message.by);
  } else if (message.t === "ask") {
    if (message.off || message.pending) {
      state.asks = state.asks.filter((ask) => ask.id !== message.id);
    } else if (state.whisper && state.whisper === message.group) {
      state.asks = state.asks.filter((ask) => ask.id !== message.id);
      state.asks.push({ id: message.id, group: message.group, until: message.until });
    }
    paintAsks();
  } else if (message.t === "profile") {
    const apply = (person) => {
      if (!person) return;
      person.displayName = message.displayName;
      person.animal = message.animal;
      person.look = message.look;
    };
    if (state.me?.id === message.id) {
      apply(state.me);
      apply(state.profile);
      if (state.avatarMode === "mirror" && !$("avatar").hidden) {
        $("avatar").hidden = true;
        state.gate = false;
      }
    } else apply(state.others.get(message.id));
    renderOnline();
  } else if (message.t === "bump") {
    world.nudge(message.id, message.nx, message.ny);
    world.nudge(message.other, -message.nx, -message.ny);
  } else if (message.t === "sit") {
    const person = message.id === state.me?.id ? state.me : state.others.get(message.id);
    if (person) {
      person.seat = message.chair;
      person.x = message.cx;
      person.y = message.cy;
      person.tx = message.cx;
      person.ty = message.cy;
    }
    const chair = state.furniture.find((item) => item.id === message.chair);
    if (chair) {
      chair.seat = message.id;
      chair.x = message.x;
      chair.y = message.y;
      chair.rot = message.rot || 0;
      chair.speed = 0;
    }
    if (message.id === state.me?.id) {
      state.seat = message.chair;
      state.rising = false;
      state.ride = { vx: 0, vy: 0 };
      state.path = [];
      state.sentX = message.x;
      state.sentY = message.y;
    }
  } else if (message.t === "reset") {
    const mine = message.id === state.me?.id;
    const person = mine ? state.me : state.others.get(message.id);
    if (person) {
      person.seat = null;
      person.x = message.x;
      person.y = message.y;
      person.tx = message.x;
      person.ty = message.y;
    }
    if (message.chair) {
      const chair = state.furniture.find((item) => item.id === message.chair);
      if (chair && chair.seat === message.id) {
        chair.seat = null;
        chair.speed = 0;
      }
    }
    if (mine && state.me) {
      state.seat = null;
      state.rising = false;
      state.ride = { vx: 0, vy: 0 };
      state.rideWish = null;
      state.path = [];
      state.drag = null;
      state.sentX = message.x;
      state.sentY = message.y;
      state.dirty = false;
      state.bubbles.set(state.me.id, { text: "已回到安全位置", until: performance.now() + 2200 });
    }
  } else if (message.t === "rise") {
    const person = message.id === state.me?.id ? state.me : state.others.get(message.id);
    if (person) {
      person.seat = null;
      person.x = message.x;
      person.y = message.y;
      person.tx = message.x;
      person.ty = message.y;
    }
    const chair = state.furniture.find((item) => item.id === message.chair);
    if (chair) {
      chair.seat = null;
      chair.speed = 0;
    }
    if (message.id === state.me?.id) {
      state.seat = null;
      state.rising = false;
      state.ride = { vx: 0, vy: 0 };
      state.rideWish = null;
      state.sentX = message.x;
      state.sentY = message.y;
    }
  } else if (message.t === "glide") {
    const chair = state.furniture.find((item) => item.id === message.chair);
    const mine = message.id === state.me?.id;
    if (chair && (!mine || message.snap)) {
      chair.x = message.x;
      chair.y = message.y;
      chair.rot = message.rot || 0;
      chair.speed = Math.hypot(message.vx || 0, message.vy || 0);
      chair.seat = message.id;
    }
    const person = mine ? state.me : state.others.get(message.id);
    if (person && (!mine || message.snap)) {
      person.seat = message.chair;
      person.tx = message.cx;
      person.ty = message.cy;
      if (message.snap || !mine) {
        person.x = message.cx;
        person.y = message.cy;
      }
    }
    if (mine && message.snap) {
      state.seat = message.chair;
      state.ride = { vx: message.vx || 0, vy: message.vy || 0 };
    }
  } else if (message.t === "furniture") {
    const dragged = state.drag?.id;
    if (Array.isArray(message.furniture)) state.furniture = message.furniture;
    else if (Array.isArray(message.items)) state.furniture = message.items;
    else if (message.item) {
      const index = state.furniture.findIndex((item) => item.id === message.item.id);
      const added = index < 0;
      if (index >= 0) state.furniture[index] = { ...state.furniture[index], ...message.item };
      else state.furniture.push({ ...message.item });
      if (added && pendingAdd && message.item.kind === pendingAdd) {
        clearPendingAdd();
        clearArmed();
      }
    } else if (typeof message.remove === "string") {
      state.furniture = state.furniture.filter((item) => item.id !== message.remove);
      if (state.selected === message.remove) state.selected = null;
    }
    if (dragged && state.drag) state.drag.item = state.furniture.find((item) => item.id === dragged) || null;
    paintTools();
  } else if (message.t === "edit") {
    setEditing(Boolean(message.on));
  } else if (message.t === "error") {
    clearPendingAdd();
    const text = message.message || "沒有成功";
    setHint(text);
    if (message.furniture) state.furniture = message.furniture;
    $("avatar-error").textContent = text;
    paintTools();
    setTimeout(() => { if (state.hint === text) setHint(""); }, 2400);
  } else if (message.t === "score") {
    if (state.boardOpen) void refreshBoard();
  } else if (message.t === "notice") {
    const text = message.text || "";
    setHint(text);
    setTimeout(() => { if (state.hint === text) setHint(""); }, 3200);
  } else if (message.t === "bye") {
    if (message.reason === "upgraded") return;
    if (message.reason === "elsewhere") {
      showElsewhere();
      return;
    }
    const text = {
      removed: "這個 ID 已被管理員移除。請重新輸入密碼後再登記。",
      kicked: "你已被請出辦公室。請重新輸入密碼。",
      password: "辦公室密碼已更新，請重新輸入。",
      restored: "辦公室已還原，請重新輸入。",
      replaced: "這個帳號已在別的分頁開啟。",
      logout: "已在其他裝置下班。下次輸入辦公室密碼就能回來。",
      device: "這台裝置已移除。請用代碼再加入。",
    }[message.reason] || "連線已結束。";
    void api("/api/office/me");
    showGate(text);
  }
}

export function send(payload) {
  if (state.socket?.readyState === 1) state.socket.send(JSON.stringify(payload));
}

export function sendMove(force = false) {
  if (!state.me) return;
  const now = performance.now();
  if (!force && now - state.sentAt < 90) return;
  if (state.seat) {
    const item = state.furniture.find((entry) => entry.id === state.seat);
    if (!item) return;
    if (!force && Math.hypot(item.x - state.sentX, item.y - state.sentY) < 0.6 && Math.hypot(state.ride.vx, state.ride.vy) < 8) {
      state.dirty = false;
      return;
    }
    state.sentX = item.x;
    state.sentY = item.y;
    state.sentAt = now;
    state.dirty = false;
    send({ t: "glide", id: item.id, x: item.x, y: item.y, rot: item.rot || 0, vx: state.ride.vx, vy: state.ride.vy });
    return;
  }
  if (Math.hypot(state.me.x - state.sentX, state.me.y - state.sentY) < 0.4) {
    state.dirty = false;
    return;
  }
  state.sentX = state.me.x;
  state.sentY = state.me.y;
  state.sentAt = now;
  state.dirty = false;
  const heading = Number.isFinite(world.gazeAim) ? world.gazeAim : (finiteDir(state.me.face) ?? 0);
  state.sentFace = heading;
  state.sentFaceAt = now;
  send({ t: "move", x: state.me.x, y: state.me.y, dir: heading });
}

export function sendFacing() {
  if (!state.me || state.socket?.readyState !== 1) return;
  const aim = world.gazeAim;
  if (typeof aim !== "number" || !Number.isFinite(aim)) return;
  const now = performance.now();
  const flush = state.faceFlush;
  if (state.sentFace != null && Number.isFinite(state.sentFace)) {
    const delta = Math.abs(Math.atan2(Math.sin(aim - state.sentFace), Math.cos(aim - state.sentFace)));
    if (delta < (flush ? 0.002 : (8 * Math.PI) / 180)) {
      state.faceFlush = false;
      return;
    }
  }
  if (!flush && now - state.sentFaceAt < 150) return;
  state.faceFlush = false;
  state.sentFace = aim;
  state.sentFaceAt = now;
  send({ t: "face", dir: aim });
}
