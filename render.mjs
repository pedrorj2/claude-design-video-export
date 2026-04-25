#!/usr/bin/env node
/**
 * claude-design-video-export
 *
 * Render a standalone Claude-artifact HTML promo to MP4.
 *
 * Usage:
 *   node render.mjs <input.html> [options]
 *
 * Options:
 *   --res <preset>       720p | 1080p | 1440p | 4k      (default 1080p)
 *   --fps <n>            30 | 60                        (default 60)
 *   --duration <s>       override auto-detected seconds
 *   --stage <WxH>        override auto-detected stage size, e.g. 1920x1080
 *   -o, --output <path>  output MP4 path                (default <input>_<res>.mp4)
 *   --show-chrome        keep the player chrome (play/pause/progress) visible
 *   --show-timer         keep the inner "XX.Xs / YY.Ys" watermark visible
 *   --quality <l>        low | mid | high               (default high)
 *   --codec <c>          h264 | hevc                    (default h264)
 *   --encoder <e>        nvenc | libx264 | libx265 | auto (default auto)
 *   --real-time          do not mock the clock (slower, less deterministic)
 *   --keep-frames        keep JPEG frames after encoding (for debugging)
 *   -h, --help
 */

import puppeteer from 'puppeteer';
import { parseArgs } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- presets ----------
const RES_PRESETS = {
  '720p':  { w: 1280, h: 720  },
  '1080p': { w: 1920, h: 1080 },
  '1440p': { w: 2560, h: 1440 },
  '4k':    { w: 3840, h: 2160 },
};

const QUALITY = {
  // cq (NVENC) / crf (x264) — lower = better
  low:  { cq: 23, crf: 23 },
  mid:  { cq: 19, crf: 19 },
  high: { cq: 15, crf: 15 },
};

const BITRATE_BY_RES = {
  '720p':  { low: '3M',  mid: '5M',  high: '8M'  },
  '1080p': { low: '6M',  mid: '10M', high: '16M' },
  '1440p': { low: '12M', mid: '20M', high: '30M' },
  '4k':    { low: '25M', mid: '40M', high: '60M' },
};

// The Claude standalone bundler always reserves ~45 CSS pixels at the bottom
// of the viewport for the player chrome. We expand the viewport by this amount
// so the stage scales 1:1 with the target resolution, and then clip the chrome
// out of the captured frames.
const CHROME_RESERVE_PX = 45;

// ---------- argv ----------
let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      res:            { type: 'string',  default: '1080p' },
      fps:            { type: 'string',  default: '60' },
      duration:       { type: 'string' },
      stage:          { type: 'string' },
      output:         { type: 'string',  short: 'o' },
      'show-chrome':  { type: 'boolean', default: false },
      'show-timer':   { type: 'boolean', default: false },
      quality:        { type: 'string',  default: 'high' },
      codec:          { type: 'string',  default: 'h264' },
      encoder:        { type: 'string',  default: 'auto' },
      'real-time':    { type: 'boolean', default: false },
      'keep-frames':  { type: 'boolean', default: false },
      help:           { type: 'boolean', short: 'h', default: false },
    },
  });
} catch (e) {
  console.error('argument error:', e.message);
  process.exit(2);
}

if (args.values.help || args.positionals.length < 1) {
  process.stdout.write(`
Usage: node render.mjs <input.html> [options]

Options:
  --res <preset>       720p | 1080p | 1440p | 4k        (default 1080p)
  --fps <n>            30 | 60                          (default 60)
  --duration <s>       override auto-detected duration (seconds)
  --stage <WxH>        override auto-detected stage size, e.g. 1920x1080
  -o, --output <path>  output MP4 path                  (default <input>_<res>.mp4)
  --show-chrome        keep the player chrome (play/pause/progress) visible
  --show-timer         keep the inner "XX.Xs / YY.Ys" counter visible
  --quality <l>        low | mid | high                 (default high)
  --codec <c>          h264 | hevc                      (default h264)
  --encoder <e>        nvenc | libx264 | libx265 | auto (default auto)
  --real-time          don't mock the clock (slower, less deterministic)
  --keep-frames        keep JPEG frames for debugging
  -h, --help

Examples:
  node render.mjs my_ad.html
  node render.mjs my_ad.html --res 4k
  node render.mjs my_ad.html --res 720p --fps 30 --quality mid
  node render.mjs my_ad.html --show-timer -o preview.mp4

`);
  process.exit(args.values.help ? 0 : 1);
}

