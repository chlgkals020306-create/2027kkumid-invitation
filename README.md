# Rare Taste — Interactive 3D Mobile Invitation

Static site, no build step. three.js r187 is vendored in `vendor/three` (MIT).

```
python3 -m http.server 8080      # or any static server
open http://localhost:8080       # must be served over http(s), not file://
```

Phones need HTTPS for the tilt sensor (iOS also asks for permission on the first touch).

## Experience

| State | What happens |
|---|---|
| `LOADING` | Figma background, logo and a thin progress line show immediately |
| `CLOSED` | Folio centred in the viewport, gentle float, tilt parallax. Swipe cue (Figma 220:6): a white dot rises inside a rounded stroke, above "위쪽으로 스와이프 해보세요! / 카드가 열릴 거에요" |
| `OPENING` / `CLOSING` | Cover rotates on its real spine, tied 1:1 to the finger. On release it completes or springs back (threshold + flick velocity) |
| `OPEN` | Cover fully unfolded; Page 2 is triggered 260 ms after an opening gesture |
| `PAGE_TRANSITION_IN` | Page 2 travels up from below the screen; Page 1 recedes and dims |
| `PAGE_02` | Scrollable content. 3D rendering is paused but the scene stays mounted |
| `PAGE_TRANSITION_OUT` | A pull down that **starts at the top** of the content returns to the open card |

Swipe down on Page 1 folds the card closed again. The cycle can be repeated any number of times.
Desktop preview supports mouse drag, wheel/trackpad, ↑/↓ and Esc.
`?qa=1` gives a low-cost render mode, used only for automated tests.

## 3D asset analysis (`assets/models/invite.gltf` v2, unmodified)

* Cinema 4D glTF export with materials:
  * `outer` mesh: 14,628 verts / 26,492 tris, material **"orange"** (base-colour texture + paper normal map at scale 0.5, roughness 0.5).
  * `inner` mesh: 180 verts / 204 tris, material **"white"** (paper normal map at scale 1.0).
  * Both normal maps use the same embedded 2048×1201 PNG.
* **Textures come from `untitled.glb`** (Blender export of the same mesh: identical triangle count and UVs, verified vertex by vertex).
  * `orange_folder` (2160²): cover print, inside print, QR code.
  * `white_card` (2160²): YOU'RE INVITED! card.
  * They are stored in `assets/textures/` as lossless WebP (pixel-identical), with the original PNG bytes as fallback.
  * The GLB's normal map is byte-identical to the one in invite.gltf. Its orange normal strength (0.2) is applied.
  * invite.gltf still provides the geometry, the camera and the opening rig, as requested.
* **`outer` is one welded shell:** a base board, a window mat with semicircular notches, and the front cover, joined at the spine.
* **It is exported OPEN.** The cover rises from the spine at 125.53°. That pose is used *exactly* as the fully-open state, so the scene at progress 1 is the original model.
* The camera uses the static pose of the file's `OctaneCamera`. Distance and target are solved each frame so the invitation sits at the exact centre.

## Hinge

`js/scene/FolioRig.js` closes the cover with two joints measured from the mesh:

1. **Spine strip.** It runs from the base's outer corner C0 (y −0.0227, z −0.9514) for 0.094 along the cover's outer face, and swings from 125.53° to 100° about C0, so the closed spine is almost upright.
2. **Cover.** It swings about the top of the strip until its inner face rests 3 mm above the mat (mat top y 0.0415). Its free edge then overhangs the base by 0.046, like the squares of a hardcover book.
   A flush edge would force a spine leaning back about 29°.

Vertices blend over 0.014-wide crease bands, so the paper folds without tearing or intersecting the mat (checked in cross-section at every stage).
Position and normal are de-interleaved value-for-value so they can be animated. Topology and UVs are untouched.

## Personal invitation (To. / From.)

* **Plain link:** the card's To./From. lines are inputs, and "초대장 링크 복사하기" creates a personal link (share sheet on phones, clipboard elsewhere).
* **One sender, many recipients:** names typed but not yet sent survive a reload. As soon as a link has been made (shared or copied), the saved names are cleared, so reloading the page gives a blank To / From for the next person.
* **Personal link** (`#i-…`): the names are printed as text. There are no inputs in the DOM, so the recipient cannot edit them.
* **Name data:** UTF-8 JSON as hex plus a salted checksum. A hand-edited link fails the check and shows the card without names.
  This is casual-tamper protection; a static site has no server to sign links. The hash is never sent to the web server.
* Names keep Figma's proportion on the card (Pretendard Bold, 24/857 of the card width), right-aligned to the end of the underline.
  Long names shrink to fit.

## Sharing (KakaoTalk)

* **What is sent** (`config.js → share.message`, the link added on the last line):

  ```
  [제36회 건국대학교 글로컬캠퍼스 시각영상디자인학과 영상/디지털트랙 졸업전시회]

  저희의 취향과 색으로 완성한 작품들이 한자리에 모인 특별한 순간에 당신을 초대합니다.
  아래 초대장을 열어 특별한 순간을 함께해 주세요!
  Keep It Rare!

  https://…/#i-…   ← the personal invitation link
  ```
* **Share button.**
  * iPhone / Android browsers: the share sheet receives this as one text, so KakaoTalk sends a single message with the link preview under it.
  * In-app browsers without a share sheet (KakaoTalk, Instagram…) and computers: the same text is copied (Clipboard API, then a WebView-safe fallback). If copying is blocked too, the text is shown selected so it can be copied by hand.
