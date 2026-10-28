// Desk monitors: a screen lights up while someone sits at that desk and goes dark when they stand up.
// Who sits where already reaches everyone with the chairs, so every client lights the same screens.

// Keep the screen colours soft: a dim plum glass when off, a pale sky glow when on.
const DARK = { color: 0x2f2a3c, emissive: 0x000000, glow: 0 };
const LIT = { color: 0xd8f1ff, emissive: 0x8fd6ff, glow: 0.85 };
// A desk chair sits about 66 px in front of its monitor; a chair pulled up from the side still counts.
const REACH = 110;

function centerOf(item, specs) {
  const spec = specs?.get?.(item.kind);
  const w = spec?.w ?? (item.kind === "monitor" ? 40 : 32);
  const h = spec?.h ?? 26;
  const turned = (((item.rot || 0) % 180) + 180) % 180 !== 0;
  return { x: item.x + (turned ? h : w) / 2, y: item.y + (turned ? w : h) / 2 };
}

/** Monitor ids that should be lit: each occupied chair lights the one nearest monitor in reach. */
export function litMonitors(furniture, present, specs) {
  const lit = new Set();
  const monitors = [];
  for (const item of furniture || []) {
    if (item.kind === "monitor") monitors.push({ id: item.id, ...centerOf(item, specs) });
  }
  for (const item of furniture || []) {
    if (item.kind !== "chair" || !item.seat || !present(item.seat)) continue;
    const seat = centerOf(item, specs);
    let best = null;
    for (const monitor of monitors) {
      const dist = Math.hypot(monitor.x - seat.x, monitor.y - seat.y);
      if (dist <= REACH && (!best || dist < best.dist)) best = { id: monitor.id, dist };
    }
    if (best) lit.add(best.id);
  }
  return lit;
}

/** Mark the glass of a monitor model so it can be switched on and off. */
export function markScreen(model) {
  model.traverse((node) => {
    if (!node.isMesh) return;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    // In the Kenney monitor the glass is the face painted "metal"; the frame is "metalDark".
    if (list.some((material) => material?.name === "metal")) node.userData.screen = true;
  });
}

/** Switch a monitor's glass on or off; returns whether anything changed. */
export function paintScreen(group, lit) {
  if (group.userData.lit === lit) return false;
  group.userData.lit = lit;
  const look = lit ? LIT : DARK;
  group.traverse((node) => {
    if (!node.isMesh || !node.userData.screen) return;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of list) {
      if (!material) continue;
      material.color?.setHex(look.color);
      if (material.emissive) {
        material.emissive.setHex(look.emissive);
        material.emissiveIntensity = look.glow;
      }
    }
  });
  return true;
}

export function attachMonitors(env) {
  const { state, world } = env;
  let shown = new Map();

  function present(id) {
    return id === state.me?.id || state.others.has(id);
  }

  function frame(meshes) {
    const lit = litMonitors(state.furniture, present, state.specs);
    const next = new Map();
    for (const [id, mesh] of meshes) {
      if (mesh.userData.kind !== "monitor") continue;
      paintScreen(mesh, lit.has(id));
      next.set(id, mesh.userData.lit === true);
    }
    shown = next;
  }

  function view() {
    return [...shown.entries()].map(([id, lit]) => ({ id, lit })).sort((a, b) => a.id.localeCompare(b.id));
  }

  world.setMonitorHook?.(frame);

  return { view };
}
