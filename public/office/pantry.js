// Pantry: hot drinks with steam, the microwave, tossing snacks and fridge sticky notes.
import * as THREE from "./vendor/three.module.js";
import { makeHeld, snackInfo } from "./snacks.js";

const REACH = 100;
const COFFEE_REACH = 108;
const TOSS_REACH = 240;
const NOTE_CHARS = 20;
const HOT_DRINKS = ["hotcoffee", "cocoa", "hottea"];
const TINTS = ["#ffe08a", "#ffc6d9", "#c9e8ff", "#d4f2c4"];
const TINT_NAMES = ["黃色", "粉紅色", "藍色", "綠色"];
const TITLES = { coffee: "咖啡機", oven: "微波爐", fridge: "冰箱便利貼", toss: "丟零食給誰？" };
const TOSS_MS = 650;
const PUFF_MS = 1500;
const DING_MS = 1800;

function disposeTree(node) {
  if (!node) return;
  node.removeFromParent();
  node.traverse((part) => {
    part.geometry?.dispose?.();
    if (part.material) {
      part.material.map?.dispose?.();
      part.material.dispose?.();
    }
  });
}

function smooth(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

export function attachPantry(env) {
  const { state, world, $, send, snacks, zoneAt, sizeOf, phone } = env;
  let notes = [];
  let oven = null;
  let panel = null;
  let mode = "";
  let peelId = "";
  let tint = 0;
  let audio = null;
  let puffAt = 0;
  let noteSig = "";
  let noteMeshes = [];
  let glow = null;
  let ding = null;
  const puffs = [];
  const flights = [];

  // ---- where things are ----------------------------------------------------

  function inPantry(x, y) {
    return zoneAt(x, y)?.id === "pantry";
  }

  function propBox(model) {
    return (state.map?.props || []).find((prop) => prop.kind === "decor" && prop.model === model) || null;
  }

  function propAt(model) {
    const prop = propBox(model);
    return prop ? { x: prop.x + prop.w / 2, y: prop.y + prop.h / 2 } : null;
  }

  function coffeeAt() {
    const item = (state.furniture || []).find((row) => row.id === "coffee-1");
    if (!item) return null;
    const size = sizeOf(item);
    return { x: item.x + size.w / 2, y: item.y + size.h / 2 };
  }

  function inReach() {
    const me = state.me;
    if (!me) return [];
    const spots = [["coffee", coffeeAt(), COFFEE_REACH]];
    if (inPantry(me.x, me.y)) spots.push(["oven", propAt("kitchenMicrowave"), REACH], ["fridge", propAt("kitchenFridge"), REACH]);
    const list = [];
    for (const [id, at, reach] of spots) {
      if (!at) continue;
      const dist = Math.hypot(me.x - at.x, me.y - at.y);
      if (dist <= reach) list.push({ id, dist });
    }
    return list.sort((a, b) => a.dist - b.dist);
  }

  function nearest() {
    return inReach()[0]?.id || "";
  }

  function reaches(which) {
    return inReach().some((spot) => spot.id === which);
  }

  function personOf(id) {
    return id === state.me?.id ? state.me : state.others.get(id);
  }

  function nameOf(id) {
    const person = personOf(id);
    return person?.displayName || id;
  }

  function tossable() {
    const item = snackInfo(snacks.carried());
    return Boolean(item && !item.hot && state.me && inPantry(state.me.x, state.me.y));
  }

  function tossTargets() {
    if (!tossable()) return [];
    const list = [];
    for (const person of state.others.values()) {
      if (!inPantry(person.x, person.y) || snacks.carried(person.id)) continue;
      const dist = Math.hypot(person.x - state.me.x, person.y - state.me.y);
      if (dist <= TOSS_REACH) list.push({ id: person.id, dist });
    }
    return list.sort((a, b) => a.dist - b.dist);
  }

  // ---- the panel -------------------------------------------------------------

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = "pantry-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "pantry-title");
    panel.innerHTML = '<div class="who" id="pantry-title"></div><div class="pantry-body"></div><div class="row"><button type="button" class="ghost" id="pantry-close">關閉</button></div>';
    document.body.appendChild(panel);
    panel.querySelector("#pantry-close").addEventListener("click", () => close());
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    });
    return panel;
  }

  function button(label, opts = {}) {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = label;
    if (opts.id) node.id = opts.id;
    if (opts.className) node.className = opts.className;
    if (opts.disabled) node.disabled = true;
    if (opts.run) node.addEventListener("click", opts.run);
    return node;
  }

  function line(text, className = "pantry-line") {
    const node = document.createElement("p");
    node.className = className;
    node.textContent = text;
    return node;
  }

  function paintCoffee(body) {
    const grid = document.createElement("div");
    grid.className = "pantry-grid";
    for (const id of HOT_DRINKS) {
      const item = snackInfo(id);
      const node = button(item.label, { className: "item", run: () => send({ t: "pantry", op: "brew", item: id }) });
      node.dataset.item = id;
      grid.appendChild(node);
    }
    body.append(line("熱熱的，小心燙口。"), grid);
  }

  function paintOven(body) {
    const me = state.me?.id;
    if (!oven) {
      body.append(line("放一個包子進去，叮一聲就好了。"), button("微波一個包子", { id: "pantry-heat", className: "big", run: () => send({ t: "pantry", op: "heat" }) }));
      return;
    }
    if (oven.by !== me) {
      body.append(line(oven.done ? `等 ${nameOf(oven.by)} 把包子拿出來` : `${nameOf(oven.by)} 正在微波中…`));
      return;
    }
    if (!oven.done) {
      const bar = document.createElement("div");
      bar.className = "pantry-bar";
      const fill = document.createElement("span");
      fill.style.animationDuration = `${Math.max(0, oven.readyAt - performance.now())}ms`;
      bar.appendChild(fill);
      body.append(line("微波中…"), bar, button("拿出來", { id: "pantry-unload", className: "big", disabled: true }));
      return;
    }
    body.append(line("叮！熱好了", "pantry-line pantry-ding"), button("拿出來", { id: "pantry-unload", className: "big", run: () => send({ t: "pantry", op: "unload" }) }));
  }

  function paintFridge(body) {
    const list = document.createElement("div");
    list.className = "fridge-notes";
    if (!notes.length) list.append(line("冰箱上還沒有便利貼。"));
    for (const note of notes) {
      const card = document.createElement("div");
      card.className = "fridge-note";
      card.dataset.note = note.id;
      card.style.background = TINTS[note.tint] || TINTS[0];
      const text = document.createElement("span");
      text.className = "text";
      text.textContent = note.text;
      const by = document.createElement("small");
      by.textContent = nameOf(note.by);
      card.append(text, by);
      if (peelId === note.id) {
        const ask = document.createElement("div");
        ask.className = "fridge-ask";
        ask.append(
          line("撕掉這張？"),
          button("確定撕掉", { id: "fridge-peel-yes", run: () => { peelId = ""; send({ t: "pantry", op: "peel", id: note.id }); } }),
          button("先不要", { id: "fridge-peel-no", className: "ghost", run: () => { peelId = ""; paint(); } }),
        );
        card.append(ask);
      } else {
        const peel = button("撕掉", { className: "ghost peel", run: () => { peelId = note.id; paint(); } });
        peel.setAttribute("aria-label", `撕掉「${note.text}」`);
        card.append(peel);
      }
      list.appendChild(card);
    }
    const form = document.createElement("form");
    form.className = "fridge-form";
    const input = document.createElement("input");
    input.id = "fridge-text";
    input.maxLength = NOTE_CHARS;
    input.placeholder = "寫一張便利貼";
    input.autocomplete = "off";
    input.setAttribute("aria-label", "便利貼內容");
    const swatches = document.createElement("div");
    swatches.className = "fridge-tints";
    TINTS.forEach((color, index) => {
      const swatch = button("", { className: "tint", run: () => { tint = index; for (const other of swatches.children) other.setAttribute("aria-pressed", String(other === swatch)); } });
      swatch.style.background = color;
      swatch.setAttribute("aria-label", TINT_NAMES[index]);
      swatch.setAttribute("aria-pressed", String(index === tint));
      swatches.appendChild(swatch);
    });
    const stick = button("貼上", { id: "fridge-stick", className: "big" });
    stick.type = "submit";
    form.append(input, swatches, stick);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      send({ t: "pantry", op: "stick", text, tint });
      input.value = "";
    });
    body.append(list, form);
  }

  function paintToss(body) {
    const targets = tossTargets();
    if (!targets.length) {
      body.append(line("附近沒有手上空著的同事。"));
      return;
    }
    const item = snackInfo(snacks.carried());
    body.append(line(`把${item?.label || "零食"}丟給：`));
    const grid = document.createElement("div");
    grid.className = "pantry-grid";
    for (const target of targets) {
      const node = button(nameOf(target.id), { className: "item", run: () => { send({ t: "pantry", op: "toss", to: target.id }); close(); } });
      node.dataset.to = target.id;
      grid.appendChild(node);
    }
    body.append(grid);
  }

  function paint() {
    if (!panel || panel.hidden) return;
    const keep = mode === "fridge" ? panel.querySelector("#fridge-text") : null;
    const draft = keep?.value || "";
    const focused = keep && document.activeElement === keep;
    panel.querySelector("#pantry-title").textContent = TITLES[mode] || "茶水間";
    panel.dataset.mode = mode;
    const body = panel.querySelector(".pantry-body");
    body.replaceChildren();
    if (mode === "coffee") paintCoffee(body);
    else if (mode === "oven") paintOven(body);
    else if (mode === "fridge") paintFridge(body);
    else if (mode === "toss") paintToss(body);
    const input = panel.querySelector("#fridge-text");
    if (input && draft) input.value = draft;
    if (input && focused) input.focus();
  }

  function open(which) {
    if (!which || !state.me) return false;
    mode = which;
    peelId = "";
    const box = ensurePanel();
    box.hidden = false;
    state.path = [];
    paint();
    const first = box.querySelector(".pantry-body button:not(:disabled)") || box.querySelector("#pantry-close");
    if (!phone() || which !== "fridge") first?.focus();
    return true;
  }

  function close() {
    if (panel) panel.hidden = true;
    mode = "";
    peelId = "";
  }

  function isOpen() {
    return Boolean(panel && !panel.hidden);
  }

  function openToss() {
    if (!tossable()) return false;
    return open("toss");
  }

  // A seat closer than the appliance wins, so E at a stool next to the coffee machine still sits down.
  function closest(seatDist) {
    const spot = inReach()[0];
    return spot && spot.dist < (seatDist ?? Infinity) ? spot.id : "";
  }

  /** E near the coffee machine, microwave or fridge. Returns true when it did something. */
  function interact(seatDist) {
    if (isOpen()) {
      close();
      return true;
    }
    return open(closest(seatDist));
  }

  function prompt(seatDist) {
    if (phone()) return "";
    const near = closest(seatDist);
    if (near === "coffee") return "按 E 泡熱飲";
    if (near === "oven") return "按 E 用微波爐";
    if (near === "fridge") return "按 E 看冰箱便利貼";
    if (tossTargets().length) return "按 G 把零食丟給同事";
    return "";
  }

  function actions() {
    const list = [];
    const labels = { coffee: "泡熱飲", oven: "用微波爐", fridge: "冰箱便利貼" };
    for (const spot of inReach()) list.push({ id: `pantry-${spot.id}`, label: labels[spot.id], run: () => open(spot.id) });
    if (tossTargets().length) list.push({ id: "toss", label: "丟零食", run: openToss });
    return list;
  }

  // ---- sound and little effects -----------------------------------------------

  function voice() {
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume().catch(() => {});
      return audio;
    } catch {
      return null;
    }
  }

  function chime() {
    const ctx = voice();
    if (!ctx) return;
    [[1568, 0], [2093, 0.16]].forEach(([freq, delay]) => {
      const at = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.7);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.75);
    });
  }

  function textSprite(text) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fffdfb";
    ctx.beginPath();
    ctx.roundRect?.(6, 6, 116, 52, 24);
    ctx.fill();
    ctx.fillStyle = "#f07a9c";
    ctx.font = "bold 34px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 64, 34);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.scale.set(22, 11, 1);
    sprite.renderOrder = 5;
    return sprite;
  }

  function ovenFront() {
    const prop = propBox("kitchenMicrowave");
    if (!prop) return null;
    return { x: prop.x - 0.6, y: (prop.lift || 0) + (prop.tall || 16) / 2, z: prop.y + prop.h / 2 };
  }

  function rang() {
    const front = ovenFront();
    const layer = world.fx;
    if (front && layer) {
      disposeTree(ding?.node);
      const node = textSprite("叮！");
      node.position.set(front.x - 4, front.y + 22, front.z);
      layer.add(node);
      ding = { node, t0: performance.now() };
    }
    if (state.me && inPantry(state.me.x, state.me.y)) chime();
  }

  function syncGlow(now) {
    const layer = world.fx;
    const front = ovenFront();
    const on = Boolean(oven && !oven.done && layer && front);
    if (!on) {
      if (glow) {
        disposeTree(glow);
        glow = null;
      }
      return;
    }
    if (!glow) {
      glow = new THREE.Mesh(new THREE.PlaneGeometry(12, 8), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.7, depthWrite: false }));
      glow.rotation.y = -Math.PI / 2;
      glow.position.set(front.x - 0.4, front.y, front.z + 2);
      layer.add(glow);
    }
    glow.material.opacity = 0.45 + Math.sin(now / 120) * 0.25;
  }

  function syncNotes() {
    const layer = world.fx;
    const prop = propBox("kitchenFridge");
    const sig = `${layer ? 1 : 0}|${notes.map((note) => `${note.id}:${note.tint}`).join(",")}`;
    if (sig === noteSig) return;
    noteSig = sig;
    for (const mesh of noteMeshes) disposeTree(mesh);
    noteMeshes = [];
    if (!layer || !prop) return;
    notes.forEach((note, index) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(TINTS[note.tint] || TINTS[0]) }));
      const col = index % 2;
      const row = Math.floor(index / 2);
      mesh.rotation.y = -Math.PI / 2;
      mesh.rotation.x = ((index * 37) % 9 - 4) * 0.02;
      mesh.position.set(prop.x - 0.5, 46 - row * 10, prop.y + prop.h / 2 - 5 + col * 10);
      mesh.userData.fridgeNote = note.id;
      layer.add(mesh);
      noteMeshes.push(mesh);
    });
  }

  const puffGeo = new THREE.SphereGeometry(1.6, 10, 8);

  function steam(now, dt) {
    const layer = world.fx;
    if (!layer) return;
    if (now - puffAt > 240) {
      puffAt = now;
      const ids = [state.me?.id, ...state.others.keys()].filter(Boolean);
      for (const id of ids) {
        if (!snackInfo(snacks.carried(id))?.hot) continue;
        const prop = snacks.heldProp?.(id);
        if (!prop?.parent) continue;
        const at = new THREE.Vector3(0, 3, 0);
        prop.localToWorld(at);
        layer.worldToLocal(at);
        const puff = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false }));
        puff.position.copy(at);
        layer.add(puff);
        puffs.push({ node: puff, t0: now, x: at.x, y: at.y, z: at.z, seed: Math.random() * 6 });
      }
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const puff = puffs[i];
      const u = (now - puff.t0) / PUFF_MS;
      if (u >= 1) {
        puff.node.removeFromParent();
        puff.node.material.dispose();
        puffs.splice(i, 1);
        continue;
      }
      puff.node.position.set(puff.x + Math.sin(puff.seed + u * 5) * 1.6, puff.y + u * 16, puff.z + Math.cos(puff.seed + u * 4) * 1.2);
      puff.node.scale.setScalar(1 + u * 1.8);
      puff.node.material.opacity = 0.6 * (1 - u);
    }
    void dt;
  }

  function anchorOf(id) {
    const actor = world.actor?.(id);
    if (actor) return new THREE.Vector3(actor.position.x, 30, actor.position.z);
    const person = personOf(id);
    return person ? new THREE.Vector3(person.x, 30, person.y) : null;
  }

  function toss(from, to, itemId) {
    snacks.drop(from);
    const item = snackInfo(itemId);
    const layer = world.fx;
    const start = anchorOf(from);
    const flight = { from, to, item: itemId, t0: performance.now(), node: null, start, landed: false, cancelled: false };
    if (layer && start && item) {
      flight.node = makeHeld(item);
      flight.node.position.copy(start);
      layer.add(flight.node);
    }
    flights.push(flight);
    state.bubbles.set(from, { text: "接著！", until: performance.now() + 1400, emote: true });
  }

  function land(flight) {
    flight.landed = true;
    disposeTree(flight.node);
    if (flight.cancelled) return;
    snacks.give(flight.to, flight.item);
    state.bubbles.set(flight.to, { text: "接到了！", until: performance.now() + 1600, emote: true });
  }

  function fly(now) {
    for (let i = flights.length - 1; i >= 0; i--) {
      const flight = flights[i];
      const u = (now - flight.t0) / TOSS_MS;
      if (u >= 1 || !flight.node) {
        land(flight);
        flights.splice(i, 1);
        continue;
      }
      const end = anchorOf(flight.to) || flight.start;
      const t = smooth(u);
      flight.node.position.lerpVectors(flight.start, end, t);
      flight.node.position.y += Math.sin(u * Math.PI) * 40;
      flight.node.rotation.z = u * 12;
    }
  }

  // ---- network -----------------------------------------------------------------

  function applyOven(raw) {
    if (!raw || typeof raw.by !== "string") {
      oven = null;
      return;
    }
    const left = Math.max(0, Number(raw.left) || 0);
    oven = { by: raw.by, readyAt: performance.now() + left, done: left <= 0 };
  }

  function applyNotes(raw) {
    if (!Array.isArray(raw)) return;
    notes = raw.filter((note) => note && typeof note.id === "string" && typeof note.text === "string").map((note) => ({ id: note.id, text: note.text, by: String(note.by || ""), tint: Number(note.tint) || 0 }));
    if (peelId && !notes.some((note) => note.id === peelId)) peelId = "";
  }

  function onNet(message) {
    if (!message || typeof message !== "object") return;
    if (message.t === "welcome") {
      applyNotes(message.pantry?.notes || []);
      applyOven(message.pantry?.oven);
      for (const flight of flights.splice(0)) disposeTree(flight.node);
      paint();
      return;
    }
    if (message.t === "snacks") {
      // A newer hold or bite for the catcher wins over a snack still in the air.
      const id = message.hold?.id || message.use?.id;
      for (const flight of flights) if (flight.to === id) flight.cancelled = true;
      if (mode === "toss") paint();
      return;
    }
    if (message.t === "leave") {
      for (const flight of flights) if (flight.to === message.id) flight.cancelled = true;
      return;
    }
    if (message.t !== "pantry") return;
    if (message.op === "notes") {
      applyNotes(message.notes);
      if (mode === "fridge") paint();
    } else if (message.op === "oven") {
      applyOven(message.oven);
      if (mode === "oven") paint();
    } else if (message.op === "toss" && typeof message.from === "string" && typeof message.to === "string") {
      toss(message.from, message.to, message.item);
    }
  }

  function frame(dt, blocked) {
    const now = performance.now();
    if (isOpen() && (blocked || (mode !== "toss" && !reaches(mode)))) close();
    if (isOpen() && mode === "toss" && !tossable()) close();
    if (oven && !oven.done && now >= oven.readyAt) {
      oven.done = true;
      rang();
      if (mode === "oven") paint();
    }
    if (ding && now - ding.t0 > DING_MS) {
      disposeTree(ding.node);
      ding = null;
    } else if (ding) {
      ding.node.position.y += dt * 6;
    }
    syncGlow(now);
    syncNotes();
    steam(now, dt);
    fly(now);
  }

  function view() {
    return {
      open: isOpen() ? mode : "",
      near: nearest(),
      notes: notes.map((note) => ({ ...note })),
      oven: oven ? { by: oven.by, done: oven.done } : null,
      ding: Boolean(ding),
      steam: puffs.length,
      flying: flights.length,
      noteMeshes: noteMeshes.length,
      targets: tossTargets().map((target) => target.id),
    };
  }

  return { onNet, frame, interact, prompt, actions, open, openToss, close, isOpen, view };
}
