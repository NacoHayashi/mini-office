import * as THREE from "./vendor/three.module.js";
import { stepGradient } from "./toon.js";

const REACH = 108;
const POSE_MS = 2800;

const ITEMS = [
  { id: "cookie", label: "餅乾", machine: "snackcab", pose: "eat", tint: 0xf0c07a },
  { id: "choco", label: "巧克力餅乾", machine: "snackcab", pose: "eat", tint: 0x8a5638 },
  { id: "candy", label: "水果糖", machine: "snackcab", pose: "eat", tint: 0xf26d9a },
  { id: "marsh", label: "棉花糖", machine: "snackcab", pose: "eat", tint: 0xfffdfb },
  { id: "tea", label: "綠茶", machine: "vendor", pose: "drink", tint: 0x7dca78 },
  { id: "soda", label: "汽水", machine: "vendor", pose: "drink", tint: 0xf08aab },
  { id: "juice", label: "果汁", machine: "vendor", pose: "drink", tint: 0xffb067 },
  { id: "latte", label: "咖啡牛奶", machine: "vendor", pose: "drink", tint: 0xf2d7a4 },
];

const BY_ID = new Map(ITEMS.map((item) => [item.id, item]));
const gradient = stepGradient([176, 222, 255]);

function toon(color) {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradient });
}

function smooth(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function makeHeld(item) {
  const group = new THREE.Group();
  const color = toon(item.tint);
  if (item.pose === "drink") {
    const can = item.id === "soda" || item.id === "latte";
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(can ? 1.7 : 2.05, can ? 1.7 : 1.7, can ? 6.4 : 4.6, 16),
      color,
    );
    group.add(body);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(can ? 1.82 : 2.16, can ? 1.82 : 1.82, 1.15, 16),
      toon(0xfff7ef),
    );
    band.position.y = 0.4;
    group.add(band);
    if (!can) {
      const handle = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.28, 8, 14), toon(0xfff7ef));
      handle.position.set(2.15, 0.1, 0);
      group.add(handle);
    }
    const top = new THREE.Mesh(new THREE.CircleGeometry(can ? 1.45 : 1.7, 16), toon(item.id === "tea" ? 0xc6e27a : 0xfff6ea));
    top.rotation.x = -Math.PI / 2;
    top.position.y = can ? 3.15 : 2.25;
    group.add(top);
    return group;
  }
  if (item.id === "candy") {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(2.15, 16, 12), color);
    group.add(ball);
    const wrap = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), toon(0xffe08a));
    wrap.position.set(2.1, 0.2, 0.4);
    group.add(wrap);
    return group;
  }
  if (item.id === "marsh") {
    const puff = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 2.4, 16), color);
    group.add(puff);
    return group;
  }
  const cookie = new THREE.Mesh(new THREE.CylinderGeometry(3.15, 3.15, 1.15, 18), color);
  group.add(cookie);
  const chip = item.id === "choco" ? 0xf2d7a4 : 0x6a4632;
  for (const [x, z] of [[-1.1, 0.7], [0.9, 0.8], [0.2, -1.1]]) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), toon(chip));
    dot.position.set(x, 0.62, z);
    group.add(dot);
  }
  return group;
}

