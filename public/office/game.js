import { createWorld } from "./world3d.js";
import { attachSnacks } from "./snacks.js";
import { attachStalls } from "./stalls.js";
import { createRequests } from "./requests.js";

const SESSION = "office_session";
const DEVICE = "office_device";
const TILE = 32;
const SPEED = 170;
const WHISPER_NEAR = 112;
const WHISPER_FAR = 176;

const $ = (id) => document.getElementById(id);
const canvas = $("view");
const world = createWorld({
  view: canvas,
  preview: $("preview"),
  labels: $("labels"),
  fallback: $("webgl-fallback"),
});

const state = {
  map: null,
  me: null,
  profile: null,
  catalog: null,
  others: new Map(),
  furniture: [],
  specs: new Map(),
  bubbles: new Map(),
  connected: false,
  editing: false,
  armed: null,
  selected: null,
  focus: null,
  keys: new Set(),
  path: [],
  socket: null,
  zoneName: "",
  gate: true,
  password: "",
  avatarMode: "first",
  avatarAnimal: "cat",
  look: null,
  lookTab: "preset",
  colorKey: "body",
  seat: null,
  rising: false,
  whisper: null,
  groups: new Map(),
  memberGroup: new Map(),
  asks: [],
  whisperArm: false,
  whisperNote: "",
  whisperNoteUntil: 0,
  tape: [],
  ride: { vx: 0, vy: 0 },
  rideWish: null,
  bumpAt: new Map(),
  backoff: 700,
  sentX: 0,
  sentY: 0,
  sentAt: 0,
  dirty: false,
  drag: null,
  pan: null,
  hint: "",
  help: false,
  arcade: false,
  boardOpen: false,
  boardGame: "cat2048",
  leaderboard: null,
  cam: { x: 0, y: 0 },
  anim: 0,
  loop: false,
  parked: false,
  orbit: null,
  stickX: 0,
  stickY: 0,
  clocked: false,
  sentFace: null,
  sentFaceAt: 0,
  faceFlush: false,
};

const phoneQuery = window.matchMedia("(max-width: 980px)");
let keyboardOverride = null;
const snacks = attachSnacks({
  state,
  world,
  $,
  send,
  sizeOf,
  phone: () => phoneQuery.matches,
  hitFurniture: (...args) => hitFurniture(...args),
  freeSpot: (...args) => freeSpot(...args),
  findPath: (...args) => findPath(...args),
});
const stalls = attachStalls({ state, world, send });

let wsGen = 0;
const requests = createRequests();
let parkTimer = 0;

function stopParkWatch() {
  window.clearInterval(parkTimer);
  parkTimer = 0;
}

function deviceKey() {
  let key = localStorage.getItem(DEVICE);
  if (!/^[a-f0-9]{32,128}$/i.test(key || "")) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    key = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(DEVICE, key);
  }
  return key.toLowerCase();
}

function checkId(raw) {
  const id = String(raw || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,15}$/.test(id)) {
    return { ok: false, error: "ID 需為 2 到 16 個字，以英數開頭，只能使用英數、底線或減號" };
  }
  if (["lala", "admin", "system", "npc", "office"].includes(id)) return { ok: false, error: "這個 ID 不能使用" };
  return { ok: true, id };
}

async function api(path, options = {}) {
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

function setConn(text, warn = false) {
  const node = $("conn");
  const label = $("conn-text");
  if (label) label.textContent = text;
  else node.textContent = text;
  node.classList.toggle("warn", warn);
  node.classList.toggle("ok", !warn);
}

function setHint(text) {
  state.hint = text || "";
  $("hint").textContent = state.hint;
  $("hint").hidden = !state.hint;
}

function personNamed(id) {
  if (state.me?.id === id) return state.me;
  return state.others.get(id) || null;
}

function applyGroup(group, members, by) {
  if (!group) return;
  const was = state.whisper;
  for (const [id, current] of state.memberGroup) {
    if (current === group) state.memberGroup.delete(id);
  }
  const list = Array.isArray(members) ? members.filter(Boolean) : [];
  if (list.length >= 2) {
    state.groups.set(group, list);
    for (const id of list) state.memberGroup.set(id, group);
  } else {
    state.groups.delete(group);
    state.asks = state.asks.filter((ask) => ask.group !== group);
  }
  state.whisper = state.me ? (state.memberGroup.get(state.me.id) || null) : null;
  state.whisperArm = false;
  if (!was && state.whisper && by && by !== state.me?.id) {
    const other = personNamed(by);
    state.whisperNote = `${other?.displayName || by} @${by} 對你說悄悄話`;
    state.whisperNoteUntil = performance.now() + 3200;
  }
  if (was && !state.whisper) state.whisperNoteUntil = 0;
  if (by) state.asks = state.asks.filter((ask) => ask.id !== by);
  paintWhisper();
  paintAsks();
}

function forgetMember(id) {
  const group = state.memberGroup.get(id);
  if (!group) return;
  state.memberGroup.delete(id);
  const rest = (state.groups.get(group) || []).filter((member) => member !== id);
  applyGroup(group, rest.length >= 2 ? rest : []);
}

function paintWhisper() {
  const node = $("chat-whisper");
  const label = $("chat-whisper-label");
  const list = $("chat-whisper-list");
  if (!node || !label || !list) return;
  document.body.classList.toggle("whispering", Boolean(state.whisper));
  if (!state.whisper) {
    node.hidden = true;
    label.textContent = "";
    list.replaceChildren();
    paintChatTip();
    return;
  }
  const members = state.groups.get(state.whisper) || [];
  node.hidden = false;
  label.textContent = `悄悄話（${members.length} 人）`;
  list.replaceChildren();
  for (const id of members) {
    const person = personNamed(id);
    const item = document.createElement("span");
    item.textContent = `${person?.displayName || id} @${id}`;
    list.appendChild(item);
  }
  paintChatTip();
}

function paintAsks() {
  const host = $("whisper-asks");
  if (!host) return;
  host.replaceChildren();
  const now = Date.now();
  state.asks = state.asks.filter((ask) => ask.until > now && ask.group === state.whisper);
  for (const ask of state.asks) {
    const row = document.createElement("div");
    row.className = "whisper-ask";
    const text = document.createElement("span");
    text.textContent = `@${ask.id} 想加入悄悄話`;
    const yes = document.createElement("button");
    yes.type = "button";
    yes.textContent = "答應";
    yes.addEventListener("click", () => send({ t: "hush", ask: ask.id, yes: true }));
    const no = document.createElement("button");
    no.type = "button";
    no.textContent = "婉拒";
    no.addEventListener("click", () => {
      state.asks = state.asks.filter((item) => item.id !== ask.id);
      paintAsks();
    });
    row.append(text, yes, no);
    host.appendChild(row);
  }
  host.hidden = host.childElementCount === 0;
}

function nearestWhisper() {
  if (!state.me || state.whisper) return null;
  let best = null;
  for (const other of state.others.values()) {
    const dist = Math.hypot(state.me.x - other.x, state.me.y - other.y);
    if (dist <= WHISPER_NEAR && (!best || dist < best.dist)) {
      best = { id: other.id, dist, grouped: Boolean(state.memberGroup.get(other.id)) };
    }
  }
  return best;
}

function toggleWhisper() {
  if (!state.me || state.gate || state.help || state.arcade || state.boardOpen || !$("avatar").hidden) return;
  if (state.whisper) {
    if (state.whisperArm) return;
    state.whisperArm = true;
    send({ t: "hush", off: true });
    return;
  }
  const near = nearestWhisper();
  if (!near) return;
  send({ t: "hush", id: near.id });
}

function showGate(message, options = {}) {
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

function showRegister() {
  $("form-password").hidden = true;
  $("form-register").hidden = false;
  $("form-pair").hidden = true;
  $("gate-msg").textContent = "密碼正確。幫自己取一個還沒人用的 ID，再寫顯示名稱。";
  $("gate-error").textContent = "";
  $("office-id").focus();
}

function showPairForm() {
  $("form-password").hidden = true;
  $("form-register").hidden = true;
  $("form-pair").hidden = false;
  $("gate-msg").textContent = "輸入你的 ID，以及另一台裝置上的代碼。";
  $("gate-error").textContent = "";
  $("pair-id").focus();
}

function showElsewhere() {
  closeSheets();
  state.parked = true;
  state.connected = false;
  $("pair-dialog").hidden = true;
  $("elsewhere").hidden = false;
  setConn("已在其他裝置上線", true);
  if (parkTimer) return;
  parkTimer = window.setInterval(async () => {
    if (!state.parked) {
      stopParkWatch();
      return;
    }
    const me = await api("/api/office/me");
    if (!state.parked) return;
    if (!me.ok) showGate("已在其他裝置下班。下次輸入辦公室密碼就能回來。");
  }, 1000);
}

function profileNow() {
  return state.me || state.profile;
}

const LOOK_TABS = [
  ["preset", "預設"],
  ["body", "體型"],
  ["ears", "耳朵"],
  ["tail", "尾巴"],
  ["colors", "顏色"],
  ["face", "臉"],
  ["gear", "配件"],
];

function cloneLook(look) {
  if (!look || typeof look !== "object") return null;
  return { ...look, v: 2, colors: { ...(look.colors || {}) } };
}

function presetOf(id) {
  return (state.catalog?.animals || []).find((item) => item.id === id) || null;
}

function bodyRadius(look) {
  const id = look?.body || "bean";
  const value = state.catalog?.radii?.[id];
  return typeof value === "number" ? value : 31;
}

function wallRadius() {
  const value = state.catalog?.wall;
  return typeof value === "number" ? value : 11;
}

function showAvatar(mode) {
  snacks.close();
  state.avatarMode = mode;
  state.gate = mode === "first";
  const profile = profileNow();
  state.avatarAnimal = profile?.animal || state.catalog?.animals?.[0]?.id || "cat";
  state.look = cloneLook(profile?.look) || cloneLook(presetOf(state.avatarAnimal)?.look) || cloneLook(presetOf("cat")?.look);
  state.lookTab = "preset";
  $("avatar-name").value = profile?.displayName || "";
  $("avatar-title").textContent = mode === "mirror" ? "廁所鏡子" : "打造你的造型";
  $("avatar-note").textContent = mode === "mirror"
    ? "只有在男廁或女廁可以調整造型。名稱也可以一起改。"
    : `大家會看到這個造型。名稱下面會標 @${profile?.id || "id"}。`;
  $("avatar-save").textContent = mode === "mirror" ? "換上這個造型" : "進入辦公室";
  $("avatar-cancel").hidden = mode !== "mirror";
  $("avatar-error").textContent = "";
  $("gate").hidden = true;
  $("avatar").hidden = false;
  buildLookEditor();
  world.resize();
  paintPreview();
  ensureLoop();
}

function buildLookEditor() {
  const tabs = $("look-tabs");
  const panel = $("look-panel");
  tabs.replaceChildren();
  panel.replaceChildren();
  for (const [id, label] of LOOK_TABS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(state.lookTab === id));
    button.addEventListener("click", () => {
      state.lookTab = id;
      buildLookEditor();
    });
    tabs.appendChild(button);
  }
  const catalog = state.catalog || { animals: [], parts: {}, colors: [], swatches: [] };
  if (state.lookTab === "preset") {
    const note = document.createElement("p");
    note.className = "slot-label";
    note.textContent = "點一個預設會填好全身，之後每個部位都能再改。";
    panel.appendChild(note);
    const row = document.createElement("div");
    row.className = "choice-grid";
    for (const animal of catalog.animals || []) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = animal.label;
      button.setAttribute("aria-pressed", String(state.avatarAnimal === animal.id));
      button.addEventListener("click", () => {
        state.avatarAnimal = animal.id;
        state.look = cloneLook(animal.look) || state.look;
        buildLookEditor();
        paintPreview();
      });
      row.appendChild(button);
    }
    panel.appendChild(row);
    return;
  }
  if (state.lookTab === "colors") {
    buildColorPanel(panel, catalog);
    return;
  }
  if (state.lookTab === "face") {
    addChoiceGroup(panel, "眼睛", "eyes", catalog.parts?.eyes || []);
    addChoiceGroup(panel, "嘴巴", "mouth", catalog.parts?.mouth || []);
    addChoiceGroup(panel, "腮紅", "blush", catalog.parts?.blush || []);
    addChoiceGroup(panel, "標記", "marking", catalog.parts?.marking || []);
    return;
  }
  if (state.lookTab === "gear") {
    addChoiceGroup(panel, "頭上", "head", catalog.parts?.head || []);
    addChoiceGroup(panel, "臉上", "face", catalog.parts?.face || []);
    addChoiceGroup(panel, "頸部", "neck", catalog.parts?.neck || []);
    addChoiceGroup(panel, "手上", "held", catalog.parts?.held || []);
    addAccessorySwatches(panel, catalog);
    return;
  }
  const titles = { body: "體型", ears: "耳朵", tail: "尾巴" };
  addChoiceGroup(panel, titles[state.lookTab] || state.lookTab, state.lookTab, catalog.parts?.[state.lookTab] || []);
}

