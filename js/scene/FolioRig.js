// Opens and closes the ORIGINAL "outer" mesh with a two-joint paper hinge.
//
// Model v2 (invite.gltf with materials): "outer" is one welded shell — base board + window
// mat + front cover joined along the spine (mesh-space z ≈ −1.0). It is exported OPEN: the
// cover rises from the spine at 125.53° to the base. That pose is kept EXACTLY as the
// fully-open state (progress 1 reproduces every original vertex position and normal).
//
// Closing works like a real hard-cover folio (two hinges):
//   joint 1 — the spine strip (from the base's outer corner C0 up to D, length Ls along the
//             cover's outer face) swings from 125.53° to an almost upright 100°;
//   joint 2 — the cover swings about D until it lies flat on the mat (inner face 3 mm above).
// Vertices blend between static / strip / cover over short bands, so the paper creases
// instead of tearing. Nothing is cut, added or re-meshed; topology and UVs are untouched.
// All numbers are measured from the mesh (README → "Hinge").

import * as THREE from 'three';
import { smoothstep } from '../util/motion.js';

const DEG = Math.PI / 180;

export class FolioRig {
  constructor(outerMesh, h) {
    this.mesh = outerMesh;
    this.geo = outerMesh.geometry;
    this.h = h;
    this.rest = h.restAngleDeg * DEG;
    this.spineClosed = h.spineClosedDeg * DEG;
    this.overOpen = (h.overOpenDeg ?? 6) * DEG;
    this.p = 1;

    // glTF stores POSITION/NORMAL interleaved; copy value-for-value into own buffers to animate.
    for (const name of ['position', 'normal']) {
      const a = this.geo.attributes[name];
      if (a.isInterleavedBufferAttribute) {
        const arr = new Float32Array(a.count * 3);
        for (let i = 0; i < a.count; i++) { arr[i * 3] = a.getX(i); arr[i * 3 + 1] = a.getY(i); arr[i * 3 + 2] = a.getZ(i); }
        this.geo.setAttribute(name, new THREE.BufferAttribute(arr, 3));
      }
    }
    const pos = this.geo.attributes.position, nor = this.geo.attributes.normal;
    this.restP = Float32Array.from(pos.array);
    this.restN = Float32Array.from(nor.array);

    // cover direction d (spine → free edge, rest pose) and slab normal n (towards the inner face)
    const dz = Math.cos(this.rest), dy = Math.sin(this.rest);
    const nz = dy, ny = -dz;
    const C0z = h.cornerZ, C0y = h.cornerY;
    this.Ls = (h.coverInnerClosedY + h.thickness - C0y) / Math.sin(this.spineClosed);   // strip length
    this.Dz = C0z + this.Ls * dz; this.Dy = C0y + this.Ls * dy;                        // joint 2, rest pose
    const b = h.band;

    const idx = [], G1 = [], G2 = [];
    const coverBox = new THREE.Box3(), v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const y = this.restP[i * 3 + 1], z = this.restP[i * 3 + 2];
      const t = (z - C0z) * dz + (y - C0y) * dy;                          // along the cover from C0
      const off = (z - h.midZ) * nz + (y - h.midY) * ny;                  // across the slab
      const high = y > h.coverMinY;
      const coverSide = (off <= h.thickness / 2 + 0.004 || high) && t > -0.004;
      let g1 = coverSide ? smoothstep(0, b, t) : 0;
      let g2 = coverSide ? smoothstep(this.Ls - b, this.Ls + b, t) : 0;
      if (high) { g1 = 1; if (t > this.Ls + b) g2 = 1; }
      if (g1 > 1e-4 || g2 > 1e-4) { idx.push(i); G1.push(g1); G2.push(g2); }
      if (g2 > 0.999) coverBox.expandByPoint(v.set(this.restP[i * 3], y, z));
    }
    this.idx = Uint32Array.from(idx);
    this.g1 = Float32Array.from(G1);
    this.g2 = Float32Array.from(G2);
    this.coverBox = coverBox;

