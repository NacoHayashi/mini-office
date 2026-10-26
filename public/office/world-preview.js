// The small character preview in the look editor.
import * as THREE from "./vendor/three.module.js";
import { FALLBACK_LOOK } from "./world3d.js";

export function createPreview(ctx) {
  const {
    animateActor,
    creature,
    currentEnvMap,
    mats,
    preview,
    signature,
    world,
  } = ctx;

  let previewRenderer;

  let previewActor = null;
  let previewScene = null;
  let previewCamera = null;

  function ensurePreview() {
    if (previewRenderer || !(preview instanceof HTMLCanvasElement)) return;
    try {
      previewRenderer = new THREE.WebGLRenderer({ canvas: preview, antialias: true, alpha: true });
      if (!previewRenderer.getContext()) throw new Error("preview webgl");
      world.previewOk = true;
      const previewCap = window.matchMedia("(max-width: 980px)").matches ? 1.25 : 1.5;
      previewRenderer.setPixelRatio(Math.min(previewCap, window.devicePixelRatio || 1));
      previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
      previewRenderer.toneMapping = THREE.NoToneMapping;
      previewRenderer.toneMappingExposure = 1;
      previewRenderer.setClearColor(0xfff6fb, 1);
      previewScene = new THREE.Scene();
      const envMap = currentEnvMap();
      if (envMap) {
        previewScene.environment = envMap;
        previewScene.environmentIntensity = 0.9;
      }
      previewScene.add(new THREE.AmbientLight(0xfff8f4, 0.82));
      previewScene.add(new THREE.HemisphereLight(0xfffaf6, 0xf6dcc4, 1.22));
      const key = new THREE.DirectionalLight(0xfff7f1, 1.28);
      key.position.set(28, 72, 96);
      previewScene.add(key);
      const fillLight = new THREE.DirectionalLight(0xfff1e6, 0.72);
      fillLight.position.set(-48, 36, 84);
      previewScene.add(fillLight);
      const lift = new THREE.DirectionalLight(0xfff6ee, 0.38);
      lift.position.set(0, 24, 140);
      previewScene.add(lift);
      previewCamera = new THREE.PerspectiveCamera(26, 1, 1, 800);
      previewCamera.position.set(0, 70, 220);
      previewCamera.lookAt(0, 48, 0);
      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(() => syncPreviewSize());
        observer.observe(preview);
      }
    } catch {
      previewRenderer = null;
      world.previewOk = false;
    }
  }

  function lightPreview(map) {
    if (previewScene) {
      previewScene.environment = map;
      previewScene.environmentIntensity = 0.9;
    }
  }

  function syncPreviewSize() {
    if (!previewRenderer || !preview || !previewCamera) return;
    const pw = Math.round(preview.clientWidth);
    const ph = Math.round(preview.clientHeight);
    if (pw < 2 || ph < 2) return;
    const cap = window.matchMedia("(max-width: 980px)").matches ? 1.25 : 1.5;
    const ratio = Math.min(cap, window.devicePixelRatio || 1);
    const aspect = pw / ph;
    const bw = Math.floor(pw * ratio);
    const bh = Math.floor(ph * ratio);
    if (preview.width === bw && preview.height === bh && Math.abs(previewCamera.aspect - aspect) < 0.001) return;
    previewRenderer.setPixelRatio(ratio);
    previewRenderer.setSize(pw, ph, false);
    previewCamera.aspect = aspect;
    previewCamera.updateProjectionMatrix();
    if (previewActor) previewActor.userData.framed = "";
  }

  function renderPreview(look, time) {
    ensurePreview();
    if (!previewRenderer || !previewScene) return;
    const src = look && typeof look === "object" ? look : FALLBACK_LOOK;
    const sig = signature(src);
    if (!previewActor || previewActor.userData.sig !== sig) {
      if (previewActor) {
        previewActor.traverse((node) => {
          const material = node.material;
          if (!node.isMesh || !material) return;
          for (const shared of mats.values()) if (shared === material) return;
          material.dispose();
        });
        previewScene.remove(previewActor);
      }
      previewActor = creature(src);
      previewActor.traverse((node) => {
        const material = node.material;
        if (!node.isMesh || !material || material.isMeshBasicMaterial) return;
        node.material = new THREE.MeshBasicMaterial({
          color: material.color,
          side: material.side,
          vertexColors: material.vertexColors,
        });
      });
      previewActor.userData.sig = sig;
      previewActor.userData.faceCamera = false;
      previewScene.add(previewActor);
    }
    const spin = time || 0;
    animateActor(previewActor, false, spin, 0, false, 0.016);
    previewActor.rotation.y = Math.sin(spin * 0.8) * 0.22;
    previewActor.userData.heading = previewActor.rotation.y;
    previewActor.position.set(0, 0, 0);
    syncPreviewSize();
    const frameKey = `${sig}|${previewCamera.aspect.toFixed(3)}`;
    if (previewActor.userData.framed !== frameKey) {
      framePreview(previewActor);
      previewActor.userData.framed = frameKey;
    }
    previewRenderer.render(previewScene, previewCamera);
  }

  function framePreview(actor) {
    actor.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(actor);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const fov = (previewCamera.fov * Math.PI) / 180;
    const aspect = Math.max(0.2, previewCamera.aspect || 1);
    const margin = 1.35;
    const distY = (size.y * margin) / 2 / Math.tan(fov / 2);
    const distX = (Math.max(size.x, size.z) * margin) / 2 / Math.tan(fov / 2) / aspect;
    const dist = Math.max(distY, distX, 90);
    previewCamera.position.set(center.x + dist * 0.08, center.y + size.y * 0.08, center.z + dist);
    previewCamera.lookAt(center);
  }

  return { lightPreview, renderPreview, syncPreviewSize };
}
