/**
 * Prepare the bundled voice STT model for Electron packaging.
 *
 * Downloads the Whisper-tiny multilingual ONNX model (transformers.js layout)
 * into resources/voice-models/whisper-tiny/ so it ships inside the installer.
 * This is the always-available "floor" engine - voice dictation works on a
 * fresh install with zero download, fully offline.
 *
 * Larger/faster models (Whisper-base, Moonshine) are NOT bundled - they
 * download on-demand via VoiceAssetRegistry. This script only handles the
 * one bundled tiny model.
 *
 * Idempotent: skips files already present with a non-zero size.
 * Pattern follows prepareWaylandCore.js / prepareBundledBun.js.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('https');

// transformers.js loads Whisper-tiny multilingual from this HF repo.
// Multilingual (not .en) so non-English users get a usable floor.
const HF_REPO = 'Xenova/whisper-tiny';
const HF_BASE = `https://huggingface.co/${HF_REPO}/resolve/main`;

const OUTPUT_DIR = path.join(__dirname, '..', 'resources', 'voice-models', 'whisper-tiny');

// Exact file set transformers.js needs for the automatic-speech-recognition
// pipeline. Quantized ONNX keeps the bundle near ~44 MB.
const FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
  'merges.txt',
  'added_tokens.json',
  'normalizer.json',
  'special_tokens_map.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function download(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'wayland-build' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) {
            reject(new Error(`Too many redirects for ${url}`));
            return;
          }
          res.resume();
          // HF can return a relative Location - resolve against the current URL.
          const nextUrl = new URL(res.headers.location, url).href;
          download(nextUrl, destPath, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }
        ensureDir(path.dirname(destPath));
        const tmpPath = destPath + '.tmp';
        const out = fs.createWriteStream(tmpPath);
        res.pipe(out);
        out.on('finish', () => {
          out.close(() => {
            fs.renameSync(tmpPath, destPath);
            resolve();
          });
        });
        out.on('error', (err) => {
          fs.rmSync(tmpPath, { force: true });
          reject(err);
        });
      })
      .on('error', reject);
  });
}

async function prepareVoiceModel() {
  ensureDir(OUTPUT_DIR);
  let downloaded = 0;
  let skipped = 0;

  for (const file of FILES) {
    const destPath = path.join(OUTPUT_DIR, file);
    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
      skipped += 1;
      continue;
    }
    process.stdout.write(`[prepareVoiceModel] downloading ${file} ... `);
    await download(`${HF_BASE}/${file}`, destPath);
    const mb = (fs.statSync(destPath).size / 1024 / 1024).toFixed(1);
    process.stdout.write(`ok (${mb} MB)\n`);
    downloaded += 1;
  }

  const totalBytes = FILES.reduce((sum, f) => {
    const p = path.join(OUTPUT_DIR, f);
    return sum + (fs.existsSync(p) ? fs.statSync(p).size : 0);
  }, 0);
  console.log(
    `[prepareVoiceModel] done - ${downloaded} downloaded, ${skipped} cached, ` +
      `${(totalBytes / 1024 / 1024).toFixed(1)} MB total at ${OUTPUT_DIR}`
  );
}

// ---------------------------------------------------------------------------
// ONNX Runtime Web, bundled beside the model (BaddAssApp fork).
//
// transformers.js otherwise fetches this runtime from cdn.jsdelivr.net the
// first time voice input runs — see src/renderer/workers/bundledOrtRuntime.ts.
// These two files are COPIED from the installed package, never downloaded, and
// from the exact package transformers.js resolves, which is the one the
// renderer bundle is built against: the loader, the binary and the JavaScript
// half of the runtime must all be the same build.
// ---------------------------------------------------------------------------

const RUNTIME_OUTPUT_DIR = path.join(__dirname, '..', 'resources', 'voice-models', 'ort-wasm');
// Must match ORT_RUNTIME_FILES in src/renderer/workers/bundledOrtRuntime.ts.
const RUNTIME_FILES = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];

/**
 * Package root from any file inside it. Neither package exposes
 * `./package.json` through its `exports` map, so resolving that subpath
 * directly throws; resolve the entry point and walk up to the root instead.
 */
function packageRoot(name, fromDirs) {
  let dir = path.dirname(require.resolve(name, fromDirs ? { paths: fromDirs } : undefined));
  for (;;) {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).name === name) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Could not find the package root of ${name}`);
    dir = parent;
  }
}

function resolveOrtWebDist() {
  const transformersRoot = packageRoot('@huggingface/transformers');
  const ortRoot = packageRoot('onnxruntime-web', [transformersRoot]);
  return {
    dist: path.join(ortRoot, 'dist'),
    version: JSON.parse(fs.readFileSync(path.join(ortRoot, 'package.json'), 'utf8')).version,
  };
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/**
 * Copies the runtime into `outputDir`. Re-copies whenever the contents differ,
 * so upgrading onnxruntime-web can never leave a stale runtime shipping beside
 * newer JavaScript. Throws if the source files are missing.
 */
function prepareVoiceRuntime({ sourceDir, outputDir = RUNTIME_OUTPUT_DIR } = {}) {
  const source = sourceDir ? { dist: sourceDir, version: 'custom' } : resolveOrtWebDist();
  ensureDir(outputDir);
  const copied = [];
  for (const file of RUNTIME_FILES) {
    const from = path.join(source.dist, file);
    if (!fs.existsSync(from)) {
      throw new Error(`onnxruntime-web ${source.version} has no ${file} at ${source.dist}`);
    }
    const to = path.join(outputDir, file);
    if (fs.existsSync(to) && sha256(to) === sha256(from)) continue;
    fs.copyFileSync(from, to);
    copied.push(file);
  }
  console.log(
    `[prepareVoiceModel] ONNX Runtime Web ${source.version}: ` +
      (copied.length ? `copied ${copied.join(', ')}` : 'runtime already current') +
      ` at ${outputDir}`
  );
  return { version: source.version, copied };
}

async function prepareAll() {
  await prepareVoiceModel();
  prepareVoiceRuntime();
}

module.exports = prepareAll;
module.exports.prepareVoiceModel = prepareVoiceModel;
module.exports.prepareVoiceRuntime = prepareVoiceRuntime;
module.exports.RUNTIME_FILES = RUNTIME_FILES;

// Allow running directly: `node scripts/prepareVoiceModel.js`
if (require.main === module) {
  prepareAll().catch((err) => {
    console.error(`[prepareVoiceModel] FAILED: ${err.message}`);
    process.exitCode = 1;
  });
}
