import * as THREE from 'three';
import { DEFAULT_GOLDSRC_STATS, PerkManager } from '../src/physics/PerkManager';
import { GOLDSRC_DT, PlayerPhysics } from '../src/physics/PlayerPhysics';
import { TrackGenerator } from '../src/world/TrackGenerator';

console.log('=== GRIDRUNNER GOLDSRC 100HZ VERIFICATION ===');

// 1. Test A: Accelerate on ground to 320 UPS, jump, hold W while rotating viewYaw
const physicsA = new PlayerPhysics(new PerkManager(DEFAULT_GOLDSRC_STATS));
for (let t = 0; t < 60; t++) {
  physicsA.stepTick({
    fmove: 320,
    smove: 0,
    viewYaw: 0,
    jumpHeld: false,
    jumpEdge: false,
    dashPressed: false,
  });
}
const groundSpeedA = physicsA.ups;

let yawA = 0;
for (let t = 0; t < 260; t++) {
  const dir = Math.floor(t / 65) % 2 === 0 ? 1 : -1;
  yawA += dir * 0.025;
  physicsA.stepTick({
    fmove: 320,
    smove: 0,
    viewYaw: yawA,
    jumpHeld: true,
    jumpEdge: t === 0,
    dashPressed: false,
  });
}
console.log(
  `[Test A] Ground Speed: ${groundSpeedA.toFixed(2)} UPS | Holding W in Air Speed: ${physicsA.ups.toFixed(2)} UPS (Expected ~320-350 UPS)`
);
if (physicsA.ups < 315 || physicsA.ups > 350) {
  throw new Error(`Test A failed: got ${physicsA.ups} UPS`);
}

// 2. Test B: Accelerate on ground to 320 UPS, jump, release W, alternate A/D air-strafes across 4 hops
const physicsB = new PlayerPhysics(new PerkManager(DEFAULT_GOLDSRC_STATS));
for (let t = 0; t < 60; t++) {
  physicsB.stepTick({
    fmove: 320,
    smove: 0,
    viewYaw: 0,
    jumpHeld: false,
    jumpEdge: false,
    dashPressed: false,
  });
}

let yawB = 0;
const hopTicks = 68;
for (let t = 0; t < hopTicks * 4; t++) {
  const hopIdx = Math.floor(t / hopTicks);
  const left = hopIdx % 2 === 0;
  yawB += left ? 0.028 : -0.028;
  physicsB.stepTick({
    fmove: 0,
    smove: left ? -320 : 320,
    viewYaw: yawB,
    jumpHeld: true,
    jumpEdge: t === 0,
    dashPressed: false,
  });
}
console.log(
  `[Test B] 4-Hop GoldSrc Air-Strafe Speed: ${physicsB.ups.toFixed(2)} UPS | Top UPS: ${physicsB.topUps.toFixed(2)} | Strafe Sync: ${physicsB.strafeSync}% | Bhop Chain: ${physicsB.bhopChain}`
);
if (physicsB.ups <= 500) {
  throw new Error(`Test B failed: expected > 500 UPS, got ${physicsB.ups}`);
}

// 3. Milestone 2: Deterministic Track Generator & Archetype Spawning
const scene = new THREE.Scene();
const track = new TrackGenerator(scene, 1337420);
let elapsed = 0;
for (let z = 0; z >= -7500; z -= 150) {
  elapsed += 0.25;
  track.updateAroundPlayerZ(z, elapsed, 0.25);
}
console.log(
  `[Milestone 2] Spawned Chunks: ${track.totalSpawnedChunks} | Despawned Chunks: ${track.totalDespawnedChunks} | Derezz Wall Speed: ${track.wallSpeedUps.toFixed(1)} UPS`
);
if (track.totalSpawnedChunks < 8 || track.totalDespawnedChunks < 2) {
  throw new Error('Track chunk spawn/despawn check failed');
}

console.log('ALL GOLDSRC PHYSICS & PROCEDURAL TRACK CHECKS PASSED!');
