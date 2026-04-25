#!/usr/bin/env node
/**
 * Interactive menu wrapper around render.mjs.
 *
 * Scans nearby folders for Claude standalone HTMLs, lets you pick one,
 * asks for resolution / fps / quality / chrome / timer visibility, then
 * invokes render.mjs with the chosen flags.
 */

import { select, input, confirm, Separator } from '@inquirer/prompts';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RENDER_SCRIPT = path.join(__dirname, 'render.mjs');

// ───────── discover HTMLs ─────────
const DOWNLOADS = path.join(os.homedir(), 'Downloads');
const DESKTOP   = path.join(os.homedir(), 'Desktop');
const CWD       = process.cwd();

async function scanDir(dir, depth = 1) {
  const out = [];
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && /\.html?$/i.test(e.name)) {
      try {
        // cheap probe: read first 4KB, look for the bundler signature
        const fh = await fs.open(full, 'r');
        const { buffer } = await fh.read({ buffer: Buffer.alloc(4096), position: 0 });
        await fh.close();
        const head = buffer.toString('utf8');
        const isBundle = head.includes('__bundler_thumbnail') || head.includes('__bundler/manifest');
        out.push({ path: full, isBundle, size: (await fs.stat(full)).size });
      } catch {}
    } else if (e.isDirectory() && depth > 0 && !e.name.startsWith('.') && e.name !== 'node_modules') {
      out.push(...await scanDir(full, depth - 1));
    }
  }
  return out;
}

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