function addChoiceGroup(panel, label, key, options) {
  const title = document.createElement("p");
  title.className = "slot-label";
  title.textContent = label;
  panel.appendChild(title);
  const row = document.createElement("div");
  row.className = "choice-grid";
  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.label;
    button.setAttribute("aria-pressed", String(state.look?.[key] === option.id));
    button.addEventListener("click", () => {
      state.look = { ...state.look, [key]: option.id };
      state.avatarAnimal = "custom";
      buildLookEditor();
      paintPreview();
    });
    row.appendChild(button);
  }
  panel.appendChild(row);
}

function addAccessorySwatches(panel, catalog) {
  const title = document.createElement("p");
  title.className = "slot-label";
  title.textContent = "配件顏色";
  panel.appendChild(title);
  const swatches = document.createElement("div");
  swatches.className = "swatches accessory-swatches";
  const options = catalog.accessorySwatches?.length ? catalog.accessorySwatches : ["#f3eee3"];
  const current = String(state.look?.colors?.accessory || "#f3eee3").toLowerCase();
  for (const swatch of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.style.background = swatch;
    button.setAttribute("aria-label", `配件顏色 ${swatch}`);
    button.setAttribute("aria-pressed", String(current === String(swatch).toLowerCase()));
    button.addEventListener("click", () => {
      state.look = { ...state.look, colors: { ...(state.look?.colors || {}), accessory: swatch } };
      state.avatarAnimal = "custom";
      buildLookEditor();
      paintPreview();
    });
    swatches.appendChild(button);
  }
  panel.appendChild(swatches);
}

function buildColorPanel(panel, catalog) {
  // The belly patch is no longer drawn, so its color is not offered.
  const keys = (catalog.colors || []).filter((item) => item.id !== "belly");
  if (!keys.some((item) => item.id === state.colorKey)) state.colorKey = keys[0]?.id || "body";
  const chips = document.createElement("div");
  chips.className = "color-keys";
  for (const item of keys) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    button.setAttribute("aria-pressed", String(state.colorKey === item.id));
    button.addEventListener("click", () => {
      state.colorKey = item.id;
      buildLookEditor();
    });
    chips.appendChild(button);
  }
  panel.appendChild(chips);
  const item = keys.find((entry) => entry.id === state.colorKey);
  if (!item) return;
  const block = document.createElement("div");
  block.className = "color-row";
  const swatches = document.createElement("div");
  swatches.className = "swatches";
  const current = String(state.look?.colors?.[item.id] || "").toLowerCase();
  for (const swatch of catalog.swatches || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.style.background = swatch;
    button.setAttribute("aria-label", `${item.label} ${swatch}`);
    button.setAttribute("aria-pressed", String(current === swatch.toLowerCase()));
    button.addEventListener("click", () => {
      state.look = { ...state.look, colors: { ...state.look.colors, [item.id]: swatch } };
      state.avatarAnimal = "custom";
      buildLookEditor();
      paintPreview();
    });
    swatches.appendChild(button);
  }
  const input = document.createElement("input");
  input.type = "color";
  input.value = /^#[0-9a-f]{6}$/.test(current) ? current : "#f06292";
  input.setAttribute("aria-label", `${item.label}自訂`);
  input.addEventListener("input", () => {
    state.look = { ...state.look, colors: { ...state.look.colors, [item.id]: input.value.toLowerCase() } };
    state.avatarAnimal = "custom";
    paintPreview();
  });
  swatches.appendChild(input);
  block.appendChild(swatches);
  panel.appendChild(block);
}

function randomLook() {
  const catalog = state.catalog;
  if (!catalog?.parts || !state.look) return;
  const pick = (list) => list[Math.floor(Math.random() * list.length)]?.id;
  const swatches = catalog.swatches || [];
  const color = () => swatches[Math.floor(Math.random() * swatches.length)] || "#f06292";
  const colors = {};
  for (const item of catalog.colors || []) colors[item.id] = color();
  const accessorySwatches = catalog.accessorySwatches?.length ? catalog.accessorySwatches : ["#f3eee3"];
  colors.accessory = accessorySwatches[Math.floor(Math.random() * accessorySwatches.length)];
  state.look = {
    v: 2,
    body: pick(catalog.parts.body),
    ears: pick(catalog.parts.ears),
    tail: pick(catalog.parts.tail),
    belly: false,
    eyes: pick(catalog.parts.eyes),
    mouth: pick(catalog.parts.mouth),
    blush: pick(catalog.parts.blush),
    marking: pick(catalog.parts.marking),
    head: pick(catalog.parts.head),
    face: pick(catalog.parts.face),
    neck: pick(catalog.parts.neck),
    held: pick(catalog.parts.held),
    colors,
  };
  state.avatarAnimal = "custom";
  buildLookEditor();
  paintPreview();
}

function paintPreview() {
  world.preview(state.look, performance.now() / 1000);
}

function paintCam() {
  const follow = world.mode === "follow";
  $("cam-iso")?.setAttribute("aria-pressed", follow ? "false" : "true");
  $("cam-follow")?.setAttribute("aria-pressed", follow ? "true" : "false");
  $("cam-btn")?.setAttribute("aria-pressed", follow ? "true" : "false");
}

