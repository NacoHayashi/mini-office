// Name tags and chat bubbles that float above each character.
import * as THREE from "./vendor/three.module.js";

export function createLabels(ctx) {
  const { camera, floaters, labels, phoneNow, projected, view } = ctx;

  function visibleBubble(state, id) {
    const live = state.bubbles?.get?.(id);
    const theirGroup = state.memberGroup?.get?.(id);
    const inMine = Boolean(state.whisper && theirGroup === state.whisper);
    if (theirGroup && !inMine) return { text: "對話中…", kind: "secret" };
    if (live?.text && live.whisper && inMine) return { text: live.text, kind: "whisper" };
    if (live?.text && !live.whisper) return { text: live.text, kind: "" };
    return { text: "", kind: "" };
  }

  const crownBox = new THREE.Box3();
  const LABEL_GAP = 10;

  function crownWorldY(actor) {
    crownBox.setFromObject(actor);
    if (crownBox.isEmpty() || !Number.isFinite(crownBox.max.y)) return actor.position.y + 80;
    return crownBox.max.y;
  }

  function placeFloater(id, actor, title, subtitle, bubble, hand = false) {
    if (!labels) return;
    let node = floaters.get(id);
    if (!node) {
      node = document.createElement("div");
      node.className = "floater";
      node.innerHTML = '<div class="bubble"></div><span class="hand" aria-label="舉手" hidden>✋</span><div class="nametag"><b></b><small></small></div>';
      labels.appendChild(node);
      floaters.set(id, node);
    }
    node.dataset.id = id;
    node.querySelector("b").textContent = title || "";
    node.querySelector("small").textContent = subtitle || "";
    const handNode = node.querySelector(".hand");
    if (handNode && handNode.hidden === Boolean(hand)) handNode.hidden = !hand;
    const info = bubble && typeof bubble === "object" ? bubble : { text: bubble || "", kind: "" };
    const bubbleNode = node.querySelector(".bubble");
    bubbleNode.hidden = !info.text;
    bubbleNode.classList.toggle("whisper", info.kind === "whisper");
    bubbleNode.classList.toggle("secret", info.kind === "secret");
    bubbleNode.replaceChildren();
    if (info.kind === "whisper") {
      const icon = document.createElement("span");
      icon.className = "shush";
      icon.textContent = "🔒";
      bubbleNode.append(icon, document.createTextNode(info.text));
    } else if (info.kind === "secret") {
      const label = document.createElement("span");
      label.textContent = "對話中…";
      const dots = document.createElement("i");
      dots.className = "dots";
      bubbleNode.append(label, dots);
    } else {
      bubbleNode.textContent = info.text || "";
    }
    if (!actor) {
      node.hidden = true;
      return;
    }
    projected.set(actor.position.x, crownWorldY(actor), actor.position.z);
    projected.project(camera);
    if (projected.z > 1) {
      node.hidden = true;
      return;
    }
    const rect = view.getBoundingClientRect();
    const host = labels.getBoundingClientRect();
    const sx = rect.left - host.left + (projected.x * 0.5 + 0.5) * rect.width;
    const headY = rect.top + (-projected.y * 0.5 + 0.5) * rect.height;
    node.dataset.crown = String(headY);
    let sy = headY - host.top - LABEL_GAP;
    node.hidden = false;
    if (phoneNow() && view.clientWidth > view.clientHeight) {
      const topbar = document.getElementById("topbar");
      if (topbar) {
        const limit = topbar.getBoundingClientRect().bottom + 4 - host.top;
        const stack = Math.max(node.offsetHeight, 28);
        const tagTop = sy - stack;
        if (tagTop < limit) sy += limit - tagTop;
      }
    }
    node.dataset.anchor = String(host.top + sy);
    node.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
  }

  return { crownWorldY, placeFloater, visibleBubble };
}
