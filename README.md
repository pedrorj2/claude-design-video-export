<div align="center">

# claude-design-video-export

**Export the animated HTML promos from Claude Design as MP4 video.**

`720p`  ·  `1080p`  ·  `1440p`  ·  `4K`  ·  NVENC-accelerated  ·  frame-deterministic

</div>

---

> [!NOTE]
> This project is not affiliated with Anthropic. *Claude* and *Claude Design* are trademarks of Anthropic. This is a community tool that consumes the standalone HTML format that Claude exports.

---

## Why

When Claude Design builds an animated promo and you click **Export as standalone HTML**, the resulting file contains:

- the animation, rendered inside a `<Stage width={W} height={H} duration={D}>` React component;
- a baked-in **video-player chrome** at the bottom (play/pause, progress bar, time counter);
- an inner **`"XX.Xs / YY.Ys"` counter watermark** inside the scene.

> [!CAUTION]
> Useful as a preview, but not as an asset. You cannot post the HTML on social, embed it as a `<video>`, or drop it into a non-linear editor.

This tool turns the HTML into a clean MP4 — chrome clipped, watermark optionally hidden, every frame rendered deterministically at the resolution of your choice — regardless of how slow the host machine is.

<table>
<tr>
<th align="center">Standalone HTML</th>
<th align="center">This tool</th>
</tr>
<tr>
<td>

- Locked to the browser
- Black frame around the ad
- Player chrome at the bottom
- Watermark in the corner
- Real-time playback only

</td>
<td>

- Plain MP4 file
- Native at 720p / 1080p / 1440p / 4K
- Chrome and watermark hidden
- Pixel-perfect text
- Frame-deterministic capture

</td>
</tr>
</table>

---

## Features

- **Auto-detection.** Parses the `<Stage>` tag for width, height, and duration. Zero config in the common case.
- **Pixel-perfect rendering.** Output is rendered natively at the target resolution. No upscaling, no blurry text.
- **Frame-deterministic capture.** Mocks `Date.now`, `performance.now`, and `requestAnimationFrame` so the animation is advanced in lockstep with the capture loop. No dropped frames, reproducible across runs.
- **Hardware-accelerated encoding.** Uses NVENC when an NVIDIA GPU is present; falls back to libx264 / libx265 transparently.
- **Clean output by default.** The player chrome and inner timer watermark are hidden by default; both are individually toggleable.
- **Two interfaces.** An interactive menu (`npm start`) for one-off renders and a pure CLI (`node render.mjs …`) for scripts and CI.

---

## Demo

### Interactive menu

```text
╭─ claude-design-video-export ─────────────────────────╮
│  Render standalone Claude HTML promos to MP4 video   │
╰──────────────────────────────────────────────────────╯

? Select HTML  (1 bundle / 3 total found in: my-project):
❯ ✓  hero_promo.html     [1.3 MB]  — /Users/you/my-project
  ·  test.html           [4 KB]    — /Users/you/my-project
  ──────────
    Expand search to ~/Downloads
    Expand search to ~/Desktop
    Browse for another file…
    Exit

detected stage: 1920×1080   duration: 44s

? Resolution
  4K      3840×2160
  1440p   2560×1440
❯ 1080p   1920×1080   (recommended)
  720p    1280×720    (draft)

? Frame rate: 60 fps — smooth
? Quality: high — CQ 15, archival / master
? Include the video player bar at the bottom? No
? Include the inner "XX.Xs / 44.0s" counter watermark? No
? Output MP4 path: hero_promo_1080p.mp4
? Render now? Yes

[render] capturing 2640 frames at 1920x1080 @ 60fps
[render] 2640/2640  0.12s/f  elapsed 315s  ETA 0s
[encode] encoder: h264_nvenc   bitrate target 16M  cq/crf 15
✔ hero_promo_1080p.mp4
  size: 48.2 MB  duration: 44s  1920x1080 @ 60fps
```

### Direct CLI

```sh
node render.mjs ./hero_promo.html --res 4k --quality high
```

---

## Installation

```sh
git clone https://github.com/pedrorj2/claude-design-video-export.git
cd claude-design-video-export
npm install
```

> [!IMPORTANT]
> Requirements
> - **Node.js** ≥ 20
> - **ffmpeg** on `PATH` (with NVENC support if you want hardware encoding)
> - ~150 MB free for the Chromium that Puppeteer downloads on first install (cached at `~/.cache/puppeteer/`)