function applySession(data) {
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

function socketLive() {
  return Boolean(state.socket && state.socket.readyState <= 1);
}

function startGame() {
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

function connect() {
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

function onNet(message) {
  snacks.onNet(message);
  stalls.onNet(message);
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
    if (Math.hypot(other.tx - other.x, other.ty - other.y) > 180) {
      other.x = other.tx;
      other.y = other.ty;
    }
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
        pendingAdd = null;
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
    pendingAdd = null;
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

function send(payload) {
  if (state.socket?.readyState === 1) state.socket.send(JSON.stringify(payload));
}

function sendMove(force = false) {
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

function sendFacing() {
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

function renderOnline() {
  const list = $("online-list");
  list.replaceChildren();
  const people = [];
  if (state.me) people.push(state.me);
  for (const other of state.others.values()) people.push(other);
  const count = String(people.length);
  for (const id of ["online-count", "online-total"]) {
    const node = $(id);
    if (node) node.textContent = count;
  }
  for (const person of people) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = person.displayName + (person.id === state.me?.id ? "（你）" : "");
    const id = document.createElement("small");
    id.textContent = `@${person.id}`;
    item.append(name, id);
    list.appendChild(item);
  }
}

function buildPalette() {
  const chips = $("room-chips");
  const palette = $("palette");
  chips.replaceChildren();
  palette.replaceChildren();
  for (const zone of state.map?.zones || []) {
    if (zone.id === "hall") continue;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = zone.name;
    button.addEventListener("click", () => {
      state.focus = {
        x: (zone.x + zone.w / 2) * TILE,
        y: (zone.y + zone.h / 2) * TILE,
      };
    });
    chips.appendChild(button);
  }
  for (const spec of state.specs.values()) {
    if (spec.fixed) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = spec.label;
    button.dataset.kind = spec.kind;
    button.addEventListener("click", () => {
      pendingAdd = null;
      state.armed = state.armed === spec.kind ? null : spec.kind;
      for (const node of palette.querySelectorAll("button")) node.classList.toggle("armed", node.dataset.kind === state.armed);
      paintTools();
    });
    palette.appendChild(button);
  }
}

function editHintText() {
  if (phoneQuery.matches) return "拖曳移動。點選後可旋轉或收回。點清單再點地板加設備。牆不能改。";
  return "拖曳移動，點一下選取。旋轉和收回也可用 R、Delete。點清單再點地板可加設備。牆不能改。";
}

function paintTools() {
  const label = $("furn-tools-label");
  const rot = $("furn-rot");
  if (!label || !rot) return;
  const found = state.furniture.find((entry) => entry.id === state.selected);
  const item = found && !state.specs.get(found.kind)?.fixed ? found : null;
  const spec = item ? state.specs.get(item.kind) : null;
  const armed = state.armed ? state.specs.get(state.armed) : null;
  if (armed) label.textContent = `點地板放置：${armed.label}`;
  else if (spec) label.textContent = `已選取：${spec.label}`;
  else label.textContent = "點選設備，或從清單放到地板";
  rot.disabled = !item;
  $("furn-remove").disabled = !item;
  $("furn-clear").disabled = !item;
  $("furn-cancel").disabled = !armed;
}

function clearArmed() {
  state.armed = null;
  pendingAdd = null;
  for (const node of $("palette").querySelectorAll("button")) node.classList.remove("armed");
  paintTools();
}

function setEditing(on) {
  snacks.close();
  state.editing = on;
  $("editbar").hidden = !on;
  $("dialogue").hidden = true;
  state.path = [];
  state.armed = null;
  pendingAdd = null;
  state.selected = null;
  placeGesture = null;
  for (const node of $("palette").querySelectorAll("button")) node.classList.remove("armed");
  if (on) {
    const hint = $("edit-hint");
    if (hint) hint.textContent = editHintText();
    if (state.me) state.focus = { x: state.me.x, y: state.me.y };
  }
  paintTools();
  if (!on) setHint("");
}

function zoneAt(x, y) {
  if (!state.map) return null;
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  return (state.map.zones || []).find((zone) => tx >= zone.x && ty >= zone.y && tx < zone.x + zone.w && ty < zone.y + zone.h) || null;
}

function inRestroom() {
  const zone = zoneAt(state.me.x, state.me.y);
  return zone?.id === "men" || zone?.id === "women";
}

function nearLala() {
  if (!state.map || !state.me) return false;
  return Math.hypot(state.me.x - state.map.lala.x, state.me.y - state.map.lala.y) < 112;
}

function isWall(tx, ty) {
  const row = state.map?.walls?.[ty];
  if (!row || tx < 0 || tx >= row.length) return true;
  return row[tx] === "1";
}

function circleRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

// Keep in sync with layoutForward / seatApproach in src/content.ts.
function layoutForward(rot) {
  const turn = ((((rot || 0) % 360) + 360) % 360 * Math.PI) / 180;
  return { x: Math.sin(turn), y: Math.cos(turn) };
}

function seatApproach(item, gap = 24) {
  const size = sizeOf(item);
  const forward = layoutForward(item.rot);
  const alongX = Math.abs(forward.x) >= Math.abs(forward.y);
  const reach = (alongX ? size.w : size.h) / 2 + gap;
  return {
    x: item.x + size.w / 2 + forward.x * reach,
    y: item.y + size.h / 2 + forward.y * reach,
  };
}

function sizeOf(item) {
  const spec = state.specs.get(item.kind);
  if (!spec) return { w: 32, h: 24, solid: false };
  const rot = ((item.rot || 0) % 360 + 360) % 360;
  if (rot % 180 !== 0) return { w: spec.h, h: spec.w, solid: spec.solid };
  return { w: spec.w, h: spec.h, solid: spec.solid };
}

function collides(x, y, ignoreId, radius = 11) {
  const minX = Math.floor((x - radius) / TILE);
  const maxX = Math.floor((x + radius) / TILE);
  const minY = Math.floor((y - radius) / TILE);
  const maxY = Math.floor((y + radius) / TILE);
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      if (isWall(tx, ty) && circleRect(x, y, radius, tx * TILE, ty * TILE, TILE, TILE)) return true;
    }
  }
  for (const prop of state.map?.props || []) {
    if (!prop.solid) continue;
    const box = prop.kind === "stalldoor" ? stalls.box(prop) : prop;
    if (circleRect(x, y, radius, box.x, box.y, box.w, box.h)) return true;
  }
  for (const item of state.furniture) {
    if (item.id === ignoreId) continue;
    if (item.kind === "chair" && item.seat) continue;
    const size = sizeOf(item);
    if (size.solid && circleRect(x, y, radius, item.x, item.y, size.w, size.h)) return true;
  }
  return false;
}

function bodyList() {
  const list = [];
  const lala = state.map?.lala;
  if (lala) list.push({ id: "lala", x: lala.x, y: lala.y, r: bodyRadius({ body: "bean" }) });
  for (const person of state.others.values()) {
    list.push({ id: person.id, x: person.x, y: person.y, r: bodyRadius(person.look) });
  }
  return list;
}

function resolveBodies(x, y, radius) {
  let cx = x;
  let cy = y;
  let hit = null;
  const list = bodyList();
  for (let pass = 0; pass < 4; pass++) {
    for (const other of list) {
      let dx = cx - other.x;
      let dy = cy - other.y;
      let dist = Math.hypot(dx, dy);
      const min = radius + other.r;
      if (dist < 0.0001) { dx = 1; dy = 0; dist = 1; }
      if (dist < min) {
        cx += (dx / dist) * (min - dist);
        cy += (dy / dist) * (min - dist);
        hit = { id: other.id, nx: dx / dist, ny: dy / dist };
      }
    }
  }
  return { x: cx, y: cy, hit };
}

function noteBump(hit, bounce) {
  if (!hit) return;
  const now = performance.now();
  if (now - (state.bumpAt.get(hit.id) || 0) < 520) return;
  state.bumpAt.set(hit.id, now);
  world.nudge(state.me.id, hit.nx, hit.ny);
  world.nudge(hit.id, -hit.nx, -hit.ny);
  send({ t: "bump", other: hit.id, nx: hit.nx, ny: hit.ny });
  if (bounce && state.seat) {
    const vn = state.ride.vx * hit.nx + state.ride.vy * hit.ny;
    if (vn < 0) {
      state.ride.vx -= 1.35 * vn * hit.nx;
      state.ride.vy -= 1.35 * vn * hit.ny;
    }
  }
}

function wallSlide(ox, oy, dx, dy, radius = wallRadius()) {
  let x = ox + dx;
  let y = oy + dy;
  if (collides(x, oy, null, radius)) x = ox;
  if (collides(x, y, null, radius)) y = oy;
  return { x, y };
}

function acceptBody(x, y, radius, fallback) {
  const resolved = resolveBodies(x, y, radius);
  if (!collides(resolved.x, resolved.y)) return resolved;
  if (!collides(resolved.x, fallback.y)) {
    const again = resolveBodies(resolved.x, fallback.y, radius);
    if (!collides(again.x, again.y)) return again;
  }
  if (!collides(fallback.x, resolved.y)) {
    const again = resolveBodies(fallback.x, resolved.y, radius);
    if (!collides(again.x, again.y)) return again;
  }
  return { x: fallback.x, y: fallback.y, hit: resolved.hit };
}

function tryMove(dx, dy) {
  const beforeX = state.me.x;
  const beforeY = state.me.y;
  const radius = bodyRadius(state.me.look);
  const direct = wallSlide(beforeX, beforeY, dx, dy);
  let resolved = acceptBody(direct.x, direct.y, radius, { x: beforeX, y: beforeY });
  const want = Math.hypot(dx, dy);
  const got = Math.hypot(resolved.x - beforeX, resolved.y - beforeY);
  if (resolved.hit && want > 0.01 && got < want * 0.45) {
    const nx = resolved.hit.nx;
    const ny = resolved.hit.ny;
    let tx = -ny;
    let ty = nx;
    if (tx * dx + ty * dy < 0) { tx = -tx; ty = -ty; }
    const slide = wallSlide(beforeX, beforeY, tx * want, ty * want);
    const slid = acceptBody(slide.x, slide.y, radius, { x: beforeX, y: beforeY });
    if (Math.hypot(slid.x - beforeX, slid.y - beforeY) > got) resolved = slid;
  }
  state.me.x = resolved.x;
  state.me.y = resolved.y;
  if (state.me.x !== beforeX) state.me.dir = state.me.x > beforeX ? 1 : -1;
  const moved = state.me.x !== beforeX || state.me.y !== beforeY;
  if (moved) state.dirty = true;
  if (resolved.hit) noteBump(resolved.hit, false);
  return moved;
}

function freeSpot(x, y) {
  const radius = bodyRadius(state.me?.look);
  const open = (px, py) => !collides(px, py) && Math.hypot(resolveBodies(px, py, radius).x - px, resolveBodies(px, py, radius).y - py) < 0.8;
  if (open(x, y)) return { x, y };
  for (let ring = 1; ring <= 6; ring++) {
    const step = ring * 26;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const px = x + Math.cos(angle) * step;
      const py = y + Math.sin(angle) * step;
      if (open(px, py)) return { x: px, y: py };
    }
  }
  return { x, y };
}

function tileBlocked(tx, ty) {
  if (isWall(tx, ty)) return true;
  const cx = tx * TILE + TILE / 2;
  const cy = ty * TILE + TILE / 2;
  for (const prop of state.map.props) {
    if (!prop.solid) continue;
    const box = prop.kind === "stalldoor" ? stalls.box(prop) : prop;
    if (cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h) return true;
  }
  for (const item of state.furniture) {
    const size = sizeOf(item);
    if (size.solid && cx >= item.x && cx <= item.x + size.w && cy >= item.y && cy <= item.y + size.h) return true;
  }
  const lala = state.map.lala;
  const mine = bodyRadius(state.me?.look);
  if (Math.hypot(cx - lala.x, cy - lala.y) < bodyRadius({ body: "bean" }) + mine - 6) return true;
  for (const person of state.others.values()) {
    if (Math.hypot(cx - person.x, cy - person.y) < bodyRadius(person.look) + mine - 6) return true;
  }
  return false;
}

function nearestOpen(tx, ty) {
  if (!tileBlocked(tx, ty)) return [tx, ty];
  for (let ring = 1; ring <= 4; ring++) {
    for (let y = ty - ring; y <= ty + ring; y++) {
      for (let x = tx - ring; x <= tx + ring; x++) {
        if (!tileBlocked(x, y)) return [x, y];
      }
    }
  }
  return null;
}

function findPath(x, y) {
  const start = nearestOpen(Math.floor(state.me.x / TILE), Math.floor(state.me.y / TILE));
  const goal = nearestOpen(Math.floor(x / TILE), Math.floor(y / TILE));
  if (!start || !goal) return [];
  const key = (tx, ty) => `${tx},${ty}`;
  const open = [start];
  const came = new Map();
  const score = new Map([[key(start[0], start[1]), 0]]);
  while (open.length) {
    open.sort((a, b) => (score.get(key(a[0], a[1])) || 0) - (score.get(key(b[0], b[1])) || 0));
    const [tx, ty] = open.shift();
    if (tx === goal[0] && ty === goal[1]) {
      const path = [[tx, ty]];
      let cursor = key(tx, ty);
      while (came.has(cursor)) {
        const prev = came.get(cursor);
        path.push(prev.split(",").map(Number));
        cursor = prev;
      }
      path.reverse();
      return path.slice(1).map(([px, py]) => ({ x: px * TILE + TILE / 2, y: py * TILE + TILE / 2 }));
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (tileBlocked(nx, ny)) continue;
      const next = (score.get(key(tx, ty)) || 0) + 1;
      const id = key(nx, ny);
      if (next < (score.get(id) ?? Infinity)) {
        score.set(id, next);
        came.set(id, key(tx, ty));
        if (!open.some((item) => item[0] === nx && item[1] === ny)) open.push([nx, ny]);
      }
    }
  }
  return [];
}

function screenToWorld(clientX, clientY) {
  return world.screenToWorld(clientX, clientY);
}

function worldToScreen(x, y) {
  return world.worldToScreen(x, y);
}

function usedProps() {
  return (state.map?.props || []).filter((prop) => prop.use === "play" || prop.use === "scores");
}

function standPoint(prop) {
  return freeSpot(prop.x + prop.w / 2, prop.y + prop.h + 18);
}

function chairCenter(item) {
  return { x: item.x + 16, y: item.y + 13 };
}

function nearestChair() {
  if (!state.me || state.seat) return null;
  let best = null;
  for (const item of state.furniture) {
    if (item.kind !== "chair" || item.seat) continue;
    const center = chairCenter(item);
    const dist = Math.hypot(state.me.x - center.x, state.me.y - center.y);
    if (dist < 78 && (!best || dist < best.dist)) best = { item, dist, ...center };
  }
  return best;
}

function applyChairMotion(item, cx, cy, rot, speed) {
  item.x = cx - 16;
  item.y = cy - 13;
  item.rot = rot;
  item.speed = speed;
}

function rideStep(dt, wishX, wishY) {
  const item = state.furniture.find((entry) => entry.id === state.seat);
  if (!item) {
    state.seat = null;
    if (state.me) state.me.seat = null;
    return;
  }
  let { vx, vy } = state.ride;
  vx += wishX * 420 * dt;
  vy += wishY * 420 * dt;
  const speed0 = Math.hypot(vx, vy);
  const max = 210;
  if (speed0 > max) {
    vx *= max / speed0;
    vy *= max / speed0;
  }
  const damp = Math.exp(-2.7 * dt);
  vx *= damp;
  vy *= damp;
  if (!wishX && !wishY && Math.hypot(vx, vy) < 12) {
    vx = 0;
    vy = 0;
  }
  const center = chairCenter(item);
  let x = center.x + vx * dt;
  let y = center.y + vy * dt;
  const radius = Math.max(CHAIR_R, bodyRadius(state.me.look) * 0.72);
  if (collides(x, center.y, item.id, CHAIR_R)) {
    x = center.x;
    vx *= -0.35;
  }
  if (collides(x, y, item.id, CHAIR_R)) {
    y = center.y;
    vy *= -0.35;
  }
  const resolved = resolveBodies(x, y, radius);
  if (resolved.hit) noteBump(resolved.hit, true);
  if (collides(resolved.x, resolved.y, item.id, CHAIR_R)) {
    x = center.x;
    y = center.y;
    vx *= 0.2;
    vy *= 0.2;
  } else {
    x = resolved.x;
    y = resolved.y;
  }
  let rot = item.rot || 0;
  const speed = Math.hypot(vx, vy);
  if (speed > 16) {
    const target = Math.atan2(vx, vy) * 180 / Math.PI;
    const delta = ((target - rot + 540) % 360) - 180;
    rot += delta * Math.min(1, dt * 6);
  }
  applyChairMotion(item, x, y, rot, speed);
  state.ride = { vx, vy };
  state.me.x = x;
  state.me.y = y;
  state.me.seat = item.id;
  if (Math.abs(vx) > 1) state.me.dir = vx > 0 ? 1 : -1;
  state.dirty = true;
}

const CHAIR_R = 18;

function nearestUse() {
  if (!state.me) return null;
  let best = null;
  for (const prop of usedProps()) {
    const stand = standPoint(prop);
    const dist = Math.hypot(state.me.x - stand.x, state.me.y - stand.y);
    if (dist < 78 && (!best || dist < best.dist)) best = { prop, dist };
  }
  return best?.prop || null;
}

function hitUse(x, y) {
  for (const prop of usedProps()) {
    if (x >= prop.x - 10 && y >= prop.y - 10 && x <= prop.x + prop.w + 10 && y <= prop.y + prop.h + 36) return prop;
  }
  return null;
}

function openArcade() {
  snacks.close();
  state.arcade = true;
  state.path = [];
  $("dialogue").hidden = true;
  $("arcade").hidden = false;
  $("arcade-frame").src = "/games/?from=office";
}

function closeArcade() {
  state.arcade = false;
  const frame = $("arcade-frame");
  if (frame) {
    frame.src = "about:blank";
    $("arcade").hidden = true;
  }
}

function openBoard() {
  snacks.close();
  state.boardOpen = true;
  state.path = [];
  $("dialogue").hidden = true;
  $("board").hidden = false;
  void refreshBoard();
}

function closeBoard() {
  state.boardOpen = false;
  const node = $("board");
  if (node) node.hidden = true;
}

async function refreshBoard() {
  const data = await requests.ask("leaderboard");
  if (!data.ok || !state.boardOpen) return;
  state.leaderboard = data.games || [];
  renderBoard();
}

function renderBoard() {
  const games = state.leaderboard || [];
  const tabs = $("board-tabs");
  tabs.replaceChildren();
  if (!games.some((game) => game.id === state.boardGame) && games[0]) state.boardGame = games[0].id;
  for (const game of games) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost";
    button.textContent = game.title;
    button.setAttribute("aria-pressed", game.id === state.boardGame ? "true" : "false");
    button.addEventListener("click", () => {
      state.boardGame = game.id;
      renderBoard();
    });
    tabs.appendChild(button);
  }
  const current = games.find((game) => game.id === state.boardGame);
  const list = $("board-list");
  list.replaceChildren();
  const me = $("board-me");
  if (!current) {
    me.textContent = "";
    return;
  }
  if (!current.top.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "還沒有紀錄";
    list.appendChild(empty);
  }
  for (const row of current.top) {
    const item = document.createElement("li");
    if (row.id === state.me?.id) item.className = "me";
    const name = document.createElement("span");
    name.textContent = `${row.rank}. ${row.displayName}`;
    const id = document.createElement("small");
    id.textContent = `@${row.id}`;
    const score = document.createElement("b");
    score.textContent = `${row.score} ${current.unit}`;
    item.append(name, id, score);
    list.appendChild(item);
  }
  if (current.me) me.textContent = `你是第 ${current.me.rank} 名，${current.me.score} ${current.unit}`;
  else me.textContent = "你還沒有紀錄";
}

async function submitScore(payload) {
  if (!payload || state.gate) return;
  const data = await requests.ask("score", payload);
  if (data.ok && state.boardOpen) void refreshBoard();
}

function standUp() {
  const item = state.furniture.find((entry) => entry.id === state.seat);
  state.ride = { vx: 0, vy: 0 };
  state.rideWish = null;
  state.rising = true;
  if (item) {
    item.speed = 0;
    state.sentX = item.x;
    state.sentY = item.y;
    state.sentAt = performance.now();
    state.dirty = false;
    send({ t: "glide", id: item.id, x: item.x, y: item.y, rot: item.rot || 0, vx: 0, vy: 0 });
  }
  send({ t: "rise" });
}

function interact() {
  if (!state.me || state.editing || state.help || state.arcade || state.boardOpen || !$("avatar").hidden) return;
  if (snacks.dismiss()) return;
  const blockBite = nearLala() || (!state.seat && (nearestChair() || nearestUse() || stalls.nearest()));
  if (snacks.carrying() && !blockBite) {
    snacks.nibble();
    return;
  }
  if (snacks.openNearest()) return;
  if (state.seat) {
    standUp();
    return;
  }
  sendMove(true);
  const chair = nearestChair();
  if (chair) {
    send({ t: "sit", id: chair.item.id });
    state.path = [];
    return;
  }
  if (stalls.toggle()) return;
  if (nearLala()) {
    snacks.openLala();
    return;
  }
  const spot = nearestUse();
  if (spot?.use === "play") {
    openArcade();
    return;
  }
  if (spot?.use === "scores") {
    openBoard();
    return;
  }
  if (inRestroom()) showAvatar("mirror");
}

function hitFurniture(x, y, movable = false) {
  const items = [...state.furniture].sort((a, b) => a.y + sizeOf(a).h - (b.y + sizeOf(b).h));
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (movable && state.specs.get(item.kind)?.fixed) continue;
    const size = sizeOf(item);
    if (x >= item.x - 6 && y >= item.y - 6 && x <= item.x + size.w + 6 && y <= item.y + size.h + 6) return item;
  }
  return null;
}

