// Camera placement, framing on phones, and the drag-to-orbit controls.
import * as THREE from "./vendor/three.module.js";
import { FOLLOW_PITCH, clamp } from "./world3d.js";

export function createCamera(ctx) {
  const {
    camera,
    desired,
    floaters,
    floorPlane,
    hit,
    look,
    ndc,
    phoneNow,
    projected,
    raycaster,
    scene,
    sun,
    view,
    world,
  } = ctx;

  let chatLift = 0;
  let autoFrame = 0;

  let snapped = false;

  function portraitPhone() {
    return phoneNow() && view.clientHeight > view.clientWidth;
  }

  function homeDist() {
    return portraitPhone() ? 800 : 500;
  }

  function frameForViewport() {
    if (world.mode !== "iso") return;
    if (world.dist === 500 || world.dist === 800 || world.dist === 1180 || (autoFrame && Math.abs(world.dist - autoFrame) < 1.5)) {
      world.dist = homeDist();
      autoFrame = 0;
    }
  }

  function screenY(x, y, z) {
    projected.set(x, y, z).project(camera);
    const rect = view.getBoundingClientRect();
    return rect.top + (-projected.y * 0.5 + 0.5) * rect.height;
  }

  function releaseAutoFrame() {
    if (autoFrame && !world.userZoom && Math.abs(world.dist - autoFrame) < 1.5) world.dist = homeDist();
    autoFrame = 0;
  }

  function frameLandscape(state, chat) {
    const topbar = document.getElementById("topbar")?.getBoundingClientRect();
    const topLimit = (topbar ? topbar.bottom : 0) + 6;
    const bottomLimit = chat.getBoundingClientRect().top - 6;
    const band = bottomLimit - topLimit;
    const spots = [];
    const add = (id, x, z) => {
      const node = id ? floaters.get(id) : null;
      const anchor = Number(node?.dataset.anchor);
      const stack = node?.offsetHeight || node?.querySelector(".nametag")?.offsetHeight || 32;
      if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(anchor)) return;
      spots.push({ nameTop: anchor - stack, feet: screenY(x, 0, z) });
    };
    if (state?.me) add(state.me.id, state.me.x, state.me.y);
    if (state?.me && state.others?.values) {
      for (const person of state.others.values()) {
        if (Math.hypot(person.x - state.me.x, person.y - state.me.y) > 260) continue;
        add(person.id, person.x, person.y);
      }
    }
    if (!spots.length || band < 48) return;
    const nameTop = Math.min(...spots.map((spot) => spot.nameTop));
    const feet = Math.max(...spots.map((spot) => spot.feet));
    const span = feet - nameTop;
    if (!world.userZoom && span > band - 16 && world.dist < 1200) {
      const need = span / Math.max(80, band - 20);
      world.dist = Math.min(1200, world.dist * Math.min(1.18, Math.max(1.06, need)));
      if (Math.abs(world.dist - 1180) < 2) world.dist = 1184;
      autoFrame = world.dist;
    }
    const topOverlap = topLimit - nameTop;
    const bottomOverlap = feet - bottomLimit;
    let delta = 0;
    if (topOverlap > 3 && topOverlap >= bottomOverlap) delta = -Math.min(16, topOverlap * 0.45);
    else if (bottomOverlap > 3) delta = Math.min(16, bottomOverlap * 0.45);
    else {
      const shift = (topLimit + bottomLimit) / 2 - (nameTop + feet) / 2;
      if (Math.abs(shift) > 8) delta = -Math.sign(shift) * Math.min(8, Math.abs(shift) * 0.3);
    }
    chatLift = clamp(chatLift + delta, -360, 640);
  }

  function fitFog(dist) {
    if (!phoneNow()) {
      scene.fog.near = 2600;
      scene.fog.far = 5600;
      return;
    }
    const fogDist = Math.max(500, dist);
    scene.fog.near = fogDist * 1.6;
    scene.fog.far = fogDist * 4.8;
  }

  function updateChatLift(state) {
    // Desktop and the follow camera never lift, so they skip the layout reads below.
    if (!phoneNow() || world.mode !== "iso") {
      releaseAutoFrame();
      chatLift = Math.max(0, chatLift - 12);
      return;
    }
    const landscape = view.clientWidth > view.clientHeight;
    const chat = document.getElementById("chatbar");
    const chatOpen = !!(chat && getComputedStyle(chat).display !== "none");
    if (landscape && chatOpen) {
      frameLandscape(state, chat);
      return;
    }
    releaseAutoFrame();
    const me = state?.me?.id ? floaters.get(state.me.id) : null;
    if (!me || me.hidden) {
      chatLift *= 0.7;
      return;
    }
    const box = me.getBoundingClientRect();
    const topbar = document.getElementById("topbar")?.getBoundingClientRect();
    const topLine = topbar ? topbar.bottom + 8 : 0;
    const topOverlap = topbar ? topLine - box.top : 0;
    let feetY = box.bottom;
    if (state.me) {
      projected.set(state.me.x, 0, state.me.y).project(camera);
      const rect = view.getBoundingClientRect();
      feetY = rect.top + (-projected.y * 0.5 + 0.5) * rect.height;
    }
    const bottomOverlap = chatOpen ? feetY - (chat.getBoundingClientRect().top - 10) : 0;
    const slack = topbar ? box.top - topLine : 80;
    let delta = 0;
    if (topOverlap > 4) delta = -Math.min(10, Math.max(0.8, topOverlap * 0.22));
    else if (bottomOverlap > 4 && slack > 12) delta = Math.min(10, bottomOverlap * 0.22, (slack - 8) * 0.35);
    else if (!chatOpen && topOverlap <= 0 && chatLift > 0.5) delta = -Math.min(6, chatLift * 0.35);
    else if (slack > 18 && bottomOverlap <= 0 && chatLift < -0.5) delta = Math.min(6, -chatLift * 0.35);
    chatLift = clamp(chatLift + delta, -240, 420);
  }

  let posed = world.mode;

  function behindYaw() {
    // Follow the eased body turn, not the raw step direction, so the camera never jitters.
    return (world.walking && Number.isFinite(world.shown) ? world.shown : world.face) + Math.PI;
  }

  function cameraYaw() {
    if (world.mode !== "follow") return world.yaw;
    if (world.steerHeld) return world.steerYaw;
    return Number.isFinite(world.camYaw) ? world.camYaw : behindYaw();
  }

  function holdSteer(held) {
    const now = performance.now();
    if (held) {
      if (!world.steerHeld) world.steerYaw = world.heading;
      world.steerHeld = true;
      world.steerUntil = now + 140;
      return;
    }
    if (world.steerHeld && now >= (world.steerUntil || 0)) world.steerHeld = false;
  }

  const focusAim = new THREE.Vector3();
  function followFocus(focus, dt) {
    const height = world.mode === "follow" ? 46 : 8;
    const yawNow = cameraYaw();
    const next = focusAim.set(
      focus.x + Math.sin(yawNow) * chatLift,
      height,
      focus.y + Math.cos(yawNow) * chatLift,
    );
    if (!snapped || posed !== world.mode) look.copy(next);
    else look.lerp(next, 1 - Math.exp(-Math.max(0.001, dt) * 8));
  }

  function placeCamera(dt) {
    const pitch = world.mode === "follow" ? world.followPitch : world.pitch;
    const dist = world.mode === "follow" ? world.followDist : world.dist;
    let yaw = world.yaw;
    if (world.mode === "follow") {
      const behind = behindYaw();
      if (!Number.isFinite(world.camYaw)) world.camYaw = behind;
      if (world.steerHeld) {
        yaw = world.steerYaw;
        world.camYaw = yaw;
      } else if (world.seated) {
        // Seated avatars keep facing the chair, so a dragged follow camera stays put.
        yaw = world.camYaw;
      } else {
        const delta = Math.atan2(Math.sin(behind - world.camYaw), Math.cos(behind - world.camYaw));
        world.camYaw += delta * (1 - Math.exp(-2.4 * Math.max(0.001, dt)));
        yaw = world.camYaw;
      }
    }
    const sinP = Math.sin(pitch);
    desired.set(
      look.x + dist * sinP * Math.sin(yaw),
      look.y + dist * Math.cos(pitch),
      look.z + dist * sinP * Math.cos(yaw),
    );
    const switched = posed !== world.mode;
    posed = world.mode;
    const blend = !snapped || switched ? 1 : 1 - Math.exp(-Math.max(0.001, dt) * 8);
    camera.position.lerp(desired, blend);
    const fov = world.mode === "follow" ? 48 : 40;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(look);
    camera.updateMatrixWorld(true);
    world.heading = yaw;
    snapped = true;
    fitFog(dist + chatLift);
    const span = clamp(dist * 0.58, 260, 640);
    const shadowCam = sun.shadow.camera;
    if (Math.abs(shadowCam.right - span) > 12) {
      shadowCam.left = -span;
      shadowCam.right = span;
      shadowCam.top = span;
      shadowCam.bottom = -span;
      shadowCam.updateProjectionMatrix();
    }
    sun.position.set(look.x + 230, look.y + 400, look.z + 170);
    sun.target.position.set(look.x, 0, look.z);
    sun.target.updateMatrixWorld();
  }

  function screenToWorld(clientX, clientY) {
    const rect = view.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(floorPlane, hit)) return { x: look.x, y: look.z };
    return { x: hit.x, y: hit.z };
  }

  function worldToScreen(x, y) {
    const rect = view.getBoundingClientRect();
    projected.set(x, 0, y).project(camera);
    return {
      x: rect.left + (projected.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-projected.y * 0.5 + 0.5) * rect.height,
    };
  }

  function orbit(dx, dy) {
    const turn = dx * 0.005;
    if (world.mode === "follow") {
      world.camYaw -= turn;
      if (world.steerHeld) world.steerYaw -= turn;
    } else world.yaw -= turn;
    tilt(dy);
  }

  function tilt(dy) {
    if (!Number.isFinite(dy)) return;
    if (world.mode === "follow") world.followPitch = clamp(world.followPitch - dy * 0.003, FOLLOW_PITCH - 0.09, FOLLOW_PITCH + 0.09);
    else world.pitch = clamp(world.pitch - dy * 0.003, 0.48, 1.02);
  }

  function aim(view = {}) {
    if (typeof view.yaw === "number") world.yaw = view.yaw;
    if (typeof view.pitch === "number") world.pitch = view.pitch;
    if (typeof view.dist === "number") {
      if (world.mode === "follow") world.followDist = view.dist;
      else world.dist = view.dist;
      world.userZoom = false;
      autoFrame = 0;
    }
  }

  function zoom(delta) {
    world.userZoom = true;
    const factor = Math.exp(delta * 0.0011);
    if (world.mode === "follow") world.followDist = clamp(world.followDist * factor, 140, 420);
    else world.dist = clamp(world.dist * factor, 280, 1400);
  }

  function toggle() {
    world.mode = world.mode === "iso" ? "follow" : "iso";
    if (world.mode === "follow") {
      world.camYaw = world.face + Math.PI;
      world.steerHeld = false;
    }
    return world.mode;
  }

  function axes() {
    const yaw = world.mode === "follow" && world.steerHeld ? world.steerYaw : world.heading;
    return {
      forwardX: -Math.sin(yaw),
      forwardY: -Math.cos(yaw),
      rightX: Math.cos(yaw),
      rightY: -Math.sin(yaw),
    };
  }

  return {
    aim,
    axes,
    followFocus,
    frameForViewport,
    holdSteer,
    homeDist,
    orbit,
    placeCamera,
    screenToWorld,
    toggle,
    updateChatLift,
    worldToScreen,
    zoom,
  };
}