const opts = args.values;
const INPUT_HTML = path.resolve(args.positionals[0]);

const resKey = opts.res.toLowerCase();
const preset = RES_PRESETS[resKey];
if (!preset) {
  console.error(`unknown --res "${opts.res}". valid: ${Object.keys(RES_PRESETS).join(', ')}`);
  process.exit(2);
}

const fps = parseInt(opts.fps, 10);
if (![24, 25, 30, 48, 50, 60].includes(fps)) {
  console.error(`unsupported --fps ${opts.fps}. try 30 or 60.`);
  process.exit(2);
}

if (!QUALITY[opts.quality]) {
  console.error(`unknown --quality "${opts.quality}". valid: low, mid, high`);
  process.exit(2);
}

if (!['h264', 'hevc'].includes(opts.codec)) {
  console.error(`unknown --codec "${opts.codec}". valid: h264, hevc`);
  process.exit(2);
}

// ---------- auto-detect stage + duration ----------
const rawHtml = await fs.readFile(INPUT_HTML, 'utf8');

function detectStage(html) {
  const tagMatch = html.match(/<\s*Stage\b[^>]*>/s);
  if (!tagMatch) return null;
  const tag = tagMatch[0];
  const num = (key) => {
    const m = tag.match(new RegExp(`\\b${key}\\s*=\\s*\\{\\s*(\\d+(?:\\.\\d+)?)\\s*\\}`));
    return m ? parseFloat(m[1]) : null;
  };
  return { width: num('width'), height: num('height'), duration: num('duration') };
}

const detected = detectStage(rawHtml) || {};

let stageW, stageH;
if (opts.stage) {
  const m = opts.stage.match(/^(\d+)x(\d+)$/i);
  if (!m) { console.error(`--stage must be WxH, got "${opts.stage}"`); process.exit(2); }
  stageW = parseInt(m[1], 10); stageH = parseInt(m[2], 10);
} else {
  stageW = detected.width; stageH = detected.height;
}
if (!stageW || !stageH) {
  console.error('could not auto-detect stage size. pass --stage WxH (e.g. --stage 1920x1080)');
  process.exit(2);
}

const durationS = opts.duration ? parseFloat(opts.duration) : detected.duration;
if (!durationS || !isFinite(durationS) || durationS <= 0) {
  console.error('could not auto-detect duration. pass --duration <seconds>');
  process.exit(2);
}

// sanity: does the input look like a Claude bundler artifact?
if (!rawHtml.includes('__bundler_thumbnail') && !rawHtml.includes('__bundler/manifest')) {
  console.warn('⚠  input does not look like a Claude standalone bundler artifact — attempting anyway.');
}

// ---------- compute viewport ----------
const stageRatio = stageW / stageH;
const targetRatio = preset.w / preset.h;
if (Math.abs(stageRatio - targetRatio) > 0.005) {
  console.warn(
    `⚠  stage ${stageW}x${stageH} (ratio ${stageRatio.toFixed(3)}) does not match ` +
    `preset ${preset.w}x${preset.h} (ratio ${targetRatio.toFixed(3)}). ` +
    `output will be letterboxed / cropped to fit.`
  );
}

const showChrome = !!opts['show-chrome'];
const viewportW = preset.w;
const viewportH = showChrome ? preset.h : preset.h + CHROME_RESERVE_PX;

// ---------- output path ----------
const outputPath = opts.output
  ? path.resolve(opts.output)
  : (() => {
      const parsed = path.parse(INPUT_HTML);
      return path.join(parsed.dir, `${parsed.name}_${resKey}.mp4`);
    })();

// ---------- temp frames dir ----------
const stamp = Date.now().toString(36);
const framesDir = path.join(os.tmpdir(), `cdve-frames-${stamp}`);
await fs.mkdir(framesDir, { recursive: true });