let pendingAdd = null;
let placeGesture = null;

function placeArmed(x, y) {
  const kind = state.armed;
  const spec = state.specs.get(kind);
  if (!spec || pendingAdd) return;
  if (state.socket?.readyState !== 1) return;
  pendingAdd = kind;
  send({ t: "furn", op: "add", kind, x: x - spec.w / 2, y: y - spec.h / 2 });
}

function rotateSelected() {
  if (!state.editing || !state.selected) return;
  send({ t: "furn", op: "rot", id: state.selected });
}

function removeSelected() {
  if (!state.editing || !state.selected) return;
  send({ t: "furn", op: "remove", id: state.selected });
  state.selected = null;
  paintTools();
}

const pointers = new Map();
let pinch = null;

// Seated taps only use what is already in reach, so the chair is kept.
function useSeated(point) {
  if (snacks.walk(point, true)) return;
  const spot = hitUse(point.x, point.y);
  if (spot) {
    if (nearestUse()?.use !== spot.use) return;
    if (spot.use === "play") openArcade();
    else if (spot.use === "scores") openBoard();
    return;
  }
  const lala = state.map?.lala;
  if (lala && Math.hypot(point.x - lala.x, point.y - lala.y) < 36 && nearLala()) snacks.openLala();
}

function walkOrUse(point) {
  if (snacks.walk(point)) return;
  const furn = hitFurniture(point.x, point.y);
  if (furn?.kind === "chair") {
    const center = chairCenter(furn);
    if (nearestChair()?.item.id === furn.id) interact();
    else state.path = findPath(freeSpot(center.x, center.y + 36).x, freeSpot(center.x, center.y + 36).y);
    return;
  }
  if (furn?.kind === "sofa") {
    const front = seatApproach(furn);
    const spot = freeSpot(front.x, front.y);
    state.path = findPath(spot.x, spot.y);
    return;
  }
  const spot = hitUse(point.x, point.y);
  if (spot) {
    const stand = standPoint(spot);
    if (nearestUse()?.use === spot.use) interact();
    else state.path = findPath(stand.x, stand.y);
    return;
  }
  const lala = state.map?.lala;
  if (lala && Math.hypot(point.x - lala.x, point.y - lala.y) < 36) {
    if (nearLala()) interact();
    else state.path = findPath(state.map.talk.x, state.map.talk.y);
    return;
  }
  state.path = findPath(point.x, point.y);
}

