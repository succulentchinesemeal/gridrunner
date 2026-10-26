import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  getHighwayDeckTextures,
  getSubstructureTexture,
} from './TextureGenerator';

const SPEED_LINE_COUNT = 90;
const SKYLINE_ARCHETYPES = 4;
const SKYLINE_PER_ARCHETYPE = 80;
const SKYLINE_INSTANCE_COUNT = SKYLINE_ARCHETYPES * SKYLINE_PER_ARCHETYPE; // 320 (optimized from 800)
const SKYLINE_SPAN_Z = 5400;
const SKYLINE_BEHIND_Z = 500;

const MEGA_ARCH_COUNT = 8;
const MEGA_ARCH_SPACING_Z = 2200;
const MEGA_ARCH_RADIUS = 850;

const SUBSTRUCTURE_BENT_COUNT = 10;
const SUBSTRUCTURE_SPACING_Z = 700;
const SUBSTRUCTURE_SPAN_Z = SUBSTRUCTURE_BENT_COUNT * SUBSTRUCTURE_SPACING_Z; // 7000

const SPEED_MOTE_COUNT = 40; // Dramatically reduced from 500/150 to eliminate air clutter
const SPEED_MOTE_SPAN_Z = 2000;
const SPEED_MOTE_BEHIND_Z = 200;

const HOLO_BILLBOARD_COUNT = 8;
const HOLO_BILLBOARD_SPAN_Z = 4000;

export type CameraMode = 'CHASE' | 'CLOSE' | 'FIRST_PERSON';

export interface CyberDeckMaterialOptions {
  gridSpacing?: THREE.Vector2;
  lineWidth?: number;
  glowIntensity?: number;
  roughness?: number;
  metalness?: number;
  useDeckTextures?: boolean;
}

/**
 * Creates and exports a high-performance composite deck material:
 * - Uses realistic PBR road roughness (0.70) and metalness (0.24) with diffuse & roughness maps
 * - Avoids expensive screen-space tangent normal calculations for buttery 120+ FPS
 * - Uses onBeforeCompile to inject screen-space derivative anti-aliasing via fwidth() (zero shimmering)
 */
export function createCyberDeckMaterial(
  gridColor: THREE.Color,
  options?: CyberDeckMaterialOptions
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: options?.roughness ?? 0.70,
    metalness: options?.metalness ?? 0.24,
  });

  if (options?.useDeckTextures !== false) {
    const deckTextures = getHighwayDeckTextures();
    if (deckTextures) {
      material.map = deckTextures.map;
      material.roughnessMap = deckTextures.roughnessMap;
    } else {
      material.color.setHex(0x0c111c);
    }
  } else {
    material.color.setHex(0x0c111c);
  }

  const uniforms = {
    uGridColor: { value: gridColor.clone() },
    uGridSpacing: {
      value: options?.gridSpacing ? options.gridSpacing.clone() : new THREE.Vector2(100.0, 75.0),
    },
    uLineWidth: { value: options?.lineWidth ?? 1.5 },
    uGridGlow: { value: options?.glowIntensity ?? 0.55 },
  };

  material.userData = {
    gridColorUniform: uniforms.uGridColor,
    gridSpacingUniform: uniforms.uGridSpacing,
    lineWidthUniform: uniforms.uLineWidth,
    gridGlowUniform: uniforms.uGridGlow,
  };

  material.customProgramCacheKey = () => 'CyberDeckMaterialV3';

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGridColor = uniforms.uGridColor;
    shader.uniforms.uGridSpacing = uniforms.uGridSpacing;
    shader.uniforms.uLineWidth = uniforms.uLineWidth;
    shader.uniforms.uGridGlow = uniforms.uGridGlow;

    shader.vertexShader = `
      varying vec3 vWorldPosition;
      ${shader.vertexShader}
    `.replace(
      '#include <worldpos_vertex>',
      `
      #include <worldpos_vertex>
      vec4 deckWorldPos = vec4( transformed, 1.0 );
      #ifdef USE_BATCHING
        deckWorldPos = batchingMatrix * deckWorldPos;
      #endif
      #ifdef USE_INSTANCING
        deckWorldPos = instanceMatrix * deckWorldPos;
      #endif
      deckWorldPos = modelMatrix * deckWorldPos;
      vWorldPosition = deckWorldPos.xyz;
      `
    );

    shader.fragmentShader = `
      varying vec3 vWorldPosition;
      uniform vec3 uGridColor;
      uniform vec2 uGridSpacing;
      uniform float uLineWidth;
      uniform float uGridGlow;
      ${shader.fragmentShader}
    `.replace(
      '#include <emissivemap_fragment>',
      `
      #include <emissivemap_fragment>

      // Fast procedural anti-aliased grid via screen-space derivatives (fwidth)
      vec2 gridCoord = vWorldPosition.xz / max(uGridSpacing, vec2(0.001));
      vec2 fw = fwidth(gridCoord);
      vec2 gridDist = abs(fract(gridCoord - 0.5) - 0.5);

      vec2 targetWidth = max(vec2(uLineWidth * 0.02), fw * (uLineWidth * 0.5));
      vec2 drawWidth = clamp(targetWidth, fw * 0.5, vec2(0.5));
      vec2 lineEdge = smoothstep(drawWidth - fw * 0.5, drawWidth + fw * 0.5, gridDist);
      float lineX = 1.0 - lineEdge.x;
      float lineY = 1.0 - lineEdge.y;

      float fadeX = 1.0 - smoothstep(0.18, 0.45, fw.x);
      float fadeY = 1.0 - smoothstep(0.18, 0.45, fw.y);
      lineX *= fadeX;
      lineY *= fadeY;

      float gridFactor = clamp(max(lineX, lineY), 0.0, 1.0);
      diffuseColor.rgb = mix(diffuseColor.rgb, uGridColor, gridFactor * 0.85);
      totalEmissiveRadiance += uGridColor * (gridFactor * uGridGlow);
      `
    );
  };

  return material;
}

