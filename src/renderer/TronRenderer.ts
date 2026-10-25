import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const SPEED_LINE_COUNT = 70;

export class TronRenderer {
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;

  /** Sleek Third-Person Action Chase Camera Spec (Low-slung, horizon-focused, zero nausea) */
  public static readonly CAM_BASE_HEIGHT = 68;
  public static readonly CAM_BASE_DISTANCE = 132;
  public static readonly CAM_LOOK_AHEAD = 220;

  // Anti-nausea smoothed camera state
  private smoothCamX = 0;
  private smoothCamY = 68;
  private smoothCamZ = 132;
  private smoothOrbitYaw = 0;
  private smoothFov = 74;
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

  public resetCameraSnap(targetPos: THREE.Vector3, viewYaw: number): void {
    this.smoothOrbitYaw = viewYaw;
    this.smoothCamX =
      targetPos.x + Math.sin(viewYaw) * TronRenderer.CAM_BASE_DISTANCE;
    this.smoothCamY = targetPos.y + TronRenderer.CAM_BASE_HEIGHT;
    this.smoothCamZ =
      targetPos.z + Math.cos(viewYaw) * TronRenderer.CAM_BASE_DISTANCE;
    this.initializedCam = true;
  }

  public updateCamera(
    targetPos: THREE.Vector3,
    viewYaw: number,
    _rollAngleDeg: number,
    ups = 0,
    dt = 0.016
  ): void {
    if (!this.initializedCam) {
      this.resetCameraSnap(targetPos, viewYaw);
    }

    // 1. Dampen orbit yaw so rapid left/right mouse whips don't violently swing camera position sideways
    let yawDiff = viewYaw - this.smoothOrbitYaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    this.smoothOrbitYaw += yawDiff * Math.min(1, dt * 8.5);

    // Blend 65% smoothed orbit yaw + 35% direct viewYaw for responsive yet rock-steady framing
    const camOrbitYaw = this.smoothOrbitYaw;
    const speedFactor = Math.max(0, Math.min(1.5, (ups - 300) / 450));

    // Pull camera slightly lower as speed climbs for an intense ground-rush sensation
    const dynamicHeight = TronRenderer.CAM_BASE_HEIGHT - speedFactor * 8;
    const dynamicDist = TronRenderer.CAM_BASE_DISTANCE + speedFactor * 10;

    const desiredX = targetPos.x + Math.sin(camOrbitYaw) * dynamicDist;
    const desiredZ = targetPos.z + Math.cos(camOrbitYaw) * dynamicDist;
    const desiredY = targetPos.y + dynamicHeight;

    // Horizontal tracking is tight; vertical tracking (smoothCamY) is heavily damped
    // so bunny-hopping up and down doesn't pogo-bob the camera!
    this.smoothCamX += (desiredX - this.smoothCamX) * Math.min(1, dt * 18);
    this.smoothCamZ += (desiredZ - this.smoothCamZ) * Math.min(1, dt * 24);
    this.smoothCamY += (desiredY - this.smoothCamY) * Math.min(1, dt * 5.2);

    this.camera.position.set(this.smoothCamX, this.smoothCamY, this.smoothCamZ);

    // Look far down the track along the player's heading with a steady horizon (zero Z roll!)
    const lookYaw = this.smoothOrbitYaw + yawDiff * 0.45;
    const lookTargetX =
      targetPos.x - Math.sin(lookYaw) * TronRenderer.CAM_LOOK_AHEAD;
    const lookTargetZ =
      targetPos.z - Math.cos(lookYaw) * TronRenderer.CAM_LOOK_AHEAD;
    const lookTargetY = this.smoothCamY - 34;

    this.camera.lookAt(lookTargetX, lookTargetY, lookTargetZ);
    // Keep horizon 100% level to prevent motion sickness
    this.camera.rotation.z = 0;

    // 2. Dynamic Speed FOV (74 deg at base -> up to 98 deg at 750+ UPS)
    const targetFov = 74 + Math.max(0, Math.min(24, ((ups - 300) / 480) * 24));
    if (Math.abs(targetFov - this.smoothFov) > 0.05) {
      this.smoothFov += (targetFov - this.smoothFov) * Math.min(1, dt * 8);
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
