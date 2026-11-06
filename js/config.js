// Central configuration. Everything a designer may want to tune lives here.

export const CONFIG = {
  // Original model, loaded unmodified (Cinema 4D glTF export: meshes "outer" + "inner").
  assetBase: '',
  model: 'assets/models/invite.gltf',
  modelModule: 'assets/models/invite.gltf.js',   // same JSON as a module — used only where fetch() is blocked

  // ── Original materials / textures ──────────────────────────────────────────
  // Geometry, camera and the opening rig come from invite.gltf (v2).
  // Textures + material values come from the Blender export untitled.glb (same mesh: identical
  // triangle count and UVs, verified). Its colour images are stored pixel-identical as lossless
  // WebP, with the original PNG bytes as fallback. Its normal map is byte-identical to the one
  // already inside invite.gltf.
  textures: {
    outer: { map: ['assets/textures/orange_folder.webp', 'assets/textures/orange_folder.png'], normalMap: null, roughnessMap: null, aoMap: null },
    inner: { map: ['assets/textures/white_card.webp', 'assets/textures/white_card.png'], normalMap: null, roughnessMap: null, aoMap: null },
  },
  // material values from untitled.glb that differ from invite.gltf
  materialOverrides: { orange: { normalScale: 0.2 } },
  missingBaseColor: { orange: '#e8611c' },   // only if the texture above fails to load

  // Stand-in surface — only used if a mesh arrives with no material at all.
  standIn: {
    paper: '#eee7da',
    innerCard: '#e4500c',
    print: false,            // brand-mark decals: off, the model now has its own materials
  },

  // ── Hinge rig (measured from the mesh — see README → "Hinge") ─────────────
  // The model is exported OPEN (cover at 125.53° to the base); that pose = fully open.
  // Closing uses two joints like a real hard-cover folio: the spine strip stands up
  // (125.53° → 100°) around the base's outer corner, the cover lies down on the mat.
  hinge: {
    restAngleDeg: 125.5315,  // cover direction in the exported pose
    spineClosedDeg: 100,     // spine strip when closed (≈ upright)
    cornerZ: -0.95141,       // C0: outer corner where the base bottom meets the cover's outer face
    cornerY: -0.0227,
    midZ: -1.49762,          // a point on the cover slab's mid-plane (rest pose)
    midY: 0.76247,
    thickness: 0.0252,       // cover board thickness
    coverInnerClosedY: 0.0445, // closed: inner face 3 mm above the mat top (0.0415)
    coverMinY: 0.075,        // away from the spine, everything above this is cover
    band: 0.014,             // crease blend width
    overOpenDeg: 6,
  },

  // ── Camera: original Octane camera, static pose from the glTF ─────────────
  camera: {
    pitchDeg: 64.5,
    yawDeg: -17.1,
    fovDeg: 28,
    fillClosed: 0.80,        // object width as a fraction of the viewport width
    fillOpen: 0.84,
  },

  gesture: {
    lockPx: 9,               // movement before a gesture is classified
    verticalBias: 1.15,      // |dy| must exceed |dx| * bias to count as vertical
    openThreshold: 0.42,     // progress needed on release to complete opening
    closeThreshold: 0.58,    // progress below which a release completes closing
    flick: 0.55,             // px / ms
    toPage2Px: 70,           // upward swipe on an already-open card → Page 2
  },

  page2: {
    delayAfterOpenMs: 260,
    inMs: 980,
    outMs: 760,
    pullCloseFrac: 0.2,      // pull Page 2 down by 20 % of the height → back to Page 1
  },

  openingAt: '2026-11-19T13:00:00+09:00',

  // Phone tilt. iOS only delivers motion data after the "Motion & Orientation" prompt is
  // accepted, and Safari shows that prompt only in response to a tap. With startGate on,
  // iPhones open on "화면을 터치해 초대장을 시작하세요": the first tap shows the prompt at once.
  // Android / desktop need no permission → no gate. askPermission:false = never ask.
  tilt: { askPermission: true, startGate: true, maxRotDeg: 6, rangeDeg: 15, returnSeconds: 4 },

  // Text sent with the invitation link (KakaoTalk / share sheet / clipboard). The personal
  // invitation link is appended on its own line after a blank line (where the brief says "링크").
  // Keep og:description in index.html in step — it is what the KakaoTalk preview card shows.
  share: {
    message: '[제36회 건국대학교 글로컬캠퍼스 시각영상디자인학과 영상/디지털트랙 졸업전시회]\n\n저희의 취향과 색으로 완성한 작품들이 한자리에 모인 특별한 순간에 당신을 초대합니다.\n아래 초대장을 열어 특별한 순간을 함께해 주세요!\nKeep It Rare!',
  },
};