<details>
<summary><b>Installing ffmpeg</b></summary>

| OS | Command |
|---|---|
| Windows | `choco install ffmpeg` or download from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) |
| macOS | `brew install ffmpeg` |
| Linux (Debian/Ubuntu) | `sudo apt install ffmpeg` |
| Linux (Arch) | `sudo pacman -S ffmpeg` |
| Linux (custom build) | `--enable-nvenc --enable-libnpp --enable-cuda-nvcc` for NVENC |

</details>

> [!TIP]
> If you do not have an NVIDIA GPU, the tool detects it and uses `libx264` / `libx265` automatically. Output quality is identical; encode time is 5–10× longer.

---

## Usage

### Interactive menu (recommended)

```sh
npm start
```

The menu:

1. Scans the repo folder (two levels deep) for HTML files.
2. Marks Claude bundles with `✓` and other HTMLs with `·`. Bundles are sorted first.
3. Lets you expand the search on demand to `~/Downloads`, `~/Desktop`, or your current working directory.
4. **Browse for another file…** accepts any path. Empty input returns to the list.
5. **Exit** quits cleanly.
6. Walks you through resolution, framerate, quality, chrome and timer visibility, and output path.
7. On completion, offers to open the resulting MP4.

> [!TIP]
> <kbd>Ctrl</kbd>+<kbd>C</kbd> at any prompt cancels cleanly.

### From VS Code