interface SkylineSlot {
  archetype: number;
  subIndex: number;
  x: number;
  y: number;
  z: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  rotY: number;
}

interface SpeedMoteSlot {
  baseX: number;
  baseY: number;
  z: number;
  scale: number;
  phase: number;
}

interface HoloBillboardSlot {
  x: number;
  y: number;
  z: number;
  rotY: number;
}

function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Radial peripheral chromatic aberration shader pass
 */
const PeripheralChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSpeedRatio: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSpeedRatio;
    varying vec2 vUv;

    void main() {
      vec2 toUV = vUv - vec2(0.5);
      float dist = length(toUV);
      if (uSpeedRatio <= 0.005 || dist < 0.32) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }
      float edgeMask = smoothstep(0.32, 0.72, dist) * (dist - 0.32);
      vec2 offset = normalize(toUV) * (edgeMask * uSpeedRatio * 0.022);

      float r = texture2D(tDiffuse, vUv + offset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - offset).b;
      float a = texture2D(tDiffuse, vUv).a;

      gl_FragColor = vec4(r, g, b, a);
    }
  `,
};

export class TronRenderer {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private chromaticPass: ShaderPass | null = null;
  private smoothDistortion = 0;
  private envMapTexture: THREE.Texture | null = null;

  public static readonly CAM_BASE_HEIGHT = 49;
  public static readonly CAM_BASE_DISTANCE = 86;
  public static readonly CAM_LOOK_AHEAD = 220;

  public cameraMode: CameraMode = 'CHASE';

  private smoothPivotY = 0;
  private smoothOrbitYaw = 0;
  private smoothFov = 72;
  private initializedCam = false;

  private speedLinesGroup = new THREE.Group();
  private speedLinePositions: Float32Array;
  private speedLineGeo: THREE.BufferGeometry;
  private speedLineMat: THREE.LineBasicMaterial;
  private speedLineSeeds: Array<{ x: number; y: number; z: number; len: number }> = [];

  // Instanced Megacity Skyline (4 distinct architectural archetypes, 80 instances each = 320 total)
  private skylineMeshes: THREE.InstancedMesh[] = [];
  private skylineSlots: SkylineSlot[] = [];

  // Colossal Aerospace Gateway Arches
  private megaArchMesh!: THREE.InstancedMesh;
  private megaArchZ: number[] = [];

  // Monumental Highway Substructure Bridge Piers
  private substructureMesh!: THREE.InstancedMesh;
  private substructureZ: number[] = [];

  // 3D Speed Motes (lightweight static diamond motes)
  private speedMotesMesh!: THREE.InstancedMesh;
  private speedMoteSlots: SpeedMoteSlot[] = [];

  // Floating Holographic Data Arrays
  private holoBillboardMesh!: THREE.InstancedMesh;
  private holoBillboardSlots: HoloBillboardSlot[] = [];

  public boostImpulseTimer = 0;

  public triggerBoostFx(_ups = 600): void {
    this.boostImpulseTimer = 0.55;
  }

  private readonly dummyMatrix = new THREE.Matrix4();
  private readonly dummyPos = new THREE.Vector3();
  private readonly dummyQuat = new THREE.Quaternion();
  private readonly dummyScale = new THREE.Vector3();
  private readonly dummyEuler = new THREE.Euler();
  private readonly processedChunkGroups = new WeakSet<THREE.Object3D>();

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x03050a);
    this.scene.fog = new THREE.FogExp2(0x03050a, 0.00022);

    this.camera = new THREE.PerspectiveCamera(
      74,
      window.innerWidth / window.innerHeight,
      2,
      6000
    );
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.speedLinePositions = new Float32Array(SPEED_LINE_COUNT * 2 * 3);
    this.speedLineGeo = new THREE.BufferGeometry();
    this.speedLineGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.speedLinePositions, 3)
    );
    this.speedLineMat = new THREE.LineBasicMaterial({
      color: 0x00f3ff,
      transparent: true,
      opacity: 0,
    });
    const speedSegments = new THREE.LineSegments(
      this.speedLineGeo,
      this.speedLineMat
    );
    this.speedLinesGroup.add(speedSegments);
    this.camera.add(this.speedLinesGroup);

    for (let i = 0; i < SPEED_LINE_COUNT; i++) {
      const angle = (i / SPEED_LINE_COUNT) * Math.PI * 2 + (i % 3) * 0.2;
      const radius = 34 + (i % 5) * 14;
      this.speedLineSeeds.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * 0.65,
        z: -20 - (i * 7) % 180,
        len: 18 + (i % 4) * 10,
      });
    }

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Capped at 1.25 to prevent 4K/Retina GPU fill-rate throttling
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.96;
    container.appendChild(this.renderer.domElement);

    this.initPbrEnvironment();

    const ambient = new THREE.AmbientLight(0x18243c, 0.65);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0x5ce1e6, 1.25);
    dirLight.position.set(220, 500, 180);
    this.scene.add(dirLight);

    const backLight = new THREE.DirectionalLight(0xff2a85, 0.85);
    backLight.position.set(-220, 300, -300);
    this.scene.add(backLight);

    this.initInstancedMegacity();
    this.initColossalMegaArches();
    this.initHighwaySubstructure();
    this.initSpeedMotes();
    this.initHoloBillboards();

    // UnrealBloomPass tuned to 0.30 resolution: cuts bloom render cost by 64% with smooth, punchy glow
    try {
      const renderScene = new RenderPass(this.scene, this.camera);
      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(
          Math.max(256, Math.floor(window.innerWidth * 0.30)),
          Math.max(144, Math.floor(window.innerHeight * 0.30))
        ),
        0.45, // strength
        0.28, // radius
        0.82  // threshold
      );
      bloomPass.threshold = 0.82;
      bloomPass.strength = 0.45;
      bloomPass.radius = 0.28;
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(renderScene);
      this.composer.addPass(bloomPass);

      this.chromaticPass = new ShaderPass(PeripheralChromaticAberrationShader);
      this.composer.addPass(this.chromaticPass);
    } catch {
      this.composer = null;
      this.chromaticPass = null;
    }

    window.addEventListener('resize', () => this.onResize());
  }

  private initPbrEnvironment(): void {
    try {
      const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
      pmremGenerator.compileEquirectangularShader();

      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color(0x02040a);

      const stripGeo = new THREE.BoxGeometry(1, 1, 1);

      const topStrip = new THREE.Mesh(
        stripGeo,
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.4, 1.8) })
      );
      topStrip.position.set(0, 14, 0);
      topStrip.scale.set(16, 0.5, 22);
      envScene.add(topStrip);

      const cyanStripMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.0, 1.5, 1.8),
      });
      const cyanLeft = new THREE.Mesh(stripGeo, cyanStripMat);
      cyanLeft.position.set(-15, 3, -6);
      cyanLeft.scale.set(0.6, 5.5, 28);
      envScene.add(cyanLeft);

      const cyanRight = new THREE.Mesh(stripGeo, cyanStripMat);
      cyanRight.position.set(15, 5, 6);
      cyanRight.scale.set(0.6, 4.0, 28);
      envScene.add(cyanRight);

      const magentaStripMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.8, 0.0, 1.0),
      });
      const magRight = new THREE.Mesh(stripGeo, magentaStripMat);
      magRight.position.set(15, 2, -8);
      magRight.scale.set(0.6, 5.0, 26);
      envScene.add(magRight);

      const magBack = new THREE.Mesh(stripGeo, magentaStripMat);
      magBack.position.set(0, 6, -16);
      magBack.scale.set(22, 2.5, 0.6);
      envScene.add(magBack);

      const floorBounce = new THREE.Mesh(
        stripGeo,
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.18, 0.32) })
      );
      floorBounce.position.set(0, -14, 0);
      floorBounce.scale.set(24, 0.5, 24);
      envScene.add(floorBounce);

      const envRenderTarget = pmremGenerator.fromScene(envScene, 0.035);
      this.envMapTexture = envRenderTarget.texture;
      this.scene.environment = this.envMapTexture;
      this.scene.environmentIntensity = 0.28;

      stripGeo.dispose();
      cyanStripMat.dispose();
      magentaStripMat.dispose();
      pmremGenerator.dispose();
    } catch {
      // Fallback
    }
  }

  // ============================================================================
  // OPTIMIZED ARCHITECTURAL SKYSCRAPER GEOMETRIES
  // ============================================================================

  private createZigguratTowerGeo(): THREE.BufferGeometry {
    const g1 = new THREE.BoxGeometry(0.96, 0.44, 0.96).translate(0, 0.22, 0);
    const g2 = new THREE.BoxGeometry(0.72, 0.34, 0.72).translate(0, 0.61, 0);
    const g3 = new THREE.BoxGeometry(0.48, 0.20, 0.48).translate(0, 0.88, 0);
    const merged = mergeGeometries([g1, g2, g3], false);
    g1.dispose();
    g2.dispose();
    g3.dispose();
    merged.computeVertexNormals();
    return merged;
  }

  private createTwinTowerGeo(): THREE.BufferGeometry {
    const left = new THREE.BoxGeometry(0.36, 1.0, 0.74).translate(-0.25, 0.5, 0);
    const right = new THREE.BoxGeometry(0.36, 1.0, 0.74).translate(0.25, 0.5, 0);
    const skybridge = new THREE.BoxGeometry(0.76, 0.12, 0.38).translate(0, 0.72, 0);
    const merged = mergeGeometries([left, right, skybridge], false);
    left.dispose();
    right.dispose();
    skybridge.dispose();
    merged.computeVertexNormals();
    return merged;
  }

  private createHexTowerGeo(): THREE.BufferGeometry {
    const body = new THREE.CylinderGeometry(0.48, 0.56, 0.92, 6).translate(0, 0.46, 0);
    const collar = new THREE.CylinderGeometry(0.36, 0.44, 0.08, 6).translate(0, 0.96, 0);
    const merged = mergeGeometries([body, collar], false);
    body.dispose();
    collar.dispose();
    merged.computeVertexNormals();
    return merged;
  }

  private createBrutalistCantileverGeo(): THREE.BufferGeometry {
    const spine = new THREE.BoxGeometry(0.60, 1.0, 0.72).translate(0, 0.5, 0);
    const deck1 = new THREE.BoxGeometry(0.92, 0.16, 0.82).translate(0.12, 0.32, 0);
    const deck2 = new THREE.BoxGeometry(0.90, 0.16, 0.82).translate(-0.12, 0.72, 0);
    const merged = mergeGeometries([spine, deck1, deck2], false);
    spine.dispose();
    deck1.dispose();
    deck2.dispose();
    merged.computeVertexNormals();
    return merged;
  }

  private initInstancedMegacity(): void {
    const geos = [
      this.createZigguratTowerGeo(),
      this.createTwinTowerGeo(),
      this.createHexTowerGeo(),
      this.createBrutalistCantileverGeo(),
    ];

    const towerMat = new THREE.MeshStandardMaterial({
      color: 0x0c1222,
      roughness: 0.60,
      metalness: 0.35,
    });

    towerMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vSkylineWorldPos;
          varying vec3 vSkylineLocalPos;
          varying vec3 vSkylineLocalNormal;
          varying float vTowerSeed;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vSkylineLocalPos = position;
          vSkylineLocalNormal = normal;
          vec4 instWorldPos = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            instWorldPos = instanceMatrix * instWorldPos;
            vTowerSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
          #else
            vTowerSeed = 0.5;
          #endif
          instWorldPos = modelMatrix * instWorldPos;
          vSkylineWorldPos = instWorldPos.xyz;`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vSkylineWorldPos;
          varying vec3 vSkylineLocalPos;
          varying vec3 vSkylineLocalNormal;
          varying float vTowerSeed;

          // Ultra-fast ALU hash (zero sin/cos) for buttery framerates
          float fastSkylineHash(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 45.32);
            return fract(p.x * p.y);
          }`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          vec3 neonCyan = vec3(0.0, 0.85, 0.95);
          vec3 neonMagenta = vec3(0.95, 0.05, 0.48);
          vec3 neonLime = vec3(0.05, 0.95, 0.50);
          vec3 trimColor = vTowerSeed < 0.58
            ? neonCyan
            : (vTowerSeed < 0.88 ? neonMagenta : neonLime);

          float isWall = 1.0 - smoothstep(0.45, 0.85, abs(vSkylineLocalNormal.y));
          float faceCoord = (abs(vSkylineLocalNormal.x) > abs(vSkylineLocalNormal.z))
            ? vSkylineLocalPos.z
            : vSkylineLocalPos.x;

          float colCount = 8.0 + floor(vTowerSeed * 6.0);
          float uWin = (faceCoord + 0.5) * colCount;
          float vWin = max(0.0, vSkylineWorldPos.y + 120.0) * 0.075;

          vec2 cellId = floor(vec2(uWin, vWin));
          vec2 cellUv = fract(vec2(uWin, vWin));

          float paneMask = step(0.18, cellUv.x) * step(cellUv.x, 0.82)
                         * step(0.24, cellUv.y) * step(cellUv.y, 0.78);

          float roomRand = fastSkylineHash(cellId + floor(vTowerSeed * 97.0));
          float litRoom = step(0.56, roomRand);

          float heightWindowMask = smoothstep(-105.0, -35.0, vSkylineWorldPos.y)
                                 * (1.0 - smoothstep(0.91, 0.96, vSkylineLocalPos.y));

          float windowIntensity = isWall * paneMask * litRoom * heightWindowMask * (0.35 + 0.65 * roomRand);
          vec3 windowColor = mix(trimColor, vec3(0.70, 0.88, 1.0), 0.35 * roomRand);

          float octagonEdgeDist = max(abs(vSkylineLocalPos.x), abs(vSkylineLocalPos.z));
          float topPerimeterBand = smoothstep(0.96, 0.995, vSkylineLocalPos.y)
                                 * smoothstep(0.40, 0.48, octagonEdgeDist);
          float roofCrownRing = smoothstep(0.92, 0.95, vSkylineLocalPos.y)
                              * (1.0 - smoothstep(0.95, 0.975, vSkylineLocalPos.y))
                              * isWall;

          float roofGlow = max(topPerimeterBand * 1.5, roofCrownRing * 0.95);
          totalEmissiveRadiance += windowColor * (windowIntensity * 0.85) + trimColor * (roofGlow * 0.75);`
        )
        .replace(
          '#include <fog_fragment>',
          `float abyssBlend = smoothstep(-20.0, -145.0, vSkylineWorldPos.y);
          vec3 abyssVoidColor = vec3(0.012, 0.014, 0.035);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, abyssVoidColor, clamp(abyssBlend, 0.0, 1.0));
          #include <fog_fragment>`
        );
    };

    for (let a = 0; a < SKYLINE_ARCHETYPES; a++) {
      const mesh = new THREE.InstancedMesh(
        geos[a],
        towerMat,
        SKYLINE_PER_ARCHETYPE
      );
      mesh.frustumCulled = false;
      this.skylineMeshes.push(mesh);
      this.scene.add(mesh);
    }

    const color = new THREE.Color();
    for (let i = 0; i < SKYLINE_INSTANCE_COUNT; i++) {
      const archetype = i % SKYLINE_ARCHETYPES;
      const subIndex = Math.floor(i / SKYLINE_ARCHETYPES);
      const slot = this.computeSkylineSlot(i, 0, archetype, subIndex);
      this.skylineSlots.push(slot);
      this.writeSkylineInstanceMatrix(slot);

      const r = pseudoRandom(i * 3.17);
      if (r < 0.5) {
        color.setHex(0x0a1426);
      } else if (r < 0.85) {
        color.setHex(0x140c26);
      } else {
        color.setHex(0x0a1e28);
      }
      this.skylineMeshes[archetype].setColorAt(subIndex, color);
    }

    for (let a = 0; a < SKYLINE_ARCHETYPES; a++) {
      this.skylineMeshes[a].instanceMatrix.needsUpdate = true;
      const instCol = this.skylineMeshes[a].instanceColor;
      if (instCol) {
        instCol.needsUpdate = true;
      }
    }
  }

  private computeSkylineSlot(
    index: number,
    cycle: number,
    archetype: number,
    subIndex: number
  ): SkylineSlot {
    const seedBase = index * 17.31 + cycle * 131.7;
    const side = index % 2 === 0 ? -1 : 1;
    const tier = Math.floor(index / 2) % 4;

    const r1 = pseudoRandom(seedBase + 1.1);
    const r2 = pseudoRandom(seedBase + 2.3);
    const r3 = pseudoRandom(seedBase + 3.7);
    const r4 = pseudoRandom(seedBase + 5.9);

    const tierBaseX = 720 + tier * 420;
    const x = side * (tierBaseX + r1 * 220);

    const baseY = -250;
    const height = 200 + tier * 65 + r2 * 255;
    const width = 75 + tier * 26 + r3 * 85;
    const depth = 75 + tier * 26 + r4 * 85;

    const slotSpacing = SKYLINE_SPAN_Z / SKYLINE_INSTANCE_COUNT;
    const zJitter = (r1 - 0.5) * 35;
    const z =
      SKYLINE_BEHIND_Z -
      index * slotSpacing -
      cycle * SKYLINE_SPAN_Z +
      zJitter;

    const rotY = Math.floor(r2 * 4) * (Math.PI * 0.5);

    return {
      archetype,
      subIndex,
      x,
      y: baseY,
      z,
      scaleX: width,
      scaleY: height,
      scaleZ: depth,
      rotY,
    };
  }

  private writeSkylineInstanceMatrix(slot: SkylineSlot): void {
    this.dummyPos.set(slot.x, slot.y, slot.z);
    this.dummyEuler.set(0, slot.rotY, 0);
    this.dummyQuat.setFromEuler(this.dummyEuler);
    this.dummyScale.set(slot.scaleX, slot.scaleY, slot.scaleZ);
    this.dummyMatrix.compose(this.dummyPos, this.dummyQuat, this.dummyScale);
    this.skylineMeshes[slot.archetype].setMatrixAt(slot.subIndex, this.dummyMatrix);
  }

  // ============================================================================
  // COLOSSAL AEROSPACE GATEWAY ARCHES
  // ============================================================================

  private createColossalGatewayGeo(): THREE.BufferGeometry {
    const outerTorus = new THREE.TorusGeometry(MEGA_ARCH_RADIUS, 24, 6, 24);
    const leftPylon = new THREE.BoxGeometry(64, 200, 74).translate(-MEGA_ARCH_RADIUS, -120, 0);
    const rightPylon = new THREE.BoxGeometry(64, 200, 74).translate(MEGA_ARCH_RADIUS, -120, 0);

    const merged = mergeGeometries([outerTorus, leftPylon, rightPylon], false);
    outerTorus.dispose();
    leftPylon.dispose();
    rightPylon.dispose();
    merged.computeVertexNormals();
    return merged;
  }

  private initColossalMegaArches(): void {
    const archGeo = this.createColossalGatewayGeo();
    const archMat = new THREE.MeshStandardMaterial({
      color: 0x0f182c,
      emissive: 0x00f3ff,
      emissiveIntensity: 0.65,
      roughness: 0.45,
      metalness: 0.45,
    });

    this.megaArchMesh = new THREE.InstancedMesh(
      archGeo,
      archMat,
      MEGA_ARCH_COUNT
    );
    this.megaArchMesh.frustumCulled = false;

    const archColor = new THREE.Color();
    for (let i = 0; i < MEGA_ARCH_COUNT; i++) {
      const z = -900 - i * MEGA_ARCH_SPACING_Z;
      this.megaArchZ.push(z);
      this.writeMegaArchMatrix(i, z);

      archColor.setHex(i % 2 === 0 ? 0x00f3ff : 0xff007f);
      this.megaArchMesh.setColorAt(i, archColor);
    }

    this.megaArchMesh.instanceMatrix.needsUpdate = true;
    if (this.megaArchMesh.instanceColor) {
      this.megaArchMesh.instanceColor.needsUpdate = true;
    }
    this.scene.add(this.megaArchMesh);
  }

  private writeMegaArchMatrix(index: number, z: number): void {
    const tiltX = index % 2 === 0 ? 0.22 : -0.20;
    const rollZ = (index % 4) * (Math.PI * 0.125);
    this.dummyPos.set(0, 120, z);
    this.dummyEuler.set(tiltX, 0, rollZ);
    this.dummyQuat.setFromEuler(this.dummyEuler);
    this.dummyScale.set(1, 1, 1.35);
    this.dummyMatrix.compose(this.dummyPos, this.dummyQuat, this.dummyScale);
    this.megaArchMesh.setMatrixAt(index, this.dummyMatrix);
  }

  // ============================================================================
  // HIGHWAY SUBSTRUCTURE BRIDGE PIERS
  // ============================================================================

  private createSubstructureBentGeo(): THREE.BufferGeometry {
    const pier = new THREE.CylinderGeometry(52, 62, 360, 8).translate(0, -196, 0);
    const crossBeam = new THREE.BoxGeometry(1140, 42, 80).translate(0, -38, 0);
    const merged = mergeGeometries([pier, crossBeam], false);
    pier.dispose();
    crossBeam.dispose();
    merged.computeVertexNormals();
    return merged;
  }

  private initHighwaySubstructure(): void {
    const geo = this.createSubstructureBentGeo();
    const subTex = getSubstructureTexture();

    const mat = new THREE.MeshStandardMaterial({
      color: 0x0c101a,
      roughness: 0.70,
      metalness: 0.25,
      emissive: 0x00f3ff,
      emissiveIntensity: 0.35,
    });

    if (subTex) {
      mat.map = subTex;
    }

    this.substructureMesh = new THREE.InstancedMesh(
      geo,
      mat,
      SUBSTRUCTURE_BENT_COUNT
    );
    this.substructureMesh.frustumCulled = false;

    for (let i = 0; i < SUBSTRUCTURE_BENT_COUNT; i++) {
      const z = -i * SUBSTRUCTURE_SPACING_Z;
      this.substructureZ.push(z);
      this.writeHighwaySubstructureMatrix(i, z);
    }

    this.substructureMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.substructureMesh);
  }

  private writeHighwaySubstructureMatrix(index: number, z: number): void {
    this.dummyPos.set(0, 0, z);
    this.dummyEuler.set(0, 0, 0);
    this.dummyQuat.setFromEuler(this.dummyEuler);
    this.dummyScale.set(1, 1, 1);
    this.dummyMatrix.compose(this.dummyPos, this.dummyQuat, this.dummyScale);
    this.substructureMesh.setMatrixAt(index, this.dummyMatrix);
  }

  // ============================================================================
  // SPEED MOTES & HOLOGRAPHIC BILLBOARDS
  // ============================================================================

  private initSpeedMotes(): void {
    const moteGeo = new THREE.OctahedronGeometry(1.0, 0);
    const moteMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.42,
    });

    this.speedMotesMesh = new THREE.InstancedMesh(
      moteGeo,
      moteMat,
      SPEED_MOTE_COUNT
    );
    this.speedMotesMesh.frustumCulled = false;

    const moteColor = new THREE.Color();
    for (let i = 0; i < SPEED_MOTE_COUNT; i++) {
      const r1 = pseudoRandom(i * 5.13 + 0.7);
      const r2 = pseudoRandom(i * 7.89 + 1.9);
      const r3 = pseudoRandom(i * 11.41 + 3.3);
      const r4 = pseudoRandom(i * 13.73 + 4.5);

      // Flank along highway periphery so the central driving path is completely unobstructed
      const side = r1 < 0.5 ? -1 : 1;
      const baseX = side * (340 + r2 * 380);
      const baseY = 25 + r3 * 220;
      const z =
        SPEED_MOTE_BEHIND_Z - (i / SPEED_MOTE_COUNT) * SPEED_MOTE_SPAN_Z;
      const scale = 0.45 + r4 * 0.55;

      const slot: SpeedMoteSlot = {
        baseX,
        baseY,
        z,
        scale,
        phase: r4 * Math.PI * 2,
      };
      this.speedMoteSlots.push(slot);

      if (r4 < 0.6) {
        moteColor.setRGB(0.0, 0.85, 0.95);
      } else {
        moteColor.setRGB(0.05, 0.95, 0.65);
      }
      this.speedMotesMesh.setColorAt(i, moteColor);
      this.writeSpeedMoteMatrix(i, slot);
    }

    this.speedMotesMesh.instanceMatrix.needsUpdate = true;
    if (this.speedMotesMesh.instanceColor) {
      this.speedMotesMesh.instanceColor.needsUpdate = true;
    }
    this.scene.add(this.speedMotesMesh);
  }

  private writeSpeedMoteMatrix(index: number, slot: SpeedMoteSlot): void {
    this.dummyPos.set(slot.baseX, slot.baseY, slot.z);
    this.dummyEuler.set(0, slot.phase, 0.35);
    this.dummyQuat.setFromEuler(this.dummyEuler);
    this.dummyScale.set(slot.scale * 0.75, slot.scale * 1.45, slot.scale * 0.75);
    this.dummyMatrix.compose(this.dummyPos, this.dummyQuat, this.dummyScale);
    this.speedMotesMesh.setMatrixAt(index, this.dummyMatrix);
  }

  private initHoloBillboards(): void {
    const planeGeo = new THREE.PlaneGeometry(140, 70);
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x00f3ff,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
    });

    this.holoBillboardMesh = new THREE.InstancedMesh(
      planeGeo,
      planeMat,
      HOLO_BILLBOARD_COUNT
    );
    this.holoBillboardMesh.frustumCulled = false;

    const color = new THREE.Color();
    for (let i = 0; i < HOLO_BILLBOARD_COUNT; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (1050 + (i % 3) * 220);
      const y = 180 + (i % 4) * 60;
      const z = -600 - (i / HOLO_BILLBOARD_COUNT) * HOLO_BILLBOARD_SPAN_Z;
      const rotY = side > 0 ? -0.35 : 0.35;

      const slot: HoloBillboardSlot = { x, y, z, rotY };
      this.holoBillboardSlots.push(slot);
      this.writeHoloBillboardMatrix(i, slot);

      color.setHex(i % 3 === 0 ? 0x00f3ff : i % 3 === 1 ? 0xff007f : 0x00ff88);
      this.holoBillboardMesh.setColorAt(i, color);
    }

    this.holoBillboardMesh.instanceMatrix.needsUpdate = true;
    if (this.holoBillboardMesh.instanceColor) {
      this.holoBillboardMesh.instanceColor.needsUpdate = true;
    }
    this.scene.add(this.holoBillboardMesh);
  }

  private writeHoloBillboardMatrix(index: number, slot: HoloBillboardSlot): void {
    this.dummyPos.set(slot.x, slot.y, slot.z);
    this.dummyEuler.set(0, slot.rotY, 0);
    this.dummyQuat.setFromEuler(this.dummyEuler);
    this.dummyScale.set(1, 1, 1);
    this.dummyMatrix.compose(this.dummyPos, this.dummyQuat, this.dummyScale);
    this.holoBillboardMesh.setMatrixAt(index, this.dummyMatrix);
  }

  private suppressLegacyChunkTowers(): void {
    const children = this.scene.children;
    for (let i = 0; i < children.length; i++) {
      const obj = children[i];
      if (
        obj.type === 'Group' &&
        obj !== this.speedLinesGroup &&
        !this.processedChunkGroups.has(obj)
      ) {
        const subChildren = obj.children;
        if (subChildren.length > 0) {
          this.processedChunkGroups.add(obj);
          for (let j = 0; j < subChildren.length; j++) {
            const sub = subChildren[j];
            if (Math.abs(sub.position.x) > 650) {
              sub.visible = false;
            }
          }
        }
      }
    }
  }

  /**
   * Recycles megacity skyline buildings, colossal mega-arches, highway substructure,
   * holographic billboards, and 3D speed motes ahead of the runner along -Z.
   * Only updates GPU instance buffers when positions actually wrap.
   */
  private updateInstancedWorld(refZ: number): void {
    this.suppressLegacyChunkTowers();

    // 1. Recycle Megacity Skyline instances across 4 archetypes (only update dirty archetypes)
    let dirtyMask = 0;
    const maxSkylineZ = refZ + SKYLINE_BEHIND_Z;
    const minSkylineZ = maxSkylineZ - SKYLINE_SPAN_Z;

    for (let i = 0; i < SKYLINE_INSTANCE_COUNT; i++) {
      const slot = this.skylineSlots[i];
      if (slot.z > maxSkylineZ || slot.z < minSkylineZ) {
        const wrappedOffset =
          ((((slot.z - minSkylineZ) % SKYLINE_SPAN_Z) + SKYLINE_SPAN_Z) %
            SKYLINE_SPAN_Z);
        slot.z = minSkylineZ + wrappedOffset;
        this.writeSkylineInstanceMatrix(slot);
        dirtyMask |= (1 << slot.archetype);
      }
    }
    if (dirtyMask !== 0) {
      for (let a = 0; a < SKYLINE_ARCHETYPES; a++) {
        if ((dirtyMask & (1 << a)) !== 0) {
          this.skylineMeshes[a].instanceMatrix.needsUpdate = true;
        }
      }
    }

    // 2. Recycle Colossal Overhead Mega-Arches
    let archDirty = false;
    const totalArchSpan = MEGA_ARCH_COUNT * MEGA_ARCH_SPACING_Z;
    const maxArchZ = refZ + 900;
    const minArchZ = maxArchZ - totalArchSpan;

    for (let i = 0; i < MEGA_ARCH_COUNT; i++) {
      let z = this.megaArchZ[i];
      if (z > maxArchZ || z < minArchZ) {
        const wrapped =
          ((((z - minArchZ) % totalArchSpan) + totalArchSpan) % totalArchSpan);
        z = minArchZ + wrapped;
        this.megaArchZ[i] = z;
        this.writeMegaArchMatrix(i, z);
        archDirty = true;
      }
    }
    if (archDirty) {
      this.megaArchMesh.instanceMatrix.needsUpdate = true;
    }

    // 3. Recycle Monumental Highway Substructure Bridge Piers
    let subDirty = false;
    const maxSubZ = refZ + 600;
    const minSubZ = maxSubZ - SUBSTRUCTURE_SPAN_Z;

    for (let i = 0; i < SUBSTRUCTURE_BENT_COUNT; i++) {
      let z = this.substructureZ[i];
      if (z > maxSubZ || z < minSubZ) {
        const wrapped =
          ((((z - minSubZ) % SUBSTRUCTURE_SPAN_Z) + SUBSTRUCTURE_SPAN_Z) % SUBSTRUCTURE_SPAN_Z);
        z = minSubZ + wrapped;
        this.substructureZ[i] = z;
        this.writeHighwaySubstructureMatrix(i, z);
        subDirty = true;
      }
    }
    if (subDirty) {
      this.substructureMesh.instanceMatrix.needsUpdate = true;
    }

    // 4. Recycle Floating Holographic Billboards
    let holoDirty = false;
    const maxHoloZ = refZ + 400;
    const minHoloZ = maxHoloZ - HOLO_BILLBOARD_SPAN_Z;

    for (let i = 0; i < HOLO_BILLBOARD_COUNT; i++) {
      const slot = this.holoBillboardSlots[i];
      if (slot.z > maxHoloZ || slot.z < minHoloZ) {
        const wrapped =
          ((((slot.z - minHoloZ) % HOLO_BILLBOARD_SPAN_Z) + HOLO_BILLBOARD_SPAN_Z) %
            HOLO_BILLBOARD_SPAN_Z);
        slot.z = minHoloZ + wrapped;
        this.writeHoloBillboardMatrix(i, slot);
        holoDirty = true;
      }
    }
    if (holoDirty) {
      this.holoBillboardMesh.instanceMatrix.needsUpdate = true;
    }

    // 5. Recycle 3D Speed Motes (only upload to GPU if a mote wraps around)
    let moteDirty = false;
    const maxMoteZ = refZ + SPEED_MOTE_BEHIND_Z;
    const minMoteZ = maxMoteZ - SPEED_MOTE_SPAN_Z;
    for (let i = 0; i < SPEED_MOTE_COUNT; i++) {
      const slot = this.speedMoteSlots[i];
      if (slot.z > maxMoteZ || slot.z < minMoteZ) {
        const wrapped =
          ((((slot.z - minMoteZ) % SPEED_MOTE_SPAN_Z) + SPEED_MOTE_SPAN_Z) %
            SPEED_MOTE_SPAN_Z);
        slot.z = minMoteZ + wrapped;
        this.writeSpeedMoteMatrix(i, slot);
        moteDirty = true;
      }
    }
    if (moteDirty) {
      this.speedMotesMesh.instanceMatrix.needsUpdate = true;
    }
  }

  public get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  public cycleCameraMode(): CameraMode {
    if (this.cameraMode === 'CHASE') {
      this.cameraMode = 'CLOSE';
    } else if (this.cameraMode === 'CLOSE') {
      this.cameraMode = 'FIRST_PERSON';
    } else {
      this.cameraMode = 'CHASE';
    }
    return this.cameraMode;
  }

  public setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
  }

  public resetCameraSnap(targetPos: THREE.Vector3, viewYaw: number): void {
    this.smoothOrbitYaw = viewYaw;
    this.smoothPivotY = targetPos.y;
    this.initializedCam = true;
    this.updateInstancedWorld(targetPos.z);
  }

  public updateCamera(
    targetPos: THREE.Vector3,
    viewYaw: number,
    rollAngleDeg: number,
    ups = 0,
    dt = 0.016,
    viewPitch = 0,
    vel?: THREE.Vector3,
    grounded = true
  ): void {
    if (!this.initializedCam) {
      this.resetCameraSnap(targetPos, viewYaw);
    }

    const vertRate =
      this.cameraMode === 'FIRST_PERSON'
        ? 28
        : grounded || targetPos.y < this.smoothPivotY
        ? 20
        : 10;
    this.smoothPivotY +=
      (targetPos.y - this.smoothPivotY) * (1 - Math.exp(-dt * vertRate));

    if (this.cameraMode === 'FIRST_PERSON') {
      this.smoothOrbitYaw = viewYaw;
      this.camera.position.set(targetPos.x, this.smoothPivotY + 43, targetPos.z);
      this.camera.rotation.y = viewYaw;
      this.camera.rotation.x = THREE.MathUtils.clamp(viewPitch - 0.02, -1.25, 1.15);
      this.camera.rotation.z = THREE.MathUtils.degToRad(rollAngleDeg * 0.55);
    } else {
      let desiredOrbitYaw = viewYaw;
      if (vel && ups > 140) {
        const velYaw = Math.atan2(-vel.x, -vel.z);
        const velDelta = wrapAngle(velYaw - viewYaw);
        if (Math.abs(velDelta) < Math.PI * 0.45) {
          desiredOrbitYaw = viewYaw + velDelta * 0.45;
        }
      }

      const orbitStep = 1 - Math.exp(-dt * 9.5);
      this.smoothOrbitYaw = wrapAngle(
        this.smoothOrbitYaw +
          wrapAngle(desiredOrbitYaw - this.smoothOrbitYaw) * orbitStep
      );

      const maxSlack = this.cameraMode === 'CLOSE' ? 0.18 : 0.25;
      const rawOrbitLag = wrapAngle(viewYaw - this.smoothOrbitYaw);
      const clampedLag = THREE.MathUtils.clamp(rawOrbitLag, -maxSlack, maxSlack);
      if (Math.abs(rawOrbitLag) > maxSlack) {
        this.smoothOrbitYaw = wrapAngle(viewYaw - clampedLag);
      }

      const boomYaw = viewYaw - clampedLag * 0.68;

      const isClose = this.cameraMode === 'CLOSE';
      const baseDist = isClose ? 56 : TronRenderer.CAM_BASE_DISTANCE;
      const pivotHeight = isClose ? 40 : 38;
      const heightAbovePivot = isClose ? 6 : 11;
      const basePitch = isClose ? -0.055 : -0.085;

      const speedFactor = Math.max(0, Math.min(1.2, (ups - 320) / 450));
      const dynamicDist = baseDist + speedFactor * 6;
      const dynamicHeight = heightAbovePivot - speedFactor * 2.5;

      const orbitPitch = viewPitch * 0.65;
      const horizDist = dynamicDist * Math.max(0.6, Math.cos(orbitPitch));
      const pitchHeightOffset = -Math.sin(orbitPitch) * dynamicDist * 0.75;

      const camX = targetPos.x + Math.sin(boomYaw) * horizDist;
      const camZ = targetPos.z + Math.cos(boomYaw) * horizDist;
      const camY = Math.max(
        targetPos.y + 12,
        this.smoothPivotY + pivotHeight + dynamicHeight + pitchHeightOffset
      );

      this.camera.position.set(camX, camY, camZ);
      this.camera.rotation.y = viewYaw;
      this.camera.rotation.x = THREE.MathUtils.clamp(
        basePitch + viewPitch,
        -1.05,
        0.75
      );
      this.camera.rotation.z = THREE.MathUtils.degToRad(rollAngleDeg * 0.25);
    }

    if (this.boostImpulseTimer > 0) {
      this.boostImpulseTimer = Math.max(0, this.boostImpulseTimer - dt);
    }
    const boostRatio = this.boostImpulseTimer / 0.55;
    const boostFovKick = boostRatio * 9.5;

    // Dynamic Speed FOV
    const baseFov = this.cameraMode === 'FIRST_PERSON' ? 78 : 72;
    const speedFov = Math.max(0, Math.min(22, ((ups - 270) / 480) * 20));
    const targetFov = baseFov + speedFov + boostFovKick;
    if (Math.abs(targetFov - this.smoothFov) > 0.05) {
      this.smoothFov +=
        (targetFov - this.smoothFov) * (1 - Math.exp(-dt * 12));
      this.camera.fov = this.smoothFov;
      this.camera.updateProjectionMatrix();
    }

    // Animate 3D Peripheral Warp Speed Lines
    const speedWarp = Math.max(0, Math.min(1.0, (ups - 270) / 440));
    const warpIntensity = Math.max(speedWarp, boostRatio);
    this.speedLineMat.opacity = warpIntensity * 0.76;
    if (warpIntensity > 0.01) {
      this.speedLineMat.color.setHex(ups >= 680 || boostRatio > 0.25 ? 0x00f3ff : 0x00c8e6);
      const streakSpeed = 300 + ups * 1.25 + boostRatio * 350;
      const streakStretch = 1.1 + warpIntensity * 2.8;

      for (let i = 0; i < SPEED_LINE_COUNT; i++) {
        const s = this.speedLineSeeds[i];
        s.z += streakSpeed * dt;
        if (s.z > 10) {
          s.z = -190 - (i % 30);
        }
        const idx = i * 6;
        this.speedLinePositions[idx] = s.x;
        this.speedLinePositions[idx + 1] = s.y;
        this.speedLinePositions[idx + 2] = s.z;

        this.speedLinePositions[idx + 3] = s.x;
        this.speedLinePositions[idx + 4] = s.y;
        this.speedLinePositions[idx + 5] = s.z - s.len * streakStretch;
      }
      this.speedLineGeo.attributes.position.needsUpdate = true;
    }

    // Speed Chromatic Aberration
    if (this.chromaticPass) {
      const targetSpeedRatio = THREE.MathUtils.clamp(
        (ups - 400.0) / 550.0,
        0.0,
        1.0
      );
      this.smoothDistortion +=
        (targetSpeedRatio - this.smoothDistortion) * Math.min(1, dt * 10);
      this.chromaticPass.uniforms.uSpeedRatio.value = this.smoothDistortion;
    }

    this.updateInstancedWorld(this.camera.position.z);
  }

  public render(): void {
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setSize(w, h);
    }
  }
}
