import * as THREE from 'three';

const TRAIL_SEGMENTS = 44;
const TRAIL_HALF_WIDTH = 13.5;
const TAIL_SEGMENT_COUNT = 6;
const TAIL_PHASE_DELAY_SEC = 0.025; // 25ms phase offset per vertebra
const SHOCKWAVE_POOL_SIZE = 4;
const SHOCKWAVE_DURATION_SEC = 0.22; // 220ms burst duration
const WING_BASE_OFFSET_X = 7.0; // Float 7 units to the left and right of central core
const MAX_CARVE_BANK_RAD = 0.95; // ±0.95 radians (±55°)
const SPRING_STIFFNESS = 180;
const SPRING_DAMPING = 14;

export interface AcrobatAnimInput {
  grounded: boolean;
  ups: number;
  vel: THREE.Vector3;
  viewYaw: number;
  smove: number; // < 0 for A (left), > 0 for D (right)
  fmove: number;
  isDashing: boolean;
  isSurfing?: boolean;
  surfRampAngle?: number;
}

export function shortestAngleDiff(currentYaw: number, prevYaw: number): number {
  let diff = currentYaw - prevYaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Reusable 2nd-Order Damped Spring Helper Class
 * (stiffness = 180, damping = 14)
 */
export class SpringValue {
  value = 0;
  vel = 0;

  constructor(initialValue = 0) {
    this.value = initialValue;
  }

  reset(val = 0): void {
    this.value = val;
    this.vel = 0;
  }

  update(target: number, stiffness: number, damping: number, dt: number): number {
    const force = (target - this.value) * stiffness;
    this.vel = (this.vel + force * dt) * Math.exp(-damping * dt);
    this.value += this.vel * dt;
    return this.value;
  }

  impulse(amount: number): void {
    this.vel += amount;
  }
}

interface SpinePoseSample {
  time: number;
  pitch: number;
  yaw: number;
  yawRate: number;
  roll: number;
  heave: number;
}

interface ShockwaveRingSlot {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  active: boolean;
  elapsed: number;
}

export class PlayerRig {
  public readonly group = new THREE.Group();

  // Aero-Core Glider Hierarchy
  private gliderRoot = new THREE.Group();
  public readonly coreGroup = new THREE.Group();
  private fuselageGroup: THREE.Group;
  private gyroRingOuter!: THREE.Mesh;
  private gyroRingInner!: THREE.Mesh;
  private reactorCoreMesh!: THREE.Mesh;
  private thrusterNozzleGroup = new THREE.Group();
  private thrusterPlumeMesh!: THREE.Mesh;

  // Detached Magnetic Wing-Blades (floating ±7 units from central core)
  private wingOrbitGroup = new THREE.Group();
  public readonly leftWing = new THREE.Group();
  public readonly rightWing = new THREE.Group();
  private leftWingPivot: THREE.Group;
  private rightWingPivot: THREE.Group;

  // Articulated 6-Segment Kinetic Spine/Tail
  private tailRoot = new THREE.Group();
  private tailSegments: THREE.Group[] = [];
  private spineHistory: SpinePoseSample[] = [];
  private simTime = 0;

  // Materials for dynamic color assignment & shader uniforms
  private playerColor = new THREE.Color(0x00f3ff);
  private rimColorUniform = { value: new THREE.Color(0x00f3ff) };
  private darkArmorMat!: THREE.MeshStandardMaterial;
  private neonCoreMat!: THREE.MeshStandardMaterial;
  private thrusterPlumeMat!: THREE.MeshBasicMaterial;

  // 2nd-Order Spring Solvers (stiffness = 180, damping = 14)
  public readonly rollSpring = new SpringValue(0);
  public readonly pitchSpring = new SpringValue(0);
  public readonly yawCarveSpring = new SpringValue(0);
  public readonly bodyHeaveSpring = new SpringValue(0);
  public readonly wingSpreadSpring = new SpringValue(0);
  public readonly wingVerticalSpring = new SpringValue(0);
  public readonly orbitalAngleSpring = new SpringValue(0);
  public readonly dashSnapSpring = new SpringValue(0);

  // Motion & Action State
  private prevViewYaw = 0;
  private smoothHeadingYaw = 0;
  private initializedYaw = false;
  private wasGrounded = true;
  public orbitalAngle = 0;
  private dashTimer = 0;
  private lastKnownUps = 0;
  private lastShockwaveTime = -1;

  // Wing-Tip Plasma Wake Ribbon Trail
  private trailGeometry: THREE.BufferGeometry;
  private trailPositions: Float32Array;
  private trailUvs: Float32Array;
  private trailMaterial: THREE.ShaderMaterial;
  private trailMesh: THREE.Mesh;
  private history: Array<{
    x: number;
    y: number;
    z: number;
    yaw: number;
    roll: number;
  }> = [];

  // Pool of 4 Bhop Shockwave Rings at floor level (y = 1.0)
  private shockwaveGroup = new THREE.Group();
  private shockwavePool: ShockwaveRingSlot[] = [];
  private shockwaveCursor = 0;
  private sharedShockwaveGeo: THREE.RingGeometry;

  constructor(colorHex: number = 0x00f3ff) {
    this.playerColor.setHex(colorHex);
    this.rimColorUniform.value.setHex(colorHex);

    this.fuselageGroup = this.coreGroup;
    this.leftWingPivot = this.leftWing;
    this.rightWingPivot = this.rightWing;

    this.buildAeroCoreGlider(colorHex);
    this.group.add(this.gliderRoot);

    // Build UV-faded Additive Plasma Wake Ribbon Trail (44 segments)
    this.trailGeometry = new THREE.BufferGeometry();
    this.trailPositions = new Float32Array(TRAIL_SEGMENTS * 2 * 3);
    this.trailUvs = new Float32Array(TRAIL_SEGMENTS * 2 * 2);

    for (let i = 0; i < TRAIL_SEGMENTS; i++) {
      const u = i / (TRAIL_SEGMENTS - 1);
      const uvIdx = i * 4;
      this.trailUvs[uvIdx] = u;
      this.trailUvs[uvIdx + 1] = 0;
      this.trailUvs[uvIdx + 2] = u;
      this.trailUvs[uvIdx + 3] = 1;
    }

    this.trailGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.trailPositions, 3)
    );
    this.trailGeometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(this.trailUvs, 2)
    );

    const indices: number[] = [];
    for (let i = 0; i < TRAIL_SEGMENTS - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
    this.trailGeometry.setIndex(indices);

    this.trailMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(colorHex) },
        uOpacity: { value: 0.8 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          // Smooth UV alpha fade: pow(1.0 - vUv.x, 1.8)
          float lengthFade = pow(max(0.0, 1.0 - vUv.x), 1.8);
          // Bright core glow across ribbon width
          float edgeDist = abs(vUv.y - 0.5) * 2.0;
          float coreGlow = exp(-edgeDist * edgeDist * 6.0);
          float wingFilaments = smoothstep(0.68, 0.95, edgeDist);
          float crossProfile = max(coreGlow * 1.25, wingFilaments * 0.9);

          float alpha = lengthFade * crossProfile * uOpacity;
          if (alpha < 0.003) discard;

          vec3 glowColor = mix(uColor, vec3(1.0), coreGlow * 0.85);
          gl_FragColor = vec4(glowColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.trailMesh = new THREE.Mesh(this.trailGeometry, this.trailMaterial);
    this.trailMesh.frustumCulled = false;

    // Pre-allocate a pool of 4 flat ring meshes (THREE.RingGeometry(3, 4.5, 32)) per rig
    this.sharedShockwaveGeo = new THREE.RingGeometry(3, 4.5, 32);
    this.sharedShockwaveGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < SHOCKWAVE_POOL_SIZE; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.sharedShockwaveGeo, mat);
      mesh.visible = false;
      mesh.position.y = 1.0;
      this.shockwaveGroup.add(mesh);
      this.shockwavePool.push({
        mesh,
        material: mat,
        active: false,
        elapsed: 0,
      });
    }
  }

  public attachToScene(scene: THREE.Scene): void {
    scene.add(this.group);
    scene.add(this.trailMesh);
    scene.add(this.shockwaveGroup);
  }

  public setVisible(visible: boolean): void {
    this.group.visible = visible;
    this.trailMesh.visible = visible;
    this.shockwaveGroup.visible = visible;
  }

  public detachFromScene(scene: THREE.Scene): void {
    scene.remove(this.group);
    scene.remove(this.trailMesh);
    scene.remove(this.shockwaveGroup);
    this.trailGeometry.dispose();
    this.trailMaterial.dispose();
    this.sharedShockwaveGeo.dispose();
  }

  public setColor(colorHex: number): void {
    this.playerColor.setHex(colorHex);
    this.rimColorUniform.value.setHex(colorHex);
    this.neonCoreMat.color.setHex(colorHex);
    this.neonCoreMat.emissive.setHex(colorHex);
    this.thrusterPlumeMat.color.setHex(colorHex);
    this.trailMaterial.uniforms.uColor.value.setHex(colorHex);
    for (const slot of this.shockwavePool) {
      slot.material.color.setHex(colorHex);
    }
  }

  public setPosition(pos: THREE.Vector3): void {
    this.group.position.copy(pos);
  }

  public setYaw(yaw: number): void {
    this.smoothHeadingYaw = yaw;
    this.group.rotation.y = yaw;
  }

  /**
   * Triggers a crisp impulse animation on jump, bhop, or double-jump vortex
   */
  public triggerJumpAnim(isDoubleJump: boolean): void {
    // Bhop Squash & Rebound: impulse wingSpreadSpring(140) and wingVerticalSpring(-160)
    this.wingSpreadSpring.impulse(140);
    this.wingVerticalSpring.impulse(-160);
    this.bodyHeaveSpring.impulse(-40);

    if (isDoubleJump) {
      // Orbital barrel roll 360° on mid-air double jump
      this.orbitalAngle += 2 * Math.PI;
    } else if (this.lastKnownUps > 450) {
      this.spawnBhopShockwave(this.group.position.x, this.group.position.z, this.group.position.y);
    }
  }

  /**
   * Pulls magnetic wings tight against fuselage into a supersonic delta-dart and flares thruster for 300ms
   */
  public triggerDashAnim(): void {
    this.dashTimer = 0.30;
    this.dashSnapSpring.impulse(12.0);
    this.pitchSpring.impulse(-0.15);
  }

  private spawnBhopShockwave(x: number, z: number, y: number = 1.0): void {
    if (this.simTime - this.lastShockwaveTime < 0.04) return;
    this.lastShockwaveTime = this.simTime;

    const slot = this.shockwavePool[this.shockwaveCursor];
    this.shockwaveCursor = (this.shockwaveCursor + 1) % SHOCKWAVE_POOL_SIZE;

    slot.active = true;
    slot.elapsed = 0;
    slot.mesh.visible = true;
    slot.mesh.position.set(x, Math.max(1.0, y), z);
    slot.mesh.scale.set(1, 1, 1);
    slot.material.opacity = 0.9;
  }

  private buildAeroCoreGlider(colorHex: number): void {
    // 1. Fresnel Rim-Lit PBR Dark Titanium Armor Material (refined matte-composite roughness: 0.45, metalness: 0.55)
    this.darkArmorMat = new THREE.MeshStandardMaterial({
      color: 0x0c1424,
      roughness: 0.45,
      metalness: 0.55,
      emissive: colorHex,
      emissiveIntensity: 0.08,
    });

    this.darkArmorMat.onBeforeCompile = (shader) => {
      shader.uniforms.uRimColor = this.rimColorUniform;
      shader.fragmentShader =
        `uniform vec3 uRimColor;\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `
        #include <emissivemap_fragment>
        vec3 fresnelViewDir = normalize(vViewPosition);
        float fresnelFactor = pow(1.0 - abs(dot(normal, fresnelViewDir)), 3.2) * 1.15;
        totalEmissiveRadiance += uRimColor * fresnelFactor;
        `
      );
    };
    this.darkArmorMat.customProgramCacheKey = () => 'aero-core-fresnel-armor-v2';

    // 2. High-Tech Gyro-Reactor & Plasma Edge Material (refined emissiveIntensity: 1.35)
    this.neonCoreMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: 1.35,
      roughness: 0.28,
      metalness: 0.20,
    });

    this.thrusterPlumeMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    // Hover height above deck
    this.gliderRoot.position.set(0, 24, 0);
    this.gliderRoot.add(this.fuselageGroup);

    // ============================================================================
    // A. CENTRAL STEALTH FUSELAGE & EXPOSED GYRO-REACTOR (Beveled ExtrudeGeometry)
    // ============================================================================
    const hullShape = new THREE.Shape();
    // 2D planform in (x, y) where +y maps to -z (forward nose) after rotateX(-PI/2)
    hullShape.moveTo(0, 19.5); // Razor stealth nose tip (z = -19.5)
    hullShape.lineTo(3.4, 10.5); // Forward chine
    hullShape.lineTo(6.2, 3.2); // Forward intake shoulder
    hullShape.lineTo(5.2, -3.5); // Mid-body reactor waist
    hullShape.lineTo(6.0, -9.5); // Rear engine cowling flare
    hullShape.lineTo(3.6, -13.5); // Exhaust shroud corner
    hullShape.lineTo(1.8, -12.2); // Exhaust recess
    hullShape.lineTo(-1.8, -12.2);
    hullShape.lineTo(-3.6, -13.5);
    hullShape.lineTo(-6.0, -9.5);
    hullShape.lineTo(-5.2, -3.5);
    hullShape.lineTo(-6.2, 3.2);
    hullShape.lineTo(-3.4, 10.5);
    hullShape.closePath();

    // Octagonal central reactor bay cutout so the spinning gyro-core is exposed
    const bayHole = new THREE.Path();
    const bayRadius = 3.5;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const hx = Math.cos(angle) * bayRadius;
      const hy = Math.sin(angle) * bayRadius - 0.5;
      if (i === 0) bayHole.moveTo(hx, hy);
      else bayHole.lineTo(hx, hy);
    }
    bayHole.closePath();
    hullShape.holes.push(bayHole);

    const hullExtrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: 2.2,
      bevelEnabled: true,
      bevelThickness: 1.2,
      bevelSize: 1.0,
      bevelSegments: 2,
      curveSegments: 8,
    };

    const hullGeo = new THREE.ExtrudeGeometry(hullShape, hullExtrudeSettings);
    hullGeo.rotateX(-Math.PI / 2);
    hullGeo.translate(0, -1.1, 0);
    const hullMesh = new THREE.Mesh(hullGeo, this.darkArmorMat);
    this.fuselageGroup.add(hullMesh);

    // Forward Dorsal Cockpit Canopy Fin (Beveled Side-Profile Extrusion)
    const canopyShape = new THREE.Shape();
    canopyShape.moveTo(-17.0, 0.4); // Forward nose bridge
    canopyShape.lineTo(-7.5, 3.3); // Cockpit crown
    canopyShape.lineTo(-3.6, 2.2); // Reactor bay forward rim
    canopyShape.lineTo(-4.4, 0.2);
    canopyShape.closePath();

    const canopyGeo = new THREE.ExtrudeGeometry(canopyShape, {
      depth: 2.4,
      bevelEnabled: true,
      bevelThickness: 0.9,
      bevelSize: 0.75,
      bevelSegments: 2,
    });
    canopyGeo.rotateY(Math.PI / 2); // Map 2D x -> -z, y -> +y, depth -> x
    canopyGeo.translate(-1.2, 0.5, 0);
    const canopyMesh = new THREE.Mesh(canopyGeo, this.darkArmorMat);
    this.fuselageGroup.add(canopyMesh);

    // Exposed Spinning Inner Energy Core & Dual Gyroscope Rings (emissiveIntensity: 3.2)
    const coreGeo = new THREE.OctahedronGeometry(2.15, 1);
    this.reactorCoreMesh = new THREE.Mesh(coreGeo, this.neonCoreMat);
    this.reactorCoreMesh.position.set(0, 0.2, 0.5);
    this.fuselageGroup.add(this.reactorCoreMesh);

    const outerGyroGeo = new THREE.TorusGeometry(3.35, 0.36, 10, 28);
    this.gyroRingOuter = new THREE.Mesh(outerGyroGeo, this.neonCoreMat);
    this.gyroRingOuter.position.set(0, 0.2, 0.5);
    this.fuselageGroup.add(this.gyroRingOuter);

    const innerGyroGeo = new THREE.TorusGeometry(2.55, 0.26, 8, 24);
    this.gyroRingInner = new THREE.Mesh(innerGyroGeo, this.neonCoreMat);
    this.gyroRingInner.position.set(0, 0.2, 0.5);
    this.fuselageGroup.add(this.gyroRingInner);

    // Main Rear Thruster Nozzle & Afterburner Cone
    this.thrusterNozzleGroup.position.set(0, 0, 12.8);
    this.fuselageGroup.add(this.thrusterNozzleGroup);

    const nozzleRingGeo = new THREE.TorusGeometry(2.1, 0.42, 10, 24);
    const nozzleRingMesh = new THREE.Mesh(nozzleRingGeo, this.neonCoreMat);
    this.thrusterNozzleGroup.add(nozzleRingMesh);

    const plumeGeo = new THREE.ConeGeometry(1.75, 9.5, 16, 1, true);
    plumeGeo.rotateX(Math.PI / 2);
    plumeGeo.translate(0, 0, 4.8);
    this.thrusterPlumeMesh = new THREE.Mesh(plumeGeo, this.thrusterPlumeMat);
    this.thrusterNozzleGroup.add(this.thrusterPlumeMesh);

    // ============================================================================
    // B. DETACHED MAGNETIC WING-BLADES (Floating ±7 units left/right of central core)
    // ============================================================================
    this.gliderRoot.add(this.wingOrbitGroup);
    this.leftWingPivot.position.set(-WING_BASE_OFFSET_X, 0, 0);
    this.rightWingPivot.position.set(WING_BASE_OFFSET_X, 0, 0);
    this.wingOrbitGroup.add(this.leftWingPivot);
    this.wingOrbitGroup.add(this.rightWingPivot);

    const buildWingBlade = (side: -1 | 1): THREE.Group => {
      const wingGroup = new THREE.Group();

      // Swept-forward aerodynamic blade outer titanium shell
      const bladeShape = new THREE.Shape();
      bladeShape.moveTo(0, 5.2); // Inner forward root
      bladeShape.lineTo(side * 4.8, 11.2); // Swept-forward leading edge mid
      bladeShape.lineTo(side * 10.2, 14.5); // Forward-swept razor wingtip!
      bladeShape.lineTo(side * 11.4, 6.0); // Outer wingtip edge
      bladeShape.lineTo(side * 7.8, -8.5); // Outer aft corner
      bladeShape.lineTo(side * 2.2, -5.2); // Recessed trailing notch
      bladeShape.lineTo(0, -6.8); // Inner aft root
      bladeShape.closePath();

      const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
        depth: 1.35,
        bevelEnabled: true,
        bevelThickness: 1.2,
        bevelSize: 1.0,
        bevelSegments: 2,
      });
      bladeGeo.rotateX(-Math.PI / 2);
      bladeGeo.translate(0, -0.65, 0);
      const bladeShell = new THREE.Mesh(bladeGeo, this.darkArmorMat);
      wingGroup.add(bladeShell);

      // Recessed glowing plasma trailing edge & wingtip energy blade
      const plasmaShape = new THREE.Shape();
      plasmaShape.moveTo(side * 0.6, -5.8);
      plasmaShape.lineTo(side * 2.6, -4.4);
      plasmaShape.lineTo(side * 7.4, -7.8);
      plasmaShape.lineTo(side * 10.6, 5.2);
      plasmaShape.lineTo(side * 9.5, -10.8);
      plasmaShape.lineTo(side * 2.4, -8.2);
      plasmaShape.closePath();

      const plasmaGeo = new THREE.ExtrudeGeometry(plasmaShape, {
        depth: 0.55,
        bevelEnabled: true,
        bevelThickness: 0.45,
        bevelSize: 0.4,
        bevelSegments: 2,
      });
      plasmaGeo.rotateX(-Math.PI / 2);
      plasmaGeo.translate(0, -0.28, 0);
      const plasmaEdge = new THREE.Mesh(plasmaGeo, this.neonCoreMat);
      wingGroup.add(plasmaEdge);

      // Subtle canted aerodynamic dihedral
      wingGroup.rotation.z = side * -0.08;
      return wingGroup;
    };

    this.leftWingPivot.add(buildWingBlade(-1));
    this.rightWingPivot.add(buildWingBlade(1));

    // ============================================================================
    // C. ARTICULATED 6-SEGMENT KINETIC SPINE / TAIL (Tapering Beveled Chevrons)
    // ============================================================================
    this.tailRoot.position.set(0, -0.2, 14.5);
    this.gliderRoot.add(this.tailRoot);

    const chevronShape = new THREE.Shape();
    chevronShape.moveTo(0, 1.8); // Forward apex pointing into exhaust
    chevronShape.lineTo(3.2, -0.8); // Right chevron wing
    chevronShape.lineTo(2.2, -2.4); // Right aft tip
    chevronShape.lineTo(0, -1.0); // Rear notch
    chevronShape.lineTo(-2.2, -2.4); // Left aft tip
    chevronShape.lineTo(-3.2, -0.8); // Left chevron wing
    chevronShape.closePath();

    const chevronArmorGeo = new THREE.ExtrudeGeometry(chevronShape, {
      depth: 0.85,
      bevelEnabled: true,
      bevelThickness: 0.55,
      bevelSize: 0.45,
      bevelSegments: 2,
    });
    chevronArmorGeo.rotateX(-Math.PI / 2);
    chevronArmorGeo.translate(0, -0.42, 0);

    const chevronCoreShape = new THREE.Shape();
    chevronCoreShape.moveTo(0, 1.2);
    chevronCoreShape.lineTo(1.3, -1.2);
    chevronCoreShape.lineTo(0, -0.5);
    chevronCoreShape.lineTo(-1.3, -1.2);
    chevronCoreShape.closePath();

    const chevronCoreGeo = new THREE.ExtrudeGeometry(chevronCoreShape, {
      depth: 0.5,
      bevelEnabled: true,
      bevelThickness: 0.35,
      bevelSize: 0.3,
      bevelSegments: 2,
    });
    chevronCoreGeo.rotateX(-Math.PI / 2);
    chevronCoreGeo.translate(0, 0.35, 0);

    for (let i = 0; i < TAIL_SEGMENT_COUNT; i++) {
      const segGroup = new THREE.Group();
      const taper = 1.0 - i * 0.125; // Tapers smoothly from 1.0 down to 0.375
      segGroup.scale.setScalar(taper);

      const armorPlate = new THREE.Mesh(chevronArmorGeo, this.darkArmorMat);
      const neonNode = new THREE.Mesh(chevronCoreGeo, this.neonCoreMat);
      segGroup.add(armorPlate);
      segGroup.add(neonNode);

      this.tailRoot.add(segGroup);
      this.tailSegments.push(segGroup);
    }
  }

  public resetTrail(x: number, y: number, z: number, yaw: number): void {
    this.smoothHeadingYaw = yaw;
    this.prevViewYaw = yaw;
    this.initializedYaw = true;

    this.rollSpring.reset(0);
    this.pitchSpring.reset(0);
    this.yawCarveSpring.reset(0);
    this.bodyHeaveSpring.reset(0);
    this.wingSpreadSpring.reset(0);
    this.wingVerticalSpring.reset(0);
    this.orbitalAngleSpring.reset(0);
    this.dashSnapSpring.reset(0);
    this.orbitalAngle = 0;
    this.spineHistory = [];

    this.history = [];
    for (let i = 0; i < TRAIL_SEGMENTS; i++) {
      this.history.push({ x, y: y + 23, z: z + 10, yaw, roll: 0 });
    }
    this.updateTrailBuffer();
  }

  public update(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    viewYaw: number,
    dt: number,
    animInput?: Partial<AcrobatAnimInput>
  ): void {
    this.updateTransform(pos, vel, viewYaw, dt, animInput);
  }

  public updateTransform(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    viewYaw: number,
    dt: number,
    animInput?: Partial<AcrobatAnimInput>
  ): void {
    const safeDt = Math.min(Math.max(dt, 0.001), 0.1);
    this.simTime += safeDt;
    this.group.position.copy(pos);

    const speed = animInput?.ups ?? Math.hypot(vel.x, vel.z);
    this.lastKnownUps = speed;
    const grounded = animInput?.grounded ?? pos.y <= 0.5;
    const isSurfing = Boolean(animInput?.isSurfing);

    if (!this.initializedYaw) {
      this.prevViewYaw = viewYaw;
      this.smoothHeadingYaw = viewYaw;
      this.initializedYaw = true;
    }

    // 1. Bhop Squash & Rebound: When a jump/bhop tick is detected
    // Pre-allocate a pool of 4 flat ring meshes per rig. Whenever the player lands a bhop above 450 UPS,
    // spawn an expanding neon shockwave ring flat on the deck at their coordinates (scale: 1 -> 9, opacity: 0.9 -> 0.0 over 220ms).
    if (grounded && !this.wasGrounded) {
      this.wingSpreadSpring.impulse(140);
      this.wingVerticalSpring.impulse(-160);

      if (speed > 450) {
        this.spawnBhopShockwave(pos.x, pos.z, pos.y);
      }
    }
    this.wasGrounded = grounded;

    // 2. Air-Strafe & Surf Carving Roll:
    // Compute yawRate = shortestAngleDiff(currentYaw, prevYaw) / dt.
    // Target roll angle = clamp(-yawRate * 0.38, -0.95, 0.95) radians (±55°).
    // If surfing (isSurfing), blend roll to match the surf ramp angle.
    const yawRate = shortestAngleDiff(viewYaw, this.prevViewYaw) / safeDt;
    this.prevViewYaw = viewYaw;

    let targetRoll = THREE.MathUtils.clamp(-yawRate * 0.38, -0.95, 0.95);

    if (isSurfing) {
      const surfAngle =
        animInput?.surfRampAngle !== undefined
          ? animInput.surfRampAngle
          : animInput?.smove !== undefined && animInput.smove < 0
          ? -0.785
          : 0.785;
      targetRoll = THREE.MathUtils.lerp(targetRoll, surfAngle, 0.85);
    }

    const currentRoll = this.rollSpring.update(
      targetRoll,
      SPRING_STIFFNESS,
      SPRING_DAMPING,
      safeDt
    );

    // Smooth heading orientation for fuselage facing
    let targetHeading = viewYaw;
    if (speed > 25) {
      const velHeading = Math.atan2(-vel.x, -vel.z);
      const velDiff = shortestAngleDiff(velHeading, viewYaw);
      if (Math.abs(velDiff) < Math.PI * 0.65) {
        targetHeading =
          viewYaw + THREE.MathUtils.clamp(velDiff * 0.42, -0.42, 0.42);
      }
    }
    const headingDelta = shortestAngleDiff(targetHeading, this.smoothHeadingYaw);
    this.smoothHeadingYaw = wrapAngle(
      this.smoothHeadingYaw + headingDelta * (1 - Math.exp(-safeDt * 20))
    );
    this.group.rotation.y = this.smoothHeadingYaw;

    // 3. Pitch & Spine Wave:
    // Pitch coreGroup.rotation.x smoothly with vertical velocity (clamp(velY * 0.0012, -0.45, 0.45)).
    if (this.dashTimer > 0) {
      this.dashTimer = Math.max(0, this.dashTimer - safeDt);
    }
    const isDashing = Boolean(animInput?.isDashing) || this.dashTimer > 0;
    const dashBlend = THREE.MathUtils.clamp(
      this.dashSnapSpring.update(
        isDashing ? 1.0 : 0.0,
        SPRING_STIFFNESS,
        SPRING_DAMPING,
        safeDt
      ),
      0.0,
      1.2
    );

    const speedNorm = Math.min(1.5, speed / 420);
    const targetPitch = THREE.MathUtils.clamp(vel.y * 0.0012, -0.45, 0.45);
    const currentPitch = this.pitchSpring.update(
      targetPitch - dashBlend * 0.1,
      SPRING_STIFFNESS,
      SPRING_DAMPING,
      safeDt
    );

    const hoverBob = Math.sin(this.simTime * 5.5) * 0.55;
    const heaveOffset = this.bodyHeaveSpring.update(
      hoverBob,
      SPRING_STIFFNESS,
      SPRING_DAMPING,
      safeDt
    );

    // Apply Central Fuselage & Core Group Pose
    this.gliderRoot.position.y = 24.0 + heaveOffset;
    this.coreGroup.rotation.x = currentPitch;
    this.coreGroup.rotation.z = currentRoll;
    this.coreGroup.rotation.y = THREE.MathUtils.clamp(
      -yawRate * 0.015,
      -0.22,
      0.22
    );

    // 4. Asymmetric Magnetic Wing Flare, Bhop Squash & Rebound, Double-Jump Vortex & Conc Dash Delta-Snap
    const wingSpread = this.wingSpreadSpring.update(
      0,
      SPRING_STIFFNESS,
      SPRING_DAMPING,
      safeDt
    );
    const wingVert = this.wingVerticalSpring.update(
      0,
      SPRING_STIFFNESS,
      SPRING_DAMPING,
      safeDt
    );
    const currentOrbitalAngle = this.orbitalAngleSpring.update(
      this.orbitalAngle,
      SPRING_STIFFNESS,
      SPRING_DAMPING,
      safeDt
    );

    this.wingOrbitGroup.rotation.z = currentRoll + currentOrbitalAngle;
    this.wingOrbitGroup.rotation.x = currentPitch;

    // Conc Dash: pull the wings inward (±4.2u) into a tight delta-dart formation
    const baseWingX = THREE.MathUtils.lerp(WING_BASE_OFFSET_X, 4.2, dashBlend);
    const dashSweepZ = dashBlend * 3.8;

    // Asymmetric Magnetic Wing Flare:
    // When banking left (roll > 0), dip leftWing.position.y down/inward and flare rightWing.position.y upward/outward,
    // plus angle wing pitch like active air-ailerons.
    const rollNorm = THREE.MathUtils.clamp(currentRoll / 0.95, -1.0, 1.0);
    const rollInwardOutward = rollNorm * 1.6;

    const leftWingX = -(baseWingX + wingSpread * 0.035 - rollInwardOutward);
    const leftWingY = -rollNorm * 4.2 + wingVert * 0.035;

    const rightWingX = +(baseWingX + wingSpread * 0.035 + rollInwardOutward);
    const rightWingY = +rollNorm * 4.2 + wingVert * 0.035;

    this.leftWing.position.set(leftWingX, leftWingY, dashSweepZ);
    this.rightWing.position.set(rightWingX, rightWingY, dashSweepZ);

    // Active air-aileron wing pitch angle
    this.leftWing.rotation.x = -currentRoll * 0.35;
    this.rightWing.rotation.x = currentRoll * 0.35;
    this.leftWing.rotation.z = -currentRoll * 0.25;
    this.rightWing.rotation.z = -currentRoll * 0.25;
    this.leftWing.rotation.y = dashBlend * 0.28;
    this.rightWing.rotation.y = -dashBlend * 0.28;

    // Gyroscope Reactor Spin
    const spinSpeed = 3.2 + speed * 0.018 + dashBlend * 12.0;
    this.gyroRingOuter.rotation.x += safeDt * spinSpeed;
    this.gyroRingOuter.rotation.y += safeDt * spinSpeed * 0.65;
    this.gyroRingInner.rotation.y -= safeDt * spinSpeed * 1.35;
    this.gyroRingInner.rotation.z += safeDt * spinSpeed * 0.85;
    this.reactorCoreMesh.rotation.y += safeDt * spinSpeed * 0.9;
    this.reactorCoreMesh.rotation.x -= safeDt * spinSpeed * 0.5;

    // Rear thruster flare for 300ms on Conc Dash
    const thrusterFlare = this.dashTimer > 0 ? this.dashTimer / 0.30 : 0;
    const flareFactor = Math.max(dashBlend, thrusterFlare);
    const plumeScaleZ = 0.75 + speedNorm * 0.85 + flareFactor * 2.6;
    const plumeScaleXY = 0.85 + speedNorm * 0.25 + flareFactor * 0.8;
    this.thrusterPlumeMesh.scale.set(plumeScaleXY, plumeScaleXY, plumeScaleZ);
    this.thrusterNozzleGroup.scale.setScalar(1.0 + flareFactor * 0.4);
    this.thrusterPlumeMat.opacity = THREE.MathUtils.clamp(
      0.55 + speedNorm * 0.25 + flareFactor * 0.45,
      0.45,
      1.0
    );

    // 5. Spine Wave: Propagate pitch and yaw history down the 6 tailSegments with a 25ms phase offset per segment
    // so the tail carves fluid S-waves in the air.
    this.spineHistory.unshift({
      time: this.simTime,
      pitch: currentPitch,
      yaw: this.smoothHeadingYaw,
      yawRate,
      roll: currentRoll,
      heave: heaveOffset,
    });
    while (
      this.spineHistory.length > 50 &&
      this.simTime - this.spineHistory[this.spineHistory.length - 1].time > 0.4
    ) {
      this.spineHistory.pop();
    }

    this.tailRoot.rotation.z = currentRoll * 0.85;
    for (let i = 0; i < TAIL_SEGMENT_COUNT; i++) {
      const targetSampleTime = this.simTime - (i + 1) * TAIL_PHASE_DELAY_SEC;
      const delayedPose = this.sampleDelayedSpinePose(targetSampleTime);
      const seg = this.tailSegments[i];

      const whipAmp = 1.0 + i * 0.22;
      const flutter =
        Math.sin(this.simTime * (12 + speed * 0.02) - i * 0.85) *
        0.18 *
        Math.min(1.4, speed / 350);

      const segZ = i * 3.15;
      const segY =
        -delayedPose.pitch * (i + 1) * 1.65 +
        (delayedPose.heave - heaveOffset) * 0.45 +
        flutter;
      const yawOffset = shortestAngleDiff(delayedPose.yaw, this.smoothHeadingYaw);
      const segX =
        yawOffset * (i + 1) * 12.0 +
        THREE.MathUtils.clamp(delayedPose.yawRate * 0.14, -1.8, 1.8) *
          (i + 1) *
          0.85;

      seg.position.set(segX, segY, segZ);
      seg.rotation.x = -delayedPose.pitch * 0.75 * whipAmp + flutter * 0.12;
      seg.rotation.y = THREE.MathUtils.clamp(
        yawOffset * 0.75 - delayedPose.yawRate * 0.035 * whipAmp,
        -0.65,
        0.65
      );
      seg.rotation.z = (delayedPose.roll - currentRoll) * 0.65;
    }

    // 6. Wing-Tip Plasma Wake Ribbon Trail (44 segments)
    if (this.history.length === 0) {
      this.resetTrail(pos.x, pos.y, pos.z, this.smoothHeadingYaw);
    } else {
      const aftOffsetX = Math.sin(this.smoothHeadingYaw) * 10;
      const aftOffsetZ = Math.cos(this.smoothHeadingYaw) * 10;
      this.history.unshift({
        x: pos.x + aftOffsetX,
        y: pos.y + 23.5 + heaveOffset * 0.5,
        z: pos.z + aftOffsetZ,
        yaw: this.smoothHeadingYaw,
        roll: currentRoll,
      });
      if (this.history.length > TRAIL_SEGMENTS) {
        this.history.pop();
      }
      this.updateTrailBuffer();
    }

    // 7. Step Pool of 4 Flat Bhop Shockwave Rings (scale: 1 -> 9, opacity: 0.9 -> 0.0 over 220ms)
    for (const slot of this.shockwavePool) {
      if (!slot.active) continue;
      slot.elapsed += safeDt;
      const t = slot.elapsed / SHOCKWAVE_DURATION_SEC;
      if (t >= 1.0) {
        slot.active = false;
        slot.mesh.visible = false;
        slot.material.opacity = 0;
      } else {
        const scale = 1.0 + (9.0 - 1.0) * t;
        slot.mesh.scale.set(scale, scale, scale);
        slot.material.opacity = (1.0 - t) * 0.9;
      }
    }
  }

  private sampleDelayedSpinePose(targetTime: number): SpinePoseSample {
    if (this.spineHistory.length === 0) {
      return { time: targetTime, pitch: 0, yaw: 0, yawRate: 0, roll: 0, heave: 0 };
    }
    for (let i = 0; i < this.spineHistory.length - 1; i++) {
      const newer = this.spineHistory[i];
      const older = this.spineHistory[i + 1];
      if (targetTime >= older.time && targetTime <= newer.time) {
        const span = Math.max(0.0001, newer.time - older.time);
        const alpha = (targetTime - older.time) / span;
        const yawDiff = shortestAngleDiff(newer.yaw, older.yaw);
        return {
          time: targetTime,
          pitch: THREE.MathUtils.lerp(older.pitch, newer.pitch, alpha),
          yaw: wrapAngle(older.yaw + yawDiff * alpha),
          yawRate: THREE.MathUtils.lerp(older.yawRate, newer.yawRate, alpha),
          roll: THREE.MathUtils.lerp(older.roll, newer.roll, alpha),
          heave: THREE.MathUtils.lerp(older.heave, newer.heave, alpha),
        };
      }
    }
    return this.spineHistory[this.spineHistory.length - 1];
  }

  private updateTrailBuffer(): void {
    for (let i = 0; i < TRAIL_SEGMENTS; i++) {
      const sample = this.history[Math.min(i, this.history.length - 1)];
      const fade = 1 - i / (TRAIL_SEGMENTS - 1);
      const halfW = TRAIL_HALF_WIDTH * (0.35 + 0.65 * fade);
      const cosRoll = Math.cos(sample.roll);
      const sinRoll = Math.sin(sample.roll);
      const rx = Math.cos(sample.yaw) * halfW * cosRoll;
      const ry = sinRoll * halfW;
      const rz = -Math.sin(sample.yaw) * halfW * cosRoll;

      const idx = i * 6;
      this.trailPositions[idx] = sample.x - rx;
      this.trailPositions[idx + 1] = sample.y - ry;
      this.trailPositions[idx + 2] = sample.z - rz;

      this.trailPositions[idx + 3] = sample.x + rx;
      this.trailPositions[idx + 4] = sample.y + ry;
      this.trailPositions[idx + 5] = sample.z + rz;
    }
    this.trailGeometry.attributes.position.needsUpdate = true;
    this.trailGeometry.computeBoundingSphere();
  }
}