    outerMesh.frustumCulled = false;
    pos.setUsage(THREE.DynamicDrawUsage);
    nor.setUsage(THREE.DynamicDrawUsage);
  }

  /** Joint angles for a progress value: 0 = closed, 1 = modelled pose, (1, 1.05] = soft overshoot. */
  joints(p) {
    const q = Math.min(p, 1);
    const extra = p > 1 ? Math.min(p - 1, 0.05) / 0.05 * this.overOpen : 0;
    const a1 = (this.spineClosed - this.rest) * (1 - q);       // strip rotation about C0
    const a2 = -this.rest * (1 - q) + extra;                    // cover rotation (about the moving joint D)
    const phi = this.rest + a1;
    return { a1, a2, Dz: this.h.cornerZ + this.Ls * Math.cos(phi), Dy: this.h.cornerY + this.Ls * Math.sin(phi) };
  }

  setProgress(p) {
    if (Math.abs(p - this.p) < 1e-6) return false;
    this.p = p;
    const { a1, a2, Dz, Dy } = this.joints(p);
    const c1 = Math.cos(a1), s1 = Math.sin(a1), c2 = Math.cos(a2), s2 = Math.sin(a2);
    const C0z = this.h.cornerZ, C0y = this.h.cornerY, Rz = this.Dz, Ry = this.Dy;
    const P = this.geo.attributes.position.array, N = this.geo.attributes.normal.array;
    const rp = this.restP, rn = this.restN, idx = this.idx, G1 = this.g1, G2 = this.g2;
    for (let k = 0; k < idx.length; k++) {
      const i3 = idx[k] * 3, g1 = G1[k], g2 = G2[k];
      const z = rp[i3 + 2], y = rp[i3 + 1];
      // joint 1: rotate about C0
      let qz = C0z + (z - C0z) * c1 - (y - C0y) * s1;
      let qy = C0y + (z - C0z) * s1 + (y - C0y) * c1;
      qz = z + (qz - z) * g1; qy = y + (qy - y) * g1;
      // joint 2: rotate about the rest joint D, then carry D to its current position
      const wz = Dz + (z - Rz) * c2 - (y - Ry) * s2;
      const wy = Dy + (z - Rz) * s2 + (y - Ry) * c2;
      P[i3 + 2] = qz + (wz - qz) * g2;
      P[i3 + 1] = qy + (wy - qy) * g2;
      const a = a1 * g1 * (1 - g2) + a2 * g2, c = Math.cos(a), s = Math.sin(a);
      const nz = rn[i3 + 2], ny = rn[i3 + 1];
      N[i3 + 2] = nz * c - ny * s;
      N[i3 + 1] = nz * s + ny * c;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
    return true;
  }

  /** Mesh-space corners of the cover for a progress value (default: current). */
  coverCorners(out = [], p = this.p) {
    const b = this.coverBox, { a2, Dz, Dy } = this.joints(p), c = Math.cos(a2), s = Math.sin(a2);
    let k = 0;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      (out[k++] ||= new THREE.Vector3()).set(x, Dy + (z - this.Dz) * s + (y - this.Dy) * c, Dz + (z - this.Dz) * c - (y - this.Dy) * s);
    }
    return out;
  }

  /** Mesh-space point on the cover's free edge for a progress value. */
  freeEdge(p = this.p) {
    const b = this.coverBox, { a2, Dz, Dy } = this.joints(p), c = Math.cos(a2), s = Math.sin(a2);
    const z = b.min.z, y = b.max.y;
    return new THREE.Vector3(0, Dy + (z - this.Dz) * s + (y - this.Dy) * c, Dz + (z - this.Dz) * c - (y - this.Dy) * s);
  }

  /** Mesh-space point on the spine (for gesture scaling). */
  hingePoint() { return new THREE.Vector3(0, this.h.cornerY + 0.05, this.h.cornerZ); }
}
