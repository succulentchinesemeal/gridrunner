import * as THREE from 'three';
import { CollisionWorld } from '../physics/PlayerPhysics';
import { SeededRandom } from './SeededRandom';

export type ChunkArchetype =
  | 'RUNWAY'
  | 'SLALOM'
  | 'FROGGER'
  | 'KZ_CHASM'
  | 'LASER_HURDLES';

export interface ObstacleBox {
  id: string;
  kind: 'pillar' | 'frogger' | 'laser' | 'platform';
  /** Center position in GoldSrc units */
  x: number;
  y: number;
  z: number;
  /** Half-extents */
  hx: number;
  hy: number;
  hz: number;
  /** For moving Frogger beams */
  speedX?: number;
  phase?: number;
  rangeX?: number;
  /** Whether touching this obstacle eliminates/knocks back or acts as solid wall */
  lethal: boolean;
  mesh: THREE.Object3D;
}

export interface BoostPad {
  x: number;
  y: number;
  z: number;
  hx: number;
  hz: number;
  boostUps: number;
  liftY: number;
}

export interface ChasmGap {
  zStart: number; // Less negative (entry edge)
  zEnd: number; // More negative (exit edge)
  bridgeMinX: number;
  bridgeMaxX: number;
}

export interface TrackChunk {
  index: number;
  archetype: ChunkArchetype;
  zStart: number;
  zEnd: number;
  group: THREE.Group;
  obstacles: ObstacleBox[];
  boostPads: BoostPad[];
  chasms: ChasmGap[];
}

export class TrackGenerator implements CollisionWorld {
  public static readonly HIGHWAY_WIDTH = 1200;
  public static readonly HIGHWAY_HALF_WIDTH = 600;
  public static readonly CHUNK_LENGTH = 1200;

  private scene: THREE.Scene;
  private matchSeed = 1337;
  private chunks = new Map<number, TrackChunk>();
  public totalSpawnedChunks = 0;
  public totalDespawnedChunks = 0;

  /** If true, disables hazards/chasms for pure flat-ground physics unit tests */
  public flatTestMode = false;

  /** Chasing "Derezzing Wall" state — starts 1600 units (50m) behind player with a gentle warmup ramp */
  public static readonly WALL_START_Z = 1600;
  public wallZ = TrackGenerator.WALL_START_Z;
  public wallSpeedUps = 140;
  public wallEnabled = true;
  private wallMesh: THREE.Group;
  private lastBoostPadTime = -10;

