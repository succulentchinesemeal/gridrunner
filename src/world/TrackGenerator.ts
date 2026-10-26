import * as THREE from 'three';
import { AABBBox, CollisionResult, CollisionWorld, SurfRampCollider } from '../physics/PlayerPhysics';
import { createCyberDeckMaterial } from '../renderer/TronRenderer';
import {
  getObstaclePillarTexture,
  getFroggerHazardTexture,
  getRampTextures,
} from '../renderer/TextureGenerator';
import { SeededRandom } from './SeededRandom';

export type TrackMode = 'FLOW' | 'COMPETITIVE';

export type ChunkArchetype =
  | 'RUNWAY'
  | 'CANYON_WAVE'
  | 'SPLIT_ELEVATION'
  | 'HALFPIPE_CARVE'
  | 'SKY_ARCHIPELAGO'
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
  surfRamps: SurfRampCollider[];
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

  /** Default 'FLOW' mode (5 obstacle-free multi-line playground chunks) vs 'COMPETITIVE' mode */
  public trackMode: TrackMode = 'FLOW';

  /** Whether strict solid platform and obstacle collisions are enabled (Skill / Competitive element) */
  public strictCollisions = false;

  /** If true, disables hazards/chasms for pure flat-ground physics unit tests */
  public flatTestMode = false;

  /** Chasing "Derezzing Wall" state — starts 1600 units (50m) behind player with a gentle warmup ramp */
  public static readonly WALL_START_Z = 1600;
  public wallZ = TrackGenerator.WALL_START_Z;
  public wallSpeedUps = 140;
  public wallEnabled = true;
  private wallMesh: THREE.Group;
  private lastBoostPadTime = -10;

  // Shared PBR & Neon Materials
  private deckMaterial: THREE.MeshStandardMaterial;
  private skyDeckMaterial: THREE.MeshStandardMaterial;
  private hexIslandMaterial: THREE.MeshStandardMaterial;
  private surfWaveMaterial: THREE.MeshStandardMaterial;
  private curbMaterial: THREE.MeshStandardMaterial;
  private parapetMaterial: THREE.MeshStandardMaterial;
  private hazardMaterial: THREE.MeshStandardMaterial;
  private thrusterConeMaterial: THREE.MeshBasicMaterial;
  private cyanLineMaterial: THREE.LineBasicMaterial;
  private magentaLineMaterial: THREE.LineBasicMaterial;
  private limeLineMaterial: THREE.LineBasicMaterial;
  private pillarMaterial: THREE.MeshStandardMaterial;
  private froggerMaterial: THREE.MeshStandardMaterial;
  private laserMaterial: THREE.MeshBasicMaterial;
  private bridgeMaterial: THREE.MeshStandardMaterial;
  private boostPadMaterial: THREE.MeshBasicMaterial;
  private archMaterial: THREE.MeshBasicMaterial;
  private lightCapMat: THREE.MeshBasicMaterial;

  // Pre-built and cached 3D Hardware Geometries (Zero Main-Thread Geometry Hitching)
  private cachedDeckGeo: THREE.BoxGeometry;
  private cachedDeckHalfGeo: THREE.BoxGeometry;
  private cachedBridgeGeo: THREE.BoxGeometry;
  private cachedCurbLeftGeo: THREE.ExtrudeGeometry;
  private cachedCurbRightGeo: THREE.ExtrudeGeometry;
  private cachedCurbLinesGeo: THREE.BufferGeometry;
  private cachedPylonGeo: THREE.BoxGeometry;
  private cachedLightCapGeo: THREE.BoxGeometry;
  private cachedLaunchWedge30Geo: THREE.ExtrudeGeometry;
  private cachedCanyonPrism50Geo: THREE.ExtrudeGeometry;
  private cachedSplitSkyHighwayGeo: THREE.ExtrudeGeometry;
  private cachedParapetWallGeo: THREE.ExtrudeGeometry;
  private cachedThrusterConeGeo: THREE.ConeGeometry;
  private cachedDiamondIslandGeo: THREE.ExtrudeGeometry;
  private cachedHexLilyPadGeo: THREE.ExtrudeGeometry;
  private cachedSurfRail950Geo: THREE.ExtrudeGeometry;
  private cachedCatwalkGeo: THREE.ExtrudeGeometry;
  private cachedSkyBridgeGeo: THREE.ExtrudeGeometry;
  private cachedHoloChevronArchGeo: THREE.ExtrudeGeometry;
  private cachedBoostPadGeo: THREE.PlaneGeometry;
  private cachedJumpChevronsGeo: THREE.BufferGeometry;
  private sharedGeometries: Set<THREE.BufferGeometry>;

  constructor(
    scene: THREE.Scene,
    initialSeed = 1337,
    trackMode: TrackMode = 'FLOW'
  ) {
    this.scene = scene;
    this.matchSeed = initialSeed;
    this.trackMode = trackMode;
    this.strictCollisions = trackMode === 'COMPETITIVE';

    // 1. Sleek Cyber Highway Road Deck (with bright cyan racing runners & chevrons)
    this.deckMaterial = createCyberDeckMaterial(new THREE.Color(0x00f3ff), {
      gridSpacing: new THREE.Vector2(100.0, 75.0),
      lineWidth: 1.5,
      glowIntensity: 0.55,
      roughness: 0.68,
      metalness: 0.22,
      useDeckTextures: true,
    });

    this.skyDeckMaterial = createCyberDeckMaterial(new THREE.Color(0x00ff66), {
      gridSpacing: new THREE.Vector2(65.0, 65.0),
      lineWidth: 1.6,
      glowIntensity: 0.50,
      roughness: 0.55,
      metalness: 0.30,
    });

    this.hexIslandMaterial = createCyberDeckMaterial(new THREE.Color(0xff007f), {
      gridSpacing: new THREE.Vector2(50.0, 50.0),
      lineWidth: 1.8,
      glowIntensity: 0.60,
      roughness: 0.52,
      metalness: 0.32,
    });

    // 2. High-Contrast Obstacle Pillar Material (bold industrial amber/black hazard stripes)
    const pillarTex = getObstaclePillarTexture();
    this.pillarMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.45,
      metalness: 0.38,
      emissive: 0xffaa00,
      emissiveIntensity: 0.22,
    });
    if (pillarTex) {
      this.pillarMaterial.map = pillarTex;
    }

    // 3. Lethal Moving Frogger Beam Material (neon-magenta/black hazard stripes with laser core)
    const froggerTex = getFroggerHazardTexture();
    this.froggerMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.40,
      metalness: 0.35,
      emissive: 0xff0066,
      emissiveIntensity: 0.55,
    });
    if (froggerTex) {
      this.froggerMaterial.map = froggerTex;
    }

    // 4. Surf Ramp & Launch Wave Material (cobalt blue metal with glowing spring-green launch chevrons)
    const rampTex = getRampTextures();
    this.surfWaveMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.48,
      metalness: 0.42,
      emissive: 0x00ffaa,
      emissiveIntensity: 0.30,
    });
    if (rampTex) {
      this.surfWaveMaterial.map = rampTex.map;
      this.surfWaveMaterial.roughnessMap = rampTex.roughnessMap;
    }

    // 5. Heavy Hazard Footing Material
    this.hazardMaterial = this.pillarMaterial;

    // 6. Curbs & Edge Parapets
    this.curbMaterial = new THREE.MeshStandardMaterial({
      color: 0x121b2d,
      roughness: 0.55,
      metalness: 0.35,
      emissive: 0x00f3ff,
      emissiveIntensity: 0.28,
    });

    this.parapetMaterial = new THREE.MeshStandardMaterial({
      color: 0x161c2e,
      roughness: 0.50,
      metalness: 0.38,
      emissive: 0xff007f,
      emissiveIntensity: 0.32,
    });

    this.thrusterConeMaterial = new THREE.MeshBasicMaterial({
      color: 0x00f3ff,
      transparent: true,
      opacity: 0.85,
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

    this.laserMaterial = new THREE.MeshBasicMaterial({
      color: 0xff1e56,
    });

    this.bridgeMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a2216,
      emissive: 0x00ff66,
      emissiveIntensity: 0.32,
      roughness: 0.55,
      metalness: 0.32,
    });
    if (rampTex) {
      this.bridgeMaterial.map = rampTex.map;
      this.bridgeMaterial.roughnessMap = rampTex.roughnessMap;
    }

    this.lightCapMat = new THREE.MeshBasicMaterial({ color: 0x00f3ff });

    this.boostPadMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff66,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });

    this.archMaterial = new THREE.MeshBasicMaterial({
      color: 0x00f3ff,
      transparent: true,
      opacity: 0.55,
    });

    // 2. Pre-build and cache all beveled ExtrudeGeometry & BufferGeometry shapes once
    const W = TrackGenerator.HIGHWAY_WIDTH;
    const L = TrackGenerator.CHUNK_LENGTH;

    this.cachedDeckGeo = new THREE.BoxGeometry(W, 16, L);
    this.cachedDeckHalfGeo = new THREE.BoxGeometry(W, 16, 420);
    this.cachedBridgeGeo = new THREE.BoxGeometry(155, 12, 430);

    // Supplementary Outer 45° Surf Curbs on outer perimeter (x = -600..-515 and x = +515..+600, y = 0..85)
    // Leaves 1,030 units of wide-open central bhop highway
    const curbLeftShape = new THREE.Shape();
    curbLeftShape.moveTo(-600, -16);
    curbLeftShape.lineTo(-515, -16);
    curbLeftShape.lineTo(-515, 0);
    curbLeftShape.lineTo(-600, 85);
    curbLeftShape.closePath();
    this.cachedCurbLeftGeo = new THREE.ExtrudeGeometry(curbLeftShape, {
      depth: L,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 2,
      bevelThickness: 2,
    });

    const curbRightShape = new THREE.Shape();
    curbRightShape.moveTo(515, -16);
    curbRightShape.lineTo(600, -16);
    curbRightShape.lineTo(600, 85);
    curbRightShape.lineTo(515, 0);
    curbRightShape.closePath();
    this.cachedCurbRightGeo = new THREE.ExtrudeGeometry(curbRightShape, {
      depth: L,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 2,
      bevelThickness: 2,
    });

    const curbLinePts: number[] = [
      -600, 85.5, 0, -600, 85.5, L,
      -515, 1.2, 0, -515, 1.2, L,
      600, 85.5, 0, 600, 85.5, L,
      515, 1.2, 0, 515, 1.2, L,
    ];
    this.cachedCurbLinesGeo = new THREE.BufferGeometry();
    this.cachedCurbLinesGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(curbLinePts, 3)
    );

    // 3D Cyber Runway Light Pylons along outer curbs
    this.cachedPylonGeo = new THREE.BoxGeometry(10, 48, 10);
    this.cachedLightCapGeo = new THREE.BoxGeometry(14, 8, 14);

    // 30° Flank Wedge (length 96u, height 34u, width 140u)
    const wedge30Shape = new THREE.Shape();
    wedge30Shape.moveTo(0, 0);
    wedge30Shape.lineTo(0, -10);
    wedge30Shape.lineTo(96, -10);
    wedge30Shape.lineTo(96, 34);
    wedge30Shape.closePath();
    this.cachedLaunchWedge30Geo = new THREE.ExtrudeGeometry(wedge30Shape, {
      depth: 140,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 2,
      bevelThickness: 2,
    });
    this.cachedLaunchWedge30Geo.rotateY(Math.PI * 0.5);
    this.cachedLaunchWedge30Geo.center();

    // Sleek 45° Flank Surf Wave (length: 520u, height: 64u, base width: 128u)
    const prismHalfW = 64;
    const prismHeight = 64;
    const prismShape = new THREE.Shape();
    prismShape.moveTo(-prismHalfW, 0);
    prismShape.lineTo(prismHalfW, 0);
    prismShape.lineTo(0, prismHeight);
    prismShape.closePath();
    this.cachedCanyonPrism50Geo = new THREE.ExtrudeGeometry(prismShape, {
      depth: 520,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 2.5,
      bevelThickness: 2.5,
    });
    this.cachedCanyonPrism50Geo.translate(0, 0, -260);

    // Sweeping Elevated Flank Sky-Highway Deck for SPLIT_ELEVATION (width: 230u, length: 920u)
    const splitDeckShape = new THREE.Shape();
    const sHw = 115;
    const sHl = 460;
    const sBevel = 16;
    splitDeckShape.moveTo(-sHw + sBevel, -sHl);
    splitDeckShape.lineTo(sHw - sBevel, -sHl);
    splitDeckShape.lineTo(sHw, -sHl + sBevel);
    splitDeckShape.lineTo(sHw, sHl - sBevel);
    splitDeckShape.lineTo(sHw - sBevel, sHl);
    splitDeckShape.lineTo(-sHw + sBevel, sHl);
    splitDeckShape.lineTo(-sHw, sHl - sBevel);
    splitDeckShape.lineTo(-sHw, -sHl + sBevel);
    splitDeckShape.closePath();
    this.cachedSplitSkyHighwayGeo = new THREE.ExtrudeGeometry(splitDeckShape, {
      depth: 12,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 3,
      bevelThickness: 3,
    });
    this.cachedSplitSkyHighwayGeo.rotateX(-Math.PI * 0.5);

    // Beveled Parapet Wall along elevated sky-highways
    const parapetShape = new THREE.Shape();
    parapetShape.moveTo(-5, 0);
    parapetShape.lineTo(5, 0);
    parapetShape.lineTo(3, 10);
    parapetShape.lineTo(-3, 10);
    parapetShape.closePath();
    this.cachedParapetWallGeo = new THREE.ExtrudeGeometry(parapetShape, {
      depth: 880,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 1.5,
      bevelThickness: 1.5,
    });
    this.cachedParapetWallGeo.translate(0, 0, -440);

    // Downward-Glowing Ion Thruster Cone underneath elevated decks
    this.cachedThrusterConeGeo = new THREE.ConeGeometry(24, 30, 8);
    this.cachedThrusterConeGeo.rotateX(Math.PI); // Point downward

    // Flush Low-Profile Bhop Flow Pad for HALFPIPE_CARVE (width: 220u, length: 320u, height: 14u)
    // Fits within sv_stepsize = 20 so players never get blocked if they run or bhop across it
    const diamondShape = new THREE.Shape();
    diamondShape.moveTo(0, -160);
    diamondShape.lineTo(110, 0);
    diamondShape.lineTo(0, 160);
    diamondShape.lineTo(-110, 0);
    diamondShape.closePath();
    this.cachedDiamondIslandGeo = new THREE.ExtrudeGeometry(diamondShape, {
      depth: 10,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 8,
      bevelThickness: 4,
    });
    this.cachedDiamondIslandGeo.rotateX(-Math.PI * 0.5);

    // Wide Beveled Hexagonal Bhop Island for SKY_ARCHIPELAGO (260u wide × 300u long -> rx = 130, rz = 150)
    const hexShape = new THREE.Shape();
    const rx = 130;
    const rz = 150;
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3 + Math.PI / 6;
      const px = Math.cos(angle) * rx;
      const py = Math.sin(angle) * rz;
      if (i === 0) hexShape.moveTo(px, py);
      else hexShape.lineTo(px, py);
    }
    hexShape.closePath();
    this.cachedHexLilyPadGeo = new THREE.ExtrudeGeometry(hexShape, {
      depth: 18,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 6,
      bevelThickness: 6,
    });
    this.cachedHexLilyPadGeo.rotateX(-Math.PI * 0.5);

    // Parallel 950-unit Neon Surf Rail for SKY_ARCHIPELAGO (48° triangular surf rail)
    const railShape = new THREE.Shape();
    railShape.moveTo(-55, 0);
    railShape.lineTo(55, 0);
    railShape.lineTo(0, 62);
    railShape.closePath();
    this.cachedSurfRail950Geo = new THREE.ExtrudeGeometry(railShape, {
      depth: 950,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 2,
      bevelThickness: 2,
    });
    this.cachedSurfRail950Geo.translate(0, 0, -475);

    // Central Safety Catwalk / Sky-Rail (width: 110u, length: 980u)
    const catwalkShape = new THREE.Shape();
    catwalkShape.moveTo(-55, -490);
    catwalkShape.lineTo(55, -490);
    catwalkShape.lineTo(55, 490);
    catwalkShape.lineTo(-55, 490);
    catwalkShape.closePath();
    this.cachedCatwalkGeo = new THREE.ExtrudeGeometry(catwalkShape, {
      depth: 12,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 3,
      bevelThickness: 3,
    });
    this.cachedCatwalkGeo.rotateX(-Math.PI * 0.5);

    // High Sky-Bridge Platform (width: 180u, length: 540u)
    const skyBridgeShape = new THREE.Shape();
    const bHx = 90;
    const bHz = 270;
    const bCorner = 16;
    skyBridgeShape.moveTo(-bHx + bCorner, -bHz);
    skyBridgeShape.lineTo(bHx - bCorner, -bHz);
    skyBridgeShape.lineTo(bHx, -bHz + bCorner);
    skyBridgeShape.lineTo(bHx, bHz - bCorner);
    skyBridgeShape.lineTo(bHx - bCorner, bHz);
    skyBridgeShape.lineTo(-bHx + bCorner, bHz);
    skyBridgeShape.lineTo(-bHx, bHz - bCorner);
    skyBridgeShape.lineTo(-bHx, -bHz + bCorner);
    skyBridgeShape.closePath();
    this.cachedSkyBridgeGeo = new THREE.ExtrudeGeometry(skyBridgeShape, {
      depth: 14,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 4,
      bevelThickness: 4,
    });
    this.cachedSkyBridgeGeo.rotateX(-Math.PI * 0.5);

    // Floating Holographic Chevron Arch above Boost Pads
    const chevronArchShape = new THREE.Shape();
    chevronArchShape.moveTo(-52, 8);
    chevronArchShape.lineTo(0, 34);
    chevronArchShape.lineTo(52, 8);
    chevronArchShape.lineTo(44, 2);
    chevronArchShape.lineTo(0, 24);
    chevronArchShape.lineTo(-44, 2);
    chevronArchShape.closePath();
    this.cachedHoloChevronArchGeo = new THREE.ExtrudeGeometry(chevronArchShape, {
      depth: 3,
      bevelEnabled: true,
      bevelSegments: 1,
      steps: 1,
      bevelSize: 1,
      bevelThickness: 1,
    });

    // Boost Pad Quad & Guide Chevrons
    this.cachedBoostPadGeo = new THREE.PlaneGeometry(1, 1);
    this.cachedBoostPadGeo.rotateX(-Math.PI * 0.5);

    const chevPts: number[] = [];
    for (let x = -450; x <= 450; x += 150) {
      chevPts.push(x - 45, 1.5, 35, x, 1.5, 0);
      chevPts.push(x, 1.5, 0, x + 45, 1.5, 35);
    }
    this.cachedJumpChevronsGeo = new THREE.BufferGeometry();
    this.cachedJumpChevronsGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(chevPts, 3)
    );

    this.sharedGeometries = new Set<THREE.BufferGeometry>([
      this.cachedDeckGeo,
      this.cachedDeckHalfGeo,
      this.cachedBridgeGeo,
      this.cachedCurbLeftGeo,
      this.cachedCurbRightGeo,
      this.cachedCurbLinesGeo,
      this.cachedLaunchWedge30Geo,
      this.cachedCanyonPrism50Geo,
      this.cachedSplitSkyHighwayGeo,
      this.cachedParapetWallGeo,
      this.cachedThrusterConeGeo,
      this.cachedDiamondIslandGeo,
      this.cachedHexLilyPadGeo,
      this.cachedSurfRail950Geo,
      this.cachedCatwalkGeo,
      this.cachedSkyBridgeGeo,
      this.cachedHoloChevronArchGeo,
      this.cachedBoostPadGeo,
      this.cachedJumpChevronsGeo,
      this.cachedPylonGeo,
      this.cachedLightCapGeo,
    ]);

    this.wallMesh = this.createDerezzingWallMesh();
    this.scene.add(this.wallMesh);

    this.resetWithSeed(initialSeed);
  }

  public setTrackMode(mode: TrackMode): void {
    if (this.trackMode !== mode) {
      this.trackMode = mode;
      this.strictCollisions = mode === 'COMPETITIVE';
      this.resetWithSeed(this.matchSeed);
    }
  }

  public setStrictCollisions(enabled: boolean): void {
    this.strictCollisions = enabled;
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

  /**
   * Retains 3 chunks behind (3600 units) and spawns 6 chunks ahead
   */
  public updateAroundPlayerZ(
    playerZ: number,
    matchElapsedSec: number,
    dt: number
  ): void {
    const L = TrackGenerator.CHUNK_LENGTH;
    const currentChunkIdx = Math.floor(-playerZ / L);

    // Spawn from 3 chunks behind to 6 chunks ahead
    for (let idx = currentChunkIdx - 3; idx <= currentChunkIdx + 6; idx++) {
      if (!this.chunks.has(idx)) {
        const chunk = this.buildChunk(idx, matchElapsedSec);
        this.chunks.set(idx, chunk);
        this.scene.add(chunk.group);
        this.totalSpawnedChunks++;
      }
    }

    // Despawn chunks more than 3 chunks behind player (3600 units trailing retention)
    for (const [idx, chunk] of this.chunks.entries()) {
      if (idx < currentChunkIdx - 3) {
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

    // Advance the chasing Derezzing Wall
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

    let archetype: ChunkArchetype = 'RUNWAY';
    if (!this.flatTestMode && index >= 1) {
      if (this.trackMode === 'FLOW') {
        const flowPool: ChunkArchetype[] = [
          'RUNWAY',
          'CANYON_WAVE',
          'SPLIT_ELEVATION',
          'HALFPIPE_CARVE',
          'SKY_ARCHIPELAGO',
        ];
        if (index <= 4) {
          archetype = flowPool[index]; // Deterministically cycles CANYON_WAVE, SPLIT_ELEVATION, HALFPIPE_CARVE, SKY_ARCHIPELAGO
        } else {
          archetype = flowPool[index % flowPool.length];
          // Consume rng once to maintain deterministic stream
          rng.next();
        }
      } else {
        const compPool: ChunkArchetype[] = [
          'SLALOM',
          'FROGGER',
          'KZ_CHASM',
          'LASER_HURDLES',
        ];
        if (index <= 4) {
          archetype = compPool[(index - 1) % compPool.length];
        } else {
          archetype = rng.pick(compPool);
        }
      }
    }

    const group = new THREE.Group();
    const obstacles: ObstacleBox[] = [];
    const boostPads: BoostPad[] = [];
    const chasms: ChasmGap[] = [];
    const surfRamps: SurfRampCollider[] = [];

    // 1. Continuous Outer 45° Half-Pipe Surf Curbs on EVERY Chunk
    if (!this.flatTestMode) {
      this.addContinuousOuterSurfCurbs(group, surfRamps, zStart, zEnd);
    }

    // 2. Deck Floor & Chasm Setup
    if (archetype === 'KZ_CHASM') {
      const gapLength = rng.range(380, 415);
      const zMid = (zStart + zEnd) * 0.5;
      const gapStart = zMid + gapLength * 0.5;
      const gapEnd = zMid - gapLength * 0.5;
      const entryLen = zStart - gapStart;

      this.addDeckBox(group, zStart, zStart - entryLen);
      this.addDeckBox(group, gapEnd, zEnd);

      const bridgeWidth = 155;
      for (const sideSign of [-1, 1]) {
        const bridgeCenterX = sideSign * (W * 0.5 - bridgeWidth * 0.5);
        const bridgeMesh = new THREE.Mesh(
          this.cachedBridgeGeo,
          this.bridgeMaterial
        );
        bridgeMesh.position.set(bridgeCenterX, -6, zMid);
        group.add(bridgeMesh);
      }

      this.addBoostPad(group, boostPads, 0, gapStart + 65, 95, 75, 110, 85);
      this.addNeonJumpChevron(group, gapStart - 10);

      chasms.push({
        zStart: gapStart,
        zEnd: gapEnd,
        bridgeMinX: -W * 0.5,
        bridgeMaxX: -W * 0.5 + bridgeWidth,
      });
    } else {
      this.addDeckBox(group, zStart, zEnd);
    }

    // 3. Populate Flow Playground Archetypes vs Competitive Archetypes
    if (!this.flatTestMode) {
      if (archetype === 'RUNWAY') {
        this.buildFlowRunwayChunk(
          group,
          obstacles,
          boostPads,
          surfRamps,
          index,
          zStart,
          zEnd
        );
      } else if (archetype === 'CANYON_WAVE') {
        this.buildCanyonWaveChunk(
          group,
          obstacles,
          boostPads,
          surfRamps,
          index,
          zStart,
          zEnd
        );
      } else if (archetype === 'SPLIT_ELEVATION') {
        this.buildSplitElevationChunk(
          group,
          obstacles,
          boostPads,
          surfRamps,
          index,
          zStart,
          zEnd
        );
      } else if (archetype === 'HALFPIPE_CARVE') {
        this.buildHalfpipeCarveChunk(
          group,
          obstacles,
          boostPads,
          surfRamps,
          index,
          zStart,
          zEnd
        );
      } else if (archetype === 'SKY_ARCHIPELAGO') {
        this.buildSkyArchipelagoChunk(
          group,
          obstacles,
          boostPads,
          surfRamps,
          index,
          zStart,
          zEnd
        );
      } else if (archetype === 'SLALOM') {
        this.buildCompetitiveSlalomChunk(
          group,
          obstacles,
          boostPads,
          index,
          zStart,
          zEnd,
          rng
        );
      } else if (archetype === 'FROGGER') {
        this.buildCompetitiveFroggerChunk(
          group,
          obstacles,
          boostPads,
          index,
          zStart,
          zEnd,
          rng
        );
      } else if (archetype === 'LASER_HURDLES') {
        this.buildCompetitiveLaserHurdlesChunk(
          group,
          obstacles,
          boostPads,
          index,
          zStart
        );
      }
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
      surfRamps,
    };
  }

  /**
   * Supplementary Outer 45° Surf Curbs (x = -600..-515 and x = +515..+600, y = 0..85)
   * Keeps 1,030 units of wide-open bhop highway while providing edge surf banks when strafing wide.
   */
  private addContinuousOuterSurfCurbs(
    group: THREE.Group,
    surfRamps: SurfRampCollider[],
    zStart: number,
    zEnd: number
  ): void {
    const minZ = Math.min(zStart, zEnd);
    const maxZ = Math.max(zStart, zEnd);

    const curbLeft = new THREE.Mesh(this.cachedCurbLeftGeo, this.curbMaterial);
    curbLeft.position.set(0, 0, minZ);
    group.add(curbLeft);

    const curbRight = new THREE.Mesh(
      this.cachedCurbRightGeo,
      this.curbMaterial
    );
    curbRight.position.set(0, 0, minZ);
    group.add(curbRight);

    const curbLines = new THREE.LineSegments(
      this.cachedCurbLinesGeo,
      this.cyanLineMaterial
    );
    curbLines.position.set(0, 0, minZ);
    group.add(curbLines);

    // 3D Cyber Runway Light Pylons every 300 units along outer highway curbs for thrilling speed depth
    for (let z = minZ + 150; z < maxZ; z += 300) {
      const pLeft = new THREE.Mesh(this.cachedPylonGeo, this.parapetMaterial);
      pLeft.position.set(-580, 24, z);
      group.add(pLeft);

      const capLeft = new THREE.Mesh(this.cachedLightCapGeo, this.lightCapMat);
      capLeft.position.set(-580, 50, z);
      group.add(capLeft);

      const pRight = new THREE.Mesh(this.cachedPylonGeo, this.parapetMaterial);
      pRight.position.set(580, 24, z);
      group.add(pRight);

      const capRight = new THREE.Mesh(this.cachedLightCapGeo, this.lightCapMat);
      capRight.position.set(580, 50, z);
      group.add(capRight);
    }

    // Left bank: normal = { x: 0.7071, y: 0.7071, z: 0 }, minX: -600, maxX: -515, minY: 0, maxY: 85
    surfRamps.push({
      minX: -600,
      maxX: -515,
      minY: 0,
      maxY: 85,
      minZ,
      maxZ,
      normal: { x: 0.7071, y: 0.7071, z: 0 },
      planeConstant: -515 * 0.7071,
      forwardBoost: 40,
    });

    // Right bank: normal = { x: -0.7071, y: 0.7071, z: 0 }, minX: 515, maxX: 600, minY: 0, maxY: 85
    surfRamps.push({
      minX: 515,
      maxX: 600,
      minY: 0,
      maxY: 85,
      minZ,
      maxZ,
      normal: { x: -0.7071, y: 0.7071, z: 0 },
      planeConstant: -515 * 0.7071,
      forwardBoost: 40,
    });
  }

  /**
   * 1. RUNWAY (Open Bhop Speed Boulevard):
   * Wide-open obsidian bhop highway with zero center-lane blockers.
   * Features a natural S-curve sequence of Recessed Turbine Boost Pads (liftY = 0 so grounded bhop timing is untouched)
   * and an optional high flank sky-bridge on the outer right lane.
   */
  private buildFlowRunwayChunk(
    group: THREE.Group,
    obstacles: ObstacleBox[],
    boostPads: BoostPad[],
    _surfRamps: SurfRampCollider[],
    index: number,
    zStart: number,
    zEnd: number
  ): void {
    const zMid = (zStart + zEnd) * 0.5;

    // Single centered runway acceleration boost pad
    this.addRecessedTurbinePad(
      group,
      boostPads,
      0,
      zStart - 500,
      95,
      75,
      280,
      85
    );

    // Optional Flank Sky-Bridge tucked out at x = +380, y = 34 (leaves 760u of center/left completely open)
    const bridgeX = 380;
    const bridgeZ = zMid - 60;
    const skyBridgeMesh = new THREE.Mesh(
      this.cachedSkyBridgeGeo,
      this.skyDeckMaterial
    );
    skyBridgeMesh.position.set(bridgeX, 34, bridgeZ);
    group.add(skyBridgeMesh);

    obstacles.push({
      id: `runway_skybridge_${index}`,
      kind: 'platform',
      x: bridgeX,
      y: 27,
      z: bridgeZ,
      hx: 90,
      hy: 7,
      hz: 270,
      lethal: false,
      mesh: skyBridgeMesh,
    });

    this.addRecessedTurbinePad(
      group,
      boostPads,
      bridgeX,
      bridgeZ,
      65,
      55,
      90,
      0,
      34
    );
  }

  /**
   * 2. CANYON_WAVE (Wide Bhop Boulevard + Supplementary Flank Surf Waves):
   * Keeps a massive 680-unit-wide central bhop spine (-340..+340) 100% open for S-curve air-strafing,
   * while placing two sleek 45° supplementary surf waves out on the left and right flanks (x = ±415).
   */
  private buildCanyonWaveChunk(
    group: THREE.Group,
    obstacles: ObstacleBox[],
    boostPads: BoostPad[],
    surfRamps: SurfRampCollider[],
    index: number,
    zStart: number,
    zEnd: number
  ): void {
    const zMid = (zStart + zEnd) * 0.5;
    const invSqrt2 = 0.70710678;

    // Left flank 45° supplementary surf wave (centered at x = -415, z = zStart - 340, halfW = 64, height = 64)
    const leftX = -415;
    const leftZ = zStart - 340;
    const leftPrism = new THREE.Mesh(
      this.cachedCanyonPrism50Geo,
      this.surfWaveMaterial
    );
    leftPrism.position.set(leftX, 0, leftZ);
    group.add(leftPrism);

    // Left wave inward-facing slope (x from -415 to -351, y from 64 down to 0)
    surfRamps.push({
      minX: leftX,
      maxX: leftX + 68,
      minY: 0,
      maxY: 66,
      minZ: leftZ - 260,
      maxZ: leftZ + 260,
      normal: { x: invSqrt2, y: invSqrt2, z: 0 },
      planeConstant: (leftX + 64) * invSqrt2,
      forwardBoost: 45,
    });

    // Right flank 45° supplementary surf wave (staggered at x = +415, z = zStart - 840, halfW = 64, height = 64)
    const rightX = 415;
    const rightZ = zStart - 840;
    const rightPrism = new THREE.Mesh(
      this.cachedCanyonPrism50Geo,
      this.surfWaveMaterial
    );
    rightPrism.position.set(rightX, 0, rightZ);
    group.add(rightPrism);

    // Right wave inward-facing slope (x from 351 to 415, y from 0 up to 64)
    surfRamps.push({
      minX: rightX - 68,
      maxX: rightX,
      minY: 0,
      maxY: 66,
      minZ: rightZ - 260,
      maxZ: rightZ + 260,
      normal: { x: -invSqrt2, y: invSqrt2, z: 0 },
      planeConstant: (rightX - 64) * -invSqrt2,
      forwardBoost: 45,
    });

    // Single strategic boost pad at the canyon chicane exit
    this.addRecessedTurbinePad(
      group,
      boostPads,
      0,
      zStart - 600,
      95,
      75,
      280,
      85
    );

    // Optional Flank Sky-Rail tucked out at x = +290, y = 38 (one-way platform)
    const skyRailMesh = new THREE.Mesh(
      this.cachedCatwalkGeo,
      this.skyDeckMaterial
    );
    skyRailMesh.position.set(290, 38, zMid);
    group.add(skyRailMesh);

    obstacles.push({
      id: `canyon_skyrail_${index}`,
      kind: 'platform',
      x: 290,
      y: 32,
      z: zMid,
      hx: 55,
      hy: 6,
      hz: 490,
      lethal: false,
      mesh: skyRailMesh,
    });
  }

  /**
   * 3. SPLIT_ELEVATION (Wide Central Bhop Highway + Accessible Flank Sky-Decks):
   * Zero ramp blockers. Two sweeping elevated sky-highways (y = 34, width = 230u each)
   * run along the outer flanks (x = ±375) as one-way bhop decks, leaving a 520-unit-wide
   * central flat bhop highway with sequential boost pads.
   */
  private buildSplitElevationChunk(
    group: THREE.Group,
    obstacles: ObstacleBox[],
    boostPads: BoostPad[],
    _surfRamps: SurfRampCollider[],
    index: number,
    zStart: number,
    zEnd: number
  ): void {
    const zMid = (zStart + zEnd) * 0.5;
    const flankXs = [-375, 375];

    for (const fx of flankXs) {
      // Sweeping elevated flank sky-highway (y = 34, width = 230u, length = 920u)
      const skyHighway = new THREE.Mesh(
        this.cachedSplitSkyHighwayGeo,
        this.skyDeckMaterial
      );
      skyHighway.position.set(fx, 34, zMid - 40);
      group.add(skyHighway);

      obstacles.push({
        id: `split_sky_${index}_${fx}`,
        kind: 'platform',
        x: fx,
        y: 28,
        z: zMid - 40,
        hx: 115,
        hy: 6,
        hz: 460,
        lethal: false,
        mesh: skyHighway,
      });

      // Outer beveled parapet trim wall on sky-highway
      const parapet = new THREE.Mesh(
        this.cachedParapetWallGeo,
        this.parapetMaterial
      );
      parapet.position.set(
        fx + (fx < 0 ? -108 : 108),
        34,
        zMid - 40
      );
      group.add(parapet);

      // Downward-glowing ion thruster cones underneath the sky-highway
      for (const tz of [zMid + 260, zMid - 40, zMid - 340]) {
        const cone = new THREE.Mesh(
          this.cachedThrusterConeGeo,
          this.thrusterConeMaterial
        );
        cone.position.set(fx, 14, tz);
        group.add(cone);
      }

      // Single reward boost pad on the elevated flank sky-highway
      this.addRecessedTurbinePad(
        group,
        boostPads,
        fx,
        zMid - 40,
        80,
        60,
        280,
        85,
        34
      );
    }

    // Single centered ground highway boost pad
    this.addRecessedTurbinePad(
      group,
      boostPads,
      0,
      zStart - 580,
      95,
      75,
      280,
      85
    );
  }

  /**
   * 4. HALFPIPE_CARVE (Flush Bhop Flow Pads + Supplementary Edge Surf Rail):
   * Places 3 ultra-low-profile (y = 14, within sv_stepsize = 20 auto-step-up) diamond bhop pads
   * along an S-curve so players can seamlessly bhop or run across them with zero collision penalty,
   * paired with a supplementary surf rail on the right flank (x = +430).
   */
  private buildHalfpipeCarveChunk(
    group: THREE.Group,
    obstacles: ObstacleBox[],
    boostPads: BoostPad[],
    surfRamps: SurfRampCollider[],
    index: number,
    zStart: number,
    zEnd: number
  ): void {
    const zMid = (zStart + zEnd) * 0.5;
    const islands = [
      { x: -130, z: zStart - 250 },
      { x: 130, z: zStart - 610 },
      { x: -130, z: zStart - 950 },
    ];

    for (let i = 0; i < islands.length; i++) {
      const { x: dx, z: dz } = islands[i];
      const diamondMesh = new THREE.Mesh(
        this.cachedDiamondIslandGeo,
        this.hexIslandMaterial
      );
      diamondMesh.position.set(dx, 14, dz);
      group.add(diamondMesh);

      // Flush top deck (y = 14 <= sv_stepsize = 20) acts as a seamless step-up bhop pad
      obstacles.push({
        id: `diamond_island_${index}_${i}`,
        kind: 'platform',
        x: dx,
        y: 7,
        z: dz,
        hx: 85,
        hy: 7,
        hz: 120,
        lethal: false,
        mesh: diamondMesh,
      });

      // Single apex boost pad on the center diamond island
      if (i === 1) {
        this.addRecessedTurbinePad(
          group,
          boostPads,
          dx,
          dz,
          75,
          75,
          280,
          85,
          14
        );
      }
    }

    // Supplementary Flank Surf Rail tucked out at x = +430 (leaves center & left lanes 100% open)
    const railX = 430;
    const railMesh = new THREE.Mesh(
      this.cachedSurfRail950Geo,
      this.surfWaveMaterial
    );
    railMesh.position.set(railX, 0, zMid);
    group.add(railMesh);

    const railNx = 0.7431;
    const railNy = 0.6691;
    surfRamps.push({
      minX: railX - 60,
      maxX: railX,
      minY: 0,
      maxY: 64,
      minZ: zMid - 475,
      maxZ: zMid + 475,
      normal: { x: -railNx, y: railNy, z: 0 },
      planeConstant: (railX - 55) * -railNx,
      forwardBoost: 45,
    });
  }

  /**
   * 5. SKY_ARCHIPELAGO (Open Highway + S-Curve Bhop Lily-Pads + Supplementary Flank Surf Rail):
   * Full flat highway deck stays 100% unobstructed underneath while 6 wide hexagonal bhop pads
   * form a gentle, optional ascending S-curve (y = 16 -> 56), with a supplementary surf rail on the far left flank.
   */
  private buildSkyArchipelagoChunk(
    group: THREE.Group,
    obstacles: ObstacleBox[],
    boostPads: BoostPad[],
    surfRamps: SurfRampCollider[],
    index: number,
    zStart: number,
    zEnd: number
  ): void {
    const zMid = (zStart + zEnd) * 0.5;

    // 1. Single ground-level central bhop boost pad along the open highway floor
    this.addRecessedTurbinePad(
      group,
      boostPads,
      0,
      zStart - 600,
      90,
      75,
      280,
      85
    );

    // 2. 6 Wide Beveled Hexagonal Bhop Islands (260u wide × 300u long) in a gentle S-curve (y = 16 -> 56)
    const lilyHeights = [16, 24, 32, 40, 48, 56];
    const lilyXs = [-165, -235, -140, 140, 235, 165];

    for (let i = 0; i < 6; i++) {
      const topY = lilyHeights[i];
      const lx = lilyXs[i];
      const lz = zStart - 130 - i * 185;

      const hexMesh = new THREE.Mesh(
        this.cachedHexLilyPadGeo,
        this.hexIslandMaterial
      );
      hexMesh.position.set(lx, topY, lz);
      group.add(hexMesh);

      obstacles.push({
        id: `lilypad_${index}_${i}`,
        kind: 'platform',
        x: lx,
        y: topY - 9,
        z: lz,
        hx: 130,
        hy: 9,
        hz: 150,
        lethal: false,
        mesh: hexMesh,
      });

      // Single apex boost pad on the highest summit island
      if (i === 5) {
        this.addBoostPad(group, boostPads, lx, lz, 75, 75, 280, 95, topY);
      }
    }

    // 3. Supplementary Neon Surf Rail tucked far out on the left flank (x = -435)
    const railX = -435;
    const railMesh = new THREE.Mesh(
      this.cachedSurfRail950Geo,
      this.surfWaveMaterial
    );
    railMesh.position.set(railX, 0, zMid);
    group.add(railMesh);

    const railNx = 0.7431; // sin(48°)
    const railNy = 0.6691; // cos(48°)
    surfRamps.push({
      minX: railX,
      maxX: railX + 60,
      minY: 0,
      maxY: 64,
      minZ: zMid - 475,
      maxZ: zMid + 475,
      normal: { x: railNx, y: railNy, z: 0 },
      planeConstant: (railX + 55) * railNx,
      forwardBoost: 45,
    });
  }

  /**
   * Recessed Turbine Boost Pad with 3 Floating Holographic Chevron Arches above the pad
   */
  private addRecessedTurbinePad(
    group: THREE.Group,
    boostPads: BoostPad[],
    x: number,
    z: number,
    hx: number,
    hz: number,
    boostUps = 280,
    liftY = 90,
    baseY = 0
  ): void {
    const effectiveBoost = Math.max(boostUps, 280);
    const effectiveLift = Math.max(liftY, 80);
    this.addBoostPad(group, boostPads, x, z, hx, hz, effectiveBoost, effectiveLift, baseY);

    // Sleek single floating holographic chevron arch above the pad
    const archMesh = new THREE.Mesh(
      this.cachedHoloChevronArchGeo,
      this.archMaterial
    );
    archMesh.position.set(x, baseY + 14, z);
    group.add(archMesh);
  }

  private addBoostPad(
    group: THREE.Group,
    boostPads: BoostPad[],
    x: number,
    z: number,
    hx: number,
    hz: number,
    boostUps: number,
    liftY: number,
    baseY = 0
  ): void {
    const padMesh = new THREE.Mesh(
      this.cachedBoostPadGeo,
      this.boostPadMaterial
    );
    padMesh.scale.set(hx * 2, hz * 2, 1);
    padMesh.position.set(x, baseY + 0.8, z);
    group.add(padMesh);

    boostPads.push({
      x,
      y: baseY,
      z,
      hx,
      hz,
      boostUps,
      liftY,
    });
  }

  private addDeckBox(group: THREE.Group, zA: number, zB: number): void {
    const length = Math.abs(zA - zB);
    const zCenter = (zA + zB) * 0.5;

    let deckMesh: THREE.Mesh;
    if (Math.abs(length - TrackGenerator.CHUNK_LENGTH) < 1) {
      deckMesh = new THREE.Mesh(this.cachedDeckGeo, this.deckMaterial);
    } else {
      deckMesh = new THREE.Mesh(this.cachedDeckHalfGeo, this.deckMaterial);
      deckMesh.scale.set(1, 1, length / 420);
    }
    deckMesh.position.set(0, -8, zCenter);
    group.add(deckMesh);
  }

  // ============================================================================
  // COMPETITIVE MODE ARCHETYPES (Gated behind trackMode === 'COMPETITIVE')
  // ============================================================================

  private buildCompetitiveSlalomChunk(
    group: THREE.Group,
    obstacles: ObstacleBox[],
    boostPads: BoostPad[],
    index: number,
    zStart: number,
    zEnd: number,
    rng: SeededRandom
  ): void {
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
  }

  private buildCompetitiveFroggerChunk(
    group: THREE.Group,
    obstacles: ObstacleBox[],
    boostPads: BoostPad[],
    index: number,
    zStart: number,
    zEnd: number,
    rng: SeededRandom
  ): void {
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
  }

  private buildCompetitiveLaserHurdlesChunk(
    group: THREE.Group,
    obstacles: ObstacleBox[],
    boostPads: BoostPad[],
    index: number,
    zStart: number
  ): void {
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

    this.addBoostPad(group, boostPads, 0, zStart - 110, 90, 75, 85, 90);
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
      this.skyDeckMaterial,
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

  private addNeonJumpChevron(group: THREE.Group, zEdge: number): void {
    const lines = new THREE.LineSegments(
      this.cachedJumpChevronsGeo,
      this.limeLineMaterial
    );
    lines.position.set(0, 0, zEdge);
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
    const edgesMat = new THREE.LineBasicMaterial({
      color: edgeColor,
      transparent: true,
      opacity: 0.75,
    });
    const wire = new THREE.LineSegments(edgesGeo, edgesMat);
    holder.add(wire);

    // If substantial obstacle (h >= 32, w >= 24), add heavy hazard-striped footing & beveled cap
    if (h >= 32 && w >= 24 && d >= 24) {
      const baseH = Math.min(24, h * 0.22);
      const baseGeo = new THREE.BoxGeometry(w * 1.10, baseH, d * 1.10);
      const baseMesh = new THREE.Mesh(baseGeo, this.hazardMaterial);
      baseMesh.position.y = -h * 0.5 + baseH * 0.5;
      holder.add(baseMesh);

      const capH = 5;
      const capGeo = new THREE.BoxGeometry(w * 1.05, capH, d * 1.05);
      const capMesh = new THREE.Mesh(capGeo, mat);
      capMesh.position.y = h * 0.5 - capH * 0.5;
      holder.add(capMesh);
    } else if (mat === this.froggerMaterial && w > 200) {
      // For moving Frogger beams: heavy magnetic emitter housings on left and right ends
      const clampW = Math.min(36, w * 0.08);
      const clampGeo = new THREE.BoxGeometry(clampW, h * 1.4, d * 1.4);
      const leftClamp = new THREE.Mesh(clampGeo, this.parapetMaterial);
      leftClamp.position.x = -w * 0.5 + clampW * 0.5;
      holder.add(leftClamp);

      const rightClamp = new THREE.Mesh(clampGeo, this.parapetMaterial);
      rightClamp.position.x = w * 0.5 - clampW * 0.5;
      holder.add(rightClamp);
    }

    return holder;
  }

  private disposeChunk(chunk: TrackChunk): void {
    this.scene.remove(chunk.group);
    chunk.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry && !this.sharedGeometries.has(mesh.geometry)) {
        mesh.geometry.dispose();
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
        const halfW = TrackGenerator.HIGHWAY_HALF_WIDTH;
        const bridgeW = 155;
        if (Math.abs(x) >= halfW - bridgeW) {
          return 0;
        }
        return -1000;
      }
    }

    return 0;
  }

  /**
   * Returns active SurfRampCollider volumes around zPos (passed into PlayerPhysics 100Hz step)
   */
  public getActiveSurfRamps(zPos: number): SurfRampCollider[] {
    if (this.flatTestMode) return [];
    const L = TrackGenerator.CHUNK_LENGTH;
    const currentChunkIdx = Math.floor(-zPos / L);
    const result: SurfRampCollider[] = [];

    for (let c = currentChunkIdx - 2; c <= currentChunkIdx + 2; c++) {
      const chunk = this.chunks.get(c);
      if (chunk && chunk.surfRamps) {
        result.push(...chunk.surfRamps);
      }
    }
    return result;
  }

  /**
   * CollisionWorld interface alias for getActiveSurfRamps
   */
  public getSurfRamps(_x?: number, z?: number): SurfRampCollider[] {
    if (z === undefined) {
      if (this.flatTestMode) return [];
      const all: SurfRampCollider[] = [];
      for (const chunk of this.chunks.values()) {
        all.push(...chunk.surfRamps);
      }
      return all;
    }
    return this.getActiveSurfRamps(z);
  }

  /**
   * Returns active AABBBox instances for platforms and obstacles around (x, z)
   */
  public getBoxes(_x?: number, z?: number): AABBBox[] {
    if (this.flatTestMode) return [];
    const result: AABBBox[] = [];
    const L = TrackGenerator.CHUNK_LENGTH;
    const currentChunkIdx = z !== undefined ? Math.floor(-z / L) : 0;
    const minC = z !== undefined ? currentChunkIdx - 2 : -Infinity;
    const maxC = z !== undefined ? currentChunkIdx + 2 : Infinity;

    for (const [idx, chunk] of this.chunks.entries()) {
      if (idx >= minC && idx <= maxC) {
        for (const obs of chunk.obstacles) {
          result.push({
            minX: obs.x - obs.hx,
            maxX: obs.x + obs.hx,
            minY: obs.y - obs.hy,
            maxY: obs.y + obs.hy,
            minZ: obs.z - obs.hz,
            maxZ: obs.z + obs.hz,
            isPlatform: obs.kind === 'platform',
            lethal: obs.lethal,
          });
        }
      }
    }
    return result;
  }

  /**
   * CollisionWorld implementation: AABB obstacle collision, Boost Pads & Derezzing Wall check
   */
  public resolveCollisions(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    radius: number,
    height: number
  ): CollisionResult {
    if (this.flatTestMode) {
      return { hitHazard: false, groundedOnObstacle: false, supportY: 0, hitBoostPad: false };
    }

    if (this.wallEnabled && pos.z > this.wallZ) {
      return { hitHazard: true, groundedOnObstacle: false, supportY: 0, hitBoostPad: false };
    }

    const L = TrackGenerator.CHUNK_LENGTH;
    const idx = Math.floor(-pos.z / L);
    let groundedOnObstacle = false;
    let supportY = 0;
    let hitBoostPad = false;
    let boostedUps = 0;

    for (let c = idx - 1; c <= idx + 1; c++) {
      const chunk = this.chunks.get(c);
      if (!chunk) continue;

      // Check Recessed Turbine / Emerald Boost Pads
      for (const pad of chunk.boostPads) {
        if (
          Math.abs(pos.x - pad.x) < pad.hx + radius &&
          Math.abs(pos.z - pad.z) < pad.hz + radius &&
          pos.y >= pad.y - 16 &&
          pos.y <= pad.y + 36
        ) {
          const now = performance.now() * 0.001;
          if (now - this.lastBoostPadTime > 0.22) {
            this.lastBoostPadTime = now;
            hitBoostPad = true;
            boostedUps = Math.max(pad.boostUps, 280);
            const currentSpeed = Math.hypot(vel.x, vel.z);
            const targetSpeed = Math.max(currentSpeed + boostedUps, 640);
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
          pos.y <= maxY + 0.5
        ) {
          // Auto-Step-Up Lip Forgiveness (sv_stepsize = 20) & Top Landing
          const stepDiff = maxY - pos.y;
          if (stepDiff >= -0.5 && stepDiff <= 20 && vel.y <= 35) {
            pos.y = maxY;
            if (vel.y < 0) vel.y = 0;
            groundedOnObstacle = true;
            supportY = Math.max(supportY, maxY);
            continue;
          }

          if (obs.lethal) {
            return { hitHazard: true, groundedOnObstacle: false, supportY: 0 };
          }

          // Elevated platforms act as one-way top decks in forgiving mode (solid obstacles when strictCollisions is enabled)
          if (obs.kind === 'platform' && !this.strictCollisions) {
            continue;
          }

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

    return { hitHazard: false, groundedOnObstacle, supportY, hitBoostPad, boostUps: boostedUps };
  }
}