function prettyBytes(n) {
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

async function run() {
  console.log('\n╭─ claude-design-video-export ─────────────────────────╮');
  console.log('│  Render standalone Claude HTML promos to MP4 video   │');
  console.log('╰──────────────────────────────────────────────────────╯\n');

  // ───────── pick file (with on-demand expansion) ─────────
  const EXPAND_DOWNLOADS = '__expand_downloads__';
  const EXPAND_DESKTOP   = '__expand_desktop__';
  const EXPAND_CWD       = '__expand_cwd__';
  const BROWSE           = '__browse__';
  const EXIT             = '__exit__';

  const scanDirs = [__dirname];   // start with just the repo
  let inputPath;

  while (true) {
    process.stdout.write(`\rscanning: ${scanDirs.map((d) => path.basename(d) || d).join(', ')}…                    `);
    const results = [];
    const seen = new Set();
    for (const d of scanDirs) {
      for (const r of await scanDir(d, 2)) {
        if (!seen.has(r.path)) { seen.add(r.path); results.push(r); }
      }
    }
    results.sort((a, b) => Number(b.isBundle) - Number(a.isBundle));
    process.stdout.write('\r' + ' '.repeat(80) + '\r');

    const bundleCount = results.filter((r) => r.isBundle).length;
    const fileChoices = results.map((r) => ({
      name: `${r.isBundle ? '✓' : '·'}  ${path.basename(r.path)}  ` +
            `[${prettyBytes(r.size)}]  — ${path.dirname(r.path)}`,
      value: r.path,
      description: r.isBundle ? 'Detected as Claude standalone bundle' : 'Regular HTML (not a Claude bundle)',
    }));
    const extraChoices = [];
    if (!scanDirs.includes(DOWNLOADS)) extraChoices.push({ name: '  Expand search to ~/Downloads',    value: EXPAND_DOWNLOADS });
    if (!scanDirs.includes(DESKTOP))   extraChoices.push({ name: '  Expand search to ~/Desktop',      value: EXPAND_DESKTOP   });
    if (CWD !== __dirname && !scanDirs.includes(CWD)) extraChoices.push({ name: '  Expand search to current dir',    value: EXPAND_CWD });
    extraChoices.push({ name: '  Browse for another file…', value: BROWSE });
    extraChoices.push({ name: '  Exit', value: EXIT });

    const choices = fileChoices.length
      ? [...fileChoices, new Separator('──────────'), ...extraChoices]
      : [...extraChoices];

    const message = fileChoices.length
      ? `Select HTML  (${bundleCount} bundle${bundleCount === 1 ? '' : 's'} / ${results.length} total found in: ${scanDirs.map((d) => path.basename(d) || d).join(', ')})`
      : `No HTMLs found in ${scanDirs.map((d) => path.basename(d) || d).join(', ')} — expand the search:`;

    const selection = await select({
      message,
      choices,
      pageSize: Math.min(14, choices.length),
    });

    if (selection === EXPAND_DOWNLOADS) { scanDirs.push(DOWNLOADS); continue; }
    if (selection === EXPAND_DESKTOP)   { scanDirs.push(DESKTOP);   continue; }
    if (selection === EXPAND_CWD)       { scanDirs.push(CWD);       continue; }
    if (selection === EXIT) {
      console.log('bye 👋');
      process.exit(0);
    }
    if (selection === BROWSE) {
      const entered = await input({
        message: 'Full path to HTML  (leave empty to go back):',
        validate: async (v) => {
          if (!v || !v.trim()) return true;     // empty = go back
          try { await fs.access(v); return true; } catch { return 'file not found'; }
        },
      });
      if (!entered || !entered.trim()) continue;   // re-show the main list
      inputPath = entered;
      break;
    }
    inputPath = selection;
    break;
  }
  inputPath = path.resolve(inputPath);

  // ───────── detect stage + duration ─────────
  const rawHtml = await fs.readFile(inputPath, 'utf8');
  const det = detectStage(rawHtml) || {};
  if (det.width && det.height && det.duration) {
    console.log(`\ndetected stage: ${det.width}×${det.height}   duration: ${det.duration}s\n`);
  } else {
    console.log('\n⚠  couldn\'t fully auto-detect stage and/or duration. you\'ll be asked for the missing values.\n');
  }

  // ───────── resolution ─────────
  const res = await select({
    message: 'Resolution',
    default: '1080p',
    choices: [
      { name: '4K      3840×2160',                   value: '4k'    },
      { name: '1440p   2560×1440',                   value: '1440p' },
      { name: '1080p   1920×1080   (recommended)',   value: '1080p' },
      { name: '720p    1280×720    (draft)',         value: '720p'  },
    ],
  });

  // ───────── fps ─────────
  const fps = await select({
    message: 'Frame rate',
    default: '60',
    choices: [
      { name: '60 fps  — smooth', value: '60' },
      { name: '30 fps  — smaller file, faster encode', value: '30' },
    ],
  });

  // ───────── quality ─────────
  const quality = await select({
    message: 'Quality',
    default: 'high',
    choices: [
      { name: 'high  — CQ 15, archival / master',        value: 'high' },
      { name: 'mid   — CQ 19, balanced upload / social', value: 'mid'  },
      { name: 'low   — CQ 23, smaller preview',          value: 'low'  },
    ],
  });

  // ───────── chrome / timer ─────────
  const showChrome = await confirm({
    message: 'Include the video player bar (play/pause/progress) at the bottom?',
    default: false,
  });
  const showTimer = await confirm({
    message: 'Include the inner "XX.Xs / 44.0s" counter watermark?',
    default: false,
  });

  // ───────── missing auto-detect fallbacks ─────────
  const extraArgs = [];
  if (!det.width || !det.height) {
    const stg = await input({
      message: 'Stage size (format WxH, e.g. 1920x1080):',
      validate: (v) => /^\d+x\d+$/i.test(v) || 'use WxH format',
    });
    extraArgs.push('--stage', stg);
  }
  if (!det.duration) {
    const durS = await input({
      message: 'Duration in seconds:',
      validate: (v) => (!isNaN(parseFloat(v)) && parseFloat(v) > 0) || 'enter a positive number',
    });
    extraArgs.push('--duration', durS);
  }

  // ───────── output ─────────
  const parsed = path.parse(inputPath);
  const defaultOut = path.join(parsed.dir, `${parsed.name}_${res}.mp4`);
  const outPath = await input({
    message: 'Output MP4 path:',
    default: defaultOut,
  });

  // ───────── summary + confirm ─────────
  console.log('\n╭─ summary ────────────────────────────────────────────');
  console.log(`│  input:      ${inputPath}`);
  console.log(`│  output:     ${outPath}`);
  console.log(`│  resolution: ${res}    fps: ${fps}    quality: ${quality}`);
  console.log(`│  chrome:     ${showChrome ? 'visible' : 'hidden'}    timer: ${showTimer ? 'visible' : 'hidden'}`);
  console.log('╰──────────────────────────────────────────────────────\n');

  const go = await confirm({ message: 'Render now?', default: true });
  if (!go) { console.log('aborted.'); return; }

  // ───────── run render.mjs ─────────
  const cliArgs = [
    RENDER_SCRIPT,
    inputPath,
    '--res', res,
    '--fps', fps,
    '--quality', quality,
    '-o', outPath,
    ...extraArgs,
  ];
  if (showChrome) cliArgs.push('--show-chrome');
  if (showTimer)  cliArgs.push('--show-timer');

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, cliArgs, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`render.mjs exited ${code}`)));
  });

  // ───────── done ─────────
  const openIt = await confirm({ message: 'Open the output file?', default: true });
  if (openIt) {
    try {
      if (process.platform === 'win32') {
        // use cmd /c start to handle paths with spaces correctly
        spawn('cmd', ['/c', 'start', '""', outPath], { detached: true, stdio: 'ignore', shell: false }).unref();
      } else if (process.platform === 'darwin') {
        spawn('open', [outPath], { detached: true, stdio: 'ignore' }).unref();
      } else {
        spawn('xdg-open', [outPath], { detached: true, stdio: 'ignore' }).unref();
      }
    } catch (e) {
      console.log(`couldn't open automatically: ${e.message}`);
    }
  }
}

try {
  await run();
} catch (e) {
  if (e && (e.name === 'ExitPromptError' || /cancel/i.test(e.message || ''))) {
    console.log('\ncanceled.');
    process.exit(130);
  }
  console.error('\nerror:', e.message || e);
  process.exit(1);
}
