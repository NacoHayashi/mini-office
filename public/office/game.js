// Office client entry: wires the page, runs the frame loop, and boots the session.
import { attachMonitors } from "./monitors.js";
import { attachSnacks } from "./snacks.js";
import { attachStalls } from "./stalls.js";
import { attachToys } from "./toys.js";
import { paintActions } from "./actions.js";
import { closeArcade, closeBoard, submitScore } from "./arcade.js";
import { composing, justEnded, openChat, paintChatTip, wireChat } from "./chat.js";
import { exposeDebug } from "./debug.js";
import { clearArmed, editHintText, hitFurniture, paintTools, removeSelected, rotateSelected } from "./edit-mode.js";
import { pinOverlays, releaseStick, typingTarget, wirePointers, wireStick } from "./input.js";
import { interact, nearestChair, nearestUse, rideStep } from "./interact.js";
import { boot, clockOut, openClockout, openPair, stopParkWatch, wireLogin } from "./login.js";
import { paintPreview, wireLook } from "./look-editor.js";
import { bodyRadius, findPath, freeSpot, inRestroom, nearLala, sizeOf, tryMove, zoneAt } from "./movement.js";
import { connect, send, sendFacing, sendMove } from "./net.js";
import { $, RUN_SPEED, SPEED, WHISPER_FAR, canvas, phoneQuery, setHint, state, world } from "./office-state.js";
import { closePeople, wirePeople } from "./people.js";
import { nearestWhisper, paintAsks, toggleWhisper } from "./whisper.js";