function disposeProp(prop) {
  if (!prop) return;
  prop.removeFromParent();
  prop.traverse((node) => {
    node.geometry?.dispose?.();
    node.material?.dispose?.();
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
  for (const node of hidden || []) {
    if (node.parent) node.visible = true;
  }
}

export function attachSnacks(env) {
  const { state, world, $, send, sizeOf } = env;
  let stock = Object.fromEntries(ITEMS.map((item) => [item.id, 5]));
  let menu = null;
  let menuKind = "";
  let openedAt = 0;
  let heldPhase = null;
  const poses = new Map();

  function counts() {
    return { ...stock };
  }

  function applyStock(raw) {
    if (!raw || typeof raw !== "object") return;
    const next = { ...stock };
    for (const item of ITEMS) {
      const value = raw[item.id];
      if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 5) next[item.id] = value;
    }
    stock = next;
    if (menu && !menu.hidden) paintMenu();
    const button = $("btn-restock");
    if (button && !$("dialogue").hidden) button.hidden = !hasEmpty();
  }

  function hasEmpty() {
    return ITEMS.some((item) => (stock[item.id] || 0) <= 0);
  }

  function isMachine(kind) {
    return kind === "snackcab" || kind === "vendor";
  }

  function nearest() {
    if (!state.me) return null;
    let best = null;
    for (const item of state.furniture || []) {
      if (!isMachine(item.kind)) continue;
      const size = sizeOf(item);
      const x = item.x + size.w / 2;
      const y = item.y + size.h / 2;
      const dist = Math.hypot(state.me.x - x, state.me.y - y);
      if (dist < REACH && (!best || dist < best.dist)) best = { item, dist, x, y };
    }
    return best;
  }

  function spot(kind) {
    const item = (state.furniture || []).find((row) => row.kind === kind);
    if (!item) return null;
    const size = sizeOf(item);
    return {
      id: item.id,
      x: item.x + size.w / 2,
      y: item.y + size.h / 2,
      standX: item.x + size.w / 2,
      standY: item.y - 40,
    };
  }

  function ensureMenu() {
    if (menu) return menu;
    menu = document.createElement("section");
    menu.id = "snack-menu";
    menu.hidden = true;
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-modal", "true");
    menu.innerHTML = '<div class="who" id="snack-title"></div><div class="snack-grid"></div><div class="row"><button type="button" class="ghost" id="snack-close">關閉</button></div>';
    document.body.appendChild(menu);
    menu.querySelector("#snack-close").addEventListener("click", () => close());
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key >= "1" && event.key <= "9") {
        const button = menu.querySelectorAll("button.item")[Number(event.key) - 1];
        if (button && !button.disabled) button.click();
      }
    });
    window.addEventListener("keydown", (event) => {
      if (menu.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (event.key.startsWith("Arrow")) event.stopImmediatePropagation();
    }, true);
    return menu;
  }

  function paintMenu() {
    const box = ensureMenu();
    const title = box.querySelector("#snack-title");
    title.textContent = menuKind === "vendor" ? "販賣機" : "零食櫃";
    const grid = box.querySelector(".snack-grid");
    grid.replaceChildren();
    const list = ITEMS.filter((item) => item.machine === menuKind);
    for (const item of list) {
      const left = stock[item.id] || 0;
      const empty = left <= 0;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "item";
      button.dataset.item = item.id;
      button.disabled = empty;
      button.setAttribute("aria-label", empty ? `${item.label}，沒了` : `${item.label}，剩 ${left}`);
      const name = document.createElement("span");
      name.textContent = item.label;
      const meta = document.createElement("span");
      meta.className = "count";
      meta.textContent = empty ? "已售完" : `剩 ${left}`;
      button.append(name);
      if (empty) {
        const gone = document.createElement("small");
        gone.textContent = "沒了";
        button.append(gone);
      }
      button.append(meta);
      button.addEventListener("click", () => {
        if (button.disabled) return;
        send({ t: "snack", item: item.id });
      });
      grid.appendChild(button);
    }
  }

  function openMenu(item) {
    menuKind = item.kind;
    paintMenu();
    const box = ensureMenu();
    box.hidden = false;
    openedAt = performance.now();
    state.path = [];
    const first = box.querySelector("button.item:not(:disabled)") || box.querySelector("#snack-close");
    first?.focus();
  }

  function close() {
    if (menu) menu.hidden = true;
  }

  function dismiss() {
    if (!isOpen()) return false;
    if (performance.now() - openedAt < 400) return true;
    close();
    return true;
  }

  function isOpen() {
    return Boolean(menu && !menu.hidden);
  }

  function ensureRestock() {
    let button = $("btn-restock");
    if (button) return button;
    button = document.createElement("button");
    button.type = "button";
    button.id = "btn-restock";
    button.textContent = "零食/飲料沒了，麻煩補貨";
    button.addEventListener("click", () => send({ t: "snack", restock: true }));
    const row = document.querySelector("#dialogue .row");
    const later = $("btn-later");
    if (row && later) row.insertBefore(button, later);
    else row?.appendChild(button);
    return button;
  }

  function openLala() {
    close();
    const text = $("dialogue-text");
    const box = $("dialogue");
    if (!text || !box) return;
    const base = "你好呀，我是櫃檯 Lala 小姐。想移動螢幕、鍵盤、椅子或其他設備就跟我說。房間的牆不能改喔。";
    const empty = hasEmpty();
    text.textContent = empty ? base : `${base}零食和飲料都還有喔。`;
    ensureRestock().hidden = !empty;
    box.hidden = false;
    state.path = [];
  }

  function minePose() {
    const id = state.me?.id;
    return id ? poses.get(id) : null;
  }

  function carrying() {
    return minePose()?.mode === "carry";
  }

  function nibble() {
    const pose = minePose();
    if (!pose || pose.mode !== "carry") return false;
    send({ t: "snack", use: true });
    return true;
  }

  function openNearest() {
    const near = nearest();
    if (!near) return false;
    openMenu(near.item);
    return true;
  }

  function prompt() {
    if (carrying()) {
      if (env.phone()) return "";
      return minePose().pose === "drink" ? "按 E 喝飲料" : "按 E 吃點心";
    }
    const near = nearest();
    if (!near || env.phone()) return "";
    return near.item.kind === "vendor" ? "按 E 買飲料" : "按 E 拿零食";
  }

  function heldAction() {
    const pose = minePose();
    if (!pose || pose.mode !== "carry") return null;
    const drink = pose.pose === "drink";
    return {
      id: drink ? "sip" : "bite",
      label: drink ? "喝飲料" : "吃點心",
      run: () => nibble(),
    };
  }

  function action() {
    const near = nearest();
    if (!near) return null;
    const vendor = near.item.kind === "vendor";
    return {
      id: vendor ? "drink" : "snack",
      label: vendor ? "買飲料" : "拿零食",
      run: () => openMenu(near.item),
    };
  }

  function walk(point, seated = false) {
    if (isOpen()) {
      close();
      return true;
    }
    const item = env.hitFurniture(point.x, point.y);
    if (!item || !isMachine(item.kind)) return false;
    if (nearest()?.item.id === item.id) openMenu(item);
    else if (!seated) {
      const size = sizeOf(item);
      const spot = env.freeSpot(item.x + size.w / 2, item.y - 36);
      state.path = env.findPath(spot.x, spot.y);
    }
    return true;
  }

  function guard() {
    if (!isOpen()) return;
    const avatar = $("avatar");
    if (state.editing || state.help || state.arcade || state.boardOpen || state.gate || (avatar && !avatar.hidden)) close();
  }

  function startCarry(id, itemId) {
    const item = BY_ID.get(itemId);
    if (!item) return;
    const prev = poses.get(id);
    disposeProp(prev?.prop);
    showPockets(prev?.hidden);
    const actor = world.actor?.(id);
    if (actor) actor.userData.tasting = false;
    poses.set(id, {
      item,
      pose: item.pose,
      mode: "carry",
      t0: performance.now(),
      prop: null,
      hidden: [],
      rest: null,
      bound: null,
    });
  }

  function startTaste(id, itemId, poseName) {
    const item = BY_ID.get(itemId);
    if (!item) return;
    const prev = poses.get(id);
    if (prev && prev.item.id === item.id) {
      prev.mode = "taste";
      prev.pose = poseName || item.pose;
      prev.t0 = performance.now();
      const actor = world.actor?.(id);
      if (actor) actor.userData.tasting = true;
      return;
    }
    disposeProp(prev?.prop);
    showPockets(prev?.hidden);
    poses.set(id, {
      item,
      pose: poseName || item.pose,
      mode: "taste",
      t0: performance.now(),
      prop: null,
      hidden: [],
      rest: null,
      bound: null,
    });
    const actor = world.actor?.(id);
    if (actor) actor.userData.tasting = true;
  }

  function restore(actor, pose) {
    showPockets(pose.hidden);
    pose.hidden = [];
    if (pose.prop) {
      disposeProp(pose.prop);
      pose.prop = null;
    }
    const arm = actor?.userData?.armR;
    if (arm && pose.rest) {
      arm.position.x = pose.rest.x;
      arm.position.y = pose.rest.y;
      arm.position.z = pose.rest.z;
    }
    if (actor) actor.userData.tasting = false;
  }

  function bind(actor, pose) {
    const arm = actor.userData.armR;
    if (!arm) return;
    if (pose.bound === actor && pose.prop?.parent === arm) return;
    disposeProp(pose.prop);
    showPockets(pose.hidden);
    pose.bound = actor;
    pose.hidden = hidePockets(actor);
    pose.prop = makeHeld(pose.item);
    arm.add(pose.prop);
    if (!pose.rest) pose.rest = { x: arm.position.x, y: arm.position.y, z: arm.position.z };
    actor.userData.tasting = pose.mode === "taste";
  }

  function placeCarry(actor, pose) {
    const arm = actor.userData.armR;
    const rest = pose.rest;
    if (arm && rest) {
      arm.position.x = rest.x + 2.6;
      arm.position.y = rest.y + 4.4;
      arm.position.z = rest.z + 0.15;
    }
    const prop = pose.prop;
    if (!prop) return;
    const drink = pose.pose === "drink";
    prop.position.set(drink ? 1.8 : 2.6, drink ? 2.4 : 1.5, 0.15);
    prop.rotation.set(drink ? 0.1 : 0.85, 0.25, drink ? -0.08 : 0.2);
    prop.scale.setScalar(1);
    actor.userData.tasting = false;
  }

  function tick(actor) {
    const id = actor.userData?.pid;
    const pose = id ? poses.get(id) : null;
    if (!pose) return;
    bind(actor, pose);
    if (pose.mode !== "taste") {
      placeCarry(actor, pose);
      return;
    }
    const arm = actor.userData.armR;
    const elapsed = performance.now() - pose.t0;
    const frozen = heldPhase != null && id === state.me?.id;
    const u = frozen ? heldPhase : Math.min(1, elapsed / POSE_MS);
    if (!frozen && elapsed >= POSE_MS) {
      restore(actor, pose);
      poses.delete(id);
      return;
    }
    const lift = smooth(Math.min(1, u / 0.22)) * (1 - smooth(Math.max(0, (u - 0.78) / 0.22)));
    const rest = pose.rest;
    if (arm && rest) {
      arm.position.x = rest.x + lift * 1.6;
      arm.position.y = rest.y + lift * (actor.userData.sitting ? 8 : 11);
      arm.position.z = rest.z + lift * 5.2;
    }
    const prop = pose.prop;
    if (!prop) return;
    prop.position.set(0.2, 2.1 + lift * 0.8, 1.5);
    prop.rotation.set(0, 0, 0);
    if (pose.pose === "drink") {
      const tilt = Math.sin(Math.min(1, Math.max(0, (u - 0.2) / 0.6)) * Math.PI);
      prop.rotation.z = -tilt * 1.05;
      prop.rotation.x = tilt * 0.2;
      prop.position.y += tilt * 0.6;
    } else {
      const chew = Math.max(0, Math.sin(u * Math.PI * 6));
      prop.position.z += lift * (0.8 + chew * 1.1);
      prop.position.y += chew * 0.35;
      const nibbles = Math.max(0, u - 0.28) * 0.7;
      const scale = Math.max(0.45, 1 - nibbles);
      prop.scale.setScalar(scale);
    }
  }

  world.setSnackHook?.(tick);

  function emote(id, text, ms) {
    const now = performance.now();
    const live = state.bubbles.get(id);
    if (live && live.until > now && !live.emote) return;
    state.bubbles.set(id, { text, until: now + ms, emote: true });
  }

  function onNet(message) {
    if (!message || typeof message !== "object") return;
    if (message.t === "leave" && typeof message.id === "string") {
      const prev = poses.get(message.id);
      if (prev) {
        const actor = world.actor?.(message.id);
        if (actor) restore(actor, prev);
        poses.delete(message.id);
      }
      return;
    }
    if (message.t === "welcome") {
      applyStock(message.stock);
      for (const [id, pose] of poses) restore(world.actor?.(id), pose);
      poses.clear();
      for (const hand of message.hands || []) {
        if (hand && typeof hand.id === "string" && typeof hand.item === "string") startCarry(hand.id, hand.item);
      }
    }
    if (message.t !== "snacks") return;
    applyStock(message.stock);
    if (typeof message.line === "string" && message.line) {
      state.lalaBubble = { text: message.line, until: performance.now() + 4200 };
      const text = $("dialogue-text");
      if (text && !$("dialogue").hidden) text.textContent = message.line;
      const button = $("btn-restock");
      if (button) button.hidden = !hasEmpty();
    }
    const hold = message.hold;
    if (hold && typeof hold.id === "string") {
      startCarry(hold.id, hold.item);
      if (hold.replaced) emote(hold.id, "換一個", 1800);
      if (hold.id === state.me?.id) close();
    }
    const use = message.use;
    if (use && typeof use.id === "string") {
      startTaste(use.id, use.item, use.pose);
      if (use.pose === "eat") emote(use.id, "😋", 2600);
      if (use.id === state.me?.id) close();
    }
  }

  function carried(id) {
    const pose = poses.get(id || state.me?.id);
    if (!pose || pose.mode !== "carry") return "";
    return pose.item.id;
  }

  function phase() {
    const pose = minePose();
    if (!pose || pose.mode !== "taste") return -1;
    if (heldPhase != null) return heldPhase;
    return Math.min(1, (performance.now() - pose.t0) / POSE_MS);
  }

  return {
    onNet,
    openLala,
    prompt,
    action,
    heldAction,
    nibble,
    carrying,
    openNearest,
    walk,
    isOpen,
    close,
    dismiss,
    guard,
    counts,
    spot,
    carried,
    phase,
    hold(value) { heldPhase = typeof value === "number" ? value : null; },
  };
}
