// window.office test hooks, exposed on localhost or with ?debug.
import { ensureLoop, meeting, monitors, snacks, stalls, toys } from "./game.js";
import { pinOverlays } from "./input.js";
import { cloneLook, presetOf } from "./look-editor.js";
import { bodyRadius, collides, findPath, freeSpot, screenToWorld, worldToScreen } from "./movement.js";
import { onNet, requests, send, sendMove } from "./net.js";
import { $, phoneQuery, state, world } from "./office-state.js";

export let keyboardOverride = null;

const officeDebug = new URLSearchParams(location.search).has("debug")
  || location.hostname === "127.0.0.1"
  || location.hostname === "localhost";

export function exposeDebug() {
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
    get monitors() { return monitors.view(); },
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
    get toys() { return toys.view(); },
    get toyHeld() { return toys.holding(); },
    toyHeldOf(id) { return toys.holding(id); },
    toyProp(id) { return toys.heldProp(id); },
    toyFx() { return toys.fxLog(); },
    toySquash(id) { return toys.squashOf(id); },
    get toyRack() { return toys.rack(); },
    get toyOpen() { return toys.isOpen(); },
    toyInteract() { return toys.interact(); },
    toyMenu() { return toys.openNearest(); },
    toyBump() { return toys.bump(); },
    get meeting() { return meeting.view(); },
    meetingOpen(tool) { meeting.open(tool || ""); },
    meetingSend(op, extra = {}) { send({ ...extra, t: "meeting", op }); },
    feed(message) { onNet(message); },
  };
}
