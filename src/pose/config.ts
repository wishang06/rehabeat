import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';

/** Where the MediaPipe wasm runtime lives. MediaPipe does not export its own type for this. */
export interface WasmFileset {
  wasmLoaderPath: string;
  wasmBinaryPath: string;
}

export const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

/** Served by our own dev server or build, so it always matches the installed package. */
export const LOCAL_WASM_FILESET: WasmFileset = {
  wasmLoaderPath: wasmLoaderUrl,
  wasmBinaryPath: wasmBinaryUrl,
};

/** Must name the same version as @mediapipe/tasks-vision in package.json. */
export const WASM_CDN_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';

/** Fallback for when the locally served files misbehave: pass it as `wasmFileset`. */
export const CDN_WASM_FILESET: WasmFileset = {
  wasmLoaderPath: `${WASM_CDN_BASE}/vision_wasm_internal.js`,
  wasmBinaryPath: `${WASM_CDN_BASE}/vision_wasm_internal.wasm`,
};
