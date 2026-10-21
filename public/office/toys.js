import * as THREE from "./vendor/three.module.js";
import { stepGradient } from "./toon.js";

// Same reach rules as the server; the server has the final say.
const RACK_REACH = 108;
const PICK_REACH = 60;
const HIT_GAP = 34;
const RAM_GAP = 22;
const THROW_REACH = 320;
const PLANE_REACH = 480;
const CATCH_OPEN_MS = 200;
const CATCH_GRACE_MS = 450;
const RAM_COOL_MS = 3000;
const HEAR = 560;

const ITEMS = [
  { id: "hammer", label: "玩具錘子", model: "tool-hammer", hand: [8, 4, 4], rack: [12, 6, 6] },
  { id: "ball", label: "丟接球", model: "ball-red", hand: [5, 5, 5], rack: [7, 7, 7] },
  { id: "plane", label: "紙飛機", model: null, hand: [6, 2, 8], rack: [9, 3, 11] },
  { id: "pillow", label: "枕頭", model: "pillow", hand: [10, 8, 5], rack: [12, 9, 6] },
  { id: "pinch", label: "捏捏臉", model: "bear", hand: [6, 7, 7], rack: [9, 9, 10] },
  { id: "ram", label: "撞撞車", model: "vehicle-racer", hand: [5, 6, 8], rack: [8, 12, 6] },
];
const BY_ID = new Map(ITEMS.map((item) => [item.id, item]));
const gradient = stepGradient([176, 222, 255]);

function toon(color, extra = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradient, ...extra });
}

// Kenney has no paper plane, so this one is a single folded dart: four flat triangles.
function paperPlane() {
  const geometry = new THREE.BufferGeometry();
  const nose = [0, 0, 5];
  const tail = [0, 0, -5];
  const keel = [0, -1.3, -4.4];
  const left = [-4, 0.5, -5];
  const right = [4, 0.5, -5];
  const flat = [...nose, ...left, ...tail, ...nose, ...tail, ...right, ...nose, ...keel, ...tail, ...nose, ...tail, ...keel];
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(flat, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, toon(0xfffdf8, { side: THREE.DoubleSide }));
  mesh.userData.own = true;
  return mesh;
}

function fallbackBall() {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(3.5, 12, 10), toon(0xf26d6d));
  mesh.userData.own = true;
  return mesh;
}

// Kenney clones share geometry and materials with the loaded templates, so only
// meshes made here are disposed.
function disposeTree(node) {
  if (!node) return;
  node.removeFromParent();
  node.traverse((child) => {
    if (!child.userData?.own) return;
    child.geometry?.dispose?.();
    child.material?.dispose?.();
  });
}

function hidePockets(actor) {
  const hidden = [];
  actor.traverse((node) => {
    if (!node.userData?.held && !node.userData?.pocket) return;
    if (!node.visible) return;
    node.visible = false;
    hidden.push(node);
  });
  return hidden;
}

function showPockets(hidden) {
  for (const node of hidden || []) if (node.parent) node.visible = true;
}

function starTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffd75e";
  ctx.strokeStyle = "#fff6c8";
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 12 : 28;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Damped spring from 1 toward 0 that overshoots: mochi squash, rebound, settle.
function spring(t, rate = 6, freq = 14) {
  return Math.exp(-rate * t) * Math.cos(freq * t);
}