function closePeople() {
  document.body.classList.remove("people-open");
  $("people-btn")?.setAttribute("aria-expanded", "false");
  const form = $("rename-form");
  if (form?.classList.contains("rename-pop")) {
    form.hidden = true;
    form.classList.remove("rename-pop");
    $("online")?.appendChild(form);
  }
}

const SWIPE_PX = 6;

function endOrbit() {
  if (state.orbit?.turned) state.faceFlush = true;
  state.orbit = null;
}

function onPointerDown(event) {
  if (event.button !== 0 && event.pointerType !== "touch") return;
  if (event.target !== canvas) return;
  closePeople();
  $("chat-input").blur();
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size >= 2) {
    const pts = [...pointers.values()];
    pinch = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1 };
    endOrbit();
    state.drag = null;
    state.pan = null;
    placeGesture = null;
    return;
  }
  const point = screenToWorld(event.clientX, event.clientY);
  if (state.editing) {
    if (state.armed) {
      placeGesture = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        wx: point.x,
        wy: point.y,
        moved: false,
      };
      try { canvas.setPointerCapture(event.pointerId); } catch { /* ignore */ }
      return;
    }
    const hit = hitFurniture(point.x, point.y, true);
    if (hit) {
      state.selected = hit.id;
      paintTools();
      state.drag = { id: hit.id, item: hit, dx: point.x - hit.x, dy: point.y - hit.y, ox: hit.x, oy: hit.y };
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    state.selected = null;
    paintTools();
    state.pan = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  const orbit = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    ox: event.clientX,
    oy: event.clientY,
    moved: false,
    world: point,
    turned: false,
  };
  state.orbit = orbit;
  try { canvas.setPointerCapture(event.pointerId); } catch { /* ignore */ }
}

function onPointerMove(event) {
  if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinch && pointers.size >= 2) {
    const pts = [...pointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    world.zoom((pinch.dist - dist) * 1.6);
    pinch.dist = dist;
    return;
  }
  if (placeGesture && event.pointerId === placeGesture.id) {
    if (Math.hypot(event.clientX - placeGesture.x, event.clientY - placeGesture.y) > 8) placeGesture.moved = true;
    if (placeGesture.moved && state.focus) {
      const now = screenToWorld(event.clientX, event.clientY);
      const then = screenToWorld(placeGesture.x, placeGesture.y);
      state.focus.x += then.x - now.x;
      state.focus.y += then.y - now.y;
      placeGesture.x = event.clientX;
      placeGesture.y = event.clientY;
    }
    return;
  }
  if (state.drag?.item) {
    const point = screenToWorld(event.clientX, event.clientY);
    state.drag.item.x = Math.round((point.x - state.drag.dx) / 4) * 4;
    state.drag.item.y = Math.round((point.y - state.drag.dy) / 4) * 4;
  } else if (state.pan && state.focus) {
    const now = screenToWorld(event.clientX, event.clientY);
    const then = screenToWorld(state.pan.x, state.pan.y);
    state.focus.x += then.x - now.x;
    state.focus.y += then.y - now.y;
    state.pan.x = event.clientX;
    state.pan.y = event.clientY;
  } else if (state.orbit && event.pointerId === state.orbit.id) {
    const dx = event.clientX - state.orbit.x;
    const dy = event.clientY - state.orbit.y;
    if (Math.hypot(event.clientX - state.orbit.ox, event.clientY - state.orbit.oy) > SWIPE_PX) state.orbit.moved = true;
    if (state.orbit.moved) {
      world.orbit(dx, dy);
      state.orbit.turned = true;
    }
    state.orbit.x = event.clientX;
    state.orbit.y = event.clientY;
  }
}

function onPointerUp(event) {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinch = null;
  if (state.orbit && (!event || event.pointerId === state.orbit.id)) {
    const orbit = state.orbit;
    // Sitting keeps the chair. A short tap walks or uses; a swipe only turns the camera.
    if (!orbit.moved) {
      if (state.seat) useSeated(orbit.world);
      else walkOrUse(orbit.world);
    }
    endOrbit();
  }
  if (placeGesture && (!event || event.pointerId === placeGesture.id)) {
    if (!placeGesture.moved) placeArmed(placeGesture.wx, placeGesture.wy);
    placeGesture = null;
  }
  if (state.drag?.item) {
    const item = state.drag.item;
    if (Math.hypot(item.x - state.drag.ox, item.y - state.drag.oy) > 2) {
      send({ t: "furn", op: "move", id: item.id, x: item.x, y: item.y });
    }
  }
  state.drag = null;
  state.pan = null;
}

const stick = $("stick");
const stickKnob = $("stick-knob");
let stickId = null;

function moveStick(event) {
  const rect = stick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = event.clientX - cx;
  const dy = event.clientY - cy;
  const dist = Math.hypot(dx, dy) || 1;
  const max = rect.width * 0.32;
  const scale = Math.min(1, dist / max);
  const dead = scale < 0.18;
  state.stickX = dead ? 0 : (dx / dist) * scale;
  state.stickY = dead ? 0 : (dy / dist) * scale;
  const reach = max * (dead ? 0 : scale);
  stickKnob.style.transform = `translate(${(dx / dist) * reach}px, ${(dy / dist) * reach}px)`;
}