1. **File → Open Folder…** and select `claude-design-video-export/`.
2. Open the integrated terminal (<kbd>Ctrl</kbd>+<kbd>`</kbd>, or <kbd>Ctrl</kbd>+<kbd>ñ</kbd> on Spanish layouts).
3. First time only: `npm install`.
4. Any time: `npm start`.

### Direct CLI

```sh
node render.mjs <input.html> [options]
```

Defaults: `1080p`, `60 fps`, `high` quality, chrome hidden, timer hidden, NVENC if available.

---

## Options

| Flag | Default | Description |
|---|---|---|
| `--res <preset>` | `1080p` | `720p` · `1080p` · `1440p` · `4k` |
| `--fps <n>` | `60` | Frame rate (30, 60, …) |
| `--duration <s>` | auto | Override auto-detected duration |
| `--stage <WxH>` | auto | Override auto-detected stage size, e.g. `1920x1080` |
| `-o, --output <path>` | `<input>_<res>.mp4` | Output MP4 path |
| `--show-chrome` | off | Include the player chrome (play/pause/progress bar) |
| `--show-timer` | off | Include the inner `"XX.Xs / YY.Ys"` watermark |
| `--quality <l>` | `high` | `low` (CQ 23) · `mid` (CQ 19) · `high` (CQ 15) |
| `--codec <c>` | `h264` | `h264` · `hevc` |
| `--encoder <e>` | `auto` | `nvenc` · `libx264` · `libx265` · `auto` |
| `--real-time` | off | Disable the mocked clock (slower, less deterministic) |
| `--keep-frames` | off | Keep the JPEG frame dump for debugging |
| `-h, --help` | — | Show CLI help |

### Examples

```sh
# defaults: 1080p, 60 fps, clean output
node render.mjs hero.html

# 4K master, archival quality
node render.mjs hero.html --res 4k

# 720p 30 fps draft
node render.mjs hero.html --res 720p --fps 30 --quality mid

# keep the mock-player look intentionally
node render.mjs hero.html --show-chrome --show-timer

# HEVC for a smaller 4K file
node render.mjs hero.html --res 4k --codec hevc

# fully manual override (non-Claude HTML)
node render.mjs something.html --stage 1920x1080 --duration 30
```

### Bitrate targets

| Resolution | low    | mid    | high   |
|------------|-------:|-------:|-------:|
| 720p       | 3 Mbps | 5 Mbps | 8 Mbps |
| 1080p      | 6 Mbps | 10 Mbps| 16 Mbps|
| 1440p      | 12 Mbps| 20 Mbps| 30 Mbps|
| 4K         | 25 Mbps| 40 Mbps| 60 Mbps|

> [!NOTE]
> These are VBR caps with `maxrate = 2×`. Rate control is CQ-based, so flat UI content typically comes in well below the target.

---

## How it works

<details>
<summary><b>Click to expand the technical breakdown</b></summary>

Rendering an HTML animation to a file is an *easy to prototype, hard to get right* problem. The naive "load the page and screenshot in a loop" approach drops frames the moment a screenshot takes longer than a frame interval. At 4K, that is unavoidable. The pipeline used here:

### 1. Auto-detect stage and duration

The Claude standalone bundler inlines the scene as JSX inside a `<script>` tag. The top-level component is always `<Stage width={W} height={H} duration={D}>…</Stage>`. A regex extracts those three numbers from the HTML — no `eval` required.

### 2. Viewport sized so the stage renders natively

The bundler reserves a fixed 45 CSS pixels at the bottom of the viewport for the player chrome. To get a pixel-perfect 4K render (`3840 × 2160`), Chromium's viewport is set to `3840 × 2205`. The stage scales to fit the `3840 × 2160` region above the chrome and renders at exactly the target resolution. **No upscaling, no blur.**

When the screenshot is clipped to `(0, 0, target_w, target_h)`, the chrome is trimmed away and the stage fills the frame.

### 3. Mocked clock for deterministic frames

The interesting part. The animation uses `Date.now()` / `performance.now()` to advance its timeline — meaning it plays in **real time**, regardless of whether the browser can keep up. At 4K, rendering a frame takes well over one frame interval, so naive real-time capture inevitably drops frames.

The fix is to inject this at document creation time:

```js
let mockTime = 0;
Date.now        = () => mockTime;
performance.now = () => mockTime;

const rafQueue = new Map();
window.requestAnimationFrame = (cb) => { /* queue with id */ };
window.__fireRAFs = () => { /* flush, passing mockTime to each callback */ };
```

Every timestamp the animation reads now comes from a variable we control. Per frame, the capture loop:

1. sets `mockTime = i / fps * 1000` (the virtual time of frame *i*),
2. flushes the rAF queue,
3. waits a tick for React to reconcile,
4. takes a screenshot.

The animation perceives a perfectly paced 60 fps timeline regardless of how long each screenshot actually takes. **No dropped frames, reproducible between runs.**

> [!WARNING]
> Some animation libraries cache timestamps in closures that outlive the monkey-patch. If a render looks frozen or wrong, fall back to `--real-time` to use wall-clock playback.

### 4. Timer watermark hiding

A `MutationObserver` watches every mutation, finds any leaf element whose full text content matches `^\d+(\.\d+)?s\s*/\s*\d+(\.\d+)?s$` (the `"22.0s / 44.0s"` pattern), and sets its visibility to `hidden`. Re-applied before every frame as a safety net. A bounding-rect size check prevents accidentally hiding a parent that wraps the entire stage.

### 5. JPEG screenshots

Each frame is written as JPEG quality 95 to an OS temp directory. JPEG is roughly 5× faster than PNG at 4K on Chromium (PNG is CPU-bound on the zlib pass); quality 95 is visually lossless for UI content.

### 6. ffmpeg encode

A single ffmpeg invocation reads the JPEG sequence and encodes. On NVIDIA hardware:

```sh
ffmpeg -framerate 60 -i frames/f_%06d.jpg \
  -c:v h264_nvenc -preset p7 -tune hq \
  -rc vbr -cq 15 -b:v 16M -maxrate 32M -bufsize 52M \
  -pix_fmt yuv420p -movflags +faststart out.mp4
```

`p7` is the slowest (highest quality) NVENC preset; `-tune hq` biases psychovisual tuning; `+faststart` moves the moov atom to the front so the file streams from the first byte.

Fallback path: `libx264` / `libx265` with `-preset slow -crf <q>`.

### 7. Cleanup

The frames directory is deleted on success. Pass `--keep-frames` to preserve it for debugging.

</details>

---

## Troubleshooting

<details>
<summary><b><code>"bundler thumbnail still present after 10s"</code></b></summary>

The page did not finish booting within the timeout. Either the HTML is not a Claude standalone bundle, or its bundle crashed. Open the file directly in Chrome to confirm — if it does not render there either, the HTML is broken, not the tool.

</details>

<details>
<summary><b>Animation looks frozen, plays at the wrong speed, or shows visual glitches</b></summary>

The mock clock may be confusing the animation (some libraries cache timestamps in closures). Re-run with `--real-time` to fall back to wall-clock playback. Slower, may drop frames, but always works.

```sh
node render.mjs hero.html --real-time
```

</details>

<details>
<summary><b><code>h264_nvenc not found</code></b></summary>

The ffmpeg build does not include NVENC, or the host has no NVIDIA GPU. Pass `--encoder libx264`. Expect 5–10× slower encode on CPU; output quality is identical.

</details>

<details>
<summary><b>Output is letterboxed or cropped</b></summary>

The stage aspect ratio does not match the chosen preset. All built-in presets are 16:9. For 9:16 or 4:3 stages, override with `--stage WxH` or pick a matching preset.

</details>

<details>
<summary><b><code>npm install</code> hangs on Chromium download</b></summary>

Puppeteer's CDN can be flaky. Retry, or point at a local Chrome:

```sh
PUPPETEER_SKIP_DOWNLOAD=1 npm install
export PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
npm start
```

</details>

<details>
<summary><b>Output file is larger than expected</b></summary>

Try `--quality mid` or `--quality low`, switch to `--codec hevc` (~30–40% smaller at the same quality), or drop to `--fps 30`.

</details>

<details>
<summary><b>Fonts look blurry at 4K</b></summary>

Should not happen — the pipeline renders natively at the target resolution. Verify the source HTML is not applying CSS transforms that scale text, and that nothing overrides `--force-device-scale-factor=1` in your environment.

</details>

---

## FAQ

<details>
<summary><b>Does this work with any animated HTML?</b></summary>

It is designed for the Claude standalone bundler format. It will attempt to render anything, but the auto-detection expects a `<Stage width height duration>` tag. For other formats, pass `--stage` and `--duration` manually. If the mock clock breaks the animation, add `--real-time`.

</details>

<details>
<summary><b>Can I render with audio?</b></summary>

No. Claude promos are silent. Mux audio afterwards with ffmpeg:

```sh
ffmpeg -i video.mp4 -i audio.mp3 -c:v copy -c:a aac -shortest out.mp4
```

</details>

<details>
<summary><b>Why not Remotion / puppeteer-video-recorder / headless-recorder?</b></summary>

- **Remotion** requires authoring the scene as Remotion code.
- **puppeteer-video-recorder** and **headless-recorder** are real-time screen recorders; both drop frames at 4K.

This tool targets the *Claude handed me an HTML, give me an MP4* workflow with zero re-authoring and no dropped frames.

</details>

<details>
<summary><b>Can I batch-render a folder of HTMLs?</b></summary>

Not built in. Bash:

```sh
for f in *.html; do node render.mjs "$f" --res 1080p; done
```

PowerShell:

```powershell
Get-ChildItem *.html | ForEach-Object { node render.mjs $_.FullName --res 1080p }
```

</details>

<details>
<summary><b>Does the interactive menu work over SSH?</b></summary>

It needs a TTY. Works over `ssh -t`; PowerShell Remoting is hit-or-miss. The direct CLI works anywhere.

</details>

<details>
<summary><b>Is this safe to run on untrusted HTMLs?</b></summary>

> [!WARNING]
> The renderer runs the HTML in headless Chromium with `--no-sandbox` (required on some Windows configurations). Only render files you trust. Run inside a VM or container for untrusted inputs.

</details>

---

## Project structure

```
claude-design-video-export/
├── render.mjs         # core CLI: parse → launch → capture → encode
├── menu.mjs           # interactive wrapper (spawns render.mjs)
├── package.json
├── README.md
├── LICENSE
└── .gitignore
```

The two scripts are independent: `menu.mjs` builds an argv and spawns `render.mjs`. Either can be used directly.

---

## Contributing

Issues and pull requests are welcome. Open ideas:

- Sub-range rendering (start / end timestamps)
- Audio muxing when a separate audio track is provided
- Non-16:9 presets (9:16 vertical for Reels / Stories, 1:1 square)
- Richer progress UI (per-stage timer, progress bar)
- Container image bundling `ffmpeg + node + chromium`
- Batch mode in the interactive menu

> [!IMPORTANT]
> When adding a new flag, update **both** `render.mjs` and `menu.mjs` so the CLI and the interactive menu stay in sync.

---

## License

[MIT](./LICENSE).

## Acknowledgements

- [Puppeteer](https://pptr.dev/) — headless Chromium control
- [@inquirer/prompts](https://github.com/SBoudrias/Inquirer.js) — interactive menu
- [ffmpeg](https://ffmpeg.org/) — video encoding
- [Claude / Claude Design](https://claude.ai/) — the source of the HTMLs

> [!NOTE]
> No affiliation with Anthropic.
