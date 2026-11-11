// Loads the ORIGINAL glTF without any network request for its embedded buffers.
//
// invite.gltf stores its geometry as base64 `data:` URIs. GLTFLoader would fetch() those,
// which sandboxed hosts with a Content-Security-Policy (`connect-src 'self'`) block — the
// cause of "초대장을 불러오지 못했습니다" in the preview. Here the base64 is decoded locally and
// the same bytes are packed into an in-memory GLB (a lossless container change: identical
// accessors, bufferViews, nodes, meshes, animation). Nothing about the model is altered.
//
// Source order: 1) fetch the .gltf file (with progress)  2) if fetching is not allowed at all,
// import the same JSON from assets/models/invite.gltf.js (generated verbatim from the .gltf).

export async function loadModelAsGLB(url, moduleUrl, onProgress) {
  let json;
  try {
    json = await fetchJSON(url, onProgress);
  } catch (err) {
    console.warn('[model] fetch unavailable, using module copy:', err?.message || err);
    const mod = await import(new URL(moduleUrl, document.baseURI).href);
    json = typeof mod.default === 'string' ? JSON.parse(mod.default) : structuredClone(mod.default);
    onProgress?.(1);
  }
  const glb = gltfJsonToGlb(json);
  glb.warnings = gltfJsonToGlb.lastWarnings || [];
  return glb;
}

async function fetchJSON(url, onProgress) {
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !total) return JSON.parse(await res.text());
  const reader = res.body.getReader();
  const chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length; onProgress?.(Math.min(1, got / total));
  }
  return JSON.parse(new TextDecoder().decode(concat(chunks, got)));
}

function concat(parts, length) {
  const out = new Uint8Array(length); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function decodeDataUri(uri) {
  const m = /^data:[^;,]*(;base64)?,(.*)$/s.exec(uri);
  if (!m) throw new Error('External buffer URIs are not supported: ' + uri.slice(0, 60));
  if (!m[1]) return new TextEncoder().encode(decodeURIComponent(m[2]));
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Packs a glTF JSON with embedded (data:) buffers and images into a GLB ArrayBuffer.
 * Bytes are copied unchanged. An image exported with an EMPTY uri (nothing to load) is
 * dropped together with the texture slots that point at it; the rest of that material
 * (factors, other maps) is kept. Returned `warnings` lists what was missing in the file.
 */
export function gltfJsonToGlb(json) {
  const out = structuredClone(json);
  const warnings = [];
  const chunks = [];                          // { bytes } in BIN order
  let size = 0;
  const push = bytes => { size = align(size, 8); const at = size; chunks.push({ at, bytes }); size += bytes.length; return at; };

  const bufBase = (out.buffers || []).map(b => push(decodeDataUri(b.uri)));
  for (const bv of out.bufferViews || []) { bv.byteOffset = bufBase[bv.buffer] + (bv.byteOffset || 0); bv.buffer = 0; }

  // images: data: → bufferView; empty uri → remove (and every texture/material slot using it)
  const dropImages = new Set();
  (out.images || []).forEach((img, i) => {
    if (img.uri && img.uri.startsWith('data:')) {
      const mime = /^data:([^;,]+)/.exec(img.uri)?.[1] || 'image/png';
      const bytes = decodeDataUri(img.uri);
      const at = push(bytes);
      out.bufferViews.push({ buffer: 0, byteOffset: at, byteLength: bytes.length });
      delete img.uri; img.bufferView = out.bufferViews.length - 1; img.mimeType = mime;
    } else if (!img.uri && img.bufferView === undefined) {
      dropImages.add(i);
    } else if (img.uri) {
      warnings.push(`image ${i}: external file "${img.uri}" is not bundled`);
      dropImages.add(i);
    }
  });
  if (dropImages.size) {
    const dropTex = new Set((out.textures || []).map((t, i) => (dropImages.has(t.source) ? i : -1)).filter(i => i >= 0));
    for (const m of out.materials || []) {
      const slots = [[m.pbrMetallicRoughness, 'baseColorTexture'], [m.pbrMetallicRoughness, 'metallicRoughnessTexture'],
        [m, 'normalTexture'], [m, 'occlusionTexture'], [m, 'emissiveTexture']];
      for (const [o, k] of slots) if (o && o[k] && dropTex.has(o[k].index)) {
        warnings.push(`material "${m.name}": ${k} image is empty in the file`);
        delete o[k];
      }
    }
    // keep indices stable: point dropped textures at a surviving image so nothing references a hole
    const keep = (out.images || []).findIndex((_, i) => !dropImages.has(i));
    for (const t of out.textures || []) if (dropImages.has(t.source)) t.source = keep >= 0 ? keep : 0;
    if (keep < 0) { delete out.images; delete out.textures; }
    else for (const i of [...dropImages].sort((a, b) => b - a)) {
      out.images.splice(i, 1);
      for (const t of out.textures) if (t.source > i) t.source -= 1;
    }
  }

  out.buffers = [{ byteLength: size }];
  const bin = new Uint8Array(align(size, 4));
  for (const c of chunks) bin.set(c.bytes, c.at);

  const jsonBytes = new TextEncoder().encode(JSON.stringify(out));
  const jsonLen = align(jsonBytes.length, 4);
  const total = 12 + 8 + jsonLen + 8 + bin.length;
  const glb = new ArrayBuffer(total);
  const dv = new DataView(glb), u8 = new Uint8Array(glb);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);         // 'JSON'
  u8.fill(0x20, 20, 20 + jsonLen); u8.set(jsonBytes, 20);
  const binHdr = 20 + jsonLen;
  dv.setUint32(binHdr, bin.length, true); dv.setUint32(binHdr + 4, 0x004e4942, true); // 'BIN\0'
  u8.set(bin, binHdr + 8);
  if (warnings.length) console.warn('[model]', warnings.join(' · '));
  gltfJsonToGlb.lastWarnings = warnings;
  return glb;
}

const align = (n, a) => Math.ceil(n / a) * a;
