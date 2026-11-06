// Materials for the original meshes.
// 1) If original textures are configured (CONFIG.textures), they are loaded onto the model's
//    own UVs.  2) Otherwise a physically based paper stand-in is used (ivory stock, fine
//    grain, soft sheen) so the object still reads as real paper rather than plastic.

import * as THREE from 'three';

const texLoader = new THREE.TextureLoader();

/** Loads a texture; `url` may be a list of fallbacks (e.g. lossless WebP first, original PNG second). */
function loadTex(url, srgb, maxAniso) {
  const urls = (Array.isArray(url) ? url : [url]).filter(Boolean);
  return new Promise(resolve => {
    const next = i => {
      if (i >= urls.length) return resolve(null);
      texLoader.load(urls[i], t => {
        t.flipY = false;                       // glTF UV convention
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = maxAniso;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        resolve(t);
      }, undefined, () => { console.warn('[textures] could not load', urls[i]); next(i + 1); });
    };
    next(0);
  });
}

/** Fine paper grain: low-amplitude noise + sparse fibres, tileable. */
function paperGrainTexture(size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < size * size; i++) { const v = 118 + rnd() * 20; img.data.set([v, v, v, 255], i * 4); }
  g.putImageData(img, 0, 0);
  g.globalAlpha = 0.07; g.strokeStyle = '#fff'; g.lineWidth = 0.6;
  for (let i = 0; i < 140; i++) {
    const x = rnd() * size, y = rnd() * size, a = rnd() * Math.PI, l = 4 + rnd() * 10;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      g.beginPath(); g.moveTo(x + ox, y + oy); g.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function paperMaterial(color, grain, repeat) {
  const bump = grain.clone(); bump.repeat.set(repeat, repeat); bump.needsUpdate = true;
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: 0.86,
    metalness: 0,
    specularIntensity: 0.45,
    sheen: 0.35, sheenRoughness: 0.75, sheenColor: new THREE.Color('#ffffff'),
    bumpMap: bump, bumpScale: 0.35,
    roughnessMap: bump,
    envMapIntensity: 0.35,
    side: THREE.FrontSide,
  });
}

export async function buildMaterials({ outer, inner }, cfg, renderer) {
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const grain = paperGrainTexture();
  const result = { outerHasOriginal: false, innerHasOriginal: false, notes: [] };

  for (const [mesh, key, color, repeat] of [[outer, 'outer', cfg.standIn.paper, 7], [inner, 'inner', cfg.standIn.innerCard, 5]]) {
    const fromFile = mesh.material && mesh.userData.__fromFile !== false && mesh.material.isMeshStandardMaterial
      && mesh.material.name && mesh.material.name !== '';
    const spec = cfg.textures[key] || {};
    const base = cfg.assetBase || '';
    const at = u => (u == null ? null : Array.isArray(u) ? u.map(x => base + x) : base + u);
    const [map, normalMap, roughnessMap, aoMap] = await Promise.all([
      loadTex(at(spec.map), true, aniso), loadTex(at(spec.normalMap), false, aniso),
      loadTex(at(spec.roughnessMap), false, aniso), loadTex(at(spec.aoMap), false, aniso),
    ]);
    let mat;
    if (fromFile) {
      // ORIGINAL material from the model file — kept as exported (factors, normal map, scale).
      mat = mesh.material;
      // Optional replacement files fill only what the file lacks or what the user supplies.
      if (map) mat.map = map;
      if (normalMap) mat.normalMap = normalMap;
      if (roughnessMap) mat.roughnessMap = roughnessMap;
      if (aoMap) mat.aoMap = aoMap;
      const ov = cfg.materialOverrides?.[mat.name];
      if (ov?.normalScale != null && mat.normalMap) mat.normalScale.set(ov.normalScale, ov.normalScale);
      if (ov?.roughness != null) mat.roughness = ov.roughness;
      if (mat.map) mat.color.set(0xffffff);
      if (!mat.map) {
        const fallback = cfg.missingBaseColor?.[mat.name];
        if (fallback) { mat.color.set(fallback); result.notes.push(`${key}: "${mat.name}" base-colour image missing → ${fallback}`); }
      }
      // The exported samplers use minFilter LINEAR (no mipmaps). On a phone the folio is drawn
      // small, so the 2048 px normal map / 2160 px prints are heavily minified and alias
      // ("broken" grain and text). Trilinear mipmaps + anisotropy keep them clean.
      if (!cfg.qaNoMipmaps) for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.aoMap]) if (t) {
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.anisotropy = aniso;
        t.needsUpdate = true;
      }
      mat.needsUpdate = true;
      result[key === 'outer' ? 'outerHasOriginal' : 'innerHasOriginal'] = true;
    } else if (map) {
      mat = new THREE.MeshPhysicalMaterial({
        map, normalMap, roughnessMap, aoMap, roughness: roughnessMap ? 1 : 0.85, metalness: 0,
        sheen: 0.3, sheenRoughness: 0.8,
      });
      result[key === 'outer' ? 'outerHasOriginal' : 'innerHasOriginal'] = true;
    } else {
      mat = paperMaterial(color, grain, repeat);
      if (key === 'inner') { mat.sheen = 0.0; mat.roughness = 0.9; mat.specularIntensity = 0.22; mat.bumpScale = 0.25; }
      mat.name = `${key}-paper (stand-in)`;
    }
    mesh.material = mat;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  return result;
}

/** Recolours the opaque pixels of an image (keeps its alpha) → texture for a print decal. */
export async function inkTexture(url, color, renderer) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';           // keeps the canvas untainted on sandboxed / CDN hosts
    i.onload = () => res(i); i.onerror = () => rej(new Error('image ' + url)); i.src = url;
  });
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
  g.getImageData(0, 0, 1, 1);               // throws now (caught upstream) if the canvas is tainted
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return { texture: t, aspect: img.naturalWidth / img.naturalHeight };
}

export function decalMaterial(texture) {
  return new THREE.MeshPhysicalMaterial({
    map: texture, transparent: true, alphaTest: 0.02, depthWrite: false,
    roughness: 0.82, metalness: 0, specularIntensity: 0.25, envMapIntensity: 0.3,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
}
