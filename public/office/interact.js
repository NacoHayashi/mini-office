// Using things nearby: chairs, the mirror, the arcade, the board, and taps.
import { openArcade, openBoard } from "./arcade.js";
import { hitFurniture } from "./edit-mode.js";
import { pantry, snacks, stalls, toys } from "./game.js";
import { showAvatar } from "./look-editor.js";
import { bodyRadius, collides, findPath, freeSpot, inRestroom, nearLala, noteBump, resolveBodies, seatApproach } from "./movement.js";
import { send, sendMove } from "./net.js";
import { $, state } from "./office-state.js";

function usedProps() {
  return (state.map?.props || []).filter((prop) => prop.use === "play" || prop.use === "scores");
}

function standPoint(prop) {
  return freeSpot(prop.x + prop.w / 2, prop.y + prop.h + 18);
}

// Office chairs roll; pantry stools are seats that stay put.
export function isSeat(item) {
  return item?.kind === "chair" || item?.kind === "stool";
}

function chairCenter(item) {
  if (item.kind === "stool") return { x: item.x + 8, y: item.y + 8 };
  return { x: item.x + 16, y: item.y + 13 };
}

export function nearestChair() {
  if (!state.me || state.seat) return null;
  let best = null;
  for (const item of state.furniture) {
    if (!isSeat(item) || item.seat) continue;
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

export function rideStep(dt, wishX, wishY) {
  const item = state.furniture.find((entry) => entry.id === state.seat);
  if (!item) {
    state.seat = null;
    if (state.me) state.me.seat = null;
    return;
  }
  if (item.kind === "stool") {
    state.ride = { vx: 0, vy: 0 };
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

export function nearestUse() {
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

function standUp() {
  const item = state.furniture.find((entry) => entry.id === state.seat);
  state.ride = { vx: 0, vy: 0 };
  state.rideWish = null;
  state.rising = true;
  if (item && item.kind === "chair") {
    item.speed = 0;
    state.sentX = item.x;
    state.sentY = item.y;
    state.sentAt = performance.now();
    state.dirty = false;
    send({ t: "glide", id: item.id, x: item.x, y: item.y, rot: item.rot || 0, vx: 0, vy: 0 });
  }
  send({ t: "rise" });
}

export function interact() {
  if (!state.me || state.editing || state.help || state.arcade || state.boardOpen || !$("avatar").hidden) return;
  if (snacks.dismiss()) return;
  if (toys.dismiss()) return;
  if (pantry.interact(state.seat ? -1 : nearestChair()?.dist)) return;
  const blockBite = nearLala() || (!state.seat && (nearestChair() || nearestUse() || stalls.nearest()));
  if (snacks.carrying() && !blockBite) {
    snacks.nibble();
    return;
  }
  if (snacks.openNearest()) return;
  if (toys.interact()) return;
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

// Seated taps only use what is already in reach, so the chair is kept.
export function useSeated(point) {
  if (snacks.walk(point, true)) return;
  if (toys.walk(point, true)) return;
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

export function walkOrUse(point) {
  if (snacks.walk(point)) return;
  if (toys.walk(point)) return;
  const furn = hitFurniture(point.x, point.y);
  if (isSeat(furn)) {
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
