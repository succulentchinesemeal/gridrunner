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

// 4. Test C: Strict Collisions vs Flow Mode (Elevated Platform Side-Hit)
console.log('\n--- Test C: Flow vs Strict Platform Collisions ---');
const platformBox = {
  minX: -50,
  maxX: 50,
  minY: 10,
  maxY: 60,
  minZ: -140,
  maxZ: -90,
  type: 'PLATFORM' as const,
  isPlatform: true,
};

// Flow mode: player running into platform side should bypass it (not snag)
const flowPhysics = new PlayerPhysics(new PerkManager(DEFAULT_GOLDSRC_STATS));
flowPhysics.strictCollisions = false;
flowPhysics.pos.set(0, 0, -50);
flowPhysics.vel.set(0, 0, -400);

for (let t = 0; t < 20; t++) {
  flowPhysics.stepTick(
    { fmove: 320, smove: 0, viewYaw: 0, jumpHeld: false, jumpEdge: false, dashPressed: false },
    GOLDSRC_DT,
    undefined,
    undefined,
    [platformBox]
  );
}
console.log(`[Flow Mode] Velocity Z after platform passage: ${flowPhysics.vel.z.toFixed(2)} (Expected ~ -400)`);
if (flowPhysics.vel.z > -300) {
  throw new Error(`Flow mode failed: blocked by elevated platform (${flowPhysics.vel.z})`);
}

// Strict mode: player running into platform side below step threshold must be blocked/deflected
const strictPhysics = new PlayerPhysics(new PerkManager(DEFAULT_GOLDSRC_STATS));
strictPhysics.strictCollisions = true;
strictPhysics.pos.set(0, 0, -50);
strictPhysics.vel.set(0, 0, -400);

for (let t = 0; t < 20; t++) {
  strictPhysics.stepTick(
    { fmove: 320, smove: 0, viewYaw: 0, jumpHeld: false, jumpEdge: false, dashPressed: false },
    GOLDSRC_DT,
    undefined,
    undefined,
    [platformBox]
  );
}
console.log(`[Strict Mode] Velocity Z after platform impact: ${strictPhysics.vel.z.toFixed(2)} (Expected 0 or positive deflection)`);
if (strictPhysics.vel.z <= -200) {
  throw new Error(`Strict mode failed: did not block elevated platform collision (${strictPhysics.vel.z})`);
}

// TrackGenerator Strict Collisions check
const trackScene = new THREE.Scene();
const trackStrict = new TrackGenerator(trackScene, 9999, 'FLOW');
console.log(`Initial Track strictCollisions: ${trackStrict.strictCollisions}`);
trackStrict.setStrictCollisions(true);
if (!trackStrict.strictCollisions) {
  throw new Error('TrackGenerator setStrictCollisions(true) failed');
}
trackStrict.setTrackMode('COMPETITIVE');
if (!trackStrict.strictCollisions) {
  throw new Error('TrackGenerator setTrackMode COMPETITIVE did not enable strictCollisions');
}
trackStrict.setTrackMode('FLOW');
if (trackStrict.strictCollisions) {
  throw new Error('TrackGenerator setTrackMode FLOW did not disable strictCollisions');
}

// 5. Test D: Player-to-Player Elastic Cyber Bump
console.log('\n--- Test D: Player Cyber Bumping in Strict Mode ---');
let bumpCalled = false;
let bumpSpeed = 0;
const bumpPhysics = new PlayerPhysics(new PerkManager(DEFAULT_GOLDSRC_STATS), {
  onPlayerBump: (spd) => {
    bumpCalled = true;
    bumpSpeed = spd;
  },
});
bumpPhysics.strictCollisions = true;
bumpPhysics.pos.set(0, 0, 0);
bumpPhysics.vel.set(0, 0, -300);

const otherRunner = {
  id: 'remote-1',
  x: 0,
  y: 0,
  z: -25, // directly ahead within radius (radius sum = 48)
  vx: 0,
  vy: 0,
  vz: 0,
  alive: true,
};

bumpPhysics.stepTick(
  { fmove: 0, smove: 0, viewYaw: 0, jumpHeld: false, jumpEdge: false, dashPressed: false },
  GOLDSRC_DT,
  undefined,
  undefined,
  undefined,
  [otherRunner]
);

console.log(`[Player Bump] Callback triggered: ${bumpCalled} | Rel Speed: ${bumpSpeed.toFixed(1)} | Vel Z after bump: ${bumpPhysics.vel.z.toFixed(1)}`);
if (!bumpCalled) {
  throw new Error('Player bump callback was not triggered');
}
if (bumpPhysics.vel.z >= -200) {
  console.log('Player elastic deflection verified!');
}

console.log('\nALL GOLDSRC PHYSICS & PROCEDURAL TRACK CHECKS PASSED!');
