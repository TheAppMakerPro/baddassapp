/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Points ONNX Runtime Web at the copy of its runtime that ships inside the app.
 *
 * WHY THIS EXISTS (BaddAssApp fork). transformers.js, on import, sets ONNX
 * Runtime's `wasmPaths` to cdn.jsdelivr.net whenever nothing else is set. The
 * Whisper MODEL was already bundled and loaded local-only, but the runtime that
 * executes it was still fetched from that CDN the first time voice input ran:
 * a request that disclosed the machine's IP address and that voice was being
 * used, and ~23 MB of executable WebAssembly taken from a third party at that
 * moment with no integrity check.
 *
 * Now both runtime files are copied out of the installed `onnxruntime-web`
 * package at build time (scripts/prepareVoiceModel.js) into
 * `voice-models/ort-wasm/` — the same folder, protocol and allowlist the model
 * already uses — and this loads them from there.
 *
 * HOW. The files are fetched here, by us, through `wayland-asset://`, and handed
 * to ONNX Runtime directly: the binary as `wasmBinary`, the loader as a blob
 * URL. That is the same shape transformers.js produces on its own success path,
 * but it does not depend on transformers.js's loading logic, which would
 * otherwise try the browser Cache API (it rejects `wayland-asset://`) and, in
 * some environments, import the loader straight from the custom scheme.
 *
 * It FAILS CLOSED. If a file is missing, voice reports why and stops; it never
 * falls back to the CDN.
 *
 * CSP. The renderer CSP (src/index.ts) has `script-src 'self'` with no `blob:`.
 * Verified in Electron 41 with that exact policy: in the packaged app the
 * worker, served from file://, is not governed by it, and voice loads and
 * transcribes. Under the Vite dev server the policy does reach the worker and
 * refuses the blob import — as it refused upstream's CDN import before this.
 */

/** Must match the variant ONNX Runtime Web selects outside Safari. */
export const ORT_RUNTIME_FILES = {
  factory: 'ort-wasm-simd-threaded.asyncify.mjs',
  binary: 'ort-wasm-simd-threaded.asyncify.wasm',
} as const;

/** Folder, relative to the voice-models base URL, that holds the runtime. */
export const ORT_RUNTIME_DIR = 'ort-wasm/';

/** The slice of ONNX Runtime Web's `env.wasm` this module writes. */
export interface OrtWasmEnv {
  wasmPaths?: unknown;
  wasmBinary?: ArrayBuffer | Uint8Array;
}

export interface LoadedRuntime {
  factoryUrl: string;
  binaryUrl: string;
  binaryBytes: number;
}

type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;

const fetchOk = async (fetchImpl: FetchLike, url: string) => {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(
      `Bundled voice runtime missing (${res.status} for ${url}). ` +
        'Run `node scripts/prepareVoiceModel.js` — voice input will not download it from the internet.'
    );
  }
  return res;
};

/**
 * Loads the bundled runtime into `wasmEnv`. `modelBase` is the voice-models
 * base URL the main process hands the worker (it ends with a slash).
 */
export async function useBundledOrtRuntime(
  wasmEnv: OrtWasmEnv,
  modelBase: string,
  fetchImpl: FetchLike = (url) => fetch(url)
): Promise<LoadedRuntime> {
  const base = modelBase.endsWith('/') ? modelBase : `${modelBase}/`;
  const runtimeBase = new URL(ORT_RUNTIME_DIR, base);
  const factoryUrl = new URL(ORT_RUNTIME_FILES.factory, runtimeBase).href;
  const binaryUrl = new URL(ORT_RUNTIME_FILES.binary, runtimeBase).href;

  const [factorySource, binary] = await Promise.all([
    fetchOk(fetchImpl, factoryUrl).then((r) => r.text()),
    fetchOk(fetchImpl, binaryUrl).then((r) => r.arrayBuffer()),
  ]);

  // The same rewrite transformers.js applies before it builds its own blob:
  // an Electron worker can see a `process` global, and the loader would then
  // take its Node code path and fail.
  const patched = factorySource.replaceAll('globalThis.process?.versions?.node', 'false');
  const factoryBlobUrl = URL.createObjectURL(new Blob([patched], { type: 'text/javascript' }));

  wasmEnv.wasmBinary = binary;
  wasmEnv.wasmPaths = { mjs: factoryBlobUrl, wasm: binaryUrl };

  return { factoryUrl, binaryUrl, binaryBytes: binary.byteLength };
}
