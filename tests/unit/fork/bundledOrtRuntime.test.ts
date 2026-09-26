/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

// BaddAssApp fork: voice input must load ONNX Runtime Web from the copy inside
// the app, never from cdn.jsdelivr.net, and must stop rather than fall back to
// the CDN when that copy is missing.

import { describe, it, expect, vi } from 'vitest';
import { useBundledOrtRuntime, ORT_RUNTIME_FILES, type OrtWasmEnv } from '@/renderer/workers/bundledOrtRuntime';

const BASE = 'wayland-asset://voice-models/';
const LOADER = 'export default () => globalThis.process?.versions?.node ? "node" : "web";';

function fakeFetch(missing?: string) {
  const binary = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]).buffer;
  return vi.fn(async (url: string) => ({
    ok: !(missing && url.endsWith(missing)),
    status: missing && url.endsWith(missing) ? 404 : 200,
    text: async () => LOADER,
    arrayBuffer: async () => binary,
  }));
}

describe('useBundledOrtRuntime', () => {
  it('fetches both runtime files from inside the app and nowhere else', async () => {
    const fetchImpl = fakeFetch();
    await useBundledOrtRuntime({}, BASE, fetchImpl);

    const urls = fetchImpl.mock.calls.map(([u]) => u).toSorted();
    expect(urls).toEqual([
      `${BASE}ort-wasm/${ORT_RUNTIME_FILES.factory}`,
      `${BASE}ort-wasm/${ORT_RUNTIME_FILES.binary}`,
    ]);
  });

  it('accepts a base without a trailing slash', async () => {
    const fetchImpl = fakeFetch();
    const loaded = await useBundledOrtRuntime({}, 'wayland-asset://voice-models', fetchImpl);
    expect(loaded.binaryUrl).toBe(`${BASE}ort-wasm/${ORT_RUNTIME_FILES.binary}`);
  });

  it('hands ONNX Runtime the binary and a local loader, leaving no CDN path to fall back to', async () => {
    const env: OrtWasmEnv = { wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/' };
    const loaded = await useBundledOrtRuntime(env, BASE, fakeFetch());

    expect(env.wasmBinary).toBeInstanceOf(ArrayBuffer);
    expect(loaded.binaryBytes).toBe(8);
    const paths = env.wasmPaths as { mjs: string; wasm: string };
    expect(paths.mjs).toMatch(/^blob:/);
    expect(paths.wasm).toBe(loaded.binaryUrl);
    expect(JSON.stringify(env.wasmPaths)).not.toMatch(/jsdelivr|https?:/);
  });

  it('rewrites the Node check out of the loader, as transformers.js does', async () => {
    const env: OrtWasmEnv = {};
    await useBundledOrtRuntime(env, BASE, fakeFetch());
    const source = await (await fetch((env.wasmPaths as { mjs: string }).mjs)).text();
    expect(source).not.toContain('globalThis.process?.versions?.node');
    expect(source).toContain('false ? "node" : "web"');
  });

  it.each([ORT_RUNTIME_FILES.factory, ORT_RUNTIME_FILES.binary])(
    'fails closed when %s is missing — and leaves the environment untouched',
    async (file) => {
      const env: OrtWasmEnv = {};
      await expect(useBundledOrtRuntime(env, BASE, fakeFetch(file))).rejects.toThrow(/Bundled voice runtime missing \(404/);
      expect(env.wasmPaths).toBeUndefined();
      expect(env.wasmBinary).toBeUndefined();
    }
  );
});