  // Shared materials for crisp neon performance
  private deckMaterial: THREE.MeshStandardMaterial;
  private platformMaterial: THREE.MeshStandardMaterial;
  private cyanLineMaterial: THREE.LineBasicMaterial;
  private magentaLineMaterial: THREE.LineBasicMaterial;
  private limeLineMaterial: THREE.LineBasicMaterial;
  private pillarMaterial: THREE.MeshStandardMaterial;
  private froggerMaterial: THREE.MeshStandardMaterial;
  private laserMaterial: THREE.MeshBasicMaterial;
  private bridgeMaterial: THREE.MeshStandardMaterial;
  private boostPadMaterial: THREE.MeshBasicMaterial;
  private archMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, initialSeed = 1337) {
    this.scene = scene;
    this.matchSeed = initialSeed;

    this.deckMaterial = new THREE.MeshStandardMaterial({
      color: 0x060a18,
      roughness: 0.25,
      metalness: 0.8,
      emissive: 0x020612,
      emissiveIntensity: 0.5,
    });

    this.platformMaterial = new THREE.MeshStandardMaterial({
      color: 0x09162e,
      roughness: 0.2,
      metalness: 0.85,
      emissive: 0x00a8ff,
      emissiveIntensity: 0.45,
    });

    this.cyanLineMaterial = new THREE.LineBasicMaterial({
      color: 0x00f3ff,
      transparent: true,
      opacity: 0.85,
    });

    this.magentaLineMaterial = new THREE.LineBasicMaterial({
      color: 0xff007f,
      transparent: true,
      opacity: 0.9,
    });

    this.limeLineMaterial = new THREE.LineBasicMaterial({
      color: 0x00ff66,
      transparent: true,
      opacity: 0.95,
    });

    this.pillarMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a1026,
      emissive: 0x00f3ff,
      emissiveIntensity: 0.75,
      roughness: 0.2,
      metalness: 0.9,
    });

    this.froggerMaterial = new THREE.MeshStandardMaterial({
      color: 0x220018,
      emissive: 0xff007f,
      emissiveIntensity: 1.15,
      roughness: 0.2,
      metalness: 0.8,
    });

    this.laserMaterial = new THREE.MeshBasicMaterial({
      color: 0xff1e56,
    });

    this.bridgeMaterial = new THREE.MeshStandardMaterial({
      color: 0x052415,
      emissive: 0x00ff66,
      emissiveIntensity: 0.75,
      roughness: 0.3,
    });

    this.boostPadMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff66,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    });

    this.archMaterial = new THREE.MeshBasicMaterial({
      color: 0x00f3ff,
      transparent: true,
      opacity: 0.55,
    });

    this.wallMesh = this.createDerezzingWallMesh();
    this.scene.add(this.wallMesh);

    this.resetWithSeed(initialSeed);
  }

  private createDerezzingWallMesh(): THREE.Group {
    const group = new THREE.Group();
    const wallGeo = new THREE.PlaneGeometry(
      TrackGenerator.HIGHWAY_WIDTH * 1.8,
      580,
      20,
      10
    );
    const wallMat = new THREE.MeshBasicMaterial({
      color: 0xff003c,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(wallGeo, wallMat);
    plane.position.y = 250;
    group.add(plane);

    const wireGeo = new THREE.WireframeGeometry(wallGeo);
    const wireMat = new THREE.LineBasicMaterial({
      color: 0xff2a55,
      transparent: true,
      opacity: 0.95,
    });
    const wire = new THREE.LineSegments(wireGeo, wireMat);
    wire.position.y = 250;
    group.add(wire);

    // Bottom blazing hazard beam
    const coreGeo = new THREE.BoxGeometry(
      TrackGenerator.HIGHWAY_WIDTH * 1.8,
      16,
      16
    );
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xff5577 });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.y = 8;
    group.add(core);

    group.position.z = this.wallZ;
    return group;
  }

  public resetWithSeed(seed: number): void {
    this.matchSeed = seed >>> 0;
    for (const chunk of this.chunks.values()) {
      this.disposeChunk(chunk);
    }
    this.chunks.clear();
    this.totalSpawnedChunks = 0;
    this.totalDespawnedChunks = 0;
    this.wallZ = TrackGenerator.WALL_START_Z;
    this.wallSpeedUps = 140;
    this.lastBoostPadTime = -10;
    this.wallMesh.position.z = this.wallZ;

    // Pre-generate initial chunks around start
    this.updateAroundPlayerZ(0, 0, 0);
  }

  public getSeed(): number {
    return this.matchSeed;
  }

  public getActiveChunkCount(): number {
    return this.chunks.size;
  }

  public getActiveArchetypes(): ChunkArchetype[] {
    return Array.from(this.chunks.values()).map((c) => c.archetype);
  }

  /**
   * Deterministic seed per chunk index so chunks can spawn in any order identically
   */
  private getChunkRng(chunkIndex: number): SeededRandom {
    const combinedSeed =
      (this.matchSeed ^ Math.imul(chunkIndex + 1024, 0x9e3779b1)) >>> 0;
    return new SeededRandom(combinedSeed);
  }

  public updateAroundPlayerZ(
    playerZ: number,
    matchElapsedSec: number,
    dt: number
  ): void {
    const L = TrackGenerator.CHUNK_LENGTH;
    const currentChunkIdx = Math.floor(-playerZ / L);

    // Spawn from 1 chunk behind to 6 chunks ahead
    for (let idx = currentChunkIdx - 1; idx <= currentChunkIdx + 6; idx++) {
      if (!this.chunks.has(idx)) {
        const chunk = this.buildChunk(idx, matchElapsedSec);
        this.chunks.set(idx, chunk);
        this.scene.add(chunk.group);
        this.totalSpawnedChunks++;
      }
    }

    // Despawn chunks more than 2 chunks behind player
    for (const [idx, chunk] of this.chunks.entries()) {
      if (idx < currentChunkIdx - 2) {
        this.disposeChunk(chunk);
        this.chunks.delete(idx);
        this.totalDespawnedChunks++;
      }
    }

    // Animate moving Frogger cross-traffic beams deterministically by matchElapsedSec
    for (const chunk of this.chunks.values()) {
      for (const obs of chunk.obstacles) {
        if (obs.kind === 'frogger' && obs.speedX && obs.rangeX) {
          const phase = obs.phase ?? 0;
          obs.x = Math.sin(matchElapsedSec * obs.speedX + phase) * obs.rangeX;
          obs.mesh.position.x = obs.x;
        }
      }
    }

    // Advance the chasing Derezzing Wall with a fair 5s warmup grace period:
    // - 0..5s: gentle 140 UPS warmup so player can orient and start moving
    // - 5..25s: ramps from 180 -> 300 UPS
    // - 25..150s: scales from 300 -> 520 UPS
    if (this.wallEnabled && !this.flatTestMode && dt > 0) {
      if (matchElapsedSec < 5) {
        this.wallSpeedUps = 140 + (matchElapsedSec / 5) * 40;
      } else if (matchElapsedSec < 25) {
        const tWarm = (matchElapsedSec - 5) / 20;
        this.wallSpeedUps = 180 + tWarm * 120;
      } else {
        const progress = Math.min(1, Math.max(0, (matchElapsedSec - 25) / 125));
        this.wallSpeedUps = 300 + (520 - 300) * progress;
      }

      this.wallZ -= this.wallSpeedUps * dt;

      // Rubber-band cap so the wall stays within 2000 units behind if player rockets far ahead
      const maxLagDistance = 2000;
      if (this.wallZ > playerZ + maxLagDistance) {
        this.wallZ = playerZ + maxLagDistance;
      }
      this.wallMesh.position.z = this.wallZ;
    }
  }

  private buildChunk(index: number, _matchElapsedSec: number): TrackChunk {
    const L = TrackGenerator.CHUNK_LENGTH;
    const W = TrackGenerator.HIGHWAY_WIDTH;
    const zStart = -index * L;
    const zEnd = -(index + 1) * L;
    const rng = this.getChunkRng(index);

    // Chunk <= 0 is always a clean launch runway with starter boost pads and guide arrows
    let archetype: ChunkArchetype = 'RUNWAY';
    if (!this.flatTestMode && index >= 1) {
      const pool: ChunkArchetype[] = [
        'SLALOM',
        'FROGGER',
        'KZ_CHASM',
        'LASER_HURDLES',
      ];
      if (index <= 4) {
        archetype = pool[(index - 1) % pool.length];
      } else {
        archetype = rng.pick(pool);
      }
    }

    const group = new THREE.Group();
    const obstacles: ObstacleBox[] = [];
    const boostPads: BoostPad[] = [];
    const chasms: ChasmGap[] = [];

    if (archetype === 'KZ_CHASM') {
      // Split deck with a 390-unit KZ Long-Jump chasm in the middle
      const gapLength = rng.range(380, 415);
      const zMid = (zStart + zEnd) * 0.5;
      const gapStart = zMid + gapLength * 0.5;
      const gapEnd = zMid - gapLength * 0.5;

      const entryLen = zStart - gapStart;

      this.addDeckSegment(group, zStart, zStart - entryLen, W, index);
      this.addDeckSegment(group, gapEnd, zEnd, W, index);

      // Slower fallback bridge on BOTH outer lanes so players on either side have a clear visual route,
      // while the center chasm rewards high-speed 450+ UPS bhop jumps or a central boost pad!
      const bridgeWidth = 155;
      for (const sideSign of [-1, 1]) {
        const bridgeCenterX = sideSign * (W * 0.5 - bridgeWidth * 0.5);
        const bridgeGeo = new THREE.BoxGeometry(
          bridgeWidth,
          12,
          gapLength + 16
        );
        const bridgeMesh = new THREE.Mesh(bridgeGeo, this.bridgeMaterial);
        bridgeMesh.position.set(bridgeCenterX, -6, zMid);
        group.add(bridgeMesh);
      }

      // Add a launch boost pad right before the center of the chasm to reward aggressive center lines
      this.addBoostPad(group, boostPads, 0, gapStart + 65, 95, 75, 110, 85);
      this.addNeonJumpChevron(group, gapStart - 10);

      chasms.push({
        zStart: gapStart,
        zEnd: gapEnd,
        bridgeMinX: -W * 0.5,
        bridgeMaxX: -W * 0.5 + bridgeWidth,
      });
    } else {
      // Continuous highway deck for this chunk
      this.addDeckSegment(group, zStart, zEnd, W, index);
    }

    // Add Overhead Speed Reference Portals & Roadside Cyber-Skyline Towers to every chunk
    if (!this.flatTestMode && index >= 0) {
      this.addSpeedArchesAndSkyline(group, zStart, zEnd, W, index, rng);
    }

    // Starter Runway Boost Pads & Intuitive Forward Guide Chevrons on Chunk 0
    if (!this.flatTestMode && index === 0) {
      this.addNeonJumpChevron(group, -70);
      this.addNeonJumpChevron(group, -240);
      this.addNeonJumpChevron(group, -440);
      this.addBoostPad(group, boostPads, 0, -140, 120, 90, 95, 0);
      this.addBoostPad(group, boostPads, 0, -680, 110, 90, 85, 65);
    }

    // Populate archetype obstacles & multi-tier parkour platforms
    if (archetype === 'SLALOM') {
      // Bhop Pillar Slaloms + Elevated Center Sky-Walk Platform
      const rows = 3;
      for (let r = 0; r < rows; r++) {
        const rowZ = zStart - 220 - r * 360;
        const offsetSign = r % 2 === 0 ? -1 : 1;
        const pillarPositionsX = offsetSign < 0 ? [-220, 260] : [-260, 220];

        for (const px of pillarPositionsX) {
          const hx = 54;
          const hy = 95;
          const hz = 54;
          const mesh = this.createNeonBoxMesh(
            hx * 2,
            hy * 2,
            hz * 2,
            this.pillarMaterial,
            0x00f3ff
          );
          mesh.position.set(px, hy, rowZ);
          group.add(mesh);

          obstacles.push({
            id: `slalom_${index}_${r}_${px}`,
            kind: 'pillar',
            x: px,
            y: hy,
            z: rowZ,
            hx,
            hy,
            hz,
            lethal: false,
            mesh,
          });
        }
      }

      // Add an elevated parkour sky-platform along the side lane
      this.addElevatedPlatform(
        group,
        obstacles,
        boostPads,
        index,
        rng.next() < 0.5 ? -390 : 390,
        36,
        (zStart + zEnd) * 0.5,
        85,
        380
      );
    } else if (archetype === 'FROGGER') {
      // Horizontal sliding plasma blocks + Elevated Center Sky-Bridge over the beams!
      const beamCount = 3;
      for (let b = 0; b < beamCount; b++) {
        const beamZ = zStart - 240 - b * 360;
        const hx = 130;
        const hy = 30;
        const hz = 30;
        const speedX = rng.range(1.5, 2.5) * (b % 2 === 0 ? 1 : -1);
        const phase = rng.range(0, Math.PI * 2);
        const rangeX = TrackGenerator.HIGHWAY_HALF_WIDTH - hx - 40;

        const mesh = this.createNeonBoxMesh(
          hx * 2,
          hy * 2,
          hz * 2,
          this.froggerMaterial,
          0xff007f
        );
        mesh.position.set(0, hy, beamZ);
        group.add(mesh);

        obstacles.push({
          id: `frogger_${index}_${b}`,
          kind: 'frogger',
          x: 0,
          y: hy,
          z: beamZ,
          hx,
          hy,
          hz,
          speedX,
          phase,
          rangeX,
          lethal: false,
          mesh,
        });
      }

      // Elevated parkour overpass in the center so acrobatic runners can vault above traffic
      this.addElevatedPlatform(
        group,
        obstacles,
        boostPads,
        index,
        0,
        66,
        (zStart + zEnd) * 0.5,
        90,
        460
      );
    } else if (archetype === 'LASER_HURDLES') {
      // Low/High horizontal laser hurdles + stepped acrobat platforms
      const hurdleCount = 3;
      for (let h = 0; h < hurdleCount; h++) {
        const hurdleZ = zStart - 250 - h * 350;
        const isHigh = h === 1;
        const spanWidth = 720;
        const laneOffset = (h % 2 === 0 ? -1 : 1) * 140;
        const yCenter = isHigh ? 68 : 22;
        const hy = 9;
        const hx = spanWidth * 0.5;
        const hz = 12;

        const mesh = this.createNeonBoxMesh(
          hx * 2,
          hy * 2,
          hz * 2,
          this.laserMaterial,
          0xff0055
        );
        mesh.position.set(laneOffset, yCenter, hurdleZ);
        group.add(mesh);

        obstacles.push({
          id: `laser_${index}_${h}`,
          kind: 'laser',
          x: laneOffset,
          y: yCenter,
          z: hurdleZ,
          hx,
          hy,
          hz,
          lethal: false,
          mesh,
        });
      }

      this.addBoostPad(
        group,
        boostPads,
        0,
        zStart - 110,
        90,
        75,
        85,
        90
      );
    }

    return {
      index,
      archetype,
      zStart,
      zEnd,
      group,
      obstacles,
      boostPads,
      chasms,
    };
  }

  private addElevatedPlatform(
    group: THREE.Group,
    obstacles: ObstacleBox[],
    boostPads: BoostPad[],
    chunkIdx: number,
    x: number,
    topY: number,
    zCenter: number,
    hx: number,
    hz: number
  ): void {
    const hy = 8;
    const yCenter = topY - hy;
    const mesh = this.createNeonBoxMesh(
      hx * 2,
      hy * 2,
      hz * 2,
      this.platformMaterial,
      0x00ff66
    );
    mesh.position.set(x, yCenter, zCenter);
    group.add(mesh);

    obstacles.push({
      id: `plat_${chunkIdx}_${x}_${zCenter}`,
      kind: 'platform',
      x,
      y: yCenter,
      z: zCenter,
      hx,
      hy,
      hz,
      lethal: false,
      mesh,
    });

    // Place a launch boost pad just ahead of the platform entry so runners can vault onto it
    this.addBoostPad(
      group,
      boostPads,
      x,
      zCenter + hz + 85,
      hx * 0.85,
      55,
      70,
      Math.max(120, topY * 3.2)
    );
  }

  private addBoostPad(
    group: THREE.Group,
    boostPads: BoostPad[],
    x: number,
    z: number,
    hx: number,
    hz: number,
    boostUps: number,
    liftY: number
  ): void {
    const padGeo = new THREE.PlaneGeometry(hx * 2, hz * 2);
    padGeo.rotateX(-Math.PI * 0.5);
    const padMesh = new THREE.Mesh(padGeo, this.boostPadMaterial);
    padMesh.position.set(x, 0.8, z);
    group.add(padMesh);

    // Inner chevron lines on pad
    const pts = [
      x - hx * 0.6, 1.2, z + hz * 0.4, x, 1.2, z - hz * 0.4,
      x, 1.2, z - hz * 0.4, x + hx * 0.6, 1.2, z + hz * 0.4,
    ];
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    group.add(new THREE.LineSegments(lineGeo, this.limeLineMaterial));

    boostPads.push({
      x,
      y: 0,
      z,
      hx,
      hz,
      boostUps,
      liftY,
    });
  }

  private addSpeedArchesAndSkyline(
    group: THREE.Group,
    zStart: number,
    zEnd: number,
    width: number,
    chunkIdx: number,
    rng: SeededRandom
  ): void {
    const halfW = width * 0.5;

    // 1. Overhead Neon Speed Portals every 300 units (crucial optical flow for sense of speed!)
    for (let z = zStart - 150; z >= zEnd + 100; z -= 300) {
      const archHeight = 210;
      const pillarLeft = new THREE.Mesh(
        new THREE.BoxGeometry(10, archHeight, 10),
        this.archMaterial
      );
      pillarLeft.position.set(-halfW + 6, archHeight * 0.5, z);
      group.add(pillarLeft);

      const pillarRight = new THREE.Mesh(
        new THREE.BoxGeometry(10, archHeight, 10),
        this.archMaterial
      );
      pillarRight.position.set(halfW - 6, archHeight * 0.5, z);
      group.add(pillarRight);

      const topBeam = new THREE.Mesh(
        new THREE.BoxGeometry(width, 8, 10),
        this.archMaterial
      );
      topBeam.position.set(0, archHeight, z);
      group.add(topBeam);
    }

    // 2. Varied Roadside Cyber-Monolith Skyline Towers outside the track rails
    for (let z = zStart - 200; z >= zEnd + 150; z -= 400) {
      for (const side of [-1, 1]) {
        const towerH = rng.range(180, 460);
        const towerW = rng.range(70, 120);
        const distOut = halfW + 130 + rng.range(0, 90);
        const towerMesh = this.createNeonBoxMesh(
          towerW,
          towerH,
          towerW,
          this.deckMaterial,
          chunkIdx % 2 === 0 ? 0x00f3ff : 0xff007f
        );
        towerMesh.position.set(side * distOut, towerH * 0.5 - 40, z);
        group.add(towerMesh);
      }
    }
  }

  private addDeckSegment(
    group: THREE.Group,
    zStart: number,
    zEnd: number,
    width: number,
    chunkIdx: number
  ): void {
    const length = Math.abs(zStart - zEnd);
    const zCenter = (zStart + zEnd) * 0.5;

    const deckGeo = new THREE.BoxGeometry(width, 16, length);
    const deckMesh = new THREE.Mesh(deckGeo, this.deckMaterial);
    deckMesh.position.set(0, -8, zCenter);
    group.add(deckMesh);

    // Procedural Tron Grid Lines (Cyan longitudinal + alternating Magenta/Lime lateral)
    const points: number[] = [];
    const halfW = width * 0.5;
    const laneSpacing = 100;
    for (let x = -halfW; x <= halfW; x += laneSpacing) {
      points.push(x, 0.4, zStart, x, 0.4, zEnd);
    }
    const zStep = 75; // Denser lateral grid lines for stronger peripheral speed perception
    for (let z = zStart; z >= zEnd; z -= zStep) {
      points.push(-halfW, 0.4, z, halfW, 0.4, z);
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(points, 3)
    );
    const mat =
      Math.abs(chunkIdx) % 3 === 1
        ? this.magentaLineMaterial
        : Math.abs(chunkIdx) % 3 === 2
        ? this.limeLineMaterial
        : this.cyanLineMaterial;
    const gridLines = new THREE.LineSegments(lineGeo, mat);
    group.add(gridLines);

    // Glowing side boundary rails
    const railPoints = [
      -halfW, 6, zStart, -halfW, 6, zEnd,
      halfW, 6, zStart, halfW, 6, zEnd,
    ];
    const railGeo = new THREE.BufferGeometry();
    railGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(railPoints, 3)
    );
    const rails = new THREE.LineSegments(railGeo, this.magentaLineMaterial);
    group.add(rails);
  }

  private addNeonJumpChevron(group: THREE.Group, zEdge: number): void {
    const pts: number[] = [];
    for (let x = -450; x <= 450; x += 150) {
      pts.push(x - 45, 1.5, zEdge + 35, x, 1.5, zEdge);
      pts.push(x, 1.5, zEdge, x + 45, 1.5, zEdge + 35);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(geo, this.limeLineMaterial);
    group.add(lines);
  }

  private createNeonBoxMesh(
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    edgeColor: number
  ): THREE.Group {
    const holder = new THREE.Group();
    const boxGeo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(boxGeo, mat);
    holder.add(mesh);

    const edgesGeo = new THREE.EdgesGeometry(boxGeo);
    const edgesMat = new THREE.LineBasicMaterial({ color: edgeColor });
    const wire = new THREE.LineSegments(edgesGeo, edgesMat);
    holder.add(wire);

    return holder;
  }

  private disposeChunk(chunk: TrackChunk): void {
    this.scene.remove(chunk.group);
    chunk.group.traverse((obj) => {
      if ((obj as THREE.Mesh).geometry) {
        (obj as THREE.Mesh).geometry.dispose();
      }
    });
  }

  /**
   * CollisionWorld implementation: returns floor Y at (x, z), or -Infinity over a KZ chasm gap
   */
  public getFloorHeight(x: number, z: number): number {
    if (this.flatTestMode) return 0;

    const L = TrackGenerator.CHUNK_LENGTH;
    const idx = Math.floor(-z / L);
    const chunk = this.chunks.get(idx);
    if (!chunk) return 0;

    for (const chasm of chunk.chasms) {
      if (z <= chasm.zStart && z >= chasm.zEnd) {
        // Check if player is on either the left or right outer bridge
        const halfW = TrackGenerator.HIGHWAY_HALF_WIDTH;
        const bridgeW = 155;
        if (Math.abs(x) >= halfW - bridgeW) {
          return 0;
        }
        return -1000; // Open KZ chasm
      }
    }

    return 0;
  }

  /**
   * CollisionWorld implementation: AABB obstacle collision, Boost Pads & Derezzing Wall check
   */
  public resolveCollisions(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    radius: number,
    height: number
  ): { hitHazard: boolean; groundedOnObstacle: boolean; supportY: number } {
    if (this.flatTestMode) {
      return { hitHazard: false, groundedOnObstacle: false, supportY: 0 };
    }

    // Check Derezzing Wall behind player
    if (this.wallEnabled && pos.z > this.wallZ) {
      return { hitHazard: true, groundedOnObstacle: false, supportY: 0 };
    }

    const L = TrackGenerator.CHUNK_LENGTH;
    const idx = Math.floor(-pos.z / L);
    let groundedOnObstacle = false;
    let supportY = 0;

    for (let c = idx - 1; c <= idx + 1; c++) {
      const chunk = this.chunks.get(c);
      if (!chunk) continue;

      // Check Emerald Boost Pads
      for (const pad of chunk.boostPads) {
        if (
          Math.abs(pos.x - pad.x) < pad.hx + radius &&
          Math.abs(pos.z - pad.z) < pad.hz + radius &&
          pos.y <= pad.y + 24
        ) {
          const now = performance.now() * 0.001;
          if (now - this.lastBoostPadTime > 0.25) {
            this.lastBoostPadTime = now;
            const currentSpeed = Math.hypot(vel.x, vel.z);
            const targetSpeed = Math.max(currentSpeed + pad.boostUps, 380);
            if (currentSpeed > 20) {
              const scale = targetSpeed / currentSpeed;
              vel.x *= scale;
              vel.z *= scale;
            } else {
              vel.z = -targetSpeed;
            }
            if (pad.liftY > 0) {
              vel.y = Math.max(vel.y, pad.liftY);
            }
          }
        }
      }

      for (const obs of chunk.obstacles) {
        const minX = obs.x - obs.hx - radius;
        const maxX = obs.x + obs.hx + radius;
        const minZ = obs.z - obs.hz - radius;
        const maxZ = obs.z + obs.hz + radius;
        const minY = obs.y - obs.hy;
        const maxY = obs.y + obs.hy;

        if (
          pos.x > minX &&
          pos.x < maxX &&
          pos.z > minZ &&
          pos.z < maxZ &&
          pos.y + height > minY &&
          pos.y < maxY
        ) {
          // Check if player is landing on top of the obstacle / platform
          if (pos.y >= maxY - 18 && vel.y <= 0) {
            groundedOnObstacle = true;
            supportY = Math.max(supportY, maxY);
            continue;
          }

          if (obs.lethal) {
            return { hitHazard: true, groundedOnObstacle: false, supportY: 0 };
          }

          // Platforms can be run underneath if player is below minY
          if (obs.kind === 'platform' && pos.y + height * 0.7 < minY) {
            continue;
          }

          // Push out along shallowest horizontal axis (GoldSrc clip-velocity feel)
          const overlapLeft = pos.x - minX;
          const overlapRight = maxX - pos.x;
          const overlapBack = maxZ - pos.z;
          const overlapFront = pos.z - minZ;

          const minOverlap = Math.min(
            overlapLeft,
            overlapRight,
            overlapBack,
            overlapFront
          );

          if (minOverlap === overlapLeft) {
            pos.x = minX;
            if (vel.x > 0) vel.x = 0;
          } else if (minOverlap === overlapRight) {
            pos.x = maxX;
            if (vel.x < 0) vel.x = 0;
          } else if (minOverlap === overlapBack) {
            pos.z = maxZ;
            if (vel.z < 0) vel.z *= 0.25;
          } else {
            pos.z = minZ;
            if (vel.z > 0) vel.z = 0;
          }
        }
      }
    }

    return { hitHazard: false, groundedOnObstacle, supportY };
  }
}
