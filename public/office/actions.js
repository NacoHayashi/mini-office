// The context action buttons.
import { meeting, snacks, stalls, toys } from "./game.js";
import { interact, nearestChair, nearestUse } from "./interact.js";
import { inRestroom, nearLala } from "./movement.js";
import { $, phoneQuery, state } from "./office-state.js";
import { nearestWhisper, toggleWhisper } from "./whisper.js";

function actionsNow() {
  if (!phoneQuery.matches || !state.me || state.editing || state.help || state.arcade || state.boardOpen || !$("avatar").hidden || !$("dialogue").hidden || snacks.isOpen() || toys.isOpen() || meeting.isOpen()) return [];
  const list = [];
  const near = nearestWhisper();
  if (state.whisper) list.push({ id: "leave", label: "離開悄悄話", run: toggleWhisper });
  else if (near?.grouped) list.push({ id: "join", label: "加入悄悄話", run: toggleWhisper });
  else if (near) list.push({ id: "whisper", label: "說悄悄話", run: toggleWhisper });
  const bite = snacks.heldAction();
  if (bite) list.push(bite);
  list.push(...toys.actions());
  const snack = snacks.action();
  if (snack) list.push(snack);
  else if (state.seat) list.push({ id: "stand", label: "起立", run: interact });
  else if (nearestChair()) list.push({ id: "sit", label: "坐下", run: interact });
  else if (nearLala()) list.push({ id: "lala", label: "跟 Lala 說話", run: interact });
  else if (nearestUse()?.use === "play") list.push({ id: "play", label: "玩小遊戲", run: interact });
  else if (nearestUse()?.use === "scores") list.push({ id: "scores", label: "看排行榜", run: interact });
  else if (stalls.action()) list.push(stalls.action());
  else if (inRestroom() && !snacks.carrying()) list.push({ id: "mirror", label: "調整造型", run: interact });
  return list;
}

// Buttons run whatever their action is this frame, so a button can stay put while its neighbours come and go.
let actionRuns = new Map();

export function paintActions() {
  const box = $("actions");
  if (!box) return;
  const list = actionsNow();
  actionRuns = new Map(list.map((action) => [action.id, action.run]));
  const sig = list.map((action) => `${action.id}:${action.label}`).join("|");
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  // Only add, drop or relabel the buttons that changed. Rebuilding the whole bar whenever a toy, chair
  // or snack comes into reach pulled the button out from under a finger that was already tapping it.
  const old = new Map([...box.children].map((button) => [button.dataset.action, button]));
  const keep = new Set(list.map((action) => action.id));
  for (const [id, button] of old) if (!keep.has(id)) button.remove();
  list.forEach((action, index) => {
    let button = old.get(action.id);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.dataset.action = action.id;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        actionRuns.get(action.id)?.();
      });
    }
    if (button.textContent !== action.label) button.textContent = action.label;
    const at = box.children[index] || null;
    if (at !== button) box.insertBefore(button, at);
  });
}
