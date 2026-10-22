import * as THREE from "./vendor/three.module.js";

// Office characters: body, ears, tail, accessories, painted face and the
// per-frame body pose. Scene helpers (materials, geometry cache) come from
// the world so characters share them with the room.

export const CREATURE = 2.35;
const BODY_R = 11.2;
const BODY_STRETCH = 1.3;
const BODY_CENTER = 17.6;
const FACE_LIFT = 9.06;
const BODY_SHAPES = {
  mochi: { id: "mochi", radius: 11.5, stretch: 1.22, top: 0.86, bottom: 1.18, center: 17.2 },
  bean: { id: "bean", radius: 11.1, stretch: 1.26, top: 0.9, bottom: 1.16, center: 17.4 },
  pear: { id: "pear", radius: 10.7, stretch: 1.34, top: 0.72, bottom: 1.28, center: 17.0 },
  wide: { id: "wide", radius: 12.5, stretch: 1.08, top: 1.02, bottom: 1.26, center: 15.8 },
};
const FOOT_Y = 1.4;
const FOOT_Z = 1.6;
export const SHADOW_Y = 0.55;
const ARM_Z = 0.5;
// Arms hang from a shoulder pivot this far above the hand.
const ARM_DROP = 4.5;
const FACE_W = 16.2;
const FACE_H = 10.6;


function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function cssColor(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const hex = value.trim().replace("#", "");
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return Number.parseInt(hex, 16);
  }
  return fallback;
}