function releaseStick() {
  stickId = null;
  state.stickX = 0;
  state.stickY = 0;
  if (stickKnob) stickKnob.style.transform = "translate(0px, 0px)";
}

stick?.addEventListener("pointerdown", (event) => {
  if (!phoneQuery.matches) return;
  event.preventDefault();
  event.stopPropagation();
  stickId = event.pointerId;
  try { stick.setPointerCapture(event.pointerId); } catch { /* ignore */ }
  moveStick(event);
});
stick?.addEventListener("pointermove", (event) => {
  if (event.pointerId !== stickId) return;
  event.preventDefault();
  moveStick(event);
});
stick?.addEventListener("pointerup", (event) => {
  if (event.pointerId !== stickId) return;
  releaseStick();
});
stick?.addEventListener("pointercancel", () => releaseStick());

function keyboardInset() {
  if (typeof keyboardOverride === "number") return Math.max(0, keyboardOverride);
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
}

function pinOverlays() {
  const inset = phoneQuery.matches ? keyboardInset() : 0;
  document.documentElement.style.setProperty("--kb", `${Math.round(inset)}px`);
}

window.visualViewport?.addEventListener("resize", pinOverlays);
window.visualViewport?.addEventListener("scroll", pinOverlays);
phoneQuery.addEventListener("change", () => {
  if (!phoneQuery.matches) {
    document.body.classList.remove("chat-open", "people-open");
    releaseStick();
  }
  if (state.editing) {
    const hint = $("edit-hint");
    if (hint) hint.textContent = editHintText();
  }
  pinOverlays();
  paintActions();
  paintChatTip();
  world.resize();
});
pinOverlays();

function typingTarget(event) {
  const target = event.target;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

let composing = false;
let justEnded = false;
const chat = $("chat-input");
chat.addEventListener("compositionstart", () => {
  composing = true;
  justEnded = false;
});
chat.addEventListener("compositionend", () => {
  composing = false;
  justEnded = true;
  setTimeout(() => { justEnded = false; }, 0);
});
chat.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== "Escape") return;
  const keyCode = event.keyCode || event.which || 0;
  if (composing || event.isComposing || keyCode === 229 || justEnded) {
    if (event.key === "Enter") event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (event.key === "Escape" || !chat.value.trim()) {
    event.preventDefault();
    chat.blur();
  }
});

function paintChatTip() {
  const input = $("chat-input");
  if (!input) return;
  const hush = Boolean(state.whisper);
  if (phoneQuery.matches) input.placeholder = hush ? "這句只有這一圈人看得到" : "說點什麼…（Enter 送出）";
  else if (document.activeElement === input) input.placeholder = hush ? "悄悄話：Enter 送出，Esc 回到行走" : "Enter 送出，Esc 回到行走";
  else input.placeholder = hush ? "按 T 說悄悄話，Esc 回到行走" : "按 T 開始輸入，Esc 回到行走";
}

function openChat() {
  if ($("chatbar").hidden || !chat.getClientRects().length) return false;
  chat.focus();
  return document.activeElement === chat;
}

chat.addEventListener("focus", () => {
  state.keys.clear();
  paintChatTip();
});
chat.addEventListener("blur", paintChatTip);
paintChatTip();
$("chatbar").addEventListener("submit", (event) => {
  event.preventDefault();
  if (composing || justEnded) return;
  const text = chat.value.trim();
  if (!text) return;
  send({ t: "chat", text, whisper: Boolean(state.whisper) });
  chat.value = "";
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closePeople();
  if (typingTarget(event) || composing || justEnded) return;
  if ((event.key === "t" || event.key === "T") && !event.ctrlKey && !event.metaKey && !event.altKey && openChat()) {
    event.preventDefault();
    return;
  }
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) event.preventDefault();
  if (event.key === "f" || event.key === "F") {
    if (!event.repeat) toggleWhisper();
    return;
  }
  state.keys.add(event.key.toLowerCase());
  if (event.key === "e" || event.key === "E") interact();
  if (event.key === "v" || event.key === "V") {
    world.toggle();
    paintCam();
  }
  if (!state.editing || !state.selected) return;
  if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault();
    removeSelected();
  } else if (event.key === "r" || event.key === "R") {
    rotateSelected();
  }
});
window.addEventListener("keyup", (event) => state.keys.delete(event.key.toLowerCase()));
canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointercancel", (event) => {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinch = null;
  if (state.orbit?.id === event.pointerId) endOrbit();
});
window.addEventListener("pointerup", onPointerUp);

$("form-password").addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = $("office-password").value.trim();
  const button = event.submitter;
  if (button) button.disabled = true;
  const result = await api("/api/office/login", {
    method: "POST",
    token: "",
    body: { password, deviceKey: deviceKey() },
  });
  if (button) button.disabled = false;
  if (!result.ok && !result.needsRegistration) {
    $("gate-error").textContent = result.error || "密碼不正確";
    return;
  }
  state.password = password;
  if (result.profile) {
    state.password = "";
    applySession(result);
    return;
  }
  showRegister();
});

$("form-register").addEventListener("submit", async (event) => {
  event.preventDefault();
  const idCheck = checkId($("office-id").value);
  const displayName = $("office-name").value.trim();
  if (!idCheck.ok) { $("gate-error").textContent = idCheck.error; return; }
  if (!displayName) { $("gate-error").textContent = "請輸入顯示名稱"; return; }
  const button = event.submitter;
  if (button) button.disabled = true;
  const result = await api("/api/office/register", {
    method: "POST",
    token: "",
    body: { password: state.password, deviceKey: deviceKey(), id: idCheck.id, displayName },
  });
  if (button) button.disabled = false;
  if (!result.ok) { $("gate-error").textContent = result.error || "沒有登記成功"; return; }
  state.password = "";
  applySession(result);
});

$("back-password").addEventListener("click", () => showGate("再輸入一次辦公室密碼。"));
$("have-id").addEventListener("click", () => showPairForm());
$("pair-back").addEventListener("click", () => showRegister());
$("form-pair").addEventListener("submit", async (event) => {
  event.preventDefault();
  const idCheck = checkId($("pair-id").value);
  if (!idCheck.ok) { $("gate-error").textContent = idCheck.error; return; }
  const button = event.submitter;
  if (button) button.disabled = true;
  const result = await api("/api/office/pair", {
    method: "POST",
    body: { password: state.password, deviceKey: deviceKey(), id: idCheck.id, code: $("pair-code-input").value },
  });
  if (button) button.disabled = false;
  if (!result.ok) { $("gate-error").textContent = result.error || "沒有加入"; return; }
  state.password = "";
  applySession(result);
});
$("btn-later").addEventListener("click", () => { $("dialogue").hidden = true; });
$("btn-edit").addEventListener("click", () => {
  sendMove(true);
  send({ t: "edit", on: true });
});
$("edit-done").addEventListener("click", () => send({ t: "edit", on: false }));
$("chairs-home").addEventListener("click", () => send({ t: "furn", op: "home" }));
const UNSTUCK_LABEL = "緊急急救";
const UNSTUCK_AGAIN = "再按一次";
const UNSTUCK_ARM_MS = 3000;
let unstuckArmed = 0;

function labelUnstuck(text) {
  const button = $("unstuck-btn");
  if (!button) return;
  const label = button.querySelector(".label");
  if (label) label.textContent = text;
  button.setAttribute("aria-label", text);
}

function disarmUnstuck() {
  clearTimeout(unstuckArmed);
  unstuckArmed = 0;
  labelUnstuck(UNSTUCK_LABEL);
  $("unstuck-btn")?.classList.remove("armed");
  if (state.hint.startsWith(UNSTUCK_AGAIN)) setHint("");
}

$("unstuck-btn")?.addEventListener("click", () => {
  if (!state.me) return;
  const button = $("unstuck-btn");
  // Phones ask for a second tap so a stray touch near the menu button does not teleport anyone.
  if (phoneQuery.matches && !unstuckArmed) {
    labelUnstuck(UNSTUCK_AGAIN);
    button.classList.add("armed");
    setHint(`${UNSTUCK_AGAIN}「${UNSTUCK_LABEL}」就會回到出生點`);
    unstuckArmed = setTimeout(disarmUnstuck, UNSTUCK_ARM_MS);
    return;
  }
  disarmUnstuck();
  button.disabled = true;
  setTimeout(() => { button.disabled = false; }, 1500);
  closePeople();
  state.path = [];
  state.ride = { vx: 0, vy: 0 };
  state.rideWish = null;
  state.drag = null;
  send({ t: "reset" });
});
$("furn-rot").addEventListener("click", () => rotateSelected());
$("furn-remove").addEventListener("click", () => removeSelected());
$("furn-clear").addEventListener("click", () => {
  state.selected = null;
  paintTools();
});
$("furn-cancel").addEventListener("click", () => clearArmed());
for (const id of ["help-btn", "help-drawer"]) {
  $(id)?.addEventListener("click", () => {
    closePeople();
    state.help = true;
    $("help").hidden = false;
  });
}
$("help-close").addEventListener("click", () => { state.help = false; $("help").hidden = true; });
$("arcade-close").addEventListener("click", () => closeArcade());
$("board-close").addEventListener("click", () => closeBoard());
window.addEventListener("message", (event) => {
  if (event.origin !== location.origin) return;
  if (event.source !== $("arcade-frame")?.contentWindow) return;
  const data = event.data || {};
  if (data.officeClose) { closeArcade(); return; }
  const score = data.officeScore;
  if (!score || typeof score !== "object") return;
  void submitScore(score);
});
$("rename").addEventListener("click", () => {
  const form = $("rename-form");
  const opening = form.hidden;
  form.hidden = !opening;
  if (!opening) {
    form.classList.remove("rename-pop");
    $("online")?.appendChild(form);
    return;
  }
  $("rename-input").value = state.me?.displayName || "";
  if (phoneQuery.matches) {
    closePeople();
    document.body.appendChild(form);
    form.classList.add("rename-pop");
    form.hidden = false;
  }
  $("rename-input").focus();
});
$("rename-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const displayName = $("rename-input").value.trim();
  if (!displayName) return;
  send({ t: "profile", displayName });
  closePeople();
  $("rename-form").hidden = true;
  $("rename-form").classList.remove("rename-pop");
  $("online")?.appendChild($("rename-form"));
});
$("avatar-cancel").addEventListener("click", () => { $("avatar").hidden = true; });
$("avatar-random").addEventListener("click", () => randomLook());
$("avatar-save").addEventListener("click", async () => {
  const displayName = $("avatar-name").value.trim() || profileNow()?.displayName;
  const body = { displayName, animal: state.avatarAnimal, look: state.look };
  if (!displayName) { $("avatar-error").textContent = "請輸入顯示名稱"; return; }
  if (state.avatarMode === "first") {
    if (!socketLive()) connect();
    const result = await requests.ask("setup", body);
    if (!result.ok) { $("avatar-error").textContent = result.error || "沒有儲存"; return; }
    state.profile = result.profile;
    $("avatar").hidden = true;
    startGame();
    return;
  }
  sendMove(true);
  send({ t: "profile", ...body });
});

