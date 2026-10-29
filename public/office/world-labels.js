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

  // Layout is read once per frame (not per label), and a label's DOM is only
  // touched when what it shows changed, so labels never force extra layouts.
  const painted = new WeakMap();
  let frameRects = null;
  function beginFrame() {
    frameRects = null;
  }

  function rects() {
    if (!frameRects) frameRects = { view: view.getBoundingClientRect(), host: labels.getBoundingClientRect(), topbar: null, wide: null };
    return frameRects;
  }

  function topbarBottom() {
    const frame = rects();
    if (frame.topbar === null) frame.topbar = document.getElementById("topbar")?.getBoundingClientRect().bottom ?? false;
    return frame.topbar;
  }

  function wide() {
    const frame = rects();
    if (frame.wide === null) frame.wide = view.clientWidth > view.clientHeight;
    return frame.wide;
  }

  function setHidden(node, hidden) {
    if (node.hidden !== hidden) node.hidden = hidden;
  }

  function paintBubble(bubbleNode, info) {
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
  }

  function placeFloater(id, actor, title, subtitle, bubble, hand = false) {
    if (!labels) return;
    let node = floaters.get(id);
    if (!node) {
      node = document.createElement("div");
      node.className = "floater";
      node.innerHTML = '<div class="bubble"></div><span class="hand" aria-label="舉手" hidden>✋</span><div class="nametag"><b></b><small></small></div>';
      node.dataset.id = id;
      painted.set(node, {
        title: null,
        subtitle: null,
        bubble: null,
        crown: null,
        anchor: null,
        transform: null,
        parts: { title: node.querySelector("b"), subtitle: node.querySelector("small"), hand: node.querySelector(".hand"), bubble: node.querySelector(".bubble") },
      });
      labels.appendChild(node);
      floaters.set(id, node);
    }
    const shown = painted.get(node);
    const { parts } = shown;
    if (node.dataset.id !== id) node.dataset.id = id;
    if (shown.title !== (title || "")) parts.title.textContent = shown.title = title || "";
    if (shown.subtitle !== (subtitle || "")) parts.subtitle.textContent = shown.subtitle = subtitle || "";
    if (parts.hand.hidden === Boolean(hand)) parts.hand.hidden = !hand;
    const text = bubble && typeof bubble === "object" ? bubble.text || "" : bubble || "";
    const kind = bubble && typeof bubble === "object" ? bubble.kind || "" : "";
    const bubbleKey = `${kind}|${text}`;
    if (shown.bubble !== bubbleKey) {
      shown.bubble = bubbleKey;
      paintBubble(parts.bubble, { text, kind });
    }
    if (!actor) {
      setHidden(node, true);
      return;
    }
    projected.set(actor.position.x, crownWorldY(actor), actor.position.z);
    projected.project(camera);
    if (projected.z > 1) {
      setHidden(node, true);
      return;
    }
    const { view: rect, host } = rects();
    const sx = rect.left - host.left + (projected.x * 0.5 + 0.5) * rect.width;
    const headY = rect.top + (-projected.y * 0.5 + 0.5) * rect.height;
    const crown = String(headY);
    if (shown.crown !== crown) node.dataset.crown = shown.crown = crown;
    let sy = headY - host.top - LABEL_GAP;
    setHidden(node, false);
    if (phoneNow() && wide()) {
      const bottom = topbarBottom();
      if (bottom !== false) {
        const limit = bottom + 4 - host.top;
        const stack = Math.max(node.offsetHeight, 28);
        const tagTop = sy - stack;
        if (tagTop < limit) sy += limit - tagTop;
      }
    }
    const anchor = String(host.top + sy);
    if (shown.anchor !== anchor) node.dataset.anchor = shown.anchor = anchor;
    const transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
    if (shown.transform !== transform) node.style.transform = shown.transform = transform;
  }

  return { beginFrame, crownWorldY, placeFloater, visibleBubble };
}
