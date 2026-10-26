// Pointer, pinch, and joystick input on the office view.
import { keyboardOverride } from "./debug.js";
import { hitFurniture, paintTools, placeArmed } from "./edit-mode.js";
import { useSeated, walkOrUse } from "./interact.js";
import { screenToWorld } from "./movement.js";
import { send } from "./net.js";
import { $, canvas, phoneQuery, state, world } from "./office-state.js";
import { closePeople } from "./people.js";

let placeGesture = null;

export function clearPlaceGesture() {
  placeGesture = null;
}

const pointers = new Map();
let pinch = null;

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

export function releaseStick() {
  stickId = null;
  state.stickX = 0;
  state.stickY = 0;
  if (stickKnob) stickKnob.style.transform = "translate(0px, 0px)";
}

export function wireStick() {
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
}

function keyboardInset() {
  if (typeof keyboardOverride === "number") return Math.max(0, keyboardOverride);
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
}

export function pinOverlays() {
  const inset = phoneQuery.matches ? keyboardInset() : 0;
  document.documentElement.style.setProperty("--kb", `${Math.round(inset)}px`);
}

export function typingTarget(event) {
  const target = event.target;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

export function wirePointers() {
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointercancel", (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (state.orbit?.id === event.pointerId) endOrbit();
  });
  window.addEventListener("pointerup", onPointerUp);
}