let layoutMode = null;
function resize() {
  const next = window.innerWidth > window.innerHeight ? "land" : "port";
  if (layoutMode && layoutMode !== next) closePeople();
  layoutMode = next;
  world.resize();
}
window.addEventListener("resize", resize);

function actionsNow() {
  if (!phoneQuery.matches || !state.me || state.editing || state.help || state.arcade || state.boardOpen || !$("avatar").hidden || !$("dialogue").hidden || snacks.isOpen()) return [];
  const list = [];
  const near = nearestWhisper();
  if (state.whisper) list.push({ id: "leave", label: "離開悄悄話", run: toggleWhisper });
  else if (near?.grouped) list.push({ id: "join", label: "加入悄悄話", run: toggleWhisper });
  else if (near) list.push({ id: "whisper", label: "說悄悄話", run: toggleWhisper });
  const bite = snacks.heldAction();
  if (bite) list.push(bite);
  const snack = snacks.action();
  if (snack) list.push(snack);
  else if (state.seat) list.push({ id: "stand", label: "起立", run: interact });
  else if (nearestChair()) list.push({ id: "sit", label: "坐下", run: interact });
  else if (nearLala()) list.push({ id: "lala", label: "跟 Lala 說話", run: interact });
  else if (nearestUse()?.use === "play") list.push({ id: "play", label: "玩小遊戲", run: interact });
  else if (nearestUse()?.use === "scores") list.push({ id: "scores", label: "看排行榜", run: interact });
  else if (stalls.action()) list.push(stalls.action());
  else if (inRestroom() && !snacks.carrying()) list.push({ id: "mirror", label: "調整造型", run: interact });
  return list;
}

function paintActions() {
  const box = $("actions");
  if (!box) return;
  const list = actionsNow();
  const sig = list.map((item) => item.label).join("|");
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.replaceChildren();
  for (const action of list) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      action.run();
    });
    box.appendChild(button);
  }
}

function update(dt) {
  snacks.guard();
  if (!state.me || state.gate || !$("avatar").hidden || state.help) {
    state.walking = false;
    world.holdSteer?.(false);
    paintActions();
    return;
  }
  const left = state.keys.has("arrowleft") || state.keys.has("a");
  const right = state.keys.has("arrowright") || state.keys.has("d");
  const up = state.keys.has("arrowup") || state.keys.has("w");
  const down = state.keys.has("arrowdown") || state.keys.has("s");
  let ix = (right ? 1 : 0) - (left ? 1 : 0);
  let iy = (up ? 1 : 0) - (down ? 1 : 0);
  if (!ix && !iy) {
    ix = state.stickX;
    iy = -state.stickY;
  }
  if (snacks.isOpen()) {
    ix = 0;
    iy = 0;
    state.path = [];
  }
  state.walking = Boolean(ix || iy || state.path?.length);
  world.holdSteer?.(Boolean(ix || iy));
  const axes = world.axes();
  const mag = Math.hypot(ix, iy);
  const length = mag > 1 ? mag : 1;
  const vx = (ix * axes.rightX + iy * axes.forwardX) / length;
  const vy = (ix * axes.rightY + iy * axes.forwardY) / length;
  if (state.editing && state.focus) {
    if (ix || iy) {
      state.focus.x += vx * 520 * dt;
      state.focus.y += vy * 520 * dt;
    }
  } else if (state.arcade || state.boardOpen) {
    state.path = [];
  } else if (state.seat && !state.rising) {
    state.path = [];
    const wishX = state.rideWish ? state.rideWish.x : vx;
    const wishY = state.rideWish ? state.rideWish.y : vy;
    rideStep(dt, wishX, wishY);
  } else if (ix || iy) {
    state.path = [];
    tryMove(vx * SPEED * dt, vy * SPEED * dt);
  } else if (state.path.length) {
    const target = state.path[0];
    const dx = target.x - state.me.x;
    const dy = target.y - state.me.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 6) state.path.shift();
    else {
      const step = Math.min(dist, SPEED * dt);
      const moved = tryMove((dx / dist) * step, (dy / dist) * step);
      if (!moved) {
        const goal = state.path[state.path.length - 1];
        state.path = findPath(goal.x, goal.y);
      }
    }
  }
  if (state.dirty) sendMove(false);
  else if (performance.now() - state.sentAt > 120 && (state.me.x !== state.sentX || state.me.y !== state.sentY)) sendMove(true);
  for (const other of state.others.values()) {
    other.x += ((other.tx ?? other.x) - other.x) * Math.min(1, dt * 8);
    other.y += ((other.ty ?? other.y) - other.y) * Math.min(1, dt * 8);
  }
  const now = performance.now();
  for (const [id, bubble] of state.bubbles) if (bubble.until <= now) state.bubbles.delete(id);
  if (state.asks.some((ask) => ask.until <= Date.now())) {
    state.asks = state.asks.filter((ask) => ask.until > Date.now());
    paintAsks();
  }
  if (state.whisper && !state.whisperArm) {
    const members = state.groups.get(state.whisper) || [];
    let close = false;
    for (const id of members) {
      if (id === state.me.id) continue;
      const person = state.others.get(id);
      if (person && Math.hypot(state.me.x - person.x, state.me.y - person.y) <= WHISPER_FAR) close = true;
    }
    if (!close) {
      state.whisperArm = true;
      send({ t: "hush", off: true });
    }
  }
  const zone = zoneAt(state.me.x, state.me.y);
  const name = zone?.name || "辦公室";
  if (name !== state.zoneName) {
    state.zoneName = name;
    $("room-label").textContent = name;
  }
  if (!state.editing && $("dialogue").hidden && $("avatar").hidden) {
    const spot = nearestUse();
    const near = nearestWhisper();
    if (state.whisperNoteUntil > now) setHint(state.whisperNote);
    else if (phoneQuery.matches) {
      if (state.hint.startsWith("按 E") || state.hint.startsWith("按 F")) setHint("");
    } else if (state.whisper) setHint("按 F 離開悄悄話");
    else if (near?.grouped) setHint(`按 F 想加入 @${near.id} 的悄悄話`);
    else if (near) setHint(`按 F 跟 @${near.id} 說悄悄話`);
    else if (snacks.isOpen()) setHint("");
    else if (!snacks.carrying() && snacks.prompt()) setHint(snacks.prompt());
    else if (state.seat) setHint(snacks.carrying() ? snacks.prompt() : "按 E 起立");
    else if (nearestChair()) setHint("按 E 坐下");
    else if (nearLala()) setHint("按 E 跟 Lala 小姐說話");
    else if (spot?.use === "play") setHint("按 E 玩小遊戲");
    else if (spot?.use === "scores") setHint("按 E 看排行榜");
    else if (stalls.prompt()) setHint(stalls.prompt());
    else if (inRestroom() && !snacks.carrying()) setHint("按 E 調整造型");
    else if (snacks.carrying() && snacks.prompt()) setHint(snacks.prompt());
    else if (state.hint.startsWith("按 E") || state.hint.startsWith("按 F") || state.hint.includes("悄悄話")) setHint("");
  }
  paintActions();
}

function frame(now) {
  if (document.hidden) {
    state.loop = false;
    return;
  }
  const dt = Math.min(0.05, (now - (frame.last || now)) / 1000);
  frame.last = now;
  state.anim += dt * 6;
  if (state.map && state.me && !state.gate) update(dt);
  world.sync(state, dt);
  sendFacing();
  if (!$("avatar").hidden) paintPreview();
  requestAnimationFrame(frame);
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden || state.loop) return;
  if (state.connected || !$("avatar").hidden) ensureLoop();
});

function ensureLoop() {
  if (state.loop) return;
  state.loop = true;
  resize();
  requestAnimationFrame(frame);
}

const officeDebug = new URLSearchParams(location.search).has("debug")
  || location.hostname === "127.0.0.1"
  || location.hostname === "localhost";