function ease(t) {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

export function attachToys(env) {
  const { state, world, $, send, sizeOf } = env;
  const places = new Map(ITEMS.map((item) => [item.id, { at: "rack" }]));
  const held = new Map();
  const effects = new Map();
  const particles = [];
  const flights = [];
  const letters = [];
  let combo = 0;
  let incoming = null;
  let pinching = null;
  let ramAt = 0;
  let menu = null;
  let compose = null;
  let reader = null;
  let openedAt = 0;
  let placedSig = "";
  let placed = [];
  let stars = null;
  let audio = null;
  const log = [];

  // ---- state -------------------------------------------------------------

  function applyView(message) {
    if (!Array.isArray(message.toys)) return;
    for (const row of message.toys) {
      if (!row || !BY_ID.has(row.id)) continue;
      if (row.at === "hand" && typeof row.holder === "string") places.set(row.id, { at: "hand", holder: row.holder });
      else if (row.at === "floor" && Number.isFinite(row.x) && Number.isFinite(row.y)) places.set(row.id, { at: "floor", x: row.x, y: row.y });
      else if (row.at === "air") places.set(row.id, { at: "air" });
      else places.set(row.id, { at: "rack" });
    }
    if (typeof message.combo === "number") combo = message.combo;
    if (menu && !menu.hidden) paintMenu();
  }

  function holding(id = state.me?.id) {
    if (!id) return "";
    for (const [toy, place] of places) if (place.at === "hand" && place.holder === id) return toy;
    return "";
  }

  function rack() {
    const item = (state.furniture || []).find((row) => row.kind === "toyrack");
    if (!item) return null;
    const size = sizeOf(item);
    return { item, x: item.x + size.w / 2, y: item.y + size.h / 2, w: size.w, h: size.h, standX: item.x + size.w / 2, standY: item.y + size.h + 30 };
  }

  function nearRack() {
    const spot = rack();
    if (!spot || !state.me) return null;
    return Math.hypot(state.me.x - spot.x, state.me.y - spot.y) < RACK_REACH ? spot : null;
  }

  function floorNear() {
    if (!state.me) return null;
    let best = null;
    for (const [id, place] of places) {
      if (place.at !== "floor") continue;
      const dist = Math.hypot(state.me.x - place.x, state.me.y - place.y);
      if (dist < PICK_REACH && (!best || dist < best.dist)) best = { id, dist };
    }
    return best;
  }

  function reachFor(toy, person) {
    const mine = env.bodyRadius(state.me?.look);
    const theirs = env.bodyRadius(person.look);
    if (toy === "ball") return THROW_REACH;
    if (toy === "plane") return PLANE_REACH;
    if (toy === "ram") return mine + theirs + RAM_GAP;
    return mine + theirs + HIT_GAP;
  }

  function target(toy = holding()) {
    if (!state.me || !toy) return null;
    let best = null;
    for (const person of state.others.values()) {
      const dist = Math.hypot(state.me.x - person.x, state.me.y - person.y);
      if (dist > reachFor(toy, person)) continue;
      if (!best || dist < best.dist) best = { person, dist };
    }
    return best?.person || null;
  }

  function nameOf(id) {
    if (id === state.me?.id) return state.me.displayName || id;
    return state.others.get(id)?.displayName || id;
  }

  function emote(id, text, ms = 1800) {
    state.bubbles.set(id, { text, until: performance.now() + ms, emote: true });
  }

  function heard(id) {
    const actor = world.actor?.(id);
    if (!actor || !state.me) return false;
    return Math.hypot(actor.position.x - state.me.x, actor.position.z - state.me.y) < HEAR;
  }

  // ---- sound (WebAudio synth) ---------------------------------------------

  function voice() {
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume().catch(() => {});
      return audio;
    } catch {
      return null;
    }
  }

  function chirp(ctx, type, from, to, length, volume, delay = 0) {
    const at = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + length);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + length + 0.02);
  }

  function puff(ctx, length, volume) {
    const frames = Math.floor(ctx.sampleRate * length);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
  }

  function sound(kind) {
    const ctx = voice();
    if (!ctx) return;
    try {
      if (kind === "bonk") {
        // 「啵」: a quick pitch drop with a bright pop on top.
        chirp(ctx, "sine", 760, 180, 0.16, 0.32);
        chirp(ctx, "triangle", 1500, 620, 0.06, 0.12);
      } else if (kind === "pillow") puff(ctx, 0.22, 0.4);
      else if (kind === "catch") chirp(ctx, "square", 520, 880, 0.08, 0.08);
      else if (kind === "throw") chirp(ctx, "sine", 300, 620, 0.14, 0.12);
      else if (kind === "plane") chirp(ctx, "sine", 980, 1400, 0.25, 0.06);
      else if (kind === "boing") {
        chirp(ctx, "sine", 240, 520, 0.12, 0.22);
        chirp(ctx, "sine", 520, 260, 0.2, 0.16, 0.12);
      } else if (kind === "pinch") chirp(ctx, "sine", 600, 900, 0.12, 0.1);
    } catch {
      /* audio is optional */
    }
  }

  // ---- held props ---------------------------------------------------------

  function makeProp(item, size) {
    if (item.id === "plane") {
      const plane = paperPlane();
      const group = new THREE.Group();
      plane.scale.setScalar(size[2] / 10);
      group.add(plane);
      return group;
    }
    const model = world.model?.(item.model, size[0], size[2], { maxHeight: size[1], stretch: 1.1 });
    if (!model) return null;
    const group = new THREE.Group();
    group.add(model);
    return group;
  }

  function release(actor, pose) {
    showPockets(pose.hidden);
    disposeTree(pose.prop);
    const arm = actor?.userData?.armR;
    if (arm && pose.rest) arm.position.set(pose.rest.x, pose.rest.y, pose.rest.z);
  }

  function bindHeld(actor, id) {
    const toy = holding(id);
    let pose = held.get(id);
    if (pose && (pose.toy !== toy || pose.actor !== actor)) {
      release(pose.actor, pose);
      held.delete(id);
      pose = null;
    }
    if (!toy) return null;
    if (!pose) {
      const arm = actor.userData.armR;
      if (!arm) return null;
      pose = { toy, actor, prop: null, hidden: hidePockets(actor), rest: { x: arm.position.x, y: arm.position.y, z: arm.position.z } };
      held.set(id, pose);
    }
    if (!pose.prop) {
      pose.prop = makeProp(BY_ID.get(toy), BY_ID.get(toy).hand);
      if (pose.prop) actor.userData.armR.add(pose.prop);
    }
    return pose;
  }

  function placeHeld(actor, pose, now) {
    const arm = actor.userData.armR;
    if (!arm || !pose.rest) return;
    arm.position.set(pose.rest.x + 2.4, pose.rest.y + 4.2, pose.rest.z + 0.4);
    const prop = pose.prop;
    if (!prop) return;
    prop.position.set(2.2, 1.6, 0.8);
    prop.rotation.set(0, 0, 0);
    if (pose.toy === "hammer") {
      prop.position.set(2, 0.6, 1);
      prop.rotation.set(0.2, 0, -0.35);
    } else if (pose.toy === "plane") prop.rotation.set(0.1, -0.4, 0);
    else if (pose.toy === "ram") prop.rotation.set(0, Math.PI / 2, 0);
    const swing = effects.get(pose.actor.userData.pid)?.swing;
    if (swing) {
      const t = (now - swing.t0) / 1000;
      if (t > 0.45) effects.get(pose.actor.userData.pid).swing = null;
      else {
        // Wind up, then a quick bonk forward.
        const lift = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 0.3);
        arm.position.y += lift * 5;
        arm.position.z += lift * 3;
        if (pose.toy === "hammer") prop.rotation.x = -1.3 * lift + (t > 0.15 ? 1.1 * lift : 0);
        else prop.rotation.z = 0.8 * lift;
      }
    }
  }

  // ---- per-actor effects ---------------------------------------------------

  function fxOf(id) {
    let fx = effects.get(id);
    if (!fx) {
      fx = {};
      effects.set(id, fx);
    }
    return fx;
  }

  function actorHook(actor, info) {
    const id = actor.userData?.pid;
    if (!id) return;
    const now = performance.now();
    const pose = bindHeld(actor, id);
    if (pose) placeHeld(actor, pose, now);
    const fx = effects.get(id);
    const rig = actor.userData.rig;
    if (!rig) return;
    rig.position.y = 0;
    rig.rotation.z = 0;
    if (!fx) return;
    let sx = 1;
    let sy = 1;
    let sz = 1;
    if (fx.squash) {
      const t = (now - fx.squash) / 1000;
      if (t > 1.4) fx.squash = 0;
      else if (t >= 0) {
        // Flatten fast, stay pressed for a beat like mochi, then spring back past round and settle.
        const s = t < 0.3 ? ease(t / 0.05) : spring(t - 0.3, 5.5, 15);
        sy *= 1 - 0.42 * s;
        sx *= 1 + 0.3 * s;
        sz *= 1 + 0.3 * s;
        fx.low = Math.min(fx.low ?? 1, sy);
      }
    }
    if (fx.wobble) {
      const t = (now - fx.wobble) / 1000;
      if (t > 1.2) fx.wobble = 0;
      else rig.rotation.z += 0.32 * Math.exp(-3.6 * t) * Math.sin(t * 19);
    }
    if (fx.pinch) {
      const p = fx.pinch;
      if (p.on && now > p.until) {
        p.on = false;
        p.off = now;
      }
      if (p.on) {
        const grip = ease((now - p.t0) / 250);
        const jiggle = Math.sin(now / 55) * 0.025 * grip;
        sx *= 1 + 0.34 * grip + jiggle;
        sy *= 1 - 0.07 * grip;
      } else {
        const t = (now - p.off) / 1000;
        if (t > 0.9) fx.pinch = null;
        else sx *= 1 + 0.34 * spring(t, 7, 17);
      }
    }
    if (fx.pinchBy) {
      const p = fx.pinchBy;
      if (now > p.until) fx.pinchBy = null;
      else {
        const arms = [actor.userData.armL, actor.userData.armR];
        for (const arm of arms) if (arm) arm.position.z += 4;
      }
    }
    if (fx.spin) {
      const t = (now - fx.spin) / 1000;
      if (t > 0.75) fx.spin = 0;
      else {
        actor.rotation.y += Math.PI * 2 * ease(t / 0.6);
        // Up in an arc, land, one small bounce.
        if (t < 0.45) rig.position.y = 16 * Math.sin((Math.PI * t) / 0.45) / (actor.scale.y || 1);
        else if (t < 0.7) rig.position.y = 4.5 * Math.sin((Math.PI * (t - 0.45)) / 0.25) / (actor.scale.y || 1);
        if (t > 0.42 && t < 0.56) {
          const land = 1 - Math.abs(t - 0.49) / 0.07;
          sy *= 1 - 0.18 * land;
          sx *= 1 + 0.12 * land;
          sz *= 1 + 0.12 * land;
        }
      }
    }
    rig.scale.x *= sx;
    rig.scale.y *= sy;
    rig.scale.z *= sz;
    void info;
  }

  // ---- placed toys, flights, particles --------------------------------------

  function syncPlaced() {
    const spot = rack();
    const rows = [];
    for (const item of ITEMS) {
      const place = places.get(item.id);
      if (place.at === "rack" && spot) rows.push(`${item.id}:r`);
      else if (place.at === "floor") rows.push(`${item.id}:${Math.round(place.x)},${Math.round(place.y)}`);
    }
    const sig = `${world.assetsReady ? 1 : 0}|${spot ? `${spot.x},${spot.y}` : ""}|${rows.join(";")}`;
    if (sig === placedSig) return;
    placedSig = sig;
    for (const node of placed) disposeTree(node);
    placed = [];
    const layer = world.fx;
    if (!layer) return;
    let slot = 0;
    for (const item of ITEMS) {
      const place = places.get(item.id);
      let node = null;
      if (place.at === "rack" && spot) {
        node = makeProp(item, item.rack);
        if (node) {
          const col = slot % 3;
          const row = Math.floor(slot / 3);
          node.position.set(spot.x - spot.w / 3 + col * (spot.w / 3), 34, spot.y - 5 + row * 10);
        }
        slot += 1;
      } else if (place.at === "floor") {
        node = makeProp(item, item.rack);
        if (node) {
          node.position.set(place.x, 0.5, place.y);
          node.rotation.y = (place.x * 7 + place.y * 3) % 6.28;
        }
      } else slot += place.at === "rack" ? 1 : 0;
      if (!node) continue;
      node.userData.toy = item.id;
      layer.add(node);
      placed.push(node);
    }
  }

  function anchorOf(id, height = 30) {
    const actor = world.actor?.(id);
    if (actor) return new THREE.Vector3(actor.position.x, height, actor.position.z);
    const person = id === state.me?.id ? state.me : state.others.get(id);
    return person ? new THREE.Vector3(person.x, height, person.y) : null;
  }

  function launch(kind, from, to, ms, extra = {}) {
    const layer = world.fx;
    const start = anchorOf(from, 30);
    const end = anchorOf(to, kind === "plane" ? 40 : 30);
    if (!layer || !start || !end) return;
    const item = BY_ID.get(kind === "plane" ? "plane" : "ball");
    const node = makeProp(item, kind === "plane" ? [10, 3, 12] : [7, 7, 7]) || fallbackBall();
    layer.add(node);
    flights.push({ kind, node, start, end, t0: performance.now(), ms, arc: kind === "plane" ? 70 : 52, ...extra });
  }

  function roll(from, x, y) {
    const layer = world.fx;
    const start = anchorOf(from, 4);
    if (!layer || !start) return;
    const node = makeProp(BY_ID.get("ball"), [7, 7, 7]) || fallbackBall();
    layer.add(node);
    flights.push({ kind: "roll", node, start, end: new THREE.Vector3(x, 3.5, y), t0: performance.now(), ms: 480, arc: 0 });
  }

  function burst(id, kind) {
    const layer = world.fx;
    const actor = world.actor?.(id);
    if (!layer || !actor) return;
    const top = world.crown?.(id) ?? 60;
    const now = performance.now();
    if (kind === "stars") {
      stars ||= starTexture();
      for (let i = 0; i < 5; i++) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: stars, transparent: true, depthWrite: false }));
        sprite.scale.setScalar(7);
        layer.add(sprite);
        particles.push({ kind, node: sprite, id, t0: now, life: 950, angle: (i / 5) * Math.PI * 2, top });
      }
      return;
    }
    for (let i = 0; i < 12; i++) {
      const feather = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.2), toon(0xfffdf8, { side: THREE.DoubleSide, transparent: true }));
      feather.position.set(actor.position.x, top - 12, actor.position.z);
      layer.add(feather);
      const a = Math.random() * Math.PI * 2;
      const speed = 22 + Math.random() * 26;
      particles.push({
        kind,
        node: feather,
        t0: now,
        life: 1500,
        vx: Math.cos(a) * speed,
        vy: 26 + Math.random() * 28,
        vz: Math.sin(a) * speed,
        spin: (Math.random() - 0.5) * 9,
      });
    }
  }

  function frameHook(dt) {
    syncPlaced();
    const now = performance.now();
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i];
      const u = Math.min(1, (now - f.t0) / f.ms);
      const end = f.kind === "roll" ? f.end : anchorOf(f.to || "", f.kind === "plane" ? 40 : 30) || f.end;
      f.node.position.lerpVectors(f.start, end, f.kind === "roll" ? ease(u) : u);
      f.node.position.y += f.kind === "roll" ? Math.abs(Math.sin(u * Math.PI * 2)) * 4 * (1 - u) : Math.sin(u * Math.PI) * f.arc;
      if (f.kind === "plane") {
        f.node.lookAt(end.x, f.node.position.y, end.z);
        f.node.rotation.z = Math.sin(u * Math.PI * 3) * 0.35;
      } else f.node.rotation.x += dt * 14;
      if (u >= 1) {
        disposeTree(f.node);
        flights.splice(i, 1);
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const age = now - p.t0;
      if (age > p.life) {
        p.node.removeFromParent();
        p.node.material?.dispose?.();
        if (p.kind !== "stars") p.node.geometry?.dispose?.();
        particles.splice(i, 1);
        continue;
      }
      const fade = 1 - age / p.life;
      if (p.kind === "stars") {
        const actor = world.actor?.(p.id);
        if (!actor) continue;
        const a = p.angle + age / 160;
        p.node.position.set(actor.position.x + Math.cos(a) * 15, p.top + 4 + Math.sin(age / 90) * 2, actor.position.z + Math.sin(a) * 15);
        p.node.material.opacity = fade;
      } else {
        p.vy -= 60 * dt;
        p.vx *= Math.exp(-2.5 * dt);
        p.vz *= Math.exp(-2.5 * dt);
        p.node.position.x += p.vx * dt;
        p.node.position.y = Math.max(1, p.node.position.y + Math.max(p.vy, -12) * dt);
        p.node.position.z += p.vz * dt;
        p.node.rotation.x += p.spin * dt;
        p.node.rotation.y += p.spin * 0.6 * dt;
        p.node.material.opacity = Math.min(1, fade * 1.6);
      }
    }
    if (incoming && now > incoming.until) incoming = null;
    if (pinching && now > pinching.until) pinching = null;
    paintButtons();
  }

  world.setToyHook?.({ actor: actorHook, frame: frameHook });

  // ---- UI -----------------------------------------------------------------

  function button(id, label, onClick) {
    let node = $(id);
    if (node) return node;
    node = document.createElement("button");
    node.type = "button";
    node.id = id;
    node.className = "toy-float";
    node.hidden = true;
    node.textContent = label;
    if (onClick) node.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    document.body.appendChild(node);
    return node;
  }

  function ensureHold() {
    let node = $("toy-hold");
    if (node) return node;
    node = button("toy-hold", "按住捏臉");
    const end = (event) => {
      event.preventDefault();
      stopPinch();
    };
    node.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      startPinch();
      try {
        node.setPointerCapture(event.pointerId);
      } catch {
        /* capture is only a nicety; pointerup on the button still ends the pinch */
      }
    });
    node.addEventListener("pointerup", end);
    node.addEventListener("pointercancel", end);
    node.addEventListener("lostpointercapture", end);
    node.addEventListener("contextmenu", (event) => event.preventDefault());
    return node;
  }

  function paintButtons() {
    const busy = env.blocked();
    const catchBtn = button("toy-catch", "接住！", () => catchBall());
    const showCatch = Boolean(incoming) && !busy && performance.now() >= incoming.open;
    if (catchBtn.hidden === showCatch) catchBtn.hidden = !showCatch;
    const letterBtn = button("toy-letter", "", () => openLetter());
    const showLetter = letters.length > 0 && !busy && !isOpen();
    const label = letters.length ? `打開紙飛機（@${letters[0].from}）` : "";
    if (letterBtn.textContent !== label) letterBtn.textContent = label;
    if (letterBtn.hidden === showLetter) letterBtn.hidden = !showLetter;
    const hold = ensureHold();
    const who = holding() === "pinch" ? target("pinch") : null;
    const showHold = env.phone() && !busy && !isOpen() && (Boolean(pinching) || Boolean(who));
    const holdLabel = pinching ? "放開" : who ? `按住捏 @${who.id} 的臉` : "按住捏臉";
    if (hold.textContent !== holdLabel) hold.textContent = holdLabel;
    if (hold.hidden === showHold) hold.hidden = !showHold;
  }

  function ensureMenu() {
    if (menu) return menu;
    menu = document.createElement("section");
    menu.id = "toy-menu";
    menu.hidden = true;
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-modal", "true");
    menu.setAttribute("aria-labelledby", "toy-title");
    menu.innerHTML = '<div class="who" id="toy-title">玩具架</div><div class="toy-grid"></div><div class="row"><button type="button" class="ghost" id="toy-back">放回架上</button><button type="button" class="ghost" id="toy-close">關閉</button></div>';
    document.body.appendChild(menu);
    menu.querySelector("#toy-close").addEventListener("click", () => close());
    menu.querySelector("#toy-back").addEventListener("click", () => send({ t: "toy", op: "back" }));
    window.addEventListener("keydown", (event) => {
      if (!isOpen()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key.startsWith("Arrow")) event.stopImmediatePropagation();
      if (menu && !menu.hidden && event.key >= "1" && event.key <= "6") {
        const pick = menu.querySelectorAll("button.item")[Number(event.key) - 1];
        if (pick && !pick.disabled) pick.click();
      }
    }, true);
    return menu;
  }

  function paintMenu() {
    const box = ensureMenu();
    const grid = box.querySelector(".toy-grid");
    grid.replaceChildren();
    const mine = holding();
    for (const item of ITEMS) {
      const place = places.get(item.id);
      const free = place.at === "rack";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "item";
      button.dataset.toy = item.id;
      button.disabled = !free;
      const name = document.createElement("span");
      name.textContent = item.label;
      const meta = document.createElement("span");
      meta.className = "count";
      meta.textContent = free
        ? "在架上"
        : place.at === "hand"
          ? (place.holder === state.me?.id ? "在你手上" : `@${place.holder}`)
          : place.at === "air" ? "飛行中" : "在地上";
      button.append(name, meta);
      button.setAttribute("aria-label", `${item.label}，${meta.textContent}`);
      button.addEventListener("click", () => {
        if (!button.disabled) send({ t: "toy", op: "take", toy: item.id });
      });
      grid.appendChild(button);
    }
    box.querySelector("#toy-back").hidden = !mine;
  }

  function openMenu() {
    paintMenu();
    const box = ensureMenu();
    box.hidden = false;
    openedAt = performance.now();
    state.path = [];
    (box.querySelector("button.item:not(:disabled)") || box.querySelector("#toy-close"))?.focus();
  }

  function ensureCompose() {
    if (compose) return compose;
    compose = document.createElement("section");
    compose.id = "toy-compose";
    compose.className = "toy-card";
    compose.hidden = true;
    compose.setAttribute("role", "dialog");
    compose.setAttribute("aria-modal", "true");
    compose.innerHTML = '<form><div class="who" id="toy-compose-title">紙飛機</div><input id="toy-text" aria-label="要寫的話" maxlength="80" autocomplete="off" placeholder="寫一句話（最多 80 字）"><div class="row"><button type="submit" id="toy-send">丟出去</button><button type="button" class="ghost" id="toy-compose-close">取消</button></div></form>';
    document.body.appendChild(compose);
    compose.querySelector("#toy-compose-close").addEventListener("click", () => close());
    compose.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = compose.querySelector("#toy-text");
      const text = input.value.trim();
      const to = compose.dataset.to;
      if (!text || !to) return;
      send({ t: "toy", op: "use", to, text });
      input.value = "";
      close();
    });
    compose.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      event.stopPropagation();
    });
    return compose;
  }

  function openCompose(person) {
    const box = ensureCompose();
    box.dataset.to = person.id;
    box.querySelector("#toy-compose-title").textContent = `寫紙飛機給 @${person.id}`;
    box.hidden = false;
    openedAt = performance.now();
    state.path = [];
    state.keys?.clear?.();
    box.querySelector("#toy-text").focus();
  }

  function ensureReader() {
    if (reader) return reader;
    reader = document.createElement("section");
    reader.id = "toy-read";
    reader.className = "toy-card";
    reader.hidden = true;
    reader.setAttribute("role", "dialog");
    reader.setAttribute("aria-modal", "true");
    reader.innerHTML = '<div class="who" id="toy-read-from"></div><p id="toy-read-text"></p><div class="row"><button type="button" id="toy-read-close">收起來</button></div>';
    document.body.appendChild(reader);
    reader.querySelector("#toy-read-close").addEventListener("click", () => close());
    return reader;
  }

  function openLetter() {
    const letter = letters.shift();
    if (!letter) return;
    const box = ensureReader();
    box.querySelector("#toy-read-from").textContent = `@${letter.from}（${letter.name}）的紙飛機`;
    box.querySelector("#toy-read-text").textContent = letter.text;
    box.hidden = false;
    openedAt = performance.now();
    box.querySelector("#toy-read-close").focus();
  }

  function isOpen() {
    return Boolean((menu && !menu.hidden) || (compose && !compose.hidden) || (reader && !reader.hidden));
  }

  function close() {
    for (const box of [menu, compose, reader]) if (box) box.hidden = true;
  }

  function dismiss() {
    if (!isOpen()) return false;
    if (performance.now() - openedAt < 400) return true;
    close();
    return true;
  }

  function guard() {
    if (!isOpen()) return;
    if (env.blocked()) close();
  }

  // ---- actions --------------------------------------------------------------

  function catchBall() {
    if (!incoming || performance.now() < incoming.open) return false;
    send({ t: "toy", op: "catch" });
    return true;
  }

  function startPinch() {
    if (pinching || holding() !== "pinch") return false;
    const who = target("pinch");
    if (!who) return false;
    pinching = { to: who.id, until: performance.now() + 2000 };
    send({ t: "toy", op: "pinch", to: who.id, on: true });
    return true;
  }

  function stopPinch() {
    if (!pinching) return;
    pinching = null;
    send({ t: "toy", op: "pinch", on: false });
  }

  function useOn(person) {
    const toy = holding();
    if (!toy || !person) return false;
    if (toy === "plane") {
      openCompose(person);
      return true;
    }
    if (toy === "pinch") return startPinch();
    if (toy === "ram") return false;
    send({ t: "toy", op: "use", to: person.id });
    return true;
  }

  function interact() {
    if (pinching) return true;
    if (catchBall()) return true;
    const toy = holding();
    if (toy && toy !== "ram") {
      const who = target(toy);
      if (who && useOn(who)) return true;
    }
    if (nearRack()) {
      openMenu();
      return true;
    }
    const floor = floorNear();
    if (floor && !toy) {
      send({ t: "toy", op: "take", toy: floor.id });
      return true;
    }
    return false;
  }

  // Clicking or tapping the rack opens it when close, otherwise walks over to it.
  function walk(point, seated = false) {
    if (isOpen()) {
      close();
      return true;
    }
    const spot = rack();
    const item = env.hitFurniture(point.x, point.y);
    if (!spot || !item || item.id !== spot.item.id) return false;
    if (nearRack()) openMenu();
    else if (!seated) {
      const stand = env.freeSpot(spot.standX, spot.standY);
      state.path = env.findPath(stand.x, stand.y);
    }
    return true;
  }

  function openNearest() {
    if (!nearRack()) return false;
    openMenu();
    return true;
  }

  function drop() {
    if (!holding()) return false;
    stopPinch();
    send({ t: "toy", op: "drop" });
    return true;
  }

  function bumped(id) {
    if (holding() !== "ram" || !state.running || state.seat) return;
    const now = performance.now();
    if (now - ramAt < RAM_COOL_MS) return;
    const person = state.others.get(id);
    if (!person || person.seat) return;
    ramAt = now;
    env.flush();
    send({ t: "toy", op: "ram", to: id });
  }

  const VERB = {
    hammer: (id) => `敲 @${id} 的頭`,
    ball: (id) => `把球丟給 @${id}`,
    plane: (id) => `寫紙飛機給 @${id}`,
    pillow: (id) => `用枕頭打 @${id}`,
    pinch: (id) => `捏 @${id} 的臉`,
  };

  function prompt() {
    if (incoming) return "按 E 接住球！";
    const toy = holding();
    if (toy) {
      const who = target(toy);
      if (toy === "ram") return "按住 Shift 跑步去撞同事 · Q 放下";
      if (who && toy === "pinch") return `按住 E ${VERB.pinch(who.id)} · Q 放下`;
      if (who) return `按 E ${VERB[toy](who.id)} · Q 放下`;
      if (nearRack()) return "按 E 打開玩具架（可以放回去）";
      return "";
    }
    if (nearRack()) return "按 E 拿玩具";
    const floor = floorNear();
    if (floor) return `按 E 撿起${BY_ID.get(floor.id).label}`;
    return "";
  }

  /** True when the toy hint should win over whisper and seat hints. */
  function urgent() {
    if (incoming) return true;
    const toy = holding();
    return Boolean(toy && (toy === "ram" || target(toy)));
  }

  function actions() {
    const list = [];
    const toy = holding();
    if (toy) {
      const who = toy === "ram" || toy === "pinch" ? null : target(toy);
      if (who) list.push({ id: "toy-use", label: VERB[toy](who.id), run: () => useOn(who) });
      if (nearRack()) list.push({ id: "toy-rack", label: "玩具架", run: () => openMenu() });
      list.push({ id: "toy-drop", label: "放下玩具", run: () => drop() });
      return list;
    }
    if (nearRack()) list.push({ id: "toy-rack", label: "拿玩具", run: () => openMenu() });
    const floor = floorNear();
    if (floor) list.push({ id: "toy-pick", label: `撿起${BY_ID.get(floor.id).label}`, run: () => send({ t: "toy", op: "take", toy: floor.id }) });
    return list;
  }

  // ---- network --------------------------------------------------------------

  function placeAfterRam(fx) {
    if (!fx.knock) return;
    if (fx.to === state.me?.id) env.placeMe(fx.x, fx.y);
    else {
      const person = state.others.get(fx.to);
      if (person) {
        person.tx = fx.x;
        person.ty = fx.y;
      }
    }
  }

  function play(fx) {
    const now = performance.now();
    log.push({ ...fx, at: now });
    if (log.length > 40) log.shift();
    if (fx.kind === "bonk") {
      fxOf(fx.by).swing = { t0: now };
      fxOf(fx.to).squash = now + 120;
      fxOf(fx.to).low = 1;
      setTimeout(() => {
        burst(fx.to, "stars");
        if (heard(fx.to)) sound("bonk");
      }, 120);
      emote(fx.to, "啵！", 1400);
    } else if (fx.kind === "pillow") {
      fxOf(fx.by).swing = { t0: now };
      fxOf(fx.to).wobble = now + 100;
      setTimeout(() => {
        burst(fx.to, "feathers");
        if (heard(fx.to)) sound("pillow");
      }, 100);
    } else if (fx.kind === "throw") {
      fxOf(fx.by).swing = { t0: now };
      launch("ball", fx.by, fx.to, fx.ms || 900, { to: fx.to });
      if (heard(fx.by)) sound("throw");
      if (fx.to === state.me?.id) incoming = { open: now + CATCH_OPEN_MS, until: now + (fx.ms || 900) + CATCH_GRACE_MS, by: fx.by };
    } else if (fx.kind === "catch") {
      if (fx.by === state.me?.id) incoming = null;
      fxOf(fx.by).squash = now;
      emote(fx.by, fx.combo > 1 ? `接到了！連續 ${fx.combo} 次` : "接到了！", 2200);
      if (heard(fx.by)) sound("catch");
    } else if (fx.kind === "fall") {
      if (fx.to === state.me?.id) incoming = null;
      roll(fx.to, fx.x, fx.y);
      emote(fx.to, "沒接到～", 1600);
    } else if (fx.kind === "plane") {
      fxOf(fx.by).swing = { t0: now };
      launch("plane", fx.by, fx.to, 1300, { to: fx.to });
      if (heard(fx.by)) sound("plane");
    } else if (fx.kind === "pinch") {
      if (fx.on) {
        fxOf(fx.to).pinch = { on: true, t0: now, until: now + (fx.ms || 2000) };
        fxOf(fx.by).pinchBy = { until: now + (fx.ms || 2000) };
        if (heard(fx.to)) sound("pinch");
      } else {
        const p = effects.get(fx.to)?.pinch;
        if (p?.on) {
          p.on = false;
          p.off = now;
        }
        if (effects.get(fx.by)) effects.get(fx.by).pinchBy = null;
        if (fx.by === state.me?.id) pinching = null;
      }
    } else if (fx.kind === "ram") {
      world.nudge?.(fx.by, -fx.nx, -fx.ny);
      if (fx.knock) {
        fxOf(fx.to).spin = now;
        placeAfterRam(fx);
        if (heard(fx.to)) sound("boing");
      } else {
        fxOf(fx.to).wobble = now;
        world.nudge?.(fx.to, fx.nx, fx.ny);
      }
    } else if (fx.kind === "hold" && fx.by === state.me?.id) close();
    else if (fx.kind === "back" && fx.by === state.me?.id) paintMenu();
  }

  function onNet(message) {
    if (!message || typeof message !== "object") return;
    if (message.t === "welcome") {
      for (const [id, pose] of held) release(pose.actor, pose);
      held.clear();
      effects.clear();
      incoming = null;
      pinching = null;
      if (message.toys) applyView(message.toys);
      return;
    }
    if (message.t === "leave" && typeof message.id === "string") {
      effects.delete(message.id);
      return;
    }
    if (message.t === "error" && message.toy && state.me) {
      if (message.toy === "early") return;
      emote(state.me.id, message.message, 1800);
      if (message.toy === "late") incoming = null;
      return;
    }
    if (message.t !== "toys") return;
    applyView(message);
    if (message.letter && typeof message.letter.text === "string") {
      letters.push({ from: String(message.letter.from || ""), name: String(message.letter.name || ""), text: message.letter.text, at: Date.now() });
      if (letters.length > 5) letters.shift();
    }
    if (message.fx && typeof message.fx.kind === "string") play(message.fx);
  }

  return {
    onNet,
    interact,
    walk,
    openNearest,
    drop,
    bumped,
    prompt,
    urgent,
    actions,
    isOpen,
    close,
    dismiss,
    guard,
    release: stopPinch,
    holding,
    view() {
      return {
        toys: Object.fromEntries([...places].map(([id, place]) => [id, { ...place }])),
        combo,
        incoming: Boolean(incoming),
        catchable: Boolean(incoming) && performance.now() >= incoming.open,
        letters: letters.map((letter) => ({ ...letter })),
        pinching: Boolean(pinching),
        flights: flights.length,
        particles: particles.length,
        placed: placed.map((node) => node.userData.toy),
      };
    },
    fxLog() {
      return log.map((row) => ({ ...row }));
    },
    squashOf(id) {
      const actor = world.actor?.(id);
      if (!actor?.userData?.rig) return null;
      const fx = effects.get(id);
      return { x: actor.userData.rig.scale.x, y: actor.userData.rig.scale.y, low: fx?.low ?? 1, busy: Boolean(fx?.squash) };
    },
    heldProp(id) {
      const pose = held.get(id);
      return pose?.prop ? pose.toy : "";
    },
    rack,
  };
}
