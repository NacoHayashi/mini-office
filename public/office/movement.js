// Walking: zones, walls, collisions, and path finding.
import { stalls, toys } from "./game.js";
import { send } from "./net.js";
import { TILE, state, world } from "./office-state.js";

export function bodyRadius(look) {
  const id = look?.body || "bean";
  const value = state.catalog?.radii?.[id];
  return typeof value === "number" ? value : 31;
}

function wallRadius() {
  const value = state.catalog?.wall;
  return typeof value === "number" ? value : 11;
}

export function zoneAt(x, y) {
  if (!state.map) return null;
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  return (state.map.zones || []).find((zone) => tx >= zone.x && ty >= zone.y && tx < zone.x + zone.w && ty < zone.y + zone.h) || null;
}

export function inRestroom() {
  const zone = zoneAt(state.me.x, state.me.y);
  return zone?.id === "men" || zone?.id === "women";
}

export function nearLala() {
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

export function seatApproach(item, gap = 24) {
  const size = sizeOf(item);
  const forward = layoutForward(item.rot);
  const alongX = Math.abs(forward.x) >= Math.abs(forward.y);
  const reach = (alongX ? size.w : size.h) / 2 + gap;
  return {
    x: item.x + size.w / 2 + forward.x * reach,
    y: item.y + size.h / 2 + forward.y * reach,
  };
}

export function sizeOf(item) {
  const spec = state.specs.get(item.kind);
  if (!spec) return { w: 32, h: 24, solid: false };
  const rot = ((item.rot || 0) % 360 + 360) % 360;
  if (rot % 180 !== 0) return { w: spec.h, h: spec.w, solid: spec.solid };
  return { w: spec.w, h: spec.h, solid: spec.solid };
}

export function collides(x, y, ignoreId, radius = 11) {
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

export function resolveBodies(x, y, radius) {
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

export function noteBump(hit, bounce) {
  if (!hit) return;
  toys.bumped(hit.id);
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

export function tryMove(dx, dy) {
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

export function freeSpot(x, y) {
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

export function findPath(x, y) {
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

export function screenToWorld(clientX, clientY) {
  return world.screenToWorld(clientX, clientY);
}

export function worldToScreen(x, y) {
  return world.worldToScreen(x, y);
}
