// Fixed props and movable furniture, built from the Kenney models once they load.
import * as THREE from "./vendor/three.module.js";
import { cssColor } from "./avatar.js";
import { createLibrary } from "./furnish.js";
import { markScreen } from "./monitors.js";
import { restyle } from "./world-materials.js";

export function createProps(ctx) {
  const {
    addMesh,
    contactShadow,
    doorPivots,
    geo,
    mat,
    propGroup,
    roundedBox,
    rugMesh,
    smoothSphere,
    textPlane,
  } = ctx;

  let library = {
    settled: false,
    ready: Promise.resolve(),
    progress: { done: 0, total: 0 },
    has() { return false; },
    take() { return null; },
  };

  let stallHook = null;

  function loadLibrary() {
    library = createLibrary();
    return library;
  }

  function libraryProgress() {
    return library.progress;
  }

  /** Kenney model clone fitted to a box, or null while models are still loading. */
  function model(name, w, h, opts) { return library.settled ? library.take(name, w, h, opts) : null; }

  function setStallHook(fn) { stallHook = typeof fn === "function" ? fn : null; }

  function buildProps(map) {
    doorPivots.clear();
    for (const prop of map.props || []) {
      propGroup.add(makeProp(prop));
    }
  }

  function placeStall(prop, group) {
    if (typeof stallHook !== "function") return false;
    if (prop.kind !== "stallwall" && prop.kind !== "stalldoor" && prop.kind !== "toilet") return false;
    const take = (name, boxW, boxH, opts) => (library.settled ? library.take(name, boxW, boxH, opts) : null);
    return stallHook(prop, group, { take }) === true;
  }

  function paintNames(object, names, color, scale = 1) {
    const hex = cssColor(color, 0xfff6ea);
    object.traverse((node) => {
      if (!node.isMesh || node.userData.outline) return;
      restyle(node, `paint|${hex}|${scale}`, (material) => {
        material.color.setHex(hex);
        if (scale !== 1) material.color.multiplyScalar(scale);
      }, (material) => names.includes(material.name));
    });
  }

  function glowPlane(parent, model, color) {
    const fit = model?.userData?.fit;
    if (!fit) return;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(6, fit.size.x * fit.sx * 0.62), Math.max(4, fit.size.y * fit.sy * 0.46)),
      new THREE.MeshBasicMaterial({ color, toneMapped: false }),
    );
    mesh.position.set(0, model.position.y + fit.size.y * fit.sy * 0.58, fit.size.z * fit.sz * 0.5 + 0.8);
    parent.add(mesh);
  }

  function kenneyProp(prop, group) {
    if (!library.settled) return false;
    const w = prop.w;
    const h = prop.h;
    if (prop.kind === "desk") {
      const model = library.take("desk", w * 0.92, h * 0.9, { maxHeight: 34, stretch: 1.55 });
      if (!model) return false;
      group.add(model);
      const top = model.userData.fit.size.y * model.userData.fit.sy;
      // Back edge of the top: the monitor stands in front of the divider, not through it.
      addMesh(group, roundedBox(w * 0.62, 13, 1.6, 1), mat(0xd9c8f5, { clay: true, roughness: 0.9 }), 0, top + 6, -h * 0.42);
      contactShadow(group, w * 0.36, h * 0.36);
      return true;
    }
    if (prop.kind === "counter") {
      const count = Math.max(1, Math.round(w / 34));
      const slot = w / count;
      let placed = 0;
      for (let i = 0; i < count; i++) {
        const piece = library.take("kitchenCabinet", slot * 0.98, Math.max(28, h), { maxHeight: 32, stretch: 1.2 });
        if (!piece) return false;
        piece.position.x = -w / 2 + slot * (i + 0.5);
        group.add(piece);
        placed += 1;
      }
      if (!placed) return false;
      contactShadow(group, w * 0.46, h * 0.6);
      return true;
    }
    if (prop.kind === "table") {
      const model = library.take("table", w * 0.94, h * 0.92, { maxHeight: 32, stretch: 1.7 });
      if (!model) return false;
      group.add(model);
      contactShadow(group, w * 0.4, h * 0.4);
      return true;
    }
    if (prop.kind === "rug") {
      const model = library.take("rugRounded", w * 0.98, h * 0.98, { maxHeight: 3, stretch: 1.85 });
      if (!model) return false;
      group.add(model);
      group.userData.paint = () => {
        paintNames(group, ["carpet", "carpetWhite", "carpetBlue"], prop.tint || "#f7c6d4");
        paintNames(group, ["carpetDarker"], prop.tint || "#f7c6d4", 0.78);
      };
      return true;
    }
    if (prop.kind === "tv") {
      const stand = library.take("cabinetTelevision", 56, 28, { maxHeight: 26, stretch: 1.25 });
      const screen = library.take("televisionModern", 62, 18, { maxHeight: 34, stretch: 1.15 });
      if (!screen) return false;
      if (stand) group.add(stand);
      const standH = stand ? stand.userData.fit.size.y * stand.userData.fit.sy : 0;
      screen.position.y = standH - 2;
      group.add(screen);
      glowPlane(group, screen, 0x8fd4ff);
      return true;
    }
    if (prop.kind === "screen") {
      // The meeting room's big screen: a Kenney TV on its cabinet; the meeting tools paint its glass.
      const stand = library.take("cabinetTelevision", w, h, { maxHeight: 24, stretch: 1.25 });
      const screen = library.take("televisionModern", w * 1.05, h * 0.6, { maxHeight: 44, stretch: 1.3 });
      if (!screen) return false;
      if (stand) group.add(stand);
      screen.position.y = stand ? stand.userData.fit.size.y * stand.userData.fit.sy - 2 : 0;
      markScreen(screen);
      group.add(screen);
      contactShadow(group, w * 0.42, h * 0.5);
      return true;
    }
    if (prop.kind === "mirror") {
      const model = library.take("bath-mirror", w * 0.6, 4, { maxHeight: 15, stretch: 1.2 });
      if (!model) return false;
      model.position.y = 26;
      model.position.z = -h / 2 + 2;
      group.add(model);
      return true;
    }
    if (prop.kind === "sink") {
      const model = library.take("bath-sink", w, h, { maxHeight: 34, stretch: 1.2 });
      if (!model) return false;
      group.add(model);
      contactShadow(group, w * 0.42, h * 0.42);
      return true;
    }
    if (prop.kind === "decor") {
      // Quarter turns swap the footprint, so fit the model to the unturned box.
      const turned = ((prop.rot || 0) / 90) % 2 === 1;
      const model = library.take(prop.model, turned ? h : w, turned ? w : h, {
        maxHeight: prop.tall || 32,
        stretch: 1.25,
        lift: prop.lift || 0,
        yaw: THREE.MathUtils.degToRad(prop.rot || 0),
      });
      if (!model) return false;
      group.add(model);
      if (prop.solid) contactShadow(group, w * 0.42, h * 0.42);
      return true;
    }
    return false;
  }

  function makeProp(prop) {
    const group = new THREE.Group();
    const cx = prop.x + prop.w / 2;
    const cz = prop.y + prop.h / 2;
    let occlude = true;
    const dressed = kenneyProp(prop, group) || placeStall(prop, group);
    if (dressed && (prop.kind === "rug" || prop.kind === "mirror" || prop.kind === "tv" || prop.kind === "screen" || (prop.kind === "decor" && !prop.solid))) occlude = false;
    if (dressed) {
      /* Kenney mesh already fills the footprint. */
    } else if (prop.kind === "desk") {
      contactShadow(group, prop.w * 0.42, prop.h * 0.46);
      addMesh(group, roundedBox(prop.w - 8, 5, prop.h - 10, 3), mat(0xf0d2a4), 0, 24, 0, { cast: true, receive: true });
      addMesh(group, geo("deskLeg", () => new THREE.CylinderGeometry(2.2, 2.6, 22, 8)), mat(0xd7b48a), -prop.w * 0.36, 12, -prop.h * 0.22, { cast: true });
      addMesh(group, geo("deskLeg", () => new THREE.CylinderGeometry(2.2, 2.6, 22, 8)), mat(0xd7b48a), prop.w * 0.36, 12, -prop.h * 0.22, { cast: true });
      addMesh(group, geo("deskLeg", () => new THREE.CylinderGeometry(2.2, 2.6, 22, 8)), mat(0xd7b48a), -prop.w * 0.36, 12, prop.h * 0.22, { cast: true });
      addMesh(group, geo("deskLeg", () => new THREE.CylinderGeometry(2.2, 2.6, 22, 8)), mat(0xd7b48a), prop.w * 0.36, 12, prop.h * 0.22, { cast: true });
      addMesh(group, roundedBox(prop.w - 18, 14, 2.4, 1.5), mat(0xd5c6f2), 0, 34, -prop.h * 0.38);
    } else if (prop.kind === "counter") {
      contactShadow(group, prop.w * 0.46, prop.h * 0.7);
      addMesh(group, roundedBox(prop.w - 4, 26, prop.h + 8, 6), mat(0xf6d7c2), 0, 16, 0, { cast: true });
      addMesh(group, roundedBox(prop.w - 16, 4, prop.h, 3), mat(0xfffaf6), 0, 31, 0);
    } else if (prop.kind === "table") {
      contactShadow(group, prop.w * 0.36, prop.h * 0.42);
      const radius = Math.max(18, (prop.h - 14) / 2);
      addMesh(group, geo(`roundTop|${radius}`, () => new THREE.CylinderGeometry(radius, radius, 5, 28)), mat(0xf0d2a4), 0, 22, 0, { sx: (prop.w - 16) / (radius * 2), cast: true });
      addMesh(group, geo("pedestal", () => new THREE.CylinderGeometry(3.2, 4.2, 18, 12)), mat(0xe7c79a), 0, 12, 0, { cast: true });
    } else if (prop.kind === "arcade") {
      contactShadow(group, prop.w * 0.4, prop.h * 0.36);
      const body = cssColor(prop.tint, prop.use === "play" ? 0xd9c8f5 : 0xf7b7d0);
      addMesh(group, roundedBox(prop.w - 4, 50, prop.h * 0.5, 5), mat(body), 0, 28, -6, { cast: true });
      const screen = new THREE.Group();
      screen.position.set(0, 46, prop.h * 0.02);
      screen.rotation.x = -0.62;
      addMesh(screen, roundedBox(prop.w - 14, 24, 2.2, 2), mat(0x241c30), 0, 0, 0);
      addMesh(screen, roundedBox(prop.w - 20, 16, 1.1, 1), mat(0x7ad8ff, { emissive: 0x3ec0ff }), 0, 1, 1.4);
      group.add(screen);
      addMesh(group, roundedBox(prop.w - 2, 7, prop.h * 0.34, 2), mat(0xffe08a, { emissive: 0xffc85a }), 0, 62, -4, { cast: true });
      addMesh(group, roundedBox(prop.w - 10, 3.2, 1.2, 1), mat(0xfff6c8, { emissive: 0xffe08a }), 0, 62, prop.h * 0.08);
      const deck = new THREE.Group();
      deck.position.set(0, 20, prop.h * 0.3);
      deck.rotation.x = 0.42;
      addMesh(deck, roundedBox(prop.w - 8, 3.2, 18, 2), mat(0x3a3050), 0, 0, 0, { cast: true });
      addMesh(deck, geo("stick", () => new THREE.CylinderGeometry(0.7, 0.9, 7, 8)), mat(0x2a2434), -8, 4.2, 1);
      addMesh(deck, smoothSphere(1.8, 12, 10), mat(0xf26d9a), -8, 8.2, 1);
      addMesh(deck, geo("btn", () => new THREE.CylinderGeometry(1.5, 1.7, 1.6, 10)), mat(0xf26d9a), 2, 1.6, 2);
      addMesh(deck, geo("btn", () => new THREE.CylinderGeometry(1.5, 1.7, 1.6, 10)), mat(0x7ec8e8), 6.2, 1.6, 1);
      addMesh(deck, geo("btn", () => new THREE.CylinderGeometry(1.5, 1.7, 1.6, 10)), mat(0xffe08a), 10.2, 1.6, 3);
      group.add(deck);
    } else if (prop.kind === "scoreboard") {
      contactShadow(group, prop.w * 0.4, 10);
      addMesh(group, roundedBox(8, 36, 8, 2), mat(0xc9b18a), -prop.w * 0.32, 18, 0, { cast: true });
      addMesh(group, roundedBox(8, 36, 8, 2), mat(0xc9b18a), prop.w * 0.32, 18, 0, { cast: true });
      addMesh(group, roundedBox(prop.w, 32, 4, 3), mat(0xfff8f1), 0, 40, 0, { cast: true });
      const board = textPlane(prop.label || "排行榜", prop.w - 8, 18);
      board.position.set(0, 42, 3);
      group.add(board);
    } else if (prop.kind === "mirror") {
      addMesh(group, roundedBox(prop.w, 22, 3, 3), mat(0xf4e2c4), 0, 36, 0, { cast: true });
      addMesh(group, roundedBox(prop.w - 6, 14, 1.4, 2), mat(0xd7f4ff, { emissive: 0xc6ecff }), 0, 36, 2);
      occlude = false;
    } else if (prop.kind === "rug") {
      const rug = rugMesh(prop.w, prop.h, prop.tint || "#f8c3d6");
      rug.position.y = 0.7;
      group.add(rug);
      occlude = false;
    } else if (prop.kind === "window") {
      addMesh(group, roundedBox(prop.w, 22, 3, 3), mat(0xfffaf6), 0, 40, 0);
      addMesh(group, roundedBox(prop.w - 8, 14, 1.4, 2), mat(0xd9f3ff, { emissive: 0xc8ebff }), 0, 40, 2);
      addMesh(group, roundedBox(prop.w + 2, 5, 4, 1.5), mat(0xd9c8f5), 0, 52, 0);
      occlude = false;
    } else if (prop.kind === "frame") {
      addMesh(group, roundedBox(prop.w, 22, 2.2, 1.5), mat(0xf0d2a4), 0, 40, 0);
      addMesh(group, roundedBox(prop.w - 6, 16, 1.2, 1), mat(cssColor(prop.tint, 0xf7c6d4)), 0, 40, 1.4);
      occlude = false;
    } else if (prop.kind === "beanbag") {
      contactShadow(group, prop.w * 0.46, prop.h * 0.46);
      addMesh(group, smoothSphere(15, 20, 16), mat(0xd4c2f4), 0, 9, 1, { sx: 1.4, sy: 0.5, sz: 1.22, cast: true });
      addMesh(group, smoothSphere(12, 18, 14), mat(0xcbb6ee), -2, 22, -1, { sx: 1.18, sy: 1.05, sz: 1.05, cast: true });
      addMesh(group, smoothSphere(9, 16, 12), mat(0xe8daf8), 3, 38, 2, { sx: 1.12, sy: 0.95, sz: 1.02, cast: true });
      addMesh(group, smoothSphere(4.5, 12, 10), mat(0xf3e9ff), -4, 30, 6, { sx: 1.2, sy: 0.7, sz: 0.85 });
    } else if (prop.kind === "tv") {
      addMesh(group, roundedBox(prop.w + 8, 8, 10, 2), mat(0xe7c79a), 0, 16, 0);
      addMesh(group, roundedBox(prop.w, 16, 2.4, 1.5), mat(0x2c2834), 0, 28, 0);
      addMesh(group, roundedBox(prop.w - 4, 12, 1.2, 1), mat(0x9fd4ee, { emissive: 0x7ec4ea }), 0, 28, 1.6);
      occlude = false;
    } else if (prop.kind === "sign") {
      const sign = textPlane(prop.label || "", prop.w, 18);
      sign.position.set(0, 34, 0);
      group.add(sign);
      occlude = false;
    } else if (prop.kind === "decor" || prop.kind === "screen") {
      // A missing model leaves an empty spot rather than a stand-in block.
      occlude = false;
    } else {
      addMesh(group, roundedBox(prop.w, 16, prop.h, 4), mat(0xe6d4c8), 0, 8, 0, { cast: true });
    }
    group.position.set(cx, 0, cz);
    group.userData.propKind = prop.kind;
    if (prop.kind === "decor") group.userData.model = prop.model;
    if (prop.kind === "stalldoor" && group.userData.doorPivot) doorPivots.set(prop.id, group.userData.doorPivot);
    group.userData.occlude = occlude;
    if (group.userData.paint) group.userData.paint();
    return group;
  }

  function itemSize(item, specs) {
    const spec = specs.get(item.kind);
    if (!spec) return { w: 32, h: 24 };
    const rot = ((item.rot || 0) % 360 + 360) % 360;
    if (rot % 180 !== 0) return { w: spec.h, h: spec.w };
    return { w: spec.w, h: spec.h };
  }

  const DESK_TOP = 34;

  function kenneyItem(item, group) {
    if (!library.settled) return false;
    const kind = item.kind;
    const place = (name, w, h, opts = {}) => library.take(name, w, h, opts);
    if (kind === "monitor") {
      const model = place("computerScreen", 36, 14, { maxHeight: 26, stretch: 1.15 });
      if (!model) return false;
      model.position.y = DESK_TOP;
      group.add(model);
      markScreen(model);
      contactShadow(group, 16, 12);
      return true;
    }
    if (kind === "keyboard") {
      const model = place("computerKeyboard", 32, 12, { maxHeight: 3.2, stretch: 1.1 });
      if (!model) return false;
      model.position.y = DESK_TOP;
      group.add(model);
      return true;
    }
    if (kind === "mouse") {
      const model = place("computerMouse", 8, 12, { maxHeight: 4, stretch: 1.05 });
      if (!model) return false;
      model.position.y = DESK_TOP;
      group.add(model);
      return true;
    }
    if (kind === "chair") {
      const meet = String(item.id || "").startsWith("meet-");
      const model = place(meet ? "chairRounded" : "chairDesk", meet ? 26 : 32, meet ? 24 : 26, { maxHeight: meet ? 40 : 36 });
      if (!model) return false;
      group.add(model);
      group.userData.paint = () => {
        if (meet) paintNames(group, ["wood", "woodDark"], 0xfff6ea);
        else paintNames(group, ["carpet", "carpetBlue"], 0xd4c4f4);
      };
      contactShadow(group, 16, 16);
      return true;
    }
    if (kind === "stool") {
      const model = place("stoolBar", 16, 16, { maxHeight: 22, stretch: 1.25 });
      if (!model) return false;
      group.add(model);
      contactShadow(group, 7, 7);
      return true;
    }
    if (kind === "plant") {
      const model = place("pottedPlant", 24, 26, { maxHeight: 52 });
      if (!model) return false;
      group.add(model);
      contactShadow(group, 12, 12);
      return true;
    }
    if (kind === "cactus") {
      const model = place("plantSmall1", 18, 18, { maxHeight: 32 });
      if (!model) return false;
      group.add(model);
      contactShadow(group, 10, 10);
      return true;
    }
    if (kind === "lamp") {
      const model = place("lampSquareFloor", 16, 16, { maxHeight: 70 });
      if (!model) return false;
      group.add(model);
      return true;
    }
    if (kind === "coffee") {
      const model = place("kitchenCoffeeMachine", 26, 28, { maxHeight: 32, stretch: 1.1 });
      if (!model) return false;
      group.add(model);
      contactShadow(group, 12, 12);
      return true;
    }
    if (kind === "water") {
      const model = place("gym-cooler", 22, 22, { maxHeight: 50, stretch: 1.2 });
      if (!model) return false;
      group.add(model);
      contactShadow(group, 12, 14);
      return true;
    }
    if (kind === "console") {
      const model = place("laptop", 32, 18, { maxHeight: 16, stretch: 1.15 });
      if (!model) return false;
      group.add(model);
      return true;
    }
    if (kind === "speaker") {
      const model = place("speaker", 16, 16, { maxHeight: 48 });
      if (!model) return false;
      group.add(model);
      contactShadow(group, 8, 8);
      return true;
    }
    if (kind === "sofa") {
      const model = place("loungeSofa", 72, 36, { maxHeight: 34, stretch: 1.08 });
      if (!model) return false;
      group.add(model);
      const pillowA = place("pillow", 18, 10, { maxHeight: 12 });
      const pillowB = place("pillow", 16, 10, { maxHeight: 11 });
      if (pillowA) {
        pillowA.position.set(-16, 20, 4);
        group.add(pillowA);
      }
      if (pillowB) {
        pillowB.position.set(14, 20, 6);
        pillowB.rotation.y = 0.4;
        group.add(pillowB);
      }
      group.userData.paint = () => {
        paintNames(group, ["carpet"], 0xfff8f1);
        if (pillowA) paintNames(pillowA, ["carpet"], 0xd9c8f5);
        if (pillowB) paintNames(pillowB, ["carpet"], 0xf7c6d4);
      };
      contactShadow(group, 34, 18);
      return true;
    }
    if (kind === "bin") {
      const model = place("trashcan", 16, 18, { maxHeight: 22 });
      if (!model) return false;
      group.add(model);
      return true;
    }
    if (kind === "coffeetable") {
      const w = 88;
      const h = 40;
      const model = place("tableCoffee", w * 0.94, h * 0.9, { maxHeight: 20, stretch: 1.45 });
      if (!model) return false;
      group.add(model);
      const books = place("books", 18, 12, { maxHeight: 8, stretch: 1.1 });
      if (books) {
        books.position.set(-w * 0.16, 18, 0);
        group.add(books);
      }
      contactShadow(group, w * 0.4, h * 0.4);
      return true;
    }
    if (kind === "toyrack") {
      const model = place("bookcaseOpenLow", 46, 26, { maxHeight: 34, stretch: 1.2 });
      if (!model) return false;
      group.add(model);
      contactShadow(group, 22, 12);
      return true;
    }
    if (kind === "shelf") {
      const model = place("bookcaseOpen", 46, 26, { maxHeight: 78, stretch: 1.1 });
      if (!model) return false;
      group.add(model);
      const fit = model.userData.fit;
      const height = fit.size.y * fit.sy;
      for (const spot of [0.28, 0.52, 0.74]) {
        const books = place("books", 16, 10, { maxHeight: 12 });
        if (!books) continue;
        books.position.set((spot - 0.5) * 24, height * spot, 2);
        group.add(books);
      }
      contactShadow(group, 20, 12);
      return true;
    }
    return false;
  }

  function snackSign(text, w, h, bg, fg) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = fg;
    ctx.font = "700 64px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 50);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
    );
    return mesh;
  }

  function placeKenney(group, name, w, h, maxHeight, x, y, z, yaw = 0) {
    const model = library.take(name, w, h, { maxHeight, stretch: 1.15, yaw });
    if (!model) return false;
    model.position.set(x, y, z);
    group.add(model);
    return true;
  }

  // Food Kit has plates, cookies, cupcakes, donuts, and a teacup. No teapot or cake stand.
  function afternoonTea(group) {
    if (!library.settled || !library.has("plate") || !library.has("cup-tea")) return false;
    const counter = 35;
    const placed = [
      placeKenney(group, "plate", 16, 16, 2.4, -6, counter, 2, 0.2),
      placeKenney(group, "cookie", 5.2, 5.2, 1.6, -8.4, counter + 1.3, 3.4, 0.5),
      placeKenney(group, "cookie", 4.6, 4.6, 1.4, -4.1, counter + 1.3, 1.1, -0.7),
      placeKenney(group, "cupcake", 6.2, 6.2, 8, -6.1, counter + 1.3, 0.2, 0.15),
      placeKenney(group, "donut", 5.6, 5.6, 2.2, 2.2, counter, -2, 0.4),
      placeKenney(group, "cup-tea", 6.2, 5.6, 7.5, 8.2, counter, 2.4, -0.5),
    ];
    return placed.filter(Boolean).length >= 4;
  }

  function buildSnackMachine(group, kind) {
    const vendor = kind === "vendor";
    contactShadow(group, vendor ? 14 : 18, vendor ? 13 : 14);
    if (!vendor) {
      addMesh(group, roundedBox(36, 34, 26, 4), mat(0xfff7ef), 0, 18, 0, { cast: true });
      addMesh(group, roundedBox(32, 2.2, 20, 1), mat(0xf3e2cf), 0, 14, 1);
      addMesh(group, roundedBox(32, 2.2, 20, 1), mat(0xf3e2cf), 0, 24, 1);
      const glass = new THREE.MeshBasicMaterial({ color: 0xdff6ee, transparent: true, opacity: 0.42, depthWrite: false });
      addMesh(group, roundedBox(30, 20, 1.2, 2), glass, 0, 20, 13.2);
      if (!afternoonTea(group)) {
        const treats = [[0xf0c07a, -8, 18], [0x8a5638, 0, 18], [0xf26d9a, 8, 18], [0xfffdfb, -4, 28], [0xffb067, 6, 28]];
        for (const [color, x, y] of treats) {
          addMesh(group, geo("treat", () => new THREE.SphereGeometry(2.1, 12, 10)), mat(color), x, y, 8);
        }
      }
      const sign = snackSign("零食", 18, 5.5, "#fff7ef", "#d36b90");
      sign.position.set(0, 33, 13.4);
      group.add(sign);
      return;
    }
    const machine = library.settled ? library.take("vending-machine", 32, 30, { maxHeight: 50, stretch: 1.2 }) : null;
    if (machine) {
      group.add(machine);
      return;
    }
    addMesh(group, roundedBox(28, 48, 24, 4), mat(0xf3f1ee), 0, 25, 0, { cast: true });
    const glass = new THREE.MeshBasicMaterial({ color: 0xd5e6f6, transparent: true, opacity: 0.4, depthWrite: false });
    addMesh(group, roundedBox(22, 26, 1.2, 2), glass, 0, 30, 12.2);
    const cans = [[0x7dca78, -6, 36], [0xf08aab, 0, 36], [0xffb067, 6, 36], [0xf2d7a4, -6, 26], [0xc9b6ee, 0, 26], [0x8ec8e6, 6, 26]];
    for (const [color, x, y] of cans) {
      addMesh(group, geo("can", () => new THREE.CylinderGeometry(1.6, 1.6, 5, 10)), mat(color), x, y, 8.5);
    }
    addMesh(group, roundedBox(14, 3.4, 5, 1.2), mat(0x6a5a78), 0, 10, 10);
    const sign = snackSign("飲料", 16, 5, "#f3f1ee", "#5c4d78");
    sign.position.set(0, 46.2, 12.4);
    group.add(sign);
  }

  function makeFurniture(item) {
    const group = new THREE.Group();
    const kind = item.kind;
    const dressed = kenneyItem(item, group);
    if (dressed) {
      /* Kenney mesh already fills this item. */
    } else if (kind === "monitor") {
      contactShadow(group, 16, 12);
      addMesh(group, geo("neck", () => new THREE.CylinderGeometry(1.6, 2, 14, 8)), mat(0xd9c8b4), 0, 33, 0, { cast: true });
      addMesh(group, roundedBox(34, 22, 3.4, 3), mat(0xf7f4ef), 0, 48, 0, { cast: true });
      const glass = addMesh(group, roundedBox(28, 16, 1.2, 2), mat(0x2f2a3c), 0, 48, 2.2);
      glass.userData.screen = true;
    } else if (kind === "keyboard") {
      addMesh(group, roundedBox(32, 2.4, 12, 2), mat(0xfffdfb), 0, 28.4, 0, { cast: true });
      addMesh(group, roundedBox(26, 1.2, 7, 1), mat(0xe7d8ea), 0, 30, 0);
    } else if (kind === "mouse") {
      addMesh(group, geo("mouse", () => new THREE.SphereGeometry(4.2, 12, 10)), mat(0xfffdfb), 0, 29, 0, { sx: 1, sy: 0.55, sz: 1.25, cast: true });
    } else if (kind === "chair") {
      contactShadow(group, 16, 16);
      const wheels = [];
      for (let i = 0; i < 5; i++) {
        const arm = new THREE.Group();
        arm.rotation.y = (i / 5) * Math.PI * 2;
        addMesh(arm, geo("casterArm", () => new THREE.BoxGeometry(11, 1.3, 2.1)), mat(0xcbb8a4), 5.6, 2.2, 0);
        const wheel = new THREE.Group();
        wheel.position.set(11.4, 1.7, 0);
        addMesh(wheel, geo("casterWheel", () => new THREE.CylinderGeometry(1.7, 1.7, 1.5, 12)), mat(0x3a3340), 0, 0, 0, { rotX: Math.PI / 2 });
        arm.add(wheel);
        group.add(arm);
        wheels.push(wheel);
      }
      addMesh(group, geo("chairGas", () => new THREE.CylinderGeometry(1.45, 1.8, 9, 12)), mat(0xe4dcd2), 0, 7.4, 0);
      const seat = new THREE.Group();
      group.add(seat);
      const creamSeat = String(item.id || "").startsWith("meet-");
      const seatColor = creamSeat ? 0xfff6ea : 0xcbb6ee;
      const backColor = creamSeat ? 0xf4ece3 : 0xbfa8e4;
      addMesh(seat, roundedBox(24, 5, 22, 5), mat(seatColor), 0, 14.5, 1, { cast: true });
      addMesh(seat, roundedBox(22, 15, 3.6, 3), mat(backColor), 0, 22, -8, { cast: true });
      group.userData.wheels = wheels;
      group.userData.seatPivot = seat;
      group.userData.wobble = 0;
    } else if (kind === "stool") {
      contactShadow(group, 7, 7);
      addMesh(group, geo("stoolLeg", () => new THREE.CylinderGeometry(1.2, 1.6, 18, 10)), mat(0xe4dcd2), 0, 9, 0);
      addMesh(group, geo("stoolSeat", () => new THREE.CylinderGeometry(7, 7, 3.4, 16)), mat(0xf2d0a4), 0, 20, 0, { cast: true });
    } else if (kind === "plant" || kind === "cactus") {
      contactShadow(group, 12, 12);
      addMesh(group, geo("pot", () => new THREE.CylinderGeometry(7, 5.5, 10, 10)), mat(0xfff6ea), 0, 6, 0, { cast: true });
      const leaf = kind === "cactus" ? 0x7dca78 : 0x7ecf86;
      addMesh(group, geo("leaf", () => new THREE.SphereGeometry(10, 12, 10)), mat(leaf), 0, 20, 0, { cast: true });
      if (kind === "plant") {
        addMesh(group, geo("leaf", () => new THREE.SphereGeometry(8, 12, 10)), mat(0xb6e7a4), 7, 26, 2, { sx: 0.85, sy: 0.75, sz: 0.75 });
        addMesh(group, geo("leaf", () => new THREE.SphereGeometry(7, 12, 10)), mat(0x9edc98), -6, 24, -1, { sx: 0.8, sy: 0.7, sz: 0.7 });
      }
    } else if (kind === "lamp") {
      addMesh(group, geo("lampStem", () => new THREE.CylinderGeometry(1.5, 2, 18, 8)), mat(0xf2d7a4), 0, 12, 0);
      addMesh(group, geo("shade", () => new THREE.ConeGeometry(8, 10, 10)), mat(0xfff1c4, { emissive: 0xffe29a }), 0, 24, 0);
    } else if (kind === "coffee") {
      addMesh(group, roundedBox(18, 20, 16, 4), mat(0xd7b08a), 0, 12, 0, { cast: true });
      addMesh(group, geo("mug", () => new THREE.CylinderGeometry(4, 3.4, 6, 10)), mat(0xfffdfb), 0, 24, 0);
    } else if (kind === "water") {
      addMesh(group, roundedBox(16, 28, 16, 4), mat(0xd7f0ff), 0, 16, 0, { cast: true });
      addMesh(group, geo("bottle", () => new THREE.CylinderGeometry(5, 5, 10, 10)), mat(0xb7e4ff), 0, 32, 0);
    } else if (kind === "console") {
      addMesh(group, roundedBox(28, 6, 16, 3), mat(0xe7d2ff), 0, 6, 0);
    } else if (kind === "speaker") {
      addMesh(group, roundedBox(14, 24, 12, 4), mat(0x6a5a78), 0, 14, 0, { cast: true });
      addMesh(group, geo("speaker", () => new THREE.CircleGeometry(3.2, 12)), mat(0x2c2434), 0, 16, 6.2);
    } else if (kind === "sofa") {
      contactShadow(group, 34, 18);
      addMesh(group, roundedBox(66, 12, 30, 6), mat(0xfff8f1), 0, 12, 2, { cast: true });
      addMesh(group, roundedBox(66, 18, 8, 4), mat(0xf7f0e6), 0, 24, -10, { cast: true });
      addMesh(group, roundedBox(8, 16, 28, 3), mat(0xf3ebe0), -30, 18, 2);
      addMesh(group, roundedBox(8, 16, 28, 3), mat(0xf3ebe0), 30, 18, 2);
      addMesh(group, roundedBox(16, 5, 12, 3), mat(0xe4d4f6), -16, 20, 4);
      addMesh(group, roundedBox(14, 5, 12, 3), mat(0xf7c6d4), 8, 20, 6);
      addMesh(group, roundedBox(12, 4, 10, 3), mat(0xffe08a), 18, 19, 2);
    } else if (kind === "bin") {
      addMesh(group, geo("bin", () => new THREE.CylinderGeometry(6, 5, 12, 10)), mat(0xd5e0ea), 0, 6, 0);
    } else if (kind === "shelf") {
      addMesh(group, roundedBox(44, 28, 10, 3), mat(0xf0d2a4), 0, 18, 0, { cast: true });
      addMesh(group, roundedBox(1.4, 24, 8, 0.4), mat(0xe7c79a), -10, 16, 1);
      addMesh(group, roundedBox(1.4, 24, 8, 0.4), mat(0xe7c79a), 10, 16, 1);
      addMesh(group, roundedBox(10, 8, 6, 1), mat(0xf7c6d4), -16, 22, 2);
      addMesh(group, roundedBox(10, 10, 6, 1), mat(0xd9c8f5), 0, 20, 2);
      addMesh(group, roundedBox(10, 7, 6, 1), mat(0xffe08a), 16, 14, 2);
    } else if (kind === "board") {
      addMesh(group, geo("boardLeg", () => new THREE.CylinderGeometry(1.3, 1.6, 16, 8)), mat(0xe7c79a), -16, 8, 0);
      addMesh(group, geo("boardLeg", () => new THREE.CylinderGeometry(1.3, 1.6, 16, 8)), mat(0xe7c79a), 16, 8, 0);
      addMesh(group, roundedBox(48, 28, 3, 2), mat(0xfffdfb), 0, 30, 0, { cast: true });
      addMesh(group, roundedBox(42, 20, 1, 1), mat(0xf4f7fb), 0, 30, 2);
    } else if (kind === "coffeetable") {
      contactShadow(group, 35, 16);
      addMesh(group, roundedBox(84, 6, 36, 6), mat(0xf0d2a4), 0, 14, 0, { cast: true });
      addMesh(group, roundedBox(16, 2, 12, 1), mat(0xd9c8f5), -10, 18, 0);
      addMesh(group, geo("cup", () => new THREE.CylinderGeometry(3.2, 2.8, 5, 10)), mat(0xfff6ea), 14, 19, 2);
    } else if (kind === "snackcab" || kind === "vendor") {
      buildSnackMachine(group, kind);
    } else if (kind === "toyrack") {
      contactShadow(group, 22, 12);
      addMesh(group, roundedBox(44, 30, 22, 3), mat(0xf0d2a4), 0, 15, 0, { cast: true });
      addMesh(group, roundedBox(40, 1.6, 18, 0.6), mat(0xe7c79a), 0, 15, 2);
    }
    const ring = new THREE.Mesh(geo("ring", () => new THREE.TorusGeometry(16, 1.1, 6, 18)), mat(0xf08aab, { basic: true }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.4;
    ring.visible = false;
    group.add(ring);
    group.userData.ring = ring;
    group.userData.kind = kind;
    group.userData.occlude = true;
    if (group.userData.paint) group.userData.paint();
    return group;
  }

  return {
    buildProps,
    itemSize,
    libraryProgress,
    loadLibrary,
    makeFurniture,
    model,
    setStallHook,
  };
}