export const snacks = attachSnacks({
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
export const stalls = attachStalls({ state, world, send });
export const monitors = attachMonitors({ state, world });
export const toys = attachToys({
  state,
  world,
  $,
  send,
  sizeOf,
  phone: () => phoneQuery.matches,
  bodyRadius: (look) => bodyRadius(look),
  blocked: () => Boolean(!state.me || state.editing || state.help || state.arcade || state.boardOpen || state.gate || !$("avatar").hidden),
  flush: () => sendMove(true),
  hitFurniture: (...args) => hitFurniture(...args),
  freeSpot: (...args) => freeSpot(...args),
  findPath: (...args) => findPath(...args),
  placeMe: (x, y) => {
    if (!state.me || state.seat) return;
    state.me.x = x;
    state.me.y = y;
    state.path = [];
    state.sentX = x;
    state.sentY = y;
    state.sentAt = performance.now();
    state.dirty = false;
  },
});

export function paintCam() {
  const follow = world.mode === "follow";
  $("cam-iso")?.setAttribute("aria-pressed", follow ? "false" : "true");
  $("cam-follow")?.setAttribute("aria-pressed", follow ? "true" : "false");
  $("cam-btn")?.setAttribute("aria-pressed", follow ? "true" : "false");
}

wireStick();

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

wireChat();

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
  if ((event.key === "q" || event.key === "Q") && !event.repeat && state.me && !state.editing) toys.drop();
  if ((event.key === "1" || event.key === "2") && !event.repeat && state.me && !state.editing && !event.ctrlKey && !event.metaKey && !event.altKey) toys.key(event.key, true);
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
window.addEventListener("keyup", (event) => {
  state.keys.delete(event.key.toLowerCase());
  if (event.key === "e" || event.key === "E" || event.key === "2") toys.release();
});
window.addEventListener("blur", () => toys.release());
wirePointers();
wireLogin();
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
wirePeople();
wireLook();

let layoutMode = null;
export function resize() {
  const next = window.innerWidth > window.innerHeight ? "land" : "port";
  if (layoutMode && layoutMode !== next) closePeople();
  layoutMode = next;
  world.resize();
}
window.addEventListener("resize", resize);

// Draw coworkers a little in the past and interpolate between their position updates, so they glide.
const REMOTE_DELAY = 150;

function glideOther(other, now, dt) {
  const tx = other.tx ?? other.x;
  const ty = other.ty ?? other.y;
  const track = other.track;
  const last = track?.[track.length - 1];
  if (last && last.x === tx && last.y === ty) {
    const at = now - REMOTE_DELAY;
    while (track.length > 2 && track[1].at <= at) track.shift();
    const a = track[0];
    const b = track[1] || a;
    const t = b.at > a.at ? Math.min(1, Math.max(0, (at - a.at) / (b.at - a.at))) : 1;
    other.x = a.x + (b.x - a.x) * t;
    other.y = a.y + (b.y - a.y) * t;
    return;
  }
  // Sit, rise and chair glides set the target directly; ease toward it.
  if (track) track.length = 0;
  const follow = 1 - Math.exp(-10 * dt);
  other.x += (tx - other.x) * follow;
  other.y += (ty - other.y) * follow;
}

function update(dt) {
  snacks.guard();
  toys.guard();
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
  if (snacks.isOpen() || toys.isOpen()) {
    ix = 0;
    iy = 0;
    state.path = [];
  }
  state.walking = Boolean(ix || iy || state.path?.length);
  const pushed = Math.hypot(state.stickX, state.stickY) >= 0.95;
  state.running = state.walking && !state.seat && (state.keys.has("shift") || pushed);
  const speed = state.running ? RUN_SPEED : SPEED;
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
    tryMove(vx * speed * dt, vy * speed * dt);
  } else if (state.path.length) {
    const target = state.path[0];
    const dx = target.x - state.me.x;
    const dy = target.y - state.me.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 6) state.path.shift();
    else {
      const step = Math.min(dist, speed * dt);
      const moved = tryMove((dx / dist) * step, (dy / dist) * step);
      if (!moved) {
        const goal = state.path[state.path.length - 1];
        state.path = findPath(goal.x, goal.y);
      }
    }
  }
  if (state.dirty) sendMove(false);
  else if (performance.now() - state.sentAt > 120 && (state.me.x !== state.sentX || state.me.y !== state.sentY)) sendMove(true);
  const now = performance.now();
  for (const other of state.others.values()) glideOther(other, now, dt);
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
      if (state.hint.startsWith("按 E") || state.hint.startsWith("按住") || state.hint.startsWith("按 F")) setHint("");
    } else if (toys.urgent() && !toys.isOpen()) setHint(toys.prompt());
    else if (state.whisper) setHint("按 F 離開悄悄話");
    else if (near?.grouped) setHint(`按 F 想加入 @${near.id} 的悄悄話`);
    else if (near) setHint(`按 F 跟 @${near.id} 說悄悄話`);
    else if (snacks.isOpen() || toys.isOpen()) setHint("");
    else if (!snacks.carrying() && snacks.prompt()) setHint(snacks.prompt());
    else if (state.seat) setHint(snacks.carrying() ? snacks.prompt() : "按 E 起立");
    else if (nearestChair()) setHint("按 E 坐下");
    else if (nearLala()) setHint("按 E 跟 Lala 小姐說話");
    else if (spot?.use === "play") setHint("按 E 玩小遊戲");
    else if (spot?.use === "scores") setHint("按 E 看排行榜");
    else if (stalls.prompt()) setHint(stalls.prompt());
    else if (toys.prompt()) setHint(toys.prompt());
    else if (inRestroom() && !snacks.carrying()) setHint("按 E 調整造型");
    else if (snacks.carrying() && snacks.prompt()) setHint(snacks.prompt());
    else if (state.hint.startsWith("按 E") || state.hint.startsWith("按住") || state.hint.startsWith("按 F") || state.hint.includes("悄悄話")) setHint("");
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

export function ensureLoop() {
  if (state.loop) return;
  state.loop = true;
  resize();
  requestAnimationFrame(frame);
}

exposeDebug();

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

export function closeSheets() {
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
  $("tg-upgrade").hidden = true;
  if (state.arcade) closeArcade();
  if (state.boardOpen) closeBoard();
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
