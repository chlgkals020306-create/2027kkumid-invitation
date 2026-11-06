// Real-time scene: loads the original glTF, rigs the cover hinge, lights it like a studio
// photograph on the Figma felt, frames it at the exact centre of the viewport and renders
// with soft shadows + ambient occlusion. The canvas is transparent: the Figma background is
// a CSS layer underneath, so it is shown pixel-exact and never tone-mapped.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FolioRig } from './FolioRig.js';
import { buildMaterials, inkTexture, decalMaterial } from './materials.js';
import { loadModelAsGLB } from './modelSource.js';
import { damp, lerp, clamp, ease, prefersReducedMotion } from '../util/motion.js';

const _v = new THREE.Vector3();

export class InvitationScene {
  constructor(canvas, cfg) {
    this.canvas = canvas;
    this.cfg = cfg;
    this.reduced = prefersReducedMotion();
    this.progress = 0;
    this.tilt = { x: 0, y: 0 };            // radians, already smoothed by TiltController
    this.parallax = { x: 0, y: 0 };        // −1…1
    this.running = false;
    this.introT = this.reduced ? 1 : 0;
    this.timer = new THREE.Timer();
    this.elapsed = 0;
    this.frameTimes = [];
    this.quality = this.pickTier();

    const r = this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance',
    });
    r.setClearColor(0x000000, 0);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(r);
    this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentRotation.set(0, -0.6, 0);
    this.scene.environmentIntensity = 0.32;   // soft studio reflections; materials share this level
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(cfg.camera.fovDeg, 1, 0.05, 60);
    this.camQuat = new THREE.Quaternion();
    this.frame = { target: new THREE.Vector3(), dist: 6, ready: false };

    this.buildLights();
  }

  pickTier() {
    const dpr = window.devicePixelRatio || 1;
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    const low = cores <= 4 && mem <= 3;
    if (new URLSearchParams(location.search).has('qa')) return { maxDpr: 0.6, minDpr: 0.6, ao: false, shadow: 512, level: 0, msaa: 0 }; // functional-test mode
    // Phones are 3× screens: render up to 2.5× so the printed textures stay crisp,
    // and never let adaptive quality go below 1.5× (below that the prints break up).
    const maxDpr = Math.min(dpr, low ? 2 : 2.5);
    return { maxDpr, minDpr: Math.min(dpr, 1.5), ao: !low, shadow: low ? 1024 : 2048, level: low ? 1 : 2 };
  }

  buildLights() {
    // Sun from the far-left of the frame — the same direction as the leaf light in the Figma photo.
    const sun = this.sun = new THREE.DirectionalLight(0xfff0d8, 2.05);
    sun.position.set(-2.0, 5.4, -2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.quality.shadow, this.quality.shadow);
    const sc = sun.shadow.camera; sc.left = -2.8; sc.right = 2.8; sc.top = 2.8; sc.bottom = -2.8; sc.near = 1; sc.far = 14;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.012; sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);

    // Sky / felt bounce (green from below, as on the felt).
    this.scene.add(new THREE.HemisphereLight(0xf4f1ea, 0x58742a, 0.4));
    const fill = new THREE.DirectionalLight(0xe9f0ff, 0.22);
    fill.position.set(3, 2.5, 4);
    this.scene.add(fill);

    // Shadow catcher: invisible "felt" plane that only shows the folio's shadow.
    this.catcher = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ color: 0x081204, opacity: 0.55 }));
    this.catcher.rotation.x = -Math.PI / 2;
    this.catcher.position.y = -0.0005;
    this.catcher.receiveShadow = true;
    this.scene.add(this.catcher);
  }

  async load(onProgress) {
    // Embedded buffers are decoded locally (no data: fetches) — see modelSource.js.
    const glb = await loadModelAsGLB(this.cfg.model, this.cfg.modelModule, onProgress);
    this.modelWarnings = glb.warnings || [];
    const gltf = await new GLTFLoader().parseAsync(glb, '');
    // Locate the two meshes by type (the file has a group AND a mesh both named "outer").
    const meshes = [];
    gltf.scene.traverse(o => o.isMesh && meshes.push(o));
    const inner = meshes.find(m => /^inner/.test(m.name));
    const outer = meshes.find(m => m !== inner && /^outer/.test(m.name)) || meshes.find(m => m !== inner);
    if (!outer || !inner) throw new Error('Expected meshes "outer" and "inner" in the model');

    // Original camera orientation (static pose of "OctaneCamera" in the file).
    const camNode = gltf.cameras[0];
    gltf.scene.updateMatrixWorld(true);
    if (camNode) camNode.getWorldQuaternion(this.camQuat);
    else this.camQuat.setFromEuler(new THREE.Euler(-THREE.MathUtils.degToRad(this.cfg.camera.pitchDeg), 0, 0));

    const stats = this.describe(gltf);
    stats.warnings = this.modelWarnings || [];
    // Keep the invitation nodes with their original transforms (the camera-rig nulls carry no geometry).
    const topOf = o => { while (o.parent && o.parent !== gltf.scene) o = o.parent; return o; };
    this.folio = new THREE.Group(); this.folio.name = 'folio';
    for (const n of new Set([topOf(outer), topOf(inner)])) this.folio.add(n);
    this.stage = new THREE.Group(); this.stage.name = 'stage';
    this.stage.add(this.folio);
    this.scene.add(this.stage);

    this.mats = await buildMaterials({ outer, inner }, this.cfg, this.renderer);
    this.rig = new FolioRig(outer, this.cfg.hinge);
    this.outer = outer; this.inner = inner;

    // Recentre on the CLOSED pose: folio centred on the origin (x, z), resting on y = 0.
    this.rig.setProgress(0);
    this.folio.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.folio, true);
    const c = box.getCenter(new THREE.Vector3());
    this.folio.position.set(-c.x, -box.min.y, -c.z);
    this.folio.updateMatrixWorld(true);
    this.baseBox = new THREE.Box3().setFromObject(this.folio, true);
    this.rig.setProgress(this.progress);

    if (this.cfg.standIn.print) {
      // Decorative only: never let it block the invitation.
      try { await this.addStandInPrint(); } catch (e) { console.warn('[print] skipped:', e?.message || e); }
    }

    this.setupComposer();
    this.resize();
    this.updateFraming(1, true);
    this.renderOnce();
    return { stats };
  }

  describe(gltf) {
    const out = [];
    gltf.scene.traverse(o => o.isMesh && out.push({ name: o.name, vertices: o.geometry.attributes.position.count, triangles: o.geometry.index.count / 3 }));
    return { meshes: out, materialsInFile: gltf.parser.json.materials?.length || 0, texturesInFile: gltf.parser.json.textures?.length || 0 };
  }

  /** Brand marks from Figma printed onto the stand-in paper (only where no original texture exists). */
  async addStandInPrint() {
    const ray = new THREE.Raycaster();
    const surfaceAt = (mesh, x, z) => {
      ray.set(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(mesh, false)[0];
      return hit ? hit.point : null;
    };
    this.folio.updateMatrixWorld(true);

    if (!this.mats.outerHasOriginal) {
      // Cover: "Rare TASTE" logotype (Figma 185:33), centred on the cover face.
      const { texture, aspect } = await inkTexture(this.cfg.assetBase + 'assets/figma/logo-footer.png', '#ff610a', this.renderer);
      const cb = this.rig.coverBox;
      const cxL = (cb.min.x + cb.max.x) / 2, czL = (cb.min.z + cb.max.z) / 2;
      const worldC = this.outer.localToWorld(new THREE.Vector3(cxL, 0, czL));
      const a = surfaceAt(this.outer, worldC.x, worldC.z - 0.2), b = surfaceAt(this.outer, worldC.x, worldC.z + 0.2);
      if (a && b) {
        const w = 0.52;
        const decal = new THREE.Mesh(new THREE.PlaneGeometry(w, w / aspect), decalMaterial(texture));
        decal.name = 'standInPrint-cover';
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const pL = this.rig.pivot.worldToLocal(mid.clone());
        decal.position.copy(pL).add(new THREE.Vector3(0, 0.0012, 0));
        decal.rotation.x = -Math.PI / 2 + Math.atan2(a.y - b.y, b.z - a.z) * -1;
        decal.receiveShadow = true;
        this.rig.pivot.add(decal);
      }
    }
    if (!this.mats.innerHasOriginal) {
      // Inner card: "R" monogram (Figma 185:188) in ivory on the orange card, centred in the mat window.
      const { texture, aspect } = await inkTexture(this.cfg.assetBase + 'assets/figma/logo-page2-r.png', '#f6efe3', this.renderer);
      const h = 0.30;
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(h * aspect, h), decalMaterial(texture));
      decal.name = 'standInPrint-card';
      const ib = new THREE.Box3().setFromBufferAttribute(this.inner.geometry.attributes.position);
      decal.position.set((ib.min.x + ib.max.x) / 2, ib.max.y + 0.0008, (ib.min.z + ib.max.z) / 2 - 0.02);
      decal.rotation.x = -Math.PI / 2;
      decal.receiveShadow = true;
      this.inner.add(decal);
    }
  }

  setupComposer() {
    const r = this.renderer;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.quality.msaa ?? 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera, null, new THREE.Color(0x000000), 0));
    this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 0.09, distanceExponent: 1.6, thickness: 0.35, scale: 1.0, samples: 16, distanceFallOff: 1.0 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    this.gtao.enabled = this.quality.ao;
    this.composer.addPass(this.gtao);
    this.composer.addPass(new OutputPass());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    if (w === this.w && h === this.h && this.dpr === this.currentDpr()) return;
    this.w = w; this.h = h; this.dpr = this.currentDpr();
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(this.dpr);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    // Portrait phones are width-limited: widen the vertical FOV slightly as aspect narrows so perspective stays natural.
    this.camera.fov = this.cfg.camera.fovDeg;
    this.camera.updateProjectionMatrix();
    if (this.rig) this.updateFraming(1, true);
    this.renderOnce();
  }
  currentDpr() { return Math.min(window.devicePixelRatio || 1, this.quality.maxDpr); }

  /** Points whose screen projection must stay inside the frame, in world space. */
  framePoints() {
    const pts = [];
    const b = this.baseBox;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.min.y + 0.05]) for (const z of [b.min.z, b.max.z]) pts.push(new THREE.Vector3(x, y, z));
    if (this.rig) for (const p of this.rig.coverCorners()) pts.push(this.outer.localToWorld(p.clone()));
    return pts;
  }

  /**
   * Finds the camera distance and target that place the invitation exactly in the middle
   * of the viewport (projected bounding box centred) at the requested fill.
   * Camera orientation is the original one, so the composition is preserved.
   */
  solveFraming() {
    const p = this.progress;
    const fill = lerp(this.cfg.camera.fillClosed, this.cfg.camera.fillOpen, ease.inOutCubic(p));
    const wide = this.camera.aspect > 1;          // landscape: leave room for the logo above
    const fillY = lerp(wide ? 0.42 : 0.56, wide ? 0.46 : 0.66, ease.inOutCubic(p));
    const pts = this.framePoints();
    const center = new THREE.Box3().setFromPoints(pts).getCenter(new THREE.Vector3());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camQuat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camQuat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camQuat);
    const cam = this.solverCam ||= new THREE.PerspectiveCamera();
    cam.fov = this.camera.fov; cam.aspect = this.camera.aspect; cam.near = 0.05; cam.far = 60; cam.updateProjectionMatrix();
    cam.quaternion.copy(this.camQuat);
    let target = center.clone(), dist = 6;
    const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), tanX = tanY * cam.aspect;
    for (let it = 0; it < 6; it++) {
      cam.position.copy(target).addScaledVector(fwd, -dist); cam.updateMatrixWorld(true);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const q of pts) { _v.copy(q).project(cam); minX = Math.min(minX, _v.x); maxX = Math.max(maxX, _v.x); minY = Math.min(minY, _v.y); maxY = Math.max(maxY, _v.y); }
      const sx = (maxX - minX) / 2 / fill, sy = (maxY - minY) / 2 / fillY;
      const s = Math.max(sx, sy);
      const cx = (maxX + minX) / 2, cy = (maxY + minY) / 2;
      // shift target so the projected centre lands on NDC (0,0)
      target.addScaledVector(right, cx * tanX * dist).addScaledVector(up, cy * tanY * dist);
      dist *= s;
    }
    return { target, dist };
  }

  updateFraming(dt, snap = false) {
    const { target, dist } = this.solveFraming();
    const f = this.frame;
    if (snap || !f.ready) { f.target.copy(target); f.dist = dist; f.ready = true; }
    else {
      const k = this.reduced ? 20 : 5.5;
      f.target.x = damp(f.target.x, target.x, k, dt); f.target.y = damp(f.target.y, target.y, k, dt); f.target.z = damp(f.target.z, target.z, k, dt);
      f.dist = damp(f.dist, dist, k, dt);
    }
  }

  setProgress(p) { this.progress = clamp(p, 0, 1); }
  setTilt(x, y) { this.tilt.x = x; this.tilt.y = y; }
  setParallax(x, y) { this.parallax.x = x; this.parallax.y = y; }

  applyCamera(time) {
    const f = this.frame;
    const fwd = _v.set(0, 0, -1).applyQuaternion(this.camQuat);
    // Intro: slow dolly-in (the intent of the camera animation in the source file).
    const intro = ease.outCubic(clamp(this.introT));
    const dist = f.dist * lerp(1.12, 1, intro);
    this.camera.quaternion.copy(this.camQuat);
    this.camera.position.copy(f.target).addScaledVector(fwd, -dist);
    // Tilt parallax: a small camera shift in its own plane; the object stays framed.
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camQuat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camQuat);
    const amp = dist * 0.018;
    // Pure translation in the image plane: orientation (incl. the original roll) never changes.
    this.camera.position.addScaledVector(right, this.parallax.x * amp).addScaledVector(up, this.parallax.y * amp);

    // Object: tilt + restrained float (rotation about the folio's own centre).
    const float = this.reduced ? 0 : 1;
    const t = time;
    this.stage.rotation.set(
      this.tilt.x + float * Math.sin(t * 0.55) * 0.006,
      this.tilt.y + float * Math.sin(t * 0.37 + 1.3) * 0.008 + (1 - intro) * 0.05,
      float * Math.sin(t * 0.43 + 0.4) * 0.003,
    );
    this.stage.position.y = float * Math.sin(t * 0.7) * 0.004 + (1 - intro) * -0.04;
  }

  start() {
    if (this.running) return;
    this.warmup = this.everStarted ? 1.5 : 3; this.everStarted = true; this.frameTimes.length = 0; // warm-up: loading / resuming is not a slow device
    this.running = true; this.timer.reset?.();
    const loop = now => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.timer.update(now);
      const dt = Math.min(this.timer.getDelta(), 1 / 10);   // real-time even on slow devices
      this.elapsed += dt;
      this.tick(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  tick(dt) {
    if (!this.rig) return;
    if (this.introT < 1) this.introT = Math.min(1, this.introT + dt / 2.4);
    this.beforeTick?.(dt);
    this.rig.setProgress(this.progress);
    this.updateFraming(dt);
    this.applyCamera(this.elapsed);
    const t0 = performance.now();
    this.composer.render(dt);
    this.watchPerformance(performance.now() - t0, dt);
  }

  renderOnce() {
    if (!this.rig || !this.composer) return;
    this.rig.setProgress(this.progress);
    this.applyCamera(this.elapsed);
    this.composer.render();
  }

  /**
   * Adaptive quality, measured only after a warm-up (loading, shader compilation and texture
   * upload make the first frames slow on every phone — they must not count). If frames stay
   * slow: first ambient occlusion goes, then resolution steps down, but never below minDpr.
   */
  watchPerformance(cpuMs, dt) {
    if ((this.warmup = (this.warmup ?? 3) - dt) > 0) return;
    const ft = this.frameTimes; ft.push(dt * 1000);
    if (ft.length < 120) return;
    ft.sort((a, b) => a - b);
    const median = ft[ft.length >> 1]; ft.length = 0;      // median: ignores one-off hitches
    if (median > 30) {
      if (this.gtao.enabled) { this.gtao.enabled = false; console.info('[quality] AO off'); }
      else if (this.quality.maxDpr - 0.25 >= this.quality.minDpr) { this.quality.maxDpr -= 0.25; this.resize(); console.info('[quality] dpr', this.quality.maxDpr); }
    }
  }

  /** Screen-space projection of the cover's free edge — used to scale finger travel. */
  projectedCoverSpan() {
    if (!this.rig) return this.h * 0.3;
    // on-screen distance between the spine and the cover's free edge in the CLOSED pose
    const a = this.outer.localToWorld(this.rig.hingePoint()).project(this.camera);
    const b = this.outer.localToWorld(this.rig.freeEdge(0)).project(this.camera);
    return Math.hypot((a.x - b.x) * this.w, (a.y - b.y) * this.h) / 2;
  }

  /** Does a screen point hit the invitation? (raycast against the original meshes) */
  hitTest(clientX, clientY) {
    if (!this.outer) return false;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = this.ray ||= new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    // cheap pre-test against the box before the triangle test
    const box = new THREE.Box3().setFromPoints(this.framePoints());
    if (!ray.ray.intersectsBox(box)) return false;
    return ray.intersectObjects([this.outer, this.inner], false).length > 0;
  }

  dispose() {
    this.stop();
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) for (const m of [].concat(o.material)) { for (const k in m) if (m[k]?.isTexture) m[k].dispose(); m.dispose(); }
    });
    this.envRT.dispose();
    this.composer?.dispose();
    this.gtao?.dispose?.();
    this.renderer.dispose();
  }
}