const totalFrames = Math.round(fps * durationS);

console.log(`input:      ${INPUT_HTML}`);
console.log(`stage:      ${stageW}x${stageH} (${detected.duration ? `auto-detected duration ${detected.duration}s` : 'manual duration'})`);
console.log(`output:     ${outputPath}`);
console.log(`resolution: ${preset.w}x${preset.h} (${resKey})  viewport: ${viewportW}x${viewportH}`);
console.log(`fps:        ${fps}   total frames: ${totalFrames}   duration: ${durationS}s`);
console.log(`player chrome: ${showChrome ? 'visible' : 'hidden (clipped)'}`);
console.log(`inner timer:   ${opts['show-timer'] ? 'visible' : 'hidden'}`);
console.log(`frames dir: ${framesDir}`);

// ---------- puppeteer ----------
const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--window-size=${viewportW},${viewportH}`,
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--force-device-scale-factor=1',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ],
  defaultViewport: { width: viewportW, height: viewportH, deviceScaleFactor: 1 },
  protocolTimeout: 600_000,
});

const page = await browser.newPage();

// inject mock clock (unless --real-time)
if (!opts['real-time']) {
  await page.evaluateOnNewDocument(() => {
    let mockTime = 0;
    Object.defineProperty(window, '__mockTime', {
      get: () => mockTime,
      set: (v) => { mockTime = v; },
      configurable: true,
    });
    Date.now = () => mockTime;
    performance.now = () => mockTime;

    const rafQueue = new Map();
    let rafId = 0;
    window.requestAnimationFrame = (cb) => {
      const id = ++rafId;
      rafQueue.set(id, cb);
      return id;
    };
    window.cancelAnimationFrame = (id) => rafQueue.delete(id);
    window.__fireRAFs = () => {
      const toFire = Array.from(rafQueue.values());
      rafQueue.clear();
      for (const cb of toFire) { try { cb(mockTime); } catch {} }
      return toFire.length;
    };
  });
}

// inject inner-timer watermark hider
if (!opts['show-timer']) {
  await page.evaluateOnNewDocument(() => {
    const TIMER_RE = /^\d+(\.\d+)?s\s*\/\s*\d+(\.\d+)?s$/;
    window.__hideTimerWatermark = () => {
      const nodes = document.querySelectorAll('body *');
      for (const el of nodes) {
        const t = (el.textContent || '').trim();
        if (!TIMER_RE.test(t)) continue;
        // safety: skip anything bigger than ~316×316 px, so we never hide the whole stage
        const r = el.getBoundingClientRect();
        if (r.width * r.height > 100_000) continue;
        el.style.visibility = 'hidden';
      }
    };
    const start = () => {
      window.__hideTimerWatermark();
      if (document.body) {
        new MutationObserver(window.__hideTimerWatermark).observe(document.body, {
          childList: true, subtree: true, characterData: true,
        });
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  });
}

console.log('\n[render] loading HTML…');
await page.goto(pathToFileURL(INPUT_HTML).href, { waitUntil: 'domcontentloaded', timeout: 60_000 });

if (!opts['real-time']) {
  await page.waitForFunction(() => typeof window.__fireRAFs === 'function');
}
console.log('[render] booting app…');
// give the bundler time to unpack (base64 decode + gunzip + module eval)
await new Promise((r) => setTimeout(r, 1500));
if (!opts['real-time']) {
  for (let i = 0; i < 15; i++) {
    await page.evaluate(() => window.__fireRAFs?.());
    await new Promise((r) => setTimeout(r, 30));
  }
}

// wait for the bundler thumbnail to disappear (confirms app mounted)
try {
  await page.waitForFunction(() => !document.getElementById('__bundler_thumbnail'), { timeout: 10_000 });
} catch {
  console.warn('⚠  bundler thumbnail still present after 10s — app may not have mounted. rendering anyway.');
}

console.log(`[render] capturing ${totalFrames} frames at ${preset.w}x${preset.h} @ ${fps}fps`);
const clipRegion = { x: 0, y: 0, width: preset.w, height: preset.h };
const startReal = Date.now();

for (let i = 0; i < totalFrames; i++) {
  const tMs = (i / fps) * 1000;
  if (!opts['real-time']) {
    await page.evaluate((t) => {
      window.__mockTime = t;
      window.__fireRAFs();
      window.__fireRAFs();
      window.__hideTimerWatermark?.();
    }, tMs);
    await new Promise((r) => setTimeout(r, 10));
  } else {
    await page.evaluate(() => window.__hideTimerWatermark?.());
    // real-time: sleep to match wall clock target
    const target = startReal + tMs;
    const wait = target - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  const fn = path.join(framesDir, `f_${String(i).padStart(6, '0')}.jpg`);
  await page.screenshot({
    path: fn,
    type: 'jpeg',
    quality: 95,
    clip: clipRegion,
    optimizeForSpeed: true,
    captureBeyondViewport: false,
  });
  if ((i + 1) % 30 === 0 || i === totalFrames - 1) {
    const elapsed = (Date.now() - startReal) / 1000;
    const perFrame = elapsed / (i + 1);
    const eta = perFrame * (totalFrames - i - 1);
    process.stdout.write(
      `\r[render] ${i + 1}/${totalFrames}  ${perFrame.toFixed(2)}s/f  ` +
      `elapsed ${elapsed.toFixed(0)}s  ETA ${eta.toFixed(0)}s    `
    );
  }
}
process.stdout.write('\n');
await browser.close();

// ---------- encode ----------
console.log('\n[encode] starting ffmpeg…');

async function detectEncoder(preferred) {
  if (preferred !== 'auto') return preferred;
  if (opts.codec === 'hevc') {
    return (await ffmpegHasEncoder('hevc_nvenc')) ? 'hevc_nvenc' : 'libx265';
  }
  return (await ffmpegHasEncoder('h264_nvenc')) ? 'h264_nvenc' : 'libx264';
}

function ffmpegHasEncoder(name) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    p.stdout.on('data', (d) => (buf += d.toString()));
    p.on('error', () => resolve(false));
    p.on('close', () => resolve(new RegExp(`\\b${name}\\b`).test(buf)));
  });
}

const encoder = await detectEncoder(opts.encoder);
const q = QUALITY[opts.quality];
const bitrate = BITRATE_BY_RES[resKey][opts.quality];
const maxBitrate = `${parseInt(bitrate) * 2}M`;

const ffArgs = [
  '-hide_banner', '-y',
  '-framerate', String(fps),
  '-i', path.join(framesDir, 'f_%06d.jpg'),
  '-c:v', encoder,
];

if (encoder === 'h264_nvenc' || encoder === 'hevc_nvenc') {
  ffArgs.push(
    '-preset', 'p7',
    '-tune', 'hq',
    '-rc', 'vbr',
    '-cq', String(q.cq),
    '-b:v', bitrate,
    '-maxrate', maxBitrate,
    '-bufsize', `${parseInt(maxBitrate) + 20}M`,
  );
} else if (encoder === 'libx264' || encoder === 'libx265') {
  ffArgs.push(
    '-preset', 'slow',
    '-crf', String(q.crf),
    '-b:v', bitrate,
    '-maxrate', maxBitrate,
    '-bufsize', `${parseInt(maxBitrate) + 20}M`,
  );
}

ffArgs.push(
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  outputPath,
);

console.log(`[encode] encoder: ${encoder}   bitrate target ${bitrate}  cq/crf ${q.cq}`);

await new Promise((resolve, reject) => {
  const p = spawn('ffmpeg', ffArgs, { stdio: ['ignore', 'inherit', 'inherit'] });
  p.on('error', reject);
  p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
});

// ---------- cleanup ----------
if (!opts['keep-frames']) {
  await fs.rm(framesDir, { recursive: true, force: true });
} else {
  console.log(`[done] frames kept at: ${framesDir}`);
}

// ---------- verify ----------
const stats = await fs.stat(outputPath);
console.log(`\n✔ ${outputPath}`);
console.log(`  size: ${(stats.size / 1024 / 1024).toFixed(1)} MB  duration: ${durationS}s  ${preset.w}x${preset.h} @ ${fps}fps`);
