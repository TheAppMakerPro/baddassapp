/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

// BaddAssApp fork: the build copies ONNX Runtime Web's runtime into the app so
// voice input never downloads it. The copy must track the installed package
// and the build must stop when the runtime cannot be found.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prepareVoiceRuntime, RUNTIME_FILES } = require('../../../scripts/prepareVoiceModel.js') as {
  prepareVoiceRuntime: (o?: { sourceDir?: string; outputDir?: string }) => { version: string; copied: string[] };
  RUNTIME_FILES: string[];
};

describe('prepareVoiceRuntime', () => {
  let tmp: string;
  let src: string;
  let out: string;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-runtime-'));
    src = path.join(tmp, 'dist');
    out = path.join(tmp, 'out', 'ort-wasm');
    fs.mkdirSync(src);
    for (const f of RUNTIME_FILES) fs.writeFileSync(path.join(src, f), `v1 ${f}`);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('names the same files the worker loads', async () => {
    const { ORT_RUNTIME_FILES } = await import('@/renderer/workers/bundledOrtRuntime');
    expect(RUNTIME_FILES.toSorted()).toEqual([ORT_RUNTIME_FILES.factory, ORT_RUNTIME_FILES.binary].toSorted());
  });

  it('copies both files, then copies nothing when they are current', () => {
    expect(prepareVoiceRuntime({ sourceDir: src, outputDir: out }).copied).toEqual(RUNTIME_FILES);
    for (const f of RUNTIME_FILES) expect(fs.readFileSync(path.join(out, f), 'utf8')).toBe(`v1 ${f}`);
    expect(prepareVoiceRuntime({ sourceDir: src, outputDir: out }).copied).toEqual([]);
  });

  it('re-copies a file whose contents changed, so an upgrade never ships a stale runtime', () => {
    prepareVoiceRuntime({ sourceDir: src, outputDir: out });
    fs.writeFileSync(path.join(src, RUNTIME_FILES[1]), 'v2');
    expect(prepareVoiceRuntime({ sourceDir: src, outputDir: out }).copied).toEqual([RUNTIME_FILES[1]]);
    expect(fs.readFileSync(path.join(out, RUNTIME_FILES[1]), 'utf8')).toBe('v2');
  });

  it('stops the build when a runtime file is missing', () => {
    fs.rmSync(path.join(src, RUNTIME_FILES[1]));
    expect(() => prepareVoiceRuntime({ sourceDir: src, outputDir: out })).toThrow(/has no ort-wasm-simd-threaded\.asyncify\.wasm/);
  });

  it('finds the runtime inside the installed onnxruntime-web', () => {
    const result = prepareVoiceRuntime({ outputDir: out });
    expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
    for (const f of RUNTIME_FILES) expect(fs.statSync(path.join(out, f)).size).toBeGreaterThan(0);
  });
});