if (officeDebug) window.office = {
  get ready() { return Boolean(state.connected && state.me && state.map); },
  get me() { return state.me ? { ...state.me } : null; },
  get others() {
    return [...state.others.values()].map((other) => ({ ...other }));
  },
  get furniture() { return state.furniture.map((item) => ({ ...item })); },
  get props() {
    return (state.map?.props || []).map((prop) => ({
      id: prop.id,
      kind: prop.kind,
      room: prop.room,
      x: prop.x,
      y: prop.y,
      w: prop.w,
      h: prop.h,
      rot: prop.rot,
      openX: prop.openX,
      openY: prop.openY,
      openW: prop.openW,
      openH: prop.openH,
    }));
  },
  get stallDoors() { return stalls.view(); },
  blocked(x, y) { return collides(x, y, null, 12); },
  pose(id, rot) {
    const item = state.furniture.find((entry) => entry.id === id);
    if (!item) return false;
    item.rot = rot;
    return true;
  },
  get bubbles() { return [...state.bubbles.entries()].map(([id, bubble]) => ({ id, text: bubble.text, whisper: Boolean(bubble.whisper), until: bubble.until })); },
  get whisper() { return state.whisper; },
  get group() { return state.whisper ? [...(state.groups.get(state.whisper) || [])] : []; },
  get asks() { return state.asks.map((ask) => ({ ...ask })); },
  get tape() { return state.tape.map((item) => ({ ...item })); },
  get zone() { return state.zoneName; },
  get spawn() { return state.map?.spawn ? { x: state.map.spawn.x, y: state.map.spawn.y } : null; },
  outlineCount(id) {
    const actor = world.actor?.(id);
    if (!actor) return -1;
    let count = 0;
    actor.traverse((node) => {
      if (node.userData?.outline || node.material?.customProgramCacheKey?.() === "toon-outline") count += 1;
    });
    return count;
  },
  get editing() { return state.editing; },
  get selected() { return state.selected; },
  get armed() { return state.armed; },
  get connected() { return state.connected; },
  get arcade() { return state.arcade; },
  get boardOpen() { return state.boardOpen; },
  ask(kind, body) { return requests.ask(kind, body); },
  get waiting() { return requests.waiting; },
  walkTo(x, y) { state.path = findPath(x, y); },
  place(x, y) {
    if (!state.me || state.seat) return;
    const spot = freeSpot(x, y);
    if (Math.abs(spot.x - state.me.x) > 0.5) state.me.dir = spot.x > state.me.x ? 1 : -1;
    state.me.x = spot.x;
    state.me.y = spot.y;
    state.path = [];
    state.dirty = true;
    sendMove(true);
  },
  radius(look) { return bodyRadius(look); },
  gap(id) { return state.me ? world.gap(state.me.id, id) : null; },
  drive(x, y) { state.rideWish = x || y ? { x, y } : null; },
  get seat() { return state.seat; },
  get socket() { return state.socket; },
  get view3d() { return world.ok; },
  get preview3d() { return world.previewOk; },
  get phone() { return phoneQuery.matches; },
  get actions() { return [...$("actions").querySelectorAll("button")].map((button) => button.textContent); },
  get pixelRatio() { return world.pixelRatio; },
  get assetsReady() { return world.assetsReady === true; },
  get assetsProgress() { return world.assetsProgress || { done: 0, total: 0 }; },
  get quality() { return world.quality || "low"; },
  homeDist() { return world.homeDist(); },
  get fogNear() { return world.fogNear; },
  applyKeyboardInset(px) {
    keyboardOverride = px == null ? null : Number(px);
    pinOverlays();
  },
  get cameraMode() { return world.mode; },
  get cameraDist() { return world.dist; },
  get cameraYaw() { return world.yaw; },
  get cameraHeading() { return world.cameraHeading; },
  get cameraPitch() { return world.pitch; },
  get heading() { return world.shown; },
  get aim() { return world.gazeAim; },
  actorHeading(id) { return world.actorHeading?.(id) ?? null; },
  setView(view) { world.aim(view); },
  poseCast(people) {
    for (const person of people) {
      const preset = presetOf(person.animal);
      state.others.set(person.id, {
        id: person.id,
        displayName: person.name || person.id,
        animal: person.animal || "custom",
        look: cloneLook(person.look) || cloneLook(preset?.look),
        x: person.x,
        y: person.y,
        tx: person.x,
        ty: person.y,
        dir: 1,
      });
    }
  },
  applyLook(look, animal) {
    if (!state.me || !look) return;
    state.me.look = cloneLook(look);
    if (animal) state.me.animal = animal;
  },
  clearCast(ids) {
    for (const id of ids) state.others.delete(id);
  },
  focusOn(x, y) {
    state.focus = { x, y };
  },
  worldToScreen,
  screenToWorld,
  beginCapture() { ensureLoop(); world.beginCapture?.(); },
  endCapture() { return world.endCapture?.() || []; },
  captureCount() { return world.captureCount?.() || 0; },
  get snackStock() { return snacks.counts(); },
  get snackCarry() { return snacks.carried(); },
  snackCarryOf(id) { return snacks.carried(id); },
  snackSpot(kind) { return snacks.spot(kind); },
  snackMenu() { return snacks.openNearest(); },
  snackPhase() { return snacks.phase(); },
  snackHold(value) { snacks.hold(value); },
  get snackOpen() { return snacks.isOpen(); },
  feed(message) { onNet(message); },
};

async function clockOut() {
  state.clocked = true;
  $("clockout").hidden = true;
  const result = await api("/api/office/logout", { method: "POST", body: {} });
  try { state.socket?.close(); } catch { /* already closing */ }
  showGate(result.ok ? "辛苦了，明天見！" : "下班沒有完成，請再試一次。");
  state.clocked = false;
}

function openClockout() {
  if (state.gate || $("avatar").hidden === false && state.avatarMode === "first") return;
  $("clockout").hidden = false;
}

async function boot() {
  paintCam();
  const legacy = localStorage.getItem(SESSION);
  if (legacy) {
    await api("/api/office/session", { method: "POST", token: legacy, body: {} });
    localStorage.removeItem(SESSION);
  }
  const me = await api("/api/office/me");
  if (me.ok) { applySession(me); return; }
  const status = await api("/api/office/status", { token: "" });
  if (status.ok && status.hasPassword === false) {
    showGate("管理員還沒設定辦公室密碼。請先到管理頁設定。", { keepPassword: true });
    $("form-password").hidden = true;
    return;
  }
  showGate("輸入管理員給大家的辦公室密碼。這台裝置會記住你。", { keepPassword: true });
}

setInterval(() => {
  if (state.socket?.readyState === 1) state.socket.send("ping");
}, 20000);

canvas.addEventListener("wheel", (event) => {
  if (state.gate) return;
  event.preventDefault();
  world.zoom(event.deltaY);
}, { passive: false });
function setCam(mode) {
  if (world.mode !== mode) world.toggle();
  paintCam();
}
$("cam-iso")?.addEventListener("click", () => setCam("iso"));
$("cam-follow")?.addEventListener("click", () => setCam("follow"));
$("cam-btn")?.addEventListener("click", () => {
  world.toggle();
  paintCam();
});
for (const id of ["clock-btn", "clock-drawer"]) {
  $(id)?.addEventListener("click", () => {
    closePeople();
    openClockout();
  });
}
document.addEventListener("pointerdown", (event) => {
  if (!document.body.classList.contains("people-open") && !$("rename-form")?.classList.contains("rename-pop")) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("#online, #people-btn, #rename-form")) return;
  closePeople();
});
$("clockout-no")?.addEventListener("click", () => { $("clockout").hidden = true; });
$("clockout-yes")?.addEventListener("click", () => { void clockOut(); });
$("pair-open")?.addEventListener("click", () => { void openPair(); });
$("pair-refresh")?.addEventListener("click", () => { void openPair(); });
$("pair-close")?.addEventListener("click", () => { $("pair-dialog").hidden = true; });
$("elsewhere-take")?.addEventListener("click", () => {
  stopParkWatch();
  state.parked = false;
  $("elsewhere").hidden = true;
  connect();
});

function closeSheets() {
  document.body.classList.remove("people-open", "chat-open");
  $("people-btn")?.setAttribute("aria-expanded", "false");
  const chatToggle = $("chat-toggle");
  if (chatToggle) {
    chatToggle.setAttribute("aria-expanded", "false");
    chatToggle.textContent = "聊天";
  }
  $("chat-whisper")?.classList.remove("open");
  const form = $("rename-form");
  if (form) {
    form.hidden = true;
    if (form.classList.contains("rename-pop")) {
      form.classList.remove("rename-pop");
      $("online")?.appendChild(form);
    }
  }
  state.help = false;
  $("help").hidden = true;
  $("clockout").hidden = true;
  $("dialogue").hidden = true;
  $("pair-dialog").hidden = true;
  if (state.arcade) closeArcade();
  if (state.boardOpen) closeBoard();
}

async function openPair() {
  closeSheets();
  $("pair-dialog").hidden = false;
  $("pair-error").textContent = "";
  $("pair-code").textContent = "……";
  const result = await api("/api/office/pair/code", { method: "POST", body: {} });
  if (!result.ok) {
    $("pair-error").textContent = result.error || "沒有產生代碼";
    $("pair-code").textContent = "------";
    return;
  }
  const code = String(result.code || "");
  $("pair-code").textContent = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
$("people-btn")?.addEventListener("click", () => {
  const open = document.body.classList.toggle("people-open");
  $("people-btn").setAttribute("aria-expanded", String(open));
});
$("chat-toggle")?.addEventListener("click", () => {
  const open = document.body.classList.toggle("chat-open");
  $("chat-toggle").setAttribute("aria-expanded", String(open));
  $("chat-toggle").textContent = open ? "收起" : "聊天";
  if (open) $("chat-input").focus();
  else $("chat-input").blur();
});
$("chat-whisper")?.addEventListener("click", () => {
  if (!phoneQuery.matches) return;
  $("chat-whisper").classList.toggle("open");
});

boot();
