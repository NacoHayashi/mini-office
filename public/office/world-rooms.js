// Floors, walls, and room name signs.
import * as THREE from "./vendor/three.module.js";
import { TILE, WALL_H, WALL_T } from "./world3d.js";

export function createRooms(ctx) {
  const {
    floorGroup,
    mat,
    ownMaterials,
    patternTexture,
    roundedBox,
    wallGroup,
    walls,
    world,
  } = ctx;

  function floorStyle(zone) {
    const id = zone?.id || "hall";
    const tones = {
      office: 0xeceae8,
      hall: 0xe6e3e1,
      reception: 0xeae7e5,
      restroom: 0xe5e6e8,
      pantry: 0xe7e4e2,
      gym: 0xe6e8ec,
      sofa: 0xebe8e6,
      meeting: 0xe8e5e3,
      game: 0xe9e6e4,
    };
    return { key: `plain|${id}`, map: floorTextures.plain, tint: tones[id] || 0xe8e6e4 };
  }

  const floorTextures = {
    plain: patternTexture("plain"),
  };

  function buildFloor(map) {
    const buckets = new Map();
    const color = new THREE.Color();
    for (let ty = 0; ty < map.rows; ty++) {
      for (let tx = 0; tx < map.cols; tx++) {
        if (map.walls[ty]?.[tx] === "1") continue;
        const zone = (map.zones || []).find((item) => tx >= item.x && ty >= item.y && tx < item.x + item.w && ty < item.y + item.h);
        const style = floorStyle(zone);
        let bucket = buckets.get(style.key);
        if (!bucket) {
          bucket = { positions: [], colors: [], uvs: [], style };
          buckets.set(style.key, bucket);
        }
        let shade = 1;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (map.walls[ty + dy]?.[tx + dx] === "1") shade = 0.94;
        }
        color.setHex(style.tint);
        color.multiplyScalar(shade);
        const x0 = tx * TILE;
        const z0 = ty * TILE;
        const x1 = x0 + TILE;
        const z1 = z0 + TILE;
        const y = 0;
        // Winding faces +Y. The opposite order is the underside, which the
        // overhead camera culls, so the pink clear color shows through.
        bucket.positions.push(x0, y, z0, x1, y, z1, x1, y, z0, x0, y, z0, x0, y, z1, x1, y, z1);
        const u0 = x0 / 64;
        const v0 = z0 / 64;
        const u1 = x1 / 64;
        const v1 = z1 / 64;
        bucket.uvs.push(u0, v0, u1, v1, u1, v0, u0, v0, u0, v1, u1, v1);
        for (let i = 0; i < 6; i++) bucket.colors.push(color.r, color.g, color.b);
      }
    }
    for (const bucket of buckets.values()) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(bucket.positions, 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(bucket.uvs, 2));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(bucket.colors, 3));
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, mat(0xffffff, world.software ? {
        basic: true,
        vertexColors: true,
        map: bucket.style.map,
        mapName: `basic-${bucket.style.key}`,
      } : {
        clay: true,
        roughness: 0.98,
        env: 0.2,
        vertexColors: true,
        map: bucket.style.map,
        mapName: bucket.style.key,
      }));
      mesh.receiveShadow = !world.software && world.quality !== "low";
      floorGroup.add(mesh);
    }
    for (const zone of map.zones || []) {
      if (zone.id === "hall") continue;
      floorGroup.add(zoneLabel(zone));
    }
  }

  function zoneLabel(zone) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = "rgba(92, 62, 58, 0.78)";
    ctx.font = "800 72px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(zone.name, 256, 68);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.min(zone.w * TILE * 0.42, 132), 28),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
    );
    // Tip the plane onto the floor, then yaw it so the top of the glyphs
    // points toward the top of the default overhead view. Keep the words
    // beside the doorway so people standing in the room do not cover them.
    const spot = zoneLabelAnchor(zone);
    mesh.rotation.order = "YXZ";
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.y = world.yaw;
    mesh.position.set(spot.x * TILE, 0.9, spot.y * TILE);
    return mesh;
  }

  function zoneLabelAnchor(zone) {
    const nearDoor = {
      reception: { x: zone.x + zone.w - 2.4, y: zone.y + zone.h - 1.25 },
      meeting: { x: zone.x + zone.w - 2.2, y: zone.y + zone.h - 1.25 },
      game: { x: zone.x + 1.7, y: zone.y + zone.h - 1.2 },
      office: { x: zone.x + 2.6, y: zone.y + 1.15 },
      restroom: { x: zone.x + zone.w - 1.8, y: zone.y + 1.35 },
      pantry: { x: zone.x + 1.5, y: zone.y + 1.35 },
      gym: { x: zone.x + zone.w - 1.6, y: zone.y + 1.35 },
      sofa: { x: zone.x + zone.w - 1.7, y: zone.y + 1.45 },
    };
    return nearDoor[zone.id] || { x: zone.x + 1.6, y: zone.y + zone.h - 1.3 };
  }

  function wallRuns(grid) {
    const rows = grid.length;
    const cols = grid[0].length;
    const used = Array.from({ length: rows }, () => Array(cols).fill(false));
    const runs = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (grid[y][x] !== "1" || used[y][x]) continue;
        let x1 = x;
        while (x1 + 1 < cols && grid[y][x1 + 1] === "1" && !used[y][x1 + 1]) x1 += 1;
        let y1 = y;
        if (x1 === x) {
          while (y1 + 1 < rows && grid[y1 + 1][x] === "1" && !used[y1 + 1][x]) y1 += 1;
        }
        for (let yy = y; yy <= y1; yy++) {
          for (let xx = x; xx <= x1; xx++) used[yy][xx] = true;
        }
        runs.push({ x, y, w: x1 - x + 1, h: y1 - y + 1 });
      }
    }
    return runs;
  }

  function buildWalls(map) {
    const plaster = mat(0xf3b4d0);
    const trim = mat(0xfffaf6);
    const cap = mat(0xfffdfb);
    for (const run of wallRuns(map.walls)) {
      const alongX = run.w >= run.h;
      const span = (alongX ? run.w : run.h) * TILE;
      const thick = Math.min(WALL_T, (alongX ? run.h : run.w) * TILE - 4);
      const width = alongX ? Math.max(8, span - 4) : thick;
      const depth = alongX ? thick : Math.max(8, span - 4);
      const mesh = new THREE.Mesh(roundedBox(width, WALL_H, depth, 3), plaster);
      const cx = run.x * TILE + (run.w * TILE) / 2;
      const cz = run.y * TILE + (run.h * TILE) / 2;
      mesh.position.set(cx, WALL_H / 2, cz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const skirt = new THREE.Mesh(roundedBox(width + 1.2, 4.2, depth + 1.2, 1.5), trim);
      skirt.position.set(0, -WALL_H / 2 + 2.1, 0);
      mesh.add(skirt);
      const lip = new THREE.Mesh(roundedBox(width + 1.4, 4.6, depth + 1.4, 1.6), cap);
      lip.position.set(0, WALL_H / 2 - 2.1, 0);
      mesh.add(lip);
      mesh.userData.occlude = true;
      ownMaterials(mesh);
      wallGroup.add(mesh);
      walls.push({
        mesh,
        h: WALL_H,
        minX: cx - width / 2,
        maxX: cx + width / 2,
        minZ: cz - depth / 2,
        maxZ: cz + depth / 2,
      });
    }
  }

  function textPlane(label, w, h) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff8f3";
    ctx.fillRect(0, 0, 256, 96);
    ctx.strokeStyle = "#e7b4cb";
    ctx.lineWidth = 10;
    ctx.strokeRect(6, 6, 244, 84);
    ctx.fillStyle = "#6a4a68";
    ctx.font = "700 40px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 128, 50);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture }));
  }

  return { buildFloor, buildWalls, textPlane };
}
