// Characters in the scene: creating, animating, and keeping them apart, plus whisper auras.
import * as THREE from "./vendor/three.module.js";
import { CREATURE, SHADOW_Y } from "./avatar.js";
import { lalaHeading } from "./lala.js";
import { FALLBACK_LOOK, LALA_LOOK, bodyRadius } from "./world3d.js";

export function createActors(ctx) {
  const {
    actorGroup,
    actors,
    auras,
    creature,
    floaters,
    paintFace,
    poseBody,
    visibleBubble,
    world,
  } = ctx;

  let snackHook = null;

  let toyHook = null;

  let auraDisc = null;
  let auraRing = null;

  function setSnackHook(fn) { snackHook = typeof fn === "function" ? fn : null; }

  function setToyHook(hooks) { toyHook = hooks && typeof hooks === "object" ? hooks : null; }

  function frameToys(dt, state) {
    if (toyHook?.frame) toyHook.frame(dt, state);
  }

  function signature(look) {
    return JSON.stringify(look || {});
  }

  function ensureActor(id, look, lala = false) {
    const sig = `${lala ? "lala" : "p"}|${signature(look)}`;
    let actor = actors.get(id);
    if (!actor || actor.userData.sig !== sig) {
      if (actor) actorGroup.remove(actor);
      actor = creature(look, { lala });
      actor.userData.sig = sig;
      actors.set(id, actor);
      actorGroup.add(actor);
    }
    actor.userData.pid = id;
    return actor;
  }

  function animateActor(actor, moving, time, moveFace, talking = false, dt = 0.016, gaze = null, gazeRate = 3.4) {
    const sitting = poseBody(actor, moving, time, dt);
    let heading = actor.userData.heading;
    if (heading == null || Number.isNaN(heading)) heading = Number.isFinite(moveFace) ? moveFace : 0;
    let target = heading;
    let rate = gazeRate;
    if ((sitting || moving) && Number.isFinite(moveFace)) {
      target = moveFace;
      rate = 12;
    } else if (!moving && Number.isFinite(gaze)) target = gaze;
    // Shortest-angle exponential ease, so turns look the same at any frame rate.
    const delta = Math.atan2(Math.sin(target - heading), Math.cos(target - heading));
    const step = Math.max(0.001, dt);
    // Cap the turn speed too, so an about-face does not start with a big jump.
    heading += Math.abs(delta) < 0.001 ? delta : Math.sign(delta) * Math.min(Math.abs(delta) * (1 - Math.exp(-rate * step)), 10 * step);
    heading = Math.atan2(Math.sin(heading), Math.cos(heading));
    actor.userData.heading = heading;
    actor.rotation.y = heading;
    let phase = (time + Math.abs(heading)) % 4.2;
    if (phase < 0) phase += 4.2;
    if (actor.userData.decal) paintFace(actor.userData.decal, phase > 4.05, Boolean(talking) || Boolean(actor.userData.tasting));
    if (snackHook) snackHook(actor, { sitting, time, dt });
    if (toyHook?.actor) toyHook.actor(actor, { sitting, time, dt });
  }

  function separateBodies(bodies) {
    for (let pass = 0; pass < 5; pass++) {
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i];
          const b = bodies[j];
          let dx = b.x - a.x;
          let dz = b.z - a.z;
          let dist = Math.hypot(dx, dz);
          const min = (a.r + b.r) * 0.98;
          if (dist >= min) continue;
          if (dist < 0.001) { dx = 1; dz = 0; dist = 1; }
          const push = (min - dist) / dist;
          if (a.pin && b.pin) continue;
          if (a.pin) {
            b.x += dx * push;
            b.z += dz * push;
          } else if (b.pin) {
            a.x -= dx * push;
            a.z -= dz * push;
          } else {
            a.x -= dx * push * 0.5;
            a.z -= dz * push * 0.5;
            b.x += dx * push * 0.5;
            b.z += dz * push * 0.5;
          }
        }
      }
    }
  }

  function nudge(id, nx, nz) {
    const actor = actors.get(id);
    if (!actor) return;
    const now = performance.now();
    const jelly = actor.userData.jelly || { s: 0, v: 0, nx: 0, nz: 1, cool: 0 };
    if (now < jelly.cool) return;
    const len = Math.hypot(nx, nz) || 1;
    jelly.s = 0.22;
    jelly.v = 0;
    jelly.nx = nx / len;
    jelly.nz = nz / len;
    jelly.cool = now + 480;
    actor.userData.jelly = jelly;
  }

  function syncActors(state, time, dt) {
    const keep = new Set();
    if (state.map?.lala) {
      const lala = state.map.lala;
      const actor = ensureActor("lala", LALA_LOOK, true);
      keep.add("lala");
      actor.position.set(lala.x, 0, lala.y);
      const gaze = lalaHeading(lala, state.me, state.map.talk);
      if (!Number.isFinite(actor.userData.heading)) actor.userData.heading = lalaHeading(lala, null, state.map.talk);
      animateActor(actor, false, time, gaze, false, dt, gaze);
      const line = state.lalaBubble;
      const lalaLine = line && line.until > performance.now() ? line.text : "";
      actor.userData.label = { title: lala.name || "Lala 小姐", subtitle: lala.title || "櫃檯", bubble: lalaLine };
    }
    const people = [];
    if (state.me) people.push({ ...state.me, moving: Boolean(state.walking) });
    for (const other of state.others?.values?.() || []) {
      const moving = Math.hypot((other.tx ?? other.x) - other.x, (other.ty ?? other.y) - other.y) > 1.5;
      people.push({ ...other, moving });
    }
    const bodies = [];
    if (state.map?.lala) {
      const lalaActor = actors.get("lala");
      if (lalaActor) bodies.push({ actor: lalaActor, x: lalaActor.position.x, z: lalaActor.position.z, r: bodyRadius(LALA_LOOK), pin: true });
    }
    for (const person of people) {
      const actor = ensureActor(person.id, person.look || FALLBACK_LOOK);
      keep.add(person.id);
      const prevX = actor.userData.px ?? person.x;
      const prevZ = actor.userData.pz ?? person.y;
      const dx = person.x - prevX;
      const dz = person.y - prevZ;
      const stepped = Math.abs(dx) > 0.01 || Math.abs(dz) > 0.01;
      const mine = person.id === state.me?.id;
      const walking = Boolean(person.moving) && !person.seat;
      actor.userData.px = person.x;
      actor.userData.pz = person.y;
      actor.userData.sitting = Boolean(person.seat);
      let moveFace = Number.isFinite(person.face) ? person.face : (actor.userData.face ?? (person.dir === -1 ? Math.PI : 0));
      let gaze = null;
      let gazeRate = 3.4;
      if (mine) {
        if (!world.faceReady) {
          world.face = Number.isFinite(person.face) ? person.face : moveFace;
          world.faceReady = true;
          if (!Number.isFinite(actor.userData.heading)) actor.userData.heading = world.face;
        }
        const moving = Boolean(person.moving);
        world.walking = moving;
        if (moving && stepped) {
          moveFace = Math.atan2(dx, dz);
          world.face = moveFace;
        } else if (moving) {
          moveFace = world.face;
        } else if (world.mode !== "follow") {
          // Top-down view: keep the last walking direction instead of turning with the camera.
          gaze = world.face;
          gazeRate = 12;
          moveFace = world.face;
        } else if (Number.isFinite(world.heading)) {
          const turn = !person.seat && actor.userData.tasting ? 0 : Math.PI;
          moveFace = Math.atan2(Math.sin(world.heading + turn), Math.cos(world.heading + turn));
          gaze = moveFace;
          world.face = moveFace;
        } else {
          moveFace = Number.isFinite(actor.userData.heading) ? actor.userData.heading : world.face;
        }
        world.gazeAim = moveFace;
      } else if (walking && Number.isFinite(person.face)) {
        moveFace = person.face;
      } else if (walking && stepped) {
        moveFace = Math.atan2(dx, dz);
        actor.userData.face = moveFace;
      } else if (!walking && Number.isFinite(person.face)) {
        moveFace = person.face;
        gaze = person.face;
      }
      // Furniture rot is the facing yaw. 0 looks +Z (south). Sofas use this same yaw.
      if (person.seat) {
        const chair = (state.furniture || []).find((item) => item.id === person.seat);
        if (chair) {
          const deg = ((Number(chair.rot) || 0) % 360 + 360) % 360;
          const facing = (deg * Math.PI) / 180;
          moveFace = facing;
          gaze = null;
          if (mine) {
            world.face = facing;
            world.gazeAim = facing;
          }
        }
      }
      const stride = actor.userData.stride ?? 0;
      actor.userData.stride = stride + ((person.moving && !person.seat ? 1 : 0) - stride) * (1 - Math.exp(-12 * Math.max(0.001, dt)));
      const hop = person.seat ? 11 : Math.abs(Math.sin(time * 11)) * 3.5 * actor.userData.stride;
      const radius = bodyRadius(person.look);
      const pinned = person.id === state.me?.id;
      let rx = pinned ? person.x : (actor.userData.rx ?? person.x);
      let rz = pinned ? person.y : (actor.userData.rz ?? person.y);
      if (!pinned) {
        const follow = 1 - Math.exp(-10 * Math.max(0.001, dt));
        rx += (person.x - rx) * follow;
        rz += (person.y - rz) * follow;
      }
      actor.userData.rx = rx;
      actor.userData.rz = rz;
      bodies.push({ actor, x: rx, z: rz, r: radius, pin: pinned, hop });
      const bubble = visibleBubble(state, person.id);
      const glide = Boolean(person.seat) && Boolean(person.moving);
      animateActor(actor, (walking || glide) && gaze == null, time + (person.id || "").length, moveFace, Boolean(bubble.text), dt, gaze, gazeRate);
      if (mine) world.shown = actor.userData.heading;
      actor.userData.label = { title: person.displayName || person.id, subtitle: `@${person.id}`, bubble };
    }
    separateBodies(bodies);
    for (const body of bodies) {
      if (!body.hop && body.hop !== 0) continue;
      body.actor.position.set(body.x, body.hop, body.z);
      // Keep the contact blob on the floor while the body hops, shrinking a
      // touch at the top of each step. Seated actors keep it on the seat.
      const blob = body.actor.userData.shadow;
      if (blob) {
        const air = body.actor.userData.sitting ? 0 : body.hop;
        blob.position.y = SHADOW_Y - air / CREATURE;
        blob.scale.setScalar(1 - Math.min(0.2, air * 0.05));
      }
      body.actor.userData.rx = body.x;
      body.actor.userData.rz = body.z;
    }
    for (const [id, actor] of actors) {
      if (!keep.has(id)) {
        actorGroup.remove(actor);
        actors.delete(id);
        const floater = floaters.get(id);
        if (floater) {
          floater.remove();
          floaters.delete(id);
        }
      }
    }
    syncAuras(state);
  }

  function auraGeometries() {
    if (!auraDisc) {
      auraDisc = new THREE.CircleGeometry(22, 40);
      auraRing = new THREE.RingGeometry(16, 24, 40);
    }
    return { auraDisc, auraRing };
  }

  function syncAuras(state) {
    const want = new Set();
    const memberGroup = state.memberGroup;
    if (memberGroup) {
      for (const [id, group] of memberGroup) {
        const actor = actors.get(id);
        if (!actor) continue;
        want.add(id);
        let aura = auras.get(id);
        if (!aura) {
          const geos = auraGeometries();
          aura = new THREE.Group();
          const disc = new THREE.Mesh(geos.auraDisc, new THREE.MeshBasicMaterial({
            color: 0xe3c8fb,
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
            side: THREE.DoubleSide,
          }));
          const ring = new THREE.Mesh(geos.auraRing, new THREE.MeshBasicMaterial({
            color: 0xc084fc,
            transparent: true,
            opacity: 0.62,
            depthWrite: false,
            side: THREE.DoubleSide,
          }));
          disc.rotation.x = -Math.PI / 2;
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = 0.35;
          aura.add(disc, ring);
          actorGroup.add(aura);
          auras.set(id, aura);
        }
        if (aura.userData.group !== group) {
          aura.userData.group = group;
          let hash = 0;
          for (const char of group) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
          const hue = 0.72 + (hash % 18) / 180;
          aura.children[0].material.color.setHSL(hue, 0.55, 0.78);
          aura.children[1].material.color.setHSL(hue, 0.6, 0.62);
        }
        aura.position.set(actor.position.x, 1.2, actor.position.z);
      }
    }
    for (const [id, aura] of auras) {
      if (want.has(id)) continue;
      actorGroup.remove(aura);
      for (const child of aura.children) child.material.dispose();
      auras.delete(id);
    }
  }

  return {
    animateActor,
    frameToys,
    nudge,
    setSnackHook,
    setToyHook,
    signature,
    syncActors,
  };
}
