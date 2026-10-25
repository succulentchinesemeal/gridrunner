import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const SPEED_LINE_COUNT = 70;

export type CameraMode = 'CHASE' | 'CLOSE' | 'FIRST_PERSON';

function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class TronRenderer {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;

  /** Tuned Action Chase Camera Spec (Crisp 1:1 mouse aim + anti-whip chase boom) */
  public static readonly CAM_BASE_HEIGHT = 49;
  public static readonly CAM_BASE_DISTANCE = 86;
  public static readonly CAM_LOOK_AHEAD = 220;

  public cameraMode: CameraMode = 'CHASE';

  // Anti-whip orbit & vertical pivot smoothing state (zero X/Z position lag)
  private smoothPivotY = 0;
  private smoothOrbitYaw = 0;
  private smoothFov = 72;
  private initializedCam = false;

  // 3D Warp Speed Lines in Camera Space for visceral high-UPS feedback
  private speedLinesGroup = new THREE.Group();
  private speedLinePositions: Float32Array;
  private speedLineGeo: THREE.BufferGeometry;
  private speedLineMat: THREE.LineBasicMaterial;
  private speedLineSeeds: Array<{ x: number; y: number; z: number; len: number }> = [];

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05050d);
    this.scene.fog = new THREE.FogExp2(0x05050d, 0.00028);

    this.camera = new THREE.PerspectiveCamera(
      74,
      window.innerWidth / window.innerHeight,
      2,
      6500
    );
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // Build 3D Peripheral Speed Warp Streaks attached to the camera
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
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ReinhardToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    container.appendChild(this.renderer.domElement);

    // Lighting for procedural cyber-grid & acrobatic rigs
    const ambient = new THREE.AmbientLight(0x283c66, 2.0);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0x00f3ff, 2.4);
    dirLight.position.set(220, 500, 180);
    this.scene.add(dirLight);

    const backLight = new THREE.DirectionalLight(0xff007f, 1.6);
    backLight.position.set(-220, 300, -300);
    this.scene.add(backLight);

    // UnrealBloomPass post-processing tuned for crisp 60+ FPS neon glow
    try {
      const renderScene = new RenderPass(this.scene, this.camera);
      const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(
          Math.floor(window.innerWidth * 0.5),
          Math.floor(window.innerHeight * 0.5)
        ),
        0.78, // strength
        0.32, // radius
        0.24 // threshold
      );
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(renderScene);
      this.composer.addPass(bloomPass);
    } catch {
      this.composer = null;
    }

    window.addEventListener('resize', () => this.onResize());
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

    // 1. Frame-rate independent vertical pivot tracking:
    // Fast catch-up when grounded or descending; smooth shock-absorption during routine bhop arcs
    const vertRate =
      this.cameraMode === 'FIRST_PERSON'
        ? 28
        : grounded || targetPos.y < this.smoothPivotY
        ? 20
        : 10;
    this.smoothPivotY +=
      (targetPos.y - this.smoothPivotY) * (1 - Math.exp(-dt * vertRate));

    if (this.cameraMode === 'FIRST_PERSON') {
      // Quake / CS 1.6 Pro First-Person View: zero position lag, 1:1 mouse yaw/pitch, subtle GoldSrc roll
      this.smoothOrbitYaw = viewYaw;
      this.camera.position.set(targetPos.x, this.smoothPivotY + 43, targetPos.z);
      this.camera.rotation.y = viewYaw;
      this.camera.rotation.x = THREE.MathUtils.clamp(viewPitch - 0.02, -1.25, 1.15);
      this.camera.rotation.z = THREE.MathUtils.degToRad(rollAngleDeg * 0.55);
    } else {
      // Third-Person Action Chase ('CHASE' or 'CLOSE'):
      // - 100% instant 1:1 mouse aim rotation (camera.rotation.y = viewYaw)
      // - Anti-whip orbit boom position that glides along the velocity S-curve during air-strafes
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
      // Keep smoothOrbitYaw within maxSlack of viewYaw on wide flicks so character stays centered
      if (Math.abs(rawOrbitLag) > maxSlack) {
        this.smoothOrbitYaw = wrapAngle(viewYaw - clampedLag);
      }

      // Boom angle absorbs 68% of rapid left/right air-strafe mouse wiggles while keeping runner centered
      const boomYaw = viewYaw - clampedLag * 0.68;

      const isClose = this.cameraMode === 'CLOSE';
      const baseDist = isClose ? 56 : TronRenderer.CAM_BASE_DISTANCE;
      const pivotHeight = isClose ? 40 : 38;
      const heightAbovePivot = isClose ? 6 : 11;
      const basePitch = isClose ? -0.055 : -0.085;

      const speedFactor = Math.max(0, Math.min(1.2, (ups - 320) / 450));
      const dynamicDist = baseDist + speedFactor * 6;
      const dynamicHeight = heightAbovePivot - speedFactor * 2.5;

      // Orbit vertically with viewPitch while guarding against floor clipping
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

      // Crisp 1:1 mouse aim rotation (zero input lag)
      this.camera.rotation.y = viewYaw;
      this.camera.rotation.x = THREE.MathUtils.clamp(
        basePitch + viewPitch,
        -1.05,
        0.75
      );
      this.camera.rotation.z = THREE.MathUtils.degToRad(rollAngleDeg * 0.25);
    }

    // 2. Dynamic Speed FOV (72 deg base -> up to 90 deg at 750+ UPS, avoiding extreme fisheye)
    const baseFov = this.cameraMode === 'FIRST_PERSON' ? 78 : 72;
    const targetFov =
      baseFov + Math.max(0, Math.min(18, ((ups - 300) / 480) * 18));
    if (Math.abs(targetFov - this.smoothFov) > 0.05) {
      this.smoothFov +=
        (targetFov - this.smoothFov) * (1 - Math.exp(-dt * 9));
      this.camera.fov = this.smoothFov;
      this.camera.updateProjectionMatrix();
    }

    // 3. Animate 3D Peripheral Warp Speed Lines when bhopping (> 340 UPS)
    const warpIntensity = Math.max(0, Math.min(1, (ups - 340) / 380));
    this.speedLineMat.opacity = warpIntensity * 0.65;
    if (warpIntensity > 0.01) {
      this.speedLineMat.color.setHex(ups >= 680 ? 0xff007f : 0x00f3ff);
      const streakSpeed = 240 + ups * 0.95;
      const streakStretch = 1 + warpIntensity * 2.2;

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
