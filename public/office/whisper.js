// Whisper groups: who is in one, pending asks, and the chat badge.
import { paintChatTip } from "./chat.js";
import { send } from "./net.js";
import { $, WHISPER_NEAR, state } from "./office-state.js";
import { personNamed } from "./people.js";

export function applyGroup(group, members, by) {
  if (!group) return;
  const was = state.whisper;
  for (const [id, current] of state.memberGroup) {
    if (current === group) state.memberGroup.delete(id);
  }
  const list = Array.isArray(members) ? members.filter(Boolean) : [];
  if (list.length >= 2) {
    state.groups.set(group, list);
    for (const id of list) state.memberGroup.set(id, group);
  } else {
    state.groups.delete(group);
    state.asks = state.asks.filter((ask) => ask.group !== group);
  }
  state.whisper = state.me ? (state.memberGroup.get(state.me.id) || null) : null;
  state.whisperArm = false;
  if (!was && state.whisper && by && by !== state.me?.id) {
    const other = personNamed(by);
    state.whisperNote = `${other?.displayName || by} @${by} 對你說悄悄話`;
    state.whisperNoteUntil = performance.now() + 3200;
  }
  if (was && !state.whisper) state.whisperNoteUntil = 0;
  if (by) state.asks = state.asks.filter((ask) => ask.id !== by);
  paintWhisper();
  paintAsks();
}

export function forgetMember(id) {
  const group = state.memberGroup.get(id);
  if (!group) return;
  state.memberGroup.delete(id);
  const rest = (state.groups.get(group) || []).filter((member) => member !== id);
  applyGroup(group, rest.length >= 2 ? rest : []);
}

export function paintWhisper() {
  const node = $("chat-whisper");
  const label = $("chat-whisper-label");
  const list = $("chat-whisper-list");
  if (!node || !label || !list) return;
  document.body.classList.toggle("whispering", Boolean(state.whisper));
  if (!state.whisper) {
    node.hidden = true;
    label.textContent = "";
    list.replaceChildren();
    paintChatTip();
    return;
  }
  const members = state.groups.get(state.whisper) || [];
  node.hidden = false;
  label.textContent = `悄悄話（${members.length} 人）`;
  list.replaceChildren();
  for (const id of members) {
    const person = personNamed(id);
    const item = document.createElement("span");
    item.textContent = `${person?.displayName || id} @${id}`;
    list.appendChild(item);
  }
  paintChatTip();
}

export function paintAsks() {
  const host = $("whisper-asks");
  if (!host) return;
  host.replaceChildren();
  const now = Date.now();
  state.asks = state.asks.filter((ask) => ask.until > now && ask.group === state.whisper);
  for (const ask of state.asks) {
    const row = document.createElement("div");
    row.className = "whisper-ask";
    const text = document.createElement("span");
    text.textContent = `@${ask.id} 想加入悄悄話`;
    const yes = document.createElement("button");
    yes.type = "button";
    yes.textContent = "答應";
    yes.addEventListener("click", () => send({ t: "hush", ask: ask.id, yes: true }));
    const no = document.createElement("button");
    no.type = "button";
    no.textContent = "婉拒";
    no.addEventListener("click", () => {
      state.asks = state.asks.filter((item) => item.id !== ask.id);
      paintAsks();
    });
    row.append(text, yes, no);
    host.appendChild(row);
  }
  host.hidden = host.childElementCount === 0;
}

export function nearestWhisper() {
  if (!state.me || state.whisper) return null;
  let best = null;
  for (const other of state.others.values()) {
    const dist = Math.hypot(state.me.x - other.x, state.me.y - other.y);
    if (dist <= WHISPER_NEAR && (!best || dist < best.dist)) {
      best = { id: other.id, dist, grouped: Boolean(state.memberGroup.get(other.id)) };
    }
  }
  return best;
}

export function toggleWhisper() {
  if (!state.me || state.gate || state.help || state.arcade || state.boardOpen || !$("avatar").hidden) return;
  if (state.whisper) {
    if (state.whisperArm) return;
    state.whisperArm = true;
    send({ t: "hush", off: true });
    return;
  }
  const near = nearestWhisper();
  if (!near) return;
  send({ t: "hush", id: near.id });
}