export function createAvatars({ mat, geo, addMesh, smoothSphere, blobTexture }) {
  function mochiGeometry(spec) {
    return geo(`mochi|${spec.id}`, () => {
      const geometry = new THREE.SphereGeometry(spec.radius, 64, 48);
      const attr = geometry.attributes.position;
      for (let i = 0; i < attr.count; i++) {
        const p = deformMochi(spec, attr.getX(i), attr.getY(i), attr.getZ(i));
        attr.setXYZ(i, p.x, p.y, p.z);
      }
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      return geometry;
    });
  }

  function creatureMat(color) {
    return mat(color, { skin: true });
  }

  function faceShell(metrics) {
    const spec = metrics.spec;
    return geo(`faceShell|${spec.id}`, () => {
      const geometry = new THREE.PlaneGeometry(FACE_W, FACE_H, 22, 18);
      const attr = geometry.attributes.position;
      const tilt = 0.42;
      const cy = Math.cos(tilt);
      const sy = Math.sin(tilt);
      for (let i = 0; i < attr.count; i++) {
        const x = attr.getX(i);
        const y = attr.getY(i) + metrics.faceLift;
        const p = projectToMochi(spec, x, y);
        const ny = p.ny * cy + p.nz * sy;
        const nz = -p.ny * sy + p.nz * cy;
        const lift = 0.46;
        attr.setXYZ(i, p.x + p.nx * lift, p.y + ny * lift, p.z + nz * lift);
      }
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      return geometry;
    });
  }

  function styleFromLook(look, options = {}) {
    const src = look || {};
    const colors = src.colors || {};
    const body = cssColor(colors.body, 0xf06292);
    return {
      body: options.lala ? 0xff4d88 : body,
      ear: cssColor(colors.ear, body),
      inner: cssColor(colors.inner, 0xd81b60),
      tip: cssColor(colors.tip, 0x4a1c0c),
      tailColor: cssColor(colors.tail, body),
      blushColor: cssColor(colors.blush, 0xf4a0b5),
      // Older looks only carry one shared accessory color.
      headColor: cssColor(colors.head || colors.accessory, 0xf3eee3),
      neckColor: cssColor(colors.neck || colors.accessory, 0xf3eee3),
      heldColor: cssColor(colors.held || colors.accessory, 0xf3eee3),
      earKind: src.ears || "point",
      tail: src.tail || "none",
      eyes: src.eyes || "dot",
      mouth: src.mouth || "smile",
      blush: src.blush || "oval",
      marking: src.marking || "none",
      beak: src.mouth === "beak",
      bodyShape: src.body || "bean",
      head: options.lala ? "ribbon" : (src.head || "none"),
      faceAcc: src.face || "none",
      neck: src.neck || "none",
      held: src.held || "none",
    };
  }

  function creature(look, options = {}) {
    const style = styleFromLook(look, options);
    const metrics = bodyMetrics(style.bodyShape);
    const spec = metrics.spec;
    const rootGroup = new THREE.Group();
    const rig = new THREE.Group();
    rootGroup.add(rig);
    const bodyGeo = mochiGeometry(spec);
    addMesh(rig, bodyGeo, creatureMat(style.body), 0, spec.center, 0, { cast: true });
    const footMat = creatureMat(style.body);
    const footL = addMesh(rig, smoothSphere(2.5), footMat, -4.6 * metrics.spread, FOOT_Y, FOOT_Z, { sx: 1.35, sy: 0.32, sz: 1.05, cast: true });
    const footR = addMesh(rig, smoothSphere(2.5), footMat, 4.6 * metrics.spread, FOOT_Y, FOOT_Z, { sx: 1.35, sy: 0.32, sz: 1.05, cast: true });
    const armMat = creatureMat(style.body);
    const armY = style.beak ? 16.2 + metrics.shift * 0.35 : spec.center - 1.5 + metrics.shift * 0.2;
    const armX = spec.radius * (spec.bottom || 1) * 0.92;
    const hand = style.beak ? { sx: 1.15, sy: 0.52, sz: 0.68 } : { sx: 0.95, sy: 0.72, sz: 0.78 };
    const shoulderL = new THREE.Group();
    const shoulderR = new THREE.Group();
    shoulderL.position.set(-armX, armY + ARM_DROP, ARM_Z);
    shoulderR.position.set(armX, armY + ARM_DROP, ARM_Z);
    rig.add(shoulderL, shoulderR);
    // userData.armL/armR stay the hand meshes: snacks and toys move them and hang props on them.
    const armL = addMesh(shoulderL, smoothSphere(1.9), armMat, 0, -ARM_DROP, 0, hand);
    const armR = addMesh(shoulderR, smoothSphere(1.9), armMat, 0, -ARM_DROP, 0, hand);
    const face = makeFace(style, metrics);
    rig.add(face.mesh);
    addEars(rig, style, metrics);
    addTail(rig, style, metrics);
    addAccessories(rig, style, metrics);
    // Held mug and balloon ride the right arm's swing.
    for (const node of rig.children.filter((child) => child.userData.held || child.userData.pocket)) {
      node.position.sub(shoulderR.position);
      shoulderR.add(node);
    }
    const shadow = new THREE.Mesh(
      geo("shadow", () => new THREE.CircleGeometry(14, 24)),
      mat(0x4a3f58, { basic: true, transparent: true, opacity: 0.4, depthWrite: false, map: blobTexture, mapName: "shadow" }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = SHADOW_Y;
    shadow.renderOrder = 1;
    rootGroup.add(shadow);
    rootGroup.scale.setScalar(CREATURE);
    rootGroup.userData.rig = rig;
    rootGroup.userData.footL = footL;
    rootGroup.userData.footR = footR;
    rootGroup.userData.armL = armL;
    rootGroup.userData.armR = armR;
    rootGroup.userData.shoulderL = shoulderL;
    rootGroup.userData.shoulderR = shoulderR;
    rootGroup.userData.decal = face;
    rootGroup.userData.shadow = shadow;
    paintFace(face, false, false);
    rootGroup.traverse((node) => {
      if (node.isMesh) node.frustumCulled = false;
    });
    return rootGroup;
  }

  function makeFace(style, metrics) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const mesh = new THREE.Mesh(faceShell(metrics), material);
    mesh.position.set(0, metrics.spec.center, 0);
    mesh.renderOrder = 3;
    return { mesh, ctx, texture, style, blink: false, talking: false };
  }

  function paintFace(face, blink, talking) {
    if (face.blink === blink && face.talking === talking && face.ready) return;
    face.blink = blink;
    face.talking = talking;
    face.ready = true;
    const ctx = face.ctx;
    const style = face.style;
    ctx.clearRect(0, 0, 256, 256);
    const eyeY = style.mouth === "wide" ? 104 : 112;
    const eyes = [88, 168];
    const blush = hexCss(style.blushColor);
    if (style.blush === "oval") {
      ctx.fillStyle = blush;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.ellipse(46, eyeY + 4, 15, 11, -0.2, 0, Math.PI * 2);
      ctx.ellipse(210, eyeY + 4, 15, 11, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (style.blush === "round") {
      ctx.fillStyle = blush;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(48, eyeY + 6, 12, 0, Math.PI * 2);
      ctx.arc(208, eyeY + 6, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (style.blush === "lines") {
      ctx.strokeStyle = blush;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      for (const x of [40, 210]) {
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(x - 10, eyeY + i * 7);
          ctx.lineTo(x + 12, eyeY + 4 + i * 7);
          ctx.stroke();
        }
      }
    }
    if (style.marking === "panda") {
      ctx.fillStyle = "#1a1a22";
      for (const x of eyes) {
        ctx.beginPath();
        ctx.ellipse(x, eyeY + 2, 30, 26, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (style.marking === "freckles") {
      ctx.fillStyle = "#c47a5a";
      for (const [x, y] of [[58, eyeY + 16], [70, eyeY + 24], [186, eyeY + 16], [198, eyeY + 24]]) {
        ctx.beginPath();
        ctx.arc(x, y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (style.marking === "spot") {
      ctx.fillStyle = "#5c4038";
      ctx.beginPath();
      ctx.ellipse(128, eyeY - 36, 8, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const rx = style.mouth === "wide" ? 22 : style.eyes === "highlight" ? 15 : 13;
    const ry = style.mouth === "wide" ? 22 : 18;
    ctx.fillStyle = "#1a1214";
    ctx.strokeStyle = "#1a1214";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    for (const x of eyes) {
      if (blink || style.eyes === "line" || style.eyes === "sleepy") {
        ctx.beginPath();
        ctx.moveTo(x - rx, eyeY);
        ctx.quadraticCurveTo(x, eyeY + (style.eyes === "sleepy" ? 8 : 2), x + rx, eyeY);
        ctx.stroke();
      } else if (style.eyes === "happy") {
        ctx.beginPath();
        ctx.moveTo(x - rx, eyeY + 6);
        ctx.quadraticCurveTo(x, eyeY - 16, x + rx, eyeY + 6);
        ctx.stroke();
      } else if (style.eyes === "sparkle") {
        ctx.beginPath();
        ctx.moveTo(x, eyeY - ry);
        ctx.lineTo(x + 6, eyeY);
        ctx.lineTo(x, eyeY + ry);
        ctx.lineTo(x - 6, eyeY);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.ellipse(x, eyeY, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const mouthY = eyeY + 46;
    ctx.strokeStyle = "#5c4038";
    ctx.fillStyle = "#5c4038";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (talking && style.mouth !== "none" && style.mouth !== "beak") {
      ctx.ellipse(128, mouthY + 2, 9, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (style.mouth === "beak") {
      ctx.fillStyle = "#f0a050";
      ctx.moveTo(128, mouthY - 6);
      ctx.lineTo(114, mouthY + 10);
      ctx.lineTo(142, mouthY + 10);
      ctx.closePath();
      ctx.fill();
    } else if (style.mouth === "wide") {
      ctx.moveTo(104, mouthY);
      ctx.quadraticCurveTo(128, mouthY + 18, 152, mouthY);
      ctx.stroke();
    } else if (style.mouth === "smile") {
      ctx.moveTo(118, mouthY + 1);
      ctx.quadraticCurveTo(128, mouthY + 8, 138, mouthY + 1);
      ctx.stroke();
    } else if (style.mouth === "o") {
      ctx.ellipse(128, mouthY + 4, 8, 9, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (style.mouth === "cat") {
      ctx.moveTo(108, mouthY + 2);
      ctx.quadraticCurveTo(118, mouthY + 12, 128, mouthY);
      ctx.quadraticCurveTo(138, mouthY + 12, 148, mouthY + 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(112, mouthY + 8);
      ctx.lineTo(118, mouthY + 16);
      ctx.moveTo(144, mouthY + 8);
      ctx.lineTo(138, mouthY + 16);
      ctx.stroke();
    } else if (style.mouth === "omega") {
      ctx.moveTo(112, mouthY);
      ctx.quadraticCurveTo(120, mouthY + 11, 128, mouthY + 1);
      ctx.quadraticCurveTo(136, mouthY + 11, 144, mouthY);
      ctx.stroke();
    }
    face.texture.needsUpdate = true;
  }

  // A flat leaf: wide root (buried in the head), widest at `mid`, then a tip
  // that is pointed at tip=0 and round at tip=1. `lift` moves the outline up
  // so an inner patch can share the outer ear's bend.
  function earGeometry(o) {
    return geo(`ear|${JSON.stringify(o)}`, () => {
      const { w, h, base, mid, tip, sink = 0, lift = 0, depth, bevel, bend = 0, span = h } = o;
      const hw = w / 2;
      const hb = base / 2;
      const m = h * mid;
      const y = (v) => v + lift;
      const shape = new THREE.Shape();
      shape.moveTo(-hb, y(-sink));
      shape.bezierCurveTo(-hb, y(m * 0.35), -hw, y(m * 0.55), -hw, y(m));
      shape.bezierCurveTo(-hw, y(m + (h - m) * 0.62), -hw * tip * 0.62, y(h), 0, y(h));
      shape.bezierCurveTo(hw * tip * 0.62, y(h), hw, y(m + (h - m) * 0.62), hw, y(m));
      shape.bezierCurveTo(hw, y(m * 0.55), hb, y(m * 0.35), hb, y(-sink));
      shape.lineTo(-hb, y(-sink));
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: Math.min(bevel, w * 0.12),
        bevelSegments: 3,
        curveSegments: 14,
      });
      geometry.translate(0, 0, -depth / 2);
      const attr = geometry.attributes.position;
      const colors = o.tipColor == null ? null : new Float32Array(attr.count * 3);
      const low = new THREE.Color(o.color ?? 0xffffff);
      const high = new THREE.Color(o.tipColor ?? 0xffffff);
      const mixed = new THREE.Color();
      for (let i = 0; i < attr.count; i++) {
        const t = clamp(attr.getY(i) / span, 0, 1);
        // The tip leans forward a little, like a soft leaf.
        attr.setZ(i, attr.getZ(i) + bend * span * t * t);
        if (colors) {
          const k = clamp((t - (o.tipFrom ?? 0.7)) / 0.08, 0, 1);
          mixed.copy(low).lerp(high, k * k * (3 - 2 * k));
          colors[i * 3] = mixed.r;
          colors[i * 3 + 1] = mixed.g;
          colors[i * 3 + 2] = mixed.b;
        }
      }
      if (colors) geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      return geometry;
    });
  }

  // Ears grow out of the head: the root is sunk below the head surface so the
  // two read as one smooth shape.
  function addLeafEars(parent, metrics, style, spec) {
    const { x, z = 0.4 } = spec;
    const top = mochiTop(metrics.spec, x, z);
    const outer = {
      w: spec.w, h: spec.h, base: spec.base, mid: spec.mid, tip: spec.tip,
      sink: spec.sink ?? 3.2, depth: spec.depth ?? 0.7, bevel: spec.bevel ?? 0.55,
      bend: spec.bend ?? 0,
    };
    let earMat = creatureMat(style.ear);
    if (spec.tipColor != null) {
      outer.color = style.ear;
      outer.tipColor = spec.tipColor;
      outer.tipFrom = spec.tipFrom;
      earMat = mat(0xffffff, { skin: true, vertexColors: true });
    }
    const front = outer.depth / 2 + outer.bevel;
    const inner = spec.inner && {
      w: spec.w * spec.inner.w, h: spec.h * spec.inner.h, base: spec.base * spec.inner.w * 0.7,
      mid: spec.mid, tip: spec.tip, lift: spec.inner.lift ?? spec.h * 0.08,
      depth: 0.08, bevel: 0.12, bend: outer.bend, span: spec.h,
    };
    for (const side of [-1, 1]) {
      const ear = new THREE.Group();
      ear.position.set(side * x, top - (spec.embed ?? 0.5), z);
      ear.rotation.order = "YXZ";
      ear.rotation.y = side * (spec.yaw ?? 0.12);
      ear.rotation.x = -(spec.tilt ?? 0.2);
      ear.rotation.z = side * -(spec.splay ?? 0.25);
      parent.add(ear);
      addMesh(ear, earGeometry(outer), earMat, 0, 0, 0);
      // The caps are flat fans, so the bend is only linear across them; sit the
      // patch a little proud of the face so it never sinks behind it.
      if (inner) addMesh(ear, earGeometry(inner), creatureMat(style.inner), 0, 0, front + 0.06);
    }
  }

  // A thick, rounded flap for a puppy: pointed root at the top (buried in the
  // head), widest and roundest near the bottom. It bulges outward as it hangs
  // and curls forward a touch, so from the side it still reads as a soft ear
  // rather than a flat board.
  function floppyEarGeometry() {
    return geo("floppyEar", () => {
      const length = 15.5;
      const width = 8.2;
      const thick = 2.6;
      const geometry = new THREE.SphereGeometry(1, 32, 24);
      const attr = geometry.attributes.position;
      for (let i = 0; i < attr.count; i++) {
        const x = attr.getX(i);
        const y = attr.getY(i);
        const z = attr.getZ(i);
        const t = (1 - y) / 2;
        const grow = 0.5 + 0.5 * Math.sin(Math.min(1, t * 1.25) * Math.PI / 2);
        attr.setXYZ(
          i,
          x * (width / 2) * grow + 1.6 * t * t,
          -t * length,
          z * (thick / 2) * (0.7 + 0.3 * t) + 1.6 * t * t,
        );
      }
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      return geometry;
    });
  }

  function addFloppyEars(parent, metrics, style, x) {
    const z = 1.2;
    const top = mochiTop(metrics.spec, x, z);
    const earMat = creatureMat(style.ear);
    for (const side of [-1, 1]) {
      // Mirror the whole ear for the left side; three flips the winding.
      const mirror = new THREE.Group();
      mirror.scale.x = side;
      parent.add(mirror);
      const ear = new THREE.Group();
      ear.position.set(x, top + 1.4, z);
      ear.rotation.order = "YXZ";
      ear.rotation.y = 0.32;
      ear.rotation.z = 0.26;
      mirror.add(ear);
      addMesh(ear, floppyEarGeometry(), earMat, 0, 0, 0);
    }
  }

  function addEars(parent, style, metrics = { shift: 0, spread: 1 }) {
    const spread = metrics.spread || 1;
    const shift = metrics.shift || 0;
    const px = (x) => x * spread;
    const py = (y) => y + shift;
    if (style.beak) {
      addMesh(parent, geo("beak", () => new THREE.ConeGeometry(1.7, 3.6, 5)), creatureMat(0xf0a050), 0, py(24.4), 11.6, { rotX: -Math.PI / 2 });
    }
    const kind = style.earKind;
    if (kind === "long") {
      // Rabbit: long rounded leaves, a little apart and leaning out.
      addLeafEars(parent, metrics, style, {
        x: px(3.6), w: 5.4, h: 15.5, base: 3.6, mid: 0.42, tip: 0.95,
        splay: 0.2, tilt: 0.14, yaw: 0.1, bend: 0.07, sink: 3.6,
        inner: { w: 0.52, h: 0.8, lift: 1.4 },
      });
    } else if (kind === "point") {
      // Cat: wide-based soft triangles near the edge of the head.
      addLeafEars(parent, metrics, style, {
        x: px(6.0), w: 6.4, h: 6.6, base: 6.6, mid: 0.06, tip: 0.12,
        splay: 0.42, tilt: 0.22, yaw: 0.2, sink: 3.4, embed: 0.7,
        inner: { w: 0.56, h: 0.68, lift: 0.5 },
      });
    } else if (kind === "fox") {
      addLeafEars(parent, metrics, style, {
        x: px(5.8), w: 6.2, h: 8.8, base: 6.4, mid: 0.1, tip: 0.16,
        splay: 0.34, tilt: 0.22, yaw: 0.18, sink: 3.4, embed: 0.7,
        tipColor: style.tip ?? 0xe07a4a, tipFrom: 0.68,
        inner: { w: 0.54, h: 0.6, lift: 0.5 },
      });
    } else if (kind === "flop") {
      addFloppyEars(parent, metrics, style, px(7.4));
    } else if (kind === "round") {
      const panda = style.marking === "panda";
      addLeafEars(parent, metrics, style, {
        x: px(panda ? 6.8 : 7.2), w: panda ? 6.2 : 7.4, h: panda ? 4.8 : 5.6, base: panda ? 4.8 : 5.6, mid: 0.36, tip: 1,
        splay: 0.5, tilt: 0.18, yaw: 0.16, sink: 3, embed: 0.6,
        inner: { w: 0.5, h: 0.55, lift: 0.6 },
      });
    } else if (kind === "nub") {
      addLeafEars(parent, metrics, style, {
        x: px(5.6), w: 4.4, h: 3.0, base: 3.8, mid: 0.3, tip: 1,
        splay: 0.36, tilt: 0.16, yaw: 0.12, sink: 2.6, embed: 0.5,
        inner: { w: 0.48, h: 0.5, lift: 0.4 },
      });
    }
  }

  function addTail(parent, style, metrics = { shift: 0, spread: 1 }) {
    const spread = metrics.spread || 1;
    const shift = metrics.shift || 0;
    const color = creatureMat(style.tailColor);
    if (style.tail === "bush") {
      addMesh(parent, smoothSphere(4.8, 28, 22), color, 11.2 * spread, 14.8 + shift * 0.4, -6.4);
      addMesh(parent, smoothSphere(4.1, 24, 18), color, 15.0 * spread, 20.2 + shift * 0.45, -1.2);
      addMesh(parent, smoothSphere(3.15, 20, 16), creatureMat(0xfffdf8), 17.4 * spread, 26.4 + shift * 0.5, 2.4);
    } else if (style.tail === "thin") {
      addMesh(parent, smoothSphere(2.1, 18, 14), color, -6.2 * spread, 14.2 + shift * 0.3, -11.4, { sx: 0.7, sy: 0.7, sz: 1.8 });
    } else if (style.tail === "curl") {
      addMesh(parent, smoothSphere(3.3, 28, 22), color, -3.4 * spread, 13.2 + shift * 0.3, -12.6);
    } else if (style.tail === "puff" || style.tail === "nub") {
      const radius = style.tail === "puff" ? 3.5 : 2.4;
      addMesh(parent, smoothSphere(radius, 24, 18), color, 0, 12.4 + shift * 0.25, -13.0);
    }
  }

  function addAccessories(parent, style, metrics = { shift: 0 }) {
    const hat = style.head;
    const glasses = style.faceAcc;
    const extra = style.neck;
    const shift = metrics.shift || 0;
    const hy = (y) => y + shift;
    const dye = creatureMat(style.headColor);
    const neckDye = creatureMat(style.neckColor);
    if (hat === "beanie") addMesh(parent, smoothSphere(7.2, 28, 22), dye, 0, hy(33.6), 0.6, { sy: 0.58 });
    if (hat === "ribbon") {
      addMesh(parent, smoothSphere(3.2, 16, 12), dye, -4.4, hy(34.6), 1.4, { sx: 1.55, sy: 0.7, sz: 0.46, rotZ: 0.35 });
      addMesh(parent, smoothSphere(3.2, 16, 12), dye, 4.4, hy(34.6), 1.4, { sx: 1.55, sy: 0.7, sz: 0.46, rotZ: -0.35 });
      addMesh(parent, smoothSphere(1.35, 12, 10), creatureMat(0xffe08a), 0, hy(34.4), 2.2);
    }
    if (hat === "beret") {
      addMesh(parent, smoothSphere(6.4, 22, 16), dye, 1.2, hy(33.4), 0.8, { sy: 0.38, rotZ: -0.35 });
      addMesh(parent, smoothSphere(0.7, 10, 8), dye, 3.4, hy(35.2), 1.2);
    }
    if (hat === "sprout") {
      addMesh(parent, geo("sproutStem", () => new THREE.CylinderGeometry(0.45, 0.55, 4.2, 8)), dye, 0, hy(34.2), 0.6);
      addMesh(parent, smoothSphere(2.1, 12, 10), dye, -1.5, hy(36.4), 0.8, { sx: 1.3, sy: 0.55, sz: 0.4, rotZ: 0.7 });
      addMesh(parent, smoothSphere(1.8, 12, 10), dye, 1.6, hy(36.6), 0.8, { sx: 1.2, sy: 0.5, sz: 0.38, rotZ: -0.6 });
    }
    if (hat === "flower") {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        addMesh(parent, smoothSphere(1.9, 14, 12), dye, Math.cos(a) * 3.0, hy(34.6) + Math.sin(a) * 1.3, 2.6);
      }
      addMesh(parent, smoothSphere(1.35, 12, 10), creatureMat(0xffe08a), 0, hy(34.6), 3.2);
    }
    if (hat === "crown") {
      addMesh(parent, geo("crownBand", () => new THREE.TorusGeometry(6.0, 0.6, 8, 20)), dye, 0, hy(34.2), 0.4, { rotX: Math.PI / 2 });
      addMesh(parent, geo("crownTip", () => new THREE.SphereGeometry(1.3, 16, 12)), dye, 0, hy(36.8), 0.6);
      addMesh(parent, geo("crownSide", () => new THREE.SphereGeometry(1.05, 14, 12)), dye, -3.8, hy(35.6), 0.5);
      addMesh(parent, geo("crownSide", () => new THREE.SphereGeometry(1.05, 14, 12)), dye, 3.8, hy(35.6), 0.5);
    }
    if (glasses === "round" || glasses === "sun") {
      const lens = glasses === "sun" ? mat(0x3a3550, { transparent: true, opacity: 0.72, mapName: "sun" }) : mat(0xfff6ea, { transparent: true, opacity: 0.18, mapName: "lens" });
      // Frames stay dark so glasses still read on pale faces; they do not follow any accessory color.
      const ring = mat(0x8a6248, { mapName: "ring" });
      addMesh(parent, geo("lens", () => new THREE.TorusGeometry(1.7, 0.14, 8, 24)), ring, -2.7, hy(27.6), 9.15);
      addMesh(parent, geo("lens", () => new THREE.TorusGeometry(1.7, 0.14, 8, 24)), ring, 2.7, hy(27.6), 9.15);
      addMesh(parent, geo("bridge", () => new THREE.CylinderGeometry(0.1, 0.1, 1.7, 8)), ring, 0, hy(27.75), 9.1, { rotZ: Math.PI / 2 });
      addMesh(parent, geo("lensFill", () => new THREE.CircleGeometry(1.45, 22)), lens, -2.7, hy(27.6), 9.3);
      addMesh(parent, geo("lensFill", () => new THREE.CircleGeometry(1.45, 22)), lens, 2.7, hy(27.6), 9.3);
    }
    if (extra === "scarf") addScarf(parent, neckDye, metrics);
    if (extra === "bowtie") {
      const spec = metrics.spec;
      const y = 14.6 + shift * 0.35 - spec.center;
      onBody(parent, spec, smoothSphere(2.0, 14, 12), neckDye, -2.5, y, 0.5, { sx: 1.4, sy: 0.72, sz: 0.38 });
      onBody(parent, spec, smoothSphere(2.0, 14, 12), neckDye, 2.5, y, 0.5, { sx: 1.4, sy: 0.72, sz: 0.38 });
      onBody(parent, spec, smoothSphere(1.0, 12, 10), neckDye, 0, y, 0.6, { sz: 0.7 });
    }
    if (hat === "headphones") {
      addMesh(parent, geo("band", () => new THREE.TorusGeometry(8.6, 0.5, 8, 24)), mat(0x6a4a68), 0, hy(31.5), 0.2, { rotX: Math.PI / 2 });
      addMesh(parent, geo("earcup", () => new THREE.CylinderGeometry(2.4, 2.4, 1.7, 16)), dye, -13.2, hy(22.5), 0.4, { rotZ: Math.PI / 2 });
      addMesh(parent, geo("earcup", () => new THREE.CylinderGeometry(2.4, 2.4, 1.7, 16)), dye, 13.2, hy(22.5), 0.4, { rotZ: Math.PI / 2 });
    }
    if (style.held === "mug") {
      parent.add(makeMug(metrics, style.heldColor));
    } else if (style.held === "balloon") {
      const pocket = new THREE.Group();
      pocket.userData.pocket = true;
      addMesh(pocket, geo("string", () => new THREE.CylinderGeometry(0.08, 0.08, 10, 6)), mat(0x6a4a68), 11.5, 22, 4);
      addMesh(pocket, smoothSphere(3.2, 16, 12), creatureMat(style.heldColor), 11.5, 29.5, 4);
      parent.add(pocket);
    }
  }

  // Sits a mesh on the front of the body at (x, y) from the body center,
  // pushed out along the surface normal and tilted to lie flat on it.
  function onBody(parent, spec, geometry, material, x, y, out, opts = {}) {
    const p = projectToMochi(spec, x, y);
    return addMesh(parent, geometry, material, p.x + p.nx * out, spec.center + p.y + p.ny * out, p.z + p.nz * out, {
      ...opts,
      rotX: (opts.rotX || 0) + Math.atan2(-p.ny, p.nz),
      rotY: (opts.rotY || 0) + Math.atan2(p.nx, p.nz),
    });
  }

  // A ring hugging the body just under the face, sized from the body's real
  // width at that height, with one short end hanging down the front.
  function addScarf(parent, material, metrics) {
    const spec = metrics.spec;
    const lift = metrics.faceLift - FACE_H / 2 - 0.3;
    const y = lift / spec.stretch;
    const radius = mochiWiden(spec, y) * Math.sqrt(spec.radius * spec.radius - y * y);
    const tube = 1.15;
    const ring = geo(`scarf|${spec.id}`, () => new THREE.TorusGeometry(radius + tube * 0.2, tube, 12, 48));
    // The body is 2% shallower front to back than side to side.
    addMesh(parent, ring, material, 0, spec.center + lift, 0, { rotX: Math.PI / 2, sy: 0.98 });
    onBody(parent, spec, smoothSphere(1.4, 16, 12), material, 3.6, lift - 0.5, tube * 0.8, { sz: 0.7 });
    const end = geo("scarfEnd", () => new THREE.CapsuleGeometry(1.1, 2.6, 4, 12));
    onBody(parent, spec, end, material, 3.9, lift - 3.2, 0.6, { sz: 0.5, rotZ: -0.08 });
  }

  // Held mug. Body and handle follow the held-item color (missing means
  // #F3EEE3 warm ivory). Toon steps keep that ivory apart from the pale floor
  // and pale characters. The band stays a quiet blush. Coffee and steam stay.
  function makeMug(metrics, bodyColor) {
    const spec = metrics.spec;
    const mug = new THREE.Group();
    const body = creatureMat(bodyColor);
    addMesh(mug, geo("mugBody", () => new THREE.CylinderGeometry(2.7, 2.45, 5.0, 24)), body, 0, 0, 0);
    addMesh(mug, geo("mugBand", () => new THREE.CylinderGeometry(2.78, 2.68, 1.2, 24, 1, true)), creatureMat(0xd9a8a4), 0, 0.4, 0);
    addMesh(mug, geo("mugCoffee", () => new THREE.CircleGeometry(2.25, 24)), creatureMat(0x8a5638), 0, 2.36, 0, { rotX: -Math.PI / 2 });
    addMesh(mug, geo("mugHandle", () => new THREE.TorusGeometry(1.35, 0.5, 10, 20)), body, 2.9, 0.1, 0);
    const steam = mat(0xffffff, { basic: true, transparent: true, opacity: 0.75, depthWrite: false, mapName: "steam" });
    const wisp = geo("mugSteam", () => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.7, 1.2, 0),
        new THREE.Vector3(-0.5, 2.4, 0),
        new THREE.Vector3(0.4, 3.6, 0),
      ]);
      return new THREE.TubeGeometry(curve, 20, 0.32, 8, false);
    });
    addMesh(mug, wisp, steam, -0.8, 3.0, 0);
    addMesh(mug, wisp, steam, 0.9, 3.4, 0.2, { sx: 0.8, sy: 0.8, sz: 0.8 });
    const armX = spec.radius * (spec.bottom || 1) * 0.92;
    mug.position.set(armX + 0.6, spec.center - 0.6 + metrics.shift * 0.2, 5.2);
    mug.rotation.y = -0.5;
    mug.userData.held = true;
    return mug;
  }

  function stepJelly(actor, dt) {
    const jelly = actor.userData.jelly;
    if (!jelly) return { sx: 0, sy: 0, sz: 0 };
    if (Math.abs(jelly.s) < 0.001 && Math.abs(jelly.v) < 0.01) return { sx: 0, sy: 0, sz: 0 };
    jelly.v += (-42 * jelly.s - 8.5 * jelly.v) * dt;
    jelly.s += jelly.v * dt;
    const ry = actor.userData.heading || 0;
    const lx = jelly.nx * Math.cos(ry) - jelly.nz * Math.sin(ry);
    const lz = jelly.nx * Math.sin(ry) + jelly.nz * Math.cos(ry);
    const s = jelly.s;
    return {
      sx: -s * lx * lx + s * 0.42 * (1 - lx * lx),
      sy: s * 0.5,
      sz: -s * lz * lz + s * 0.42 * (1 - lz * lz),
    };
  }

  function poseBody(actor, moving, time, dt) {
    const rig = actor.userData.rig;
    const sitting = Boolean(actor.userData.sitting);
    const wave = Math.sin(time * (moving && !sitting ? 11 : 2.4));
    const squash = sitting ? 0 : moving ? Math.max(0, Math.sin(time * 11)) * 0.14 : wave * 0.035;
    const jelly = stepJelly(actor, dt);
    // Idle breathing keeps volume: stretch up, slim in.
    const breathe = moving ? 0 : 1 / Math.sqrt(1 - squash) - 1;
    let sx = 1 + (moving ? squash * 0.65 : breathe) + jelly.sx;
    let sy = 1 - squash + jelly.sy;
    let sz = 1 + (moving ? squash * 0.45 : breathe) + jelly.sz;
    if (sitting) {
      sx *= 1.08;
      sy *= 0.74;
      sz *= 1.05;
    }
    rig.scale.set(sx, sy, sz);
    rig.rotation.x = sitting ? 0.08 : moving ? 0.14 : 0;
    if (sitting) {
      const dangle = Math.sin(time * 3);
      actor.userData.footL.position.y = -2.6;
      actor.userData.footR.position.y = -2.6;
      actor.userData.footL.position.z = 4.6 + dangle * 0.7;
      actor.userData.footR.position.z = 4.6 + Math.sin(time * 3 + 1.1) * 0.7;
    } else {
      actor.userData.footL.position.y = FOOT_Y;
      actor.userData.footR.position.y = FOOT_Y;
      actor.userData.footL.position.z = FOOT_Z + (moving ? Math.sin(time * 11) * 2.2 : 0);
      actor.userData.footR.position.z = FOOT_Z + (moving ? Math.sin(time * 11 + Math.PI) * 2.2 : 0);
    }
    if (actor.userData.shoulderL) {
      // Pendulum from the shoulder: opposite arms while walking, a slow sway at rest.
      const swing = sitting ? 0 : moving ? Math.sin(time * 11) * 0.5 : Math.sin(time * 2.4) * 0.05;
      const sway = sitting || moving ? 0 : Math.sin(time * 2.4 + 0.8) * 0.04;
      actor.userData.shoulderL.rotation.set(-swing, 0, -sway);
      actor.userData.shoulderR.rotation.set(moving ? swing : -swing, 0, sway);
      // Hands rest at the end of the arm; snack and toy poses offset them after this.
      actor.userData.armL.position.z = 0;
      actor.userData.armR.position.z = 0;
    }
    return sitting;
  }

  return { creature, paintFace, poseBody };
}

function bodySpec(id) {
  return BODY_SHAPES[id] || BODY_SHAPES.bean;
}

function bodyMetrics(id) {
  const spec = bodySpec(id);
  const half = spec.radius * spec.stretch;
  const topY = spec.center + half;
  const beanTop = BODY_CENTER + BODY_R * BODY_STRETCH;
  return {
    spec,
    half,
    topY,
    shift: topY - beanTop,
    spread: spec.radius / BODY_R,
    faceLift: FACE_LIFT * (half / (BODY_R * BODY_STRETCH)),
  };
}

function mochiWiden(spec, y) {
  const ny = Math.max(0, Math.min(1, y / spec.radius * 0.5 + 0.5));
  return spec.top + (1 - ny) * (spec.bottom - spec.top);
}

// Height of the body surface right above (x, z), in the same space as the
// rig (the body mesh sits at spec.center).
function mochiTop(spec, x, z) {
  let lo = 0;
  let hi = spec.radius;
  for (let i = 0; i < 24; i++) {
    const y = (lo + hi) / 2;
    const widen = mochiWiden(spec, y);
    const inside = (x / widen) ** 2 + (z / (widen * 0.98)) ** 2 + y * y <= spec.radius * spec.radius;
    if (inside) lo = y;
    else hi = y;
  }
  return spec.center + lo * spec.stretch;
}

function deformMochi(spec, x, y, z) {
  const widen = mochiWiden(spec, y);
  return { x: x * widen, y: y * spec.stretch, z: z * widen * 0.98 };
}

function projectToMochi(spec, xWant, yWant) {
  const y = Math.max(-spec.radius * 0.96, Math.min(spec.radius * 0.96, yWant / spec.stretch));
  const widen = mochiWiden(spec, y);
  let x = xWant / widen;
  const room = spec.radius * spec.radius - y * y;
  const limit = Math.sqrt(Math.max(0, room * 0.9));
  if (Math.abs(x) > limit) x = Math.sign(x || 1) * limit;
  const z = Math.sqrt(Math.max(0.08, spec.radius * spec.radius - x * x - y * y));
  const p = deformMochi(spec, x, y, z);
  const e = 0.06;
  const y2 = Math.max(-spec.radius * 0.96, Math.min(spec.radius * 0.96, y + e));
  const px = deformMochi(spec, x + e, y, Math.sqrt(Math.max(0.05, spec.radius * spec.radius - (x + e) * (x + e) - y * y)));
  const py = deformMochi(spec, x, y2, Math.sqrt(Math.max(0.05, spec.radius * spec.radius - x * x - y2 * y2)));
  const tx = { x: px.x - p.x, y: px.y - p.y, z: px.z - p.z };
  const ty = { x: py.x - p.x, y: py.y - p.y, z: py.z - p.z };
  let nx = tx.y * ty.z - tx.z * ty.y;
  let ny = tx.z * ty.x - tx.x * ty.z;
  let nz = tx.x * ty.y - tx.y * ty.x;
  if (nz < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  return { x: p.x, y: p.y, z: p.z, nx: nx / len, ny: ny / len, nz: nz / len };
}

function hexCss(hex) {
  return `#${(hex >>> 0).toString(16).padStart(6, "0")}`;
}