* **Link preview card.** KakaoTalk builds it from the `og:` tags in `index.html` (title, description = the same message, image `assets/share/og-image.jpg`). Kakao does not run JavaScript.
* **After deploying:**
  1. Make `og:image` an absolute URL, e.g. `https://your-domain/assets/share/og-image.jpg`, and add `<meta property="og:url" content="https://your-domain/">`.
  2. Kakao caches previews. To refresh after a change, use Kakao's sharing debugger (developers.kakao.com → Tools → Sharing debugger).

## Tilt (phone sensor)

* **Where it works:** only over **HTTPS**, and not inside the claude.ai preview (its frame blocks motion sensors).
* **iOS:** the "Motion & Orientation" prompt is the only way to get motion data, and Safari shows it only in response to a tap.
  iPhones/iPads therefore open on "화면을 터치해 초대장을 시작하세요" (shown even while loading); that first tap opens the prompt at once.
  Android and desktop need no permission, so they never see this line.
  Settings: `config.js → tilt.startGate`, and `tilt.askPermission: false` to never ask.
* **Behaviour:** the card tilts up to 6° and drifts back to neutral about 4 s after the phone stops moving.
* **Mouse tilt:** only a desktop fallback when no sensor exists.
* **Testing on a phone:** deploy to any HTTPS host (e.g. drag the folder onto Netlify Drop) and open that URL.

## iPhone and Android

* iPhone (Safari and in-app browsers): start gate for the motion permission (above); inputs never auto-zoom.
* Android (Chrome, Samsung Internet, KakaoTalk WebView): tilt works without a prompt.
* The Android back button and the iOS edge swipe on Page 2 return to the 3D card instead of leaving the invitation (Page 2 owns one history entry).
* `color-scheme: only light` keeps Samsung Internet / WebView forced dark mode from inverting the Figma colours.
* If the phone drops the WebGL context (memory pressure, long time in the background), the page reloads once it comes back, instead of showing a blank card.
* Layout checked at 320, 360, 390 and 412 px wide with no horizontal overflow.

## Mobile rendering quality

* **Mipmaps.** The exported glTF samplers use `minFilter LINEAR` (no mipmaps), which made the normal map and prints alias on small phone screens. Every texture now gets trilinear mipmaps and anisotropic filtering.
* **Resolution.** Phones render at up to 2.5× (2× on low-end devices). Adaptive quality ignores the first 3 s (loading/shader compilation), uses the median frame time, drops ambient occlusion first, and never goes below 1.5×.

## Model loading (works on locked-down hosts)

`invite.gltf` keeps its geometry in base64 `data:` URIs.
GLTFLoader would `fetch()` those, and hosts with a strict Content-Security-Policy (such as the claude.ai preview) block that.
`js/scene/modelSource.js` decodes the buffers locally and passes GLTFLoader the same bytes as an in-memory GLB.
If the host blocks `fetch()` entirely, it imports the identical JSON from `assets/models/invite.gltf.js`.
All three paths were checked to produce identical nodes, positions, normals, UVs, indices and animation.

If the model changes, regenerate the module copy:
`python3 -c "s=open('assets/models/invite.gltf').read(); open('assets/models/invite.gltf.js','w').write('export default '+s.strip()+';\n')"`

## Still needed from you

1. **Adobe Fonts domain setting.** Caesura Bold loads from the Adobe Fonts kit `sut8xhy` (`index.html`; CSS family `caesura`, weight 700).
   Adobe serves a kit only to domains listed in that kit's Web Project.
   Add the site's domain there, and `localhost` for local testing. Anywhere the kit cannot load, Bodoni Moda Bold (OFL) is used instead.
   The claude.ai preview only allows Google Fonts, so it always shows the fallback.

## Site icon

`favicon.ico` (16/32/48) and `assets/icons/` are made from the supplied orange "R" icon:
browser tab (`favicon.ico`, 16/32 px PNG), Android / Chrome (`icon-192`, `icon-512` via `site.webmanifest`)
and iPhone home screen (`apple-touch-icon.png`, 180 px, square with the orange filled to the edges because iOS rounds the corners itself).
Keep `favicon.ico` at the site root. KakaoTalk's link preview uses `og:image`, not this icon.

## Figma mapping

Assets were exported from the file (Page 3 → `invitation page1` 185:4 / `초대장 페이지 2` 200:37, revised 2026-11-06) into `assets/figma/`.
1 Figma px = `--u` = `min(100vw, 480px) / 1049`.
Page 2 reproduces the frame's section positions exactly (5920 Figma px tall). Body text is Figma's 27 px; a 10 px floor only applies on very narrow phones.
The invitation inner page, location map and parking map are 2× exports of the Figma nodes. The card's drop shadow is rebuilt in CSS from Figma's five shadow layers.
The sponsor row (wider than the frame in Figma) holds, then steps one logo to the left, on a loop.

## Files

```
index.html                 markup for both pages
css/style.css              Figma-derived layout
js/config.js               all tunables (paths, colours, hinge, camera, thresholds, dates)
js/main.js                 orchestration: state machine ⇄ scene ⇄ gestures ⇄ Page 2
js/StateMachine.js         explicit states + allowed transitions
js/scene/InvitationScene.js  renderer, lights, shadows, GTAO, framing, adaptive quality
js/scene/FolioRig.js       hinge rig on the original mesh
js/scene/materials.js      original-texture slots + paper stand-in + print decals
js/scene/modelSource.js    fetch-free glTF loading (embedded buffers → in-memory GLB)
js/input/VerticalGesture.js  pointer gesture recogniser (axis lock, velocity)
js/input/TiltController.js   device-orientation parallax (iOS permission, fallback)
js/page2/Page2.js          sheet transition, pull-to-return, countdown, copy, sponsors
```
