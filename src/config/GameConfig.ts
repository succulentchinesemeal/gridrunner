import { CameraMode } from '../renderer/TronRenderer';
import { TrackMode } from '../world/TrackGenerator';

export interface LaunchConfig {
  mode: TrackMode;
  seed: number;
  camera: CameraMode;
  autostart: boolean;
  flatTest: boolean;
}

export const DEFAULT_TRACK_SEED = 1337420;

/**
 * Central visual palette and lighting tuning constants.
 * Edit here first before touching TronRenderer.ts or PlayerRig.ts.
 */
export const VISUAL_THEME = {
  primaryCyan: 0x00f3ff,
  accentMagenta: 0xff007f,
  synthViolet: 0x7a04eb,
  solarGold: 0xffb800,
  hazardCrimson: 0xff1e42,
  skyZenith: 0x03010a,
  skyHorizon: 0x1a052e,
} as const;

/**
 * Parses URL query parameters for deterministic AI testing, snapshots, and debugging.
 *
 * Supported parameters:
 *   ?mode=FLOW | COMPETITIVE
 *   ?seed=1337420
 *   ?cam=CHASE | FIRST_PERSON
 *   ?autostart=1
 *   ?flat=1
 */
export function parseLaunchConfig(search: string = window.location.search): LaunchConfig {
  const params = new URLSearchParams(search);

  const rawMode = params.get('mode')?.toUpperCase();
  const mode: TrackMode = rawMode === 'COMPETITIVE' ? 'COMPETITIVE' : 'FLOW';

  const rawSeed = Number(params.get('seed'));
  const seed = Number.isFinite(rawSeed) && rawSeed > 0 ? Math.floor(rawSeed) : DEFAULT_TRACK_SEED;

  const rawCam = params.get('cam')?.toUpperCase();
  const camera: CameraMode = rawCam === 'FIRST_PERSON' ? 'FIRST_PERSON' : 'CHASE';

  const autostart = params.get('autostart') === '1' || params.get('autostart') === 'true';
  const flatTest = params.get('flat') === '1' || params.get('flat') === 'true';

  return {
    mode,
    seed,
    camera,
    autostart,
    flatTest,
  };
}
