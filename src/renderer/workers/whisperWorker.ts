/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Web Worker that runs local speech-to-text via transformers.js (ONNX
 * Whisper, WASM backend). Kept off the renderer main thread so the ~5-10s
 * one-time model warmup and per-utterance inference never freeze the UI.
 *
 * Protocol (postMessage):
 *   → { type: 'init', modelBase }      load the bundled Whisper-tiny model
 *   ← { type: 'ready' } | { type: 'error', error }
 *   → { type: 'transcribe', requestId, audio }   audio = Float32Array 16kHz mono
 *   ← { type: 'result', requestId, text } | { type: 'error', requestId, error }
 */

import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { useBundledOrtRuntime, type OrtWasmEnv } from './bundledOrtRuntime';

// Nothing here touches the network. The model is bundled and loaded local-only,
// and so is the ONNX Runtime WebAssembly that runs it: see bundledOrtRuntime.ts
// for why (transformers.js would otherwise fetch it from a public CDN).
env.allowRemoteModels = false;
env.allowLocalModels = true;
// The runtime is handed to ONNX Runtime directly below, so transformers.js's
// own pre-load (via the Cache API, which rejects wayland-asset://) is skipped.
env.useWasmCache = false;
// The browser Cache API rejects the wayland-asset:// scheme; disabling the
// cache silences a stream of harmless "scheme unsupported" warnings. Model
// files are local disk reads anyway, so re-fetching per load is cheap.
env.useBrowserCache = false;

// Bundled model id under the voice-models dir (resources/voice-models/whisper-tiny).
const MODEL_ID = 'whisper-tiny';

let asrPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

type InitMessage = { type: 'init'; modelBase: string };
type TranscribeMessage = { type: 'transcribe'; requestId: string; audio: Float32Array };
type IncomingMessage = InitMessage | TranscribeMessage;

self.onmessage = async (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;

  if (msg.type === 'init') {
    // transformers.js fetches `${localModelPath}${MODEL_ID}/<file>`.
    env.localModelPath = msg.modelBase.endsWith('/') ? msg.modelBase : `${msg.modelBase}/`;
    // Replaces the CDN default transformers.js set on import. Must run before
    // the pipeline creates its session; throws (fails closed) if the bundled
    // runtime is missing, and that error reaches the caller below as 'error'.
    const runtimeReady = useBundledOrtRuntime(env.backends.onnx.wasm as OrtWasmEnv, env.localModelPath);
    // `graphOptimizationLevel: 'basic'` skips ORT's QDQ→MatMulNBits transpose
    // pass, which crashes on the q8-quantized Whisper decoder ("Missing
    // required scale"). Basic-level optimization still loads cleanly.
    asrPromise = runtimeReady.then(
      () =>
        pipeline('automatic-speech-recognition', MODEL_ID, {
          dtype: 'q8',
          session_options: { graphOptimizationLevel: 'basic' },
        }) as Promise<AutomaticSpeechRecognitionPipeline>
    );
    try {
      await asrPromise;
      self.postMessage({ type: 'ready' });
    } catch (err) {
      asrPromise = null;
      self.postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (msg.type === 'transcribe') {
    try {
      if (!asrPromise) throw new Error('whisper worker not initialized');
      const asr = await asrPromise;
      const output = await asr(msg.audio, { return_timestamps: false });
      const text = Array.isArray(output)
        ? output.map((o) => o.text).join(' ')
        : (output as { text?: string }).text ?? '';
      self.postMessage({ type: 'result', requestId: msg.requestId, text: text.trim() });
    } catch (err) {
      self.postMessage({
        type: 'error',
        requestId: msg.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
