// Gym: dumbbell sets and their leaderboard, yoga on the mats, the bouncy ball and the water cooler.
import * as THREE from "./vendor/three.module.js";

const REACH = 90;
const LIFT_MS = 1800;
const BOUNCE_MS = 1600;
const POSE_DRIFT = 6;
const BUFF_BOOST = 1.15;
const LABELS = { lift: "舉啞鈴", yoga: "做瑜珈", ball: "拍彈力球", water: "喝水" };

export function attachGym(env) {
  const { state, world, $, send, snacks, toys, zoneAt, phone } = env;
  let panel = null;
  let board = [];
  let mine = null;
  let bounceAt = -Infinity;
  let bounces = 0;
  let ballUp = false;
  const lifts = new Map();
  const poses = new Map();
  const buffs = new Map();
  const rings = new Map();

  // ---- where things are ----------------------------------------------------

  function inGym(x, y) {
    return zoneAt(x, y)?.id === "gym";
  }

  function propBox(model) {
    return (state.map?.props || []).find((prop) => prop.kind === "decor" && prop.model === model) || null;
  }

  function distTo(prop) {
    const me = state.me;
    return prop ? Math.hypot(me.x - (prop.x + prop.w / 2), me.y - (prop.y + prop.h / 2)) : Infinity;
  }

  function onMat() {
    const mat = propBox("gym-mats");
    const me = state.me;
    return Boolean(mat && me.x >= mat.x && me.x <= mat.x + mat.w && me.y >= mat.y && me.y <= mat.y + mat.h);
  }

  function handsFull() {
    return Boolean(snacks.carried() || toys.holding());
  }

  /** Gym spots in reach, closest first. With full hands E stays free for eating or the toy. */
  function inReach() {
    const me = state.me;
    if (!me || state.seat || !inGym(me.x, me.y) || handsFull()) return [];
    const list = [];
    const add = (id, dist) => { if (dist <= REACH) list.push({ id, dist }); };
    add("lift", distTo(propBox("gym-dumbbells")));
    if (onMat() || poses.has(me.id)) list.push({ id: "yoga", dist: poses.has(me.id) ? 0 : distTo(propBox("gym-mats")) });
    add("ball", distTo(propBox("gym-ball")));
    add("water", distTo(propBox("gym-cooler")));
    return list.sort((a, b) => a.dist - b.dist);
  }

  function nameOf(row) {
    const person = row.id === state.me?.id ? state.me : state.others.get(row.id);
    return person?.displayName || row.name || row.id;
  }

  // ---- the dumbbell panel ------------------------------------------------------

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = "gym-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "gym-title");
    panel.innerHTML = '<div class="who" id="gym-title">啞鈴架</div><div class="gym-body"></div><div class="row"><button type="button" class="ghost" id="gym-close">關閉</button></div>';
    document.body.appendChild(panel);
    panel.querySelector("#gym-close").addEventListener("click", () => close());
    panel.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    });
    return panel;
  }

  function paint() {
    if (!panel || panel.hidden) return;
    const body = panel.querySelector(".gym-body");
    body.replaceChildren();
    const note = document.createElement("p");
    note.className = "gym-line";
    note.textContent = buffs.get(state.me?.id) > performance.now() ? "元氣滿滿！走路變快了。" : "舉一組啞鈴，會有一小段時間走得比較快。";
    const lift = document.createElement("button");
    lift.type = "button";
    lift.id = "gym-lift";
    lift.className = "big";
    lift.textContent = "舉一組";
    lift.addEventListener("click", () => send({ t: "gym", op: "lift" }));
    const title = document.createElement("p");
    title.className = "gym-line";
    title.textContent = mine ? `排行榜（你第 ${mine.rank} 名，${mine.sets} 組）` : "排行榜";
    const list = document.createElement("ol");
    list.className = "gym-board";
    if (!board.length) list.append(Object.assign(document.createElement("li"), { textContent: "還沒有人舉過，當第一個吧！" }));
    for (const row of board) {
      const item = document.createElement("li");
      item.dataset.id = row.id;
      const name = document.createElement("span");
      name.textContent = nameOf(row);
      const sets = document.createElement("b");
      sets.textContent = `${row.sets} 組`;
      item.append(name, sets);
      list.append(item);
    }
    body.append(note, lift, title, list);
  }

  function open() {
    if (!state.me) return false;
    ensurePanel().hidden = false;
    state.path = [];
    paint();
    if (!phone()) panel.querySelector("#gym-lift")?.focus();
    return true;
  }

  function close() {
    if (panel) panel.hidden = true;
  }

  function isOpen() {
    return Boolean(panel && !panel.hidden);
  }

  function run(id) {
    if (id === "lift") return open();
    if (id === "yoga") send({ t: "gym", op: "yoga", on: !poses.has(state.me.id) });
    else if (id === "ball") send({ t: "gym", op: "bounce" });
    else if (id === "water") send({ t: "gym", op: "drink" });
    return Boolean(id);
  }

  // A seat or a stall closer than the gym spot wins, like the pantry.
  function closest(seatDist) {
    const spot = inReach()[0];
    return spot && spot.dist < (seatDist ?? Infinity) ? spot.id : "";
  }

  /** E near a gym spot. Returns true when it did something. */
  function interact(seatDist) {
    if (isOpen()) {
      close();
      return true;
    }
    return run(closest(seatDist));
  }

  function label(id) {
    return id === "yoga" && state.me && poses.has(state.me.id) ? "結束瑜珈" : LABELS[id];
  }

  function prompt(seatDist) {
    if (phone()) return "";
    const id = closest(seatDist);
    return id ? `按 E ${label(id)}` : "";
  }

  function actions() {
    return inReach().map((spot) => ({ id: `gym-${spot.id}`, label: label(spot.id), run: () => run(spot.id) }));
  }

  function speedBoost() {
    return buffs.get(state.me?.id) > performance.now() ? BUFF_BOOST : 1;
  }

  // ---- poses on the characters ---------------------------------------------------

  function raiseArms(actor, angle) {
    actor.userData.shoulderL?.rotation.set(0, 0, -angle);
    actor.userData.shoulderR?.rotation.set(0, 0, angle);
  }

  function actorHook(actor, info) {
    const id = actor.userData?.pid;
    if (!id || info.sitting) return;
    const lift = lifts.get(id);
    if (lift) {
      // Three presses from the shoulders up over the head.
      const u = (performance.now() - lift) / LIFT_MS;
      raiseArms(actor, 1.6 + (0.5 - 0.5 * Math.cos(Math.min(1, u) * Math.PI * 6)) * 1.2);
      return;
    }
    if (!poses.has(id)) return;
    // A slow side stretch: lean over with one arm up and the other down, one foot lifted.
    // The body pose and the toy hook set all of these again each frame, so nothing needs undoing.
    const sway = 0.5 + 0.5 * Math.sin(info.time * 1.6);
    actor.userData.shoulderL?.rotation.set(0, 0, -(2.4 + sway * 0.5));
    actor.userData.shoulderR?.rotation.set(0, 0, 0.25);
    if (actor.userData.rig) actor.userData.rig.rotation.z = -(0.12 + sway * 0.12);
    const foot = actor.userData.footR;
    if (foot) foot.position.y = 4.2;
  }

  // ---- little effects --------------------------------------------------------------

  function syncRings(now) {
    const layer = world.fx;
    for (const [id, ring] of rings) {
      if (buffs.get(id) > now && layer) continue;
      ring.removeFromParent();
      ring.geometry.dispose();
      ring.material.dispose();
      rings.delete(id);
    }
    if (!layer) return;
    for (const [id, until] of buffs) {
      if (until <= now) {
        buffs.delete(id);
        continue;
      }
      const actor = world.actor?.(id);
      if (!actor) continue;
      let ring = rings.get(id);
      if (!ring) {
        ring = new THREE.Mesh(new THREE.RingGeometry(19, 24, 40), new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2;
        layer.add(ring);
        rings.set(id, ring);
      }
      ring.position.set(actor.position.x, 0.6, actor.position.z);
      ring.material.opacity = 0.7 + Math.sin(now / 160) * 0.2;
    }
  }

  function bounceBall(now) {
    const u = (now - bounceAt) / BOUNCE_MS;
    // Only touch the ball while it hops, and once more to set it back down.
    const ball = u < 1 || ballUp ? world.decor?.("gym-ball") : null;
    if (!ball) return;
    ballUp = u < 1;
    const base = (ball.userData.rest ??= { y: ball.position.y, scale: ball.scale.clone() });
    if (u >= 1) {
      ball.position.y = base.y;
      ball.scale.copy(base.scale);
      return;
    }
    // Three hops that shrink, with a squash at each landing.
    const hop = Math.abs(Math.sin(u * Math.PI * 3));
    const squash = hop < 0.2 ? (0.2 - hop) * 0.6 * (1 - u) : 0;
    ball.position.y = base.y + hop * 18 * (1 - u);
    ball.scale.set(base.scale.x * (1 + squash), base.scale.y * (1 - squash), base.scale.z * (1 + squash));
  }

  // ---- network ---------------------------------------------------------------------

  function personAt(id) {
    return id === state.me?.id ? state.me : state.others.get(id);
  }

  function setPose(id, on) {
    // On welcome the people list is not filled yet, so the anchor is taken on the next frame.
    const person = personAt(id);
    if (on) poses.set(id, person ? { x: person.x, y: person.y } : null);
    else poses.delete(id);
  }

  function applyBoard(raw) {
    if (!Array.isArray(raw)) return;
    board = raw.filter((row) => row && typeof row.id === "string").map((row) => ({ id: row.id, name: String(row.name || ""), sets: Number(row.sets) || 0 }));
  }

  function onNet(message) {
    if (!message || typeof message !== "object") return;
    if (message.t === "welcome") {
      const gym = message.gym || {};
      applyBoard(gym.board);
      mine = gym.mine && Number.isFinite(gym.mine.sets) ? gym.mine : null;
      poses.clear();
      lifts.clear();
      buffs.clear();
      const now = performance.now();
      for (const id of Array.isArray(gym.poses) ? gym.poses : []) setPose(id, true);
      for (const [id, left] of Object.entries(gym.buffs || {})) if (Number(left) > 0) buffs.set(id, now + Number(left));
      paint();
      return;
    }
    if (message.t === "leave") {
      setPose(message.id, false);
      lifts.delete(message.id);
      buffs.delete(message.id);
      return;
    }
    if (message.t !== "gym") return;
    const now = performance.now();
    if (message.op === "lift" && typeof message.id === "string") {
      lifts.set(message.id, now);
      buffs.set(message.id, now + (Number(message.buff) || 0));
      applyBoard(message.board);
      if (message.id === state.me?.id) mine = { rank: board.findIndex((row) => row.id === message.id) + 1 || mine?.rank || 0, sets: Number(message.sets) || 0 };
      if (mine && !mine.rank) mine = null;
      state.bubbles.set(message.id, { text: "嘿咻！", until: now + 1600, emote: true });
      paint();
    } else if (message.op === "pose" && typeof message.id === "string") {
      setPose(message.id, Boolean(message.on));
    } else if (message.op === "bounce") {
      bounceAt = now;
      bounces += 1;
      state.bubbles.set(message.by, { text: "咚咚！", until: now + 1200, emote: true });
    }
  }

  function frame(blocked) {
    const now = performance.now();
    if (isOpen() && (blocked || !inReach().some((spot) => spot.id === "lift"))) close();
    for (const [id, t0] of lifts) if (now - t0 > LIFT_MS) lifts.delete(id);
    // A pose ends once its owner walks off; my own client tells everyone.
    for (const [id, at] of poses) {
      const person = personAt(id);
      if (!at && person) poses.set(id, { x: person.x, y: person.y });
      if (!at || (person && Math.hypot(person.x - at.x, person.y - at.y) <= POSE_DRIFT)) continue;
      setPose(id, false);
      if (id === state.me?.id) send({ t: "gym", op: "yoga", on: false });
    }
    syncRings(now);
    bounceBall(now);
  }

  function view() {
    return {
      open: isOpen(),
      near: inReach().map((spot) => spot.id),
      board: board.map((row) => ({ ...row })),
      mine: mine ? { ...mine } : null,
      poses: [...poses.keys()],
      lifting: [...lifts.keys()],
      buffed: [...buffs.keys()].filter((id) => buffs.get(id) > performance.now()),
      rings: rings.size,
      bounces,
      boost: speedBoost(),
    };
  }

  world.setGymHook?.(actorHook);

  return { onNet, frame, interact, prompt, actions, open, close, isOpen, speedBoost, view };
}
