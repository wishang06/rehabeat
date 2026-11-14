import { describe, expect, it } from 'vitest';
import * as pose from './index';

/**
 * Importing the barrel also loads the browser-only modules, so this doubles as
 * a check that other packages' tests can import from src/pose under Node.
 */
describe('pose public API', () => {
  it('exports the pipeline functions and classes', () => {
    for (const name of [
      'angleBetween',
      'computeJointAngles',
      'computeFormMetrics',
      'pickFrameTime',
      'openCamera',
      'stopCamera',
      'createPoseTracker',
      'drawSkeleton',
      'OneEuroFilter',
      'AngleSmoother',
    ] as const) {
      expect(typeof pose[name]).toBe('function');
    }
  });

  it('re-exports the landmark tables', () => {
    expect(pose.LM.leftShoulder).toBe(11);
    expect(pose.MIN_VISIBILITY).toBe(0.6);
    expect(Object.keys(pose.JOINT_TRIPLETS)).toHaveLength(8);
    expect(pose.SKELETON_BONES.length).toBeGreaterThan(0);
  });

  it('exports the smoothing defaults', () => {
    expect(pose.ANGLE_MIN_CUTOFF).toBe(1.5);
    expect(pose.ANGLE_BETA).toBe(0.02);
    expect(pose.ANGLE_D_CUTOFF).toBe(1.0);
  });

  it('points the wasm filesets at the non-module loader and its binary', () => {
    expect(pose.LOCAL_WASM_FILESET.wasmLoaderPath).toMatch(/vision_wasm_internal.*\.js/);
    expect(pose.LOCAL_WASM_FILESET.wasmBinaryPath).toMatch(/vision_wasm_internal.*\.wasm/);
    expect(pose.WASM_CDN_BASE).toBe(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm',
    );
    expect(pose.CDN_WASM_FILESET).toEqual({
      wasmLoaderPath: `${pose.WASM_CDN_BASE}/vision_wasm_internal.js`,
      wasmBinaryPath: `${pose.WASM_CDN_BASE}/vision_wasm_internal.wasm`,
    });
    expect(pose.POSE_MODEL_URL).toMatch(/pose_landmarker_lite\.task$/);
  });
});
