// Furniture edit mode: palette, selection, placing, rotating, and removing.
import { snacks, toys } from "./game.js";
import { clearPlaceGesture } from "./input.js";
import { sizeOf } from "./movement.js";
import { send } from "./net.js";
import { $, TILE, phoneQuery, setHint, state } from "./office-state.js";

export function buildPalette() {
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

export function editHintText() {
  if (phoneQuery.matches) return "拖曳移動。點選後可旋轉或收回。點清單再點地板加設備。牆不能改。";
  return "拖曳移動，點一下選取。旋轉和收回也可用 R、Delete。點清單再點地板可加設備。牆不能改。";
}

export function paintTools() {
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

export function clearArmed() {
  state.armed = null;
  pendingAdd = null;
  for (const node of $("palette").querySelectorAll("button")) node.classList.remove("armed");
  paintTools();
}

export function setEditing(on) {
  snacks.close();
  toys.close();
  state.editing = on;
  $("editbar").hidden = !on;
  $("dialogue").hidden = true;
  state.path = [];
  state.armed = null;
  pendingAdd = null;
  state.selected = null;
  clearPlaceGesture();
  for (const node of $("palette").querySelectorAll("button")) node.classList.remove("armed");
  if (on) {
    const hint = $("edit-hint");
    if (hint) hint.textContent = editHintText();
    if (state.me) state.focus = { x: state.me.x, y: state.me.y };
  }
  paintTools();
  if (!on) setHint("");
}

export function hitFurniture(x, y, movable = false) {
  const items = [...state.furniture].sort((a, b) => a.y + sizeOf(a).h - (b.y + sizeOf(b).h));
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (movable && state.specs.get(item.kind)?.fixed) continue;
    const size = sizeOf(item);
    if (x >= item.x - 6 && y >= item.y - 6 && x <= item.x + size.w + 6 && y <= item.y + size.h + 6) return item;
  }
  return null;
}

export let pendingAdd = null;

// net.js clears it once the server confirms the new item.
export function clearPendingAdd() {
  pendingAdd = null;
}

export function placeArmed(x, y) {
  const kind = state.armed;
  const spec = state.specs.get(kind);
  if (!spec || pendingAdd) return;
  if (state.socket?.readyState !== 1) return;
  pendingAdd = kind;
  send({ t: "furn", op: "add", kind, x: x - spec.w / 2, y: y - spec.h / 2 });
}

export function rotateSelected() {
  if (!state.editing || !state.selected) return;
  send({ t: "furn", op: "rot", id: state.selected });
}

export function removeSelected() {
  if (!state.editing || !state.selected) return;
  send({ t: "furn", op: "remove", id: state.selected });
  state.selected = null;
  paintTools();
}
