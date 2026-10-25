import * as THREE from 'three';

const TRAIL_SEGMENTS = 44;
const TRAIL_HALF_WIDTH = 7;

export interface AcrobatAnimInput {
  grounded: boolean;
  ups: number;
  vel: THREE.Vector3;
  viewYaw: number;
  smove: number; // < 0 for A (left), > 0 for D (right)
  fmove: number;
  isDashing: boolean;
}

export class PlayerRig {
  public readonly group = new THREE.Group();

  // Articulated Digital Cyber-Acrobat Skeleton Hierarchy
  private characterRoot = new THREE.Group();
  private pelvis = new THREE.Group();
  private spine = new THREE.Group();
  private headGroup = new THREE.Group();
  private scarfLeft = new THREE.Group();
  private scarfRight = new THREE.Group();

  private leftShoulder = new THREE.Group();
  private leftElbow = new THREE.Group();
  private rightShoulder = new THREE.Group();
  private rightElbow = new THREE.Group();

  private leftHip = new THREE.Group();
  private leftKnee = new THREE.Group();
  private rightHip = new THREE.Group();
  private rightKnee = new THREE.Group();

  // Procedural Animation State
  private runCycle = 0;
  private smoothLeanX = 0; // Forward/back pitch lean
  private smoothLeanZ = 0; // Lateral strafe bank
  private smoothTwistY = 0; // Torso counter-yaw into strafe
  private landingSquash = 0; // Knee compression spring on landing/jump
  private flipAngle = 0; // 360-degree aerial somersault on double jump
  private dashPulse = 0; // Boost pose blend
  private wasGrounded = true;
  private smoothHeadingYaw = 0;

  // Dual Ribbon Trails (from shoulders/scarf)
  private trailGeometry: THREE.BufferGeometry;
  private trailPositions: Float32Array;
  private trailMesh: THREE.Mesh;
  private history: Array<{ x: number; y: number; z: number; yaw: number }> = [];

  constructor(colorHex: number = 0x00f3ff) {
    this.buildCyberAcrobat(colorHex);
    this.group.add(this.characterRoot);

    // Build BufferGeometry ring buffer ribbon trail
    this.trailGeometry = new THREE.BufferGeometry();
    this.trailPositions = new Float32Array(TRAIL_SEGMENTS * 2 * 3);
    this.trailGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.trailPositions, 3)
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

    const trailMat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.48,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.trailMesh = new THREE.Mesh(this.trailGeometry, trailMat);
    this.trailMesh.frustumCulled = false;
  }

  public attachToScene(scene: THREE.Scene): void {
    scene.add(this.group);
    scene.add(this.trailMesh);
  }

  public detachFromScene(scene: THREE.Scene): void {
    scene.remove(this.group);
    scene.remove(this.trailMesh);
    this.trailGeometry.dispose();
  }

  /**
   * Triggers a crisp acrobatic impulse animation on jump, double-jump, or conc-dash
   */
  public triggerJumpAnim(isDoubleJump: boolean): void {
    this.landingSquash = 0.65;
    if (isDoubleJump) {
      this.flipAngle = Math.PI * 2; // Full 360° aerial front-tuck flip
    }
  }

  public triggerDashAnim(): void {
    this.dashPulse = 1.0;
  }

  private buildCyberAcrobat(colorHex: number): void {
    const darkArmorMat = new THREE.MeshStandardMaterial({
      color: 0x0b1328,
      roughness: 0.25,
      metalness: 0.85,
      emissive: colorHex,
      emissiveIntensity: 0.22,
    });

    const neonCoreMat = new THREE.MeshStandardMaterial({
      color: colorHex,
      emissive: colorHex,
      emissiveIntensity: 1.35,
      roughness: 0.15,
      metalness: 0.5,
    });

    const visorMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
    });

    const makeLimb = (
      w: number,
      h: number,
      d: number,
      yOffset: number,
      isNeon = false
    ): THREE.Mesh => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geo, isNeon ? neonCoreMat : darkArmorMat);
      mesh.position.y = yOffset;

      const edgeGeo = new THREE.EdgesGeometry(geo);
      const edgeMat = new THREE.LineBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.65,
      });
      mesh.add(new THREE.LineSegments(edgeGeo, edgeMat));
      return mesh;
    };

    // 1. Pelvis (Root at hip height y = 26)
    this.pelvis.position.set(0, 26, 0);
    this.characterRoot.add(this.pelvis);
    const pelvisMesh = makeLimb(9, 4.5, 6, 0);
    this.pelvis.add(pelvisMesh);

    // 2. Spine & Athletic Torso
    this.spine.position.set(0, 2.5, 0);
    this.pelvis.add(this.spine);

    const abdomenMesh = makeLimb(8, 6, 5.5, 3.5);
    this.spine.add(abdomenMesh);

    const chestMesh = makeLimb(11.5, 8.5, 7, 10.5);
    this.spine.add(chestMesh);

    // Glowing Cyber Spine & Core Reactor
    const spineCore = makeLimb(3.2, 11, 7.6, 8.5, true);
    this.spine.add(spineCore);

    // 3. Head & Sleek Aero Helmet + Visor + Energy Scarf
    this.headGroup.position.set(0, 16.5, 0);
    this.spine.add(this.headGroup);

    const helmetGeo = new THREE.OctahedronGeometry(4.6, 1);
    helmetGeo.scale(0.88, 1.05, 1.25);
    const helmetMesh = new THREE.Mesh(helmetGeo, darkArmorMat);
    helmetMesh.position.y = 3.2;
    this.headGroup.add(helmetMesh);

    const visorGeo = new THREE.BoxGeometry(6.8, 1.8, 5.2);
    const visorMesh = new THREE.Mesh(visorGeo, visorMat);
    visorMesh.position.set(0, 3.5, -2.2);
    this.headGroup.add(visorMesh);

    // Dual kinetic light-scarf tails flowing behind the acrobat's neck
    this.scarfLeft.position.set(-2.5, 14.5, 3.2);
    this.scarfRight.position.set(2.5, 14.5, 3.2);
    this.spine.add(this.scarfLeft);
    this.spine.add(this.scarfRight);

    const tailGeo = new THREE.BoxGeometry(1.8, 1.2, 16);
    const tailL = new THREE.Mesh(tailGeo, neonCoreMat);
    tailL.position.set(0, 0, 8);
    this.scarfLeft.add(tailL);

    const tailR = new THREE.Mesh(tailGeo, neonCoreMat);
    tailR.position.set(0, 0, 8);
    this.scarfRight.add(tailR);

    // 4. Left & Right Articulated Arms (Shoulder -> Upper Arm -> Elbow -> Forearm)
    this.leftShoulder.position.set(-7.2, 13.5, 0);
    this.rightShoulder.position.set(7.2, 13.5, 0);
    this.spine.add(this.leftShoulder);
    this.spine.add(this.rightShoulder);

    this.leftShoulder.add(makeLimb(3.2, 8.5, 3.2, -4.2));
    this.rightShoulder.add(makeLimb(3.2, 8.5, 3.2, -4.2));

    this.leftElbow.position.set(0, -8.5, 0);
    this.rightElbow.position.set(0, -8.5, 0);
    this.leftShoulder.add(this.leftElbow);
    this.rightShoulder.add(this.rightElbow);

    this.leftElbow.add(makeLimb(2.8, 8.5, 2.8, -4.2, true));
    this.rightElbow.add(makeLimb(2.8, 8.5, 2.8, -4.2, true));

    // 5. Left & Right Articulated Legs (Hip -> Thigh -> Knee -> Shin + Cyber-Skates)
    this.leftHip.position.set(-3.4, -1.5, 0);
    this.rightHip.position.set(3.4, -1.5, 0);
    this.pelvis.add(this.leftHip);
    this.pelvis.add(this.rightHip);

    this.leftHip.add(makeLimb(4.0, 11.5, 4.2, -5.75));
    this.rightHip.add(makeLimb(4.0, 11.5, 4.2, -5.75));

    this.leftKnee.position.set(0, -11.5, 0);
    this.rightKnee.position.set(0, -11.5, 0);
    this.leftHip.add(this.leftKnee);
    this.rightHip.add(this.rightKnee);

    this.leftKnee.add(makeLimb(3.2, 12.0, 3.4, -6.0));
    this.rightKnee.add(makeLimb(3.2, 12.0, 3.4, -6.0));

    // Glowing Cyber-Blade Feet (Parkour / Skate Runners)
    const bladeL = makeLimb(3.4, 2.2, 8.5, -12.2, true);
    bladeL.position.z = -1.8;
    this.leftKnee.add(bladeL);

    const bladeR = makeLimb(3.4, 2.2, 8.5, -12.2, true);
    bladeR.position.z = -1.8;
    this.rightKnee.add(bladeR);
  }

  public resetTrail(x: number, y: number, z: number, yaw: number): void {
    this.smoothHeadingYaw = yaw;
    this.history = [];
    for (let i = 0; i < TRAIL_SEGMENTS; i++) {
      this.history.push({ x, y: y + 24, z, yaw });
    }
    this.updateTrailBuffer();
  }

  public updateTransform(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    viewYaw: number,
    dt: number,
    animInput?: Partial<AcrobatAnimInput>
  ): void {
    this.group.position.copy(pos);

    const speed = Math.hypot(vel.x, vel.z);
    const grounded = animInput?.grounded ?? pos.y <= 0.5;
    const smove = animInput?.smove ?? 0;

    // Detect landing transition for squash-and-spring knee absorption
    if (grounded && !this.wasGrounded) {
      this.landingSquash = Math.min(1.0, 0.45 + speed / 1200);
    }
    this.wasGrounded = grounded;

    // Smoothly orient character toward velocity vector when moving, or viewYaw at rest
    let targetHeading = viewYaw;
    if (speed > 25) {
      targetHeading = Math.atan2(-vel.x, -vel.z);
    }
    let yawDiff = targetHeading - this.smoothHeadingYaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    this.smoothHeadingYaw += yawDiff * Math.min(1, dt * 18);
    this.group.rotation.y = this.smoothHeadingYaw;

    // Compute strafe turn delta for athletic body banking
    let lookDiff = viewYaw - this.smoothHeadingYaw;
    while (lookDiff > Math.PI) lookDiff -= Math.PI * 2;
    while (lookDiff < -Math.PI) lookDiff += Math.PI * 2;

    const strafeInputSign = smove < 0 ? 1 : smove > 0 ? -1 : 0;
    const targetBankZ = THREE.MathUtils.clamp(
      lookDiff * 0.85 + strafeInputSign * 0.24,
      -0.52,
      0.52
    );
    const speedRatio = Math.min(1.6, speed / 320);
    const targetLeanX = grounded
      ? -0.18 * speedRatio - this.landingSquash * 0.22
      : THREE.MathUtils.clamp(vel.y * 0.0012 - 0.16, -0.45, 0.35);
    const targetTwistY = THREE.MathUtils.clamp(
      lookDiff * 0.55 + strafeInputSign * 0.28,
      -0.6,
      0.6
    );

    const blend = Math.min(1, dt * 16);
    this.smoothLeanX += (targetLeanX - this.smoothLeanX) * blend;
    this.smoothLeanZ += (targetBankZ - this.smoothLeanZ) * blend;
    this.smoothTwistY += (targetTwistY - this.smoothTwistY) * blend;
    this.landingSquash = Math.max(0, this.landingSquash - dt * 4.2);
    this.dashPulse = Math.max(0, this.dashPulse - dt * 3.0);

    if (this.flipAngle > 0) {
      this.flipAngle = Math.max(0, this.flipAngle - dt * 13.5);
    }

    // Apply root & spine posture
    const squashDrop = this.landingSquash * 5.5;
    this.pelvis.position.y = 25.5 - squashDrop;
    this.pelvis.rotation.z = this.smoothLeanZ;
    this.pelvis.rotation.x =
      this.smoothLeanX - (this.flipAngle > 0 ? this.flipAngle : 0);

    this.spine.rotation.y = this.smoothTwistY;
    this.spine.rotation.x = -0.12 * speedRatio - this.dashPulse * 0.45;
    this.headGroup.rotation.y = this.smoothTwistY * 0.65;
    this.headGroup.rotation.x = -this.smoothLeanX * 0.5;

    // Animate kinetic energy scarf flowing in the wind behind the runner
    const time = performance.now() * 0.01;
    const scarfPitch = 0.25 + Math.min(0.95, speed / 520);
    this.scarfLeft.rotation.x = scarfPitch + Math.sin(time + 0.5) * 0.14;
    this.scarfRight.rotation.x = scarfPitch + Math.cos(time) * 0.14;
    this.scarfLeft.rotation.y = -this.smoothTwistY * 0.5;
    this.scarfRight.rotation.y = -this.smoothTwistY * 0.5;

    if (grounded) {
      // Fluid Sprint / Parkour Run Cycle driven by actual speed
      if (speed > 15) {
        this.runCycle += dt * (6.5 + speed * 0.026);
        const s = Math.sin(this.runCycle);
        const c = Math.cos(this.runCycle);
        const amp = Math.min(1.25, speed / 290);

        // Pelvis vertical bounce & counter-sway
        this.pelvis.position.y += Math.abs(s) * 2.2 * amp;

        // Legs pump with high knee-drive & reactive shin flexion
        this.leftHip.rotation.x = s * 0.92 * amp - this.landingSquash * 0.5;
        this.leftKnee.rotation.x =
          -Math.max(0.15, -c * 0.95 * amp + 0.35) - this.landingSquash * 0.85;

        this.rightHip.rotation.x = -s * 0.92 * amp - this.landingSquash * 0.5;
        this.rightKnee.rotation.x =
          -Math.max(0.15, c * 0.95 * amp + 0.35) - this.landingSquash * 0.85;

        // Opposite Arms pump athletically
        this.leftShoulder.rotation.x = -s * 0.82 * amp;
        this.leftShoulder.rotation.z = 0.18;
        this.leftElbow.rotation.x = 0.65 + Math.max(0, -s) * 0.55;

        this.rightShoulder.rotation.x = s * 0.82 * amp;
        this.rightShoulder.rotation.z = -0.18;
        this.rightElbow.rotation.x = 0.65 + Math.max(0, s) * 0.55;
      } else {
        // Athletic Parkour Idle Ready Stance
        const breathe = Math.sin(time * 0.35) * 0.06;
        this.leftHip.rotation.x = 0.22 + breathe;
        this.leftKnee.rotation.x = -0.42;
        this.rightHip.rotation.x = -0.18 + breathe;
        this.rightKnee.rotation.x = -0.35;

        this.leftShoulder.rotation.x = -0.15 + breathe;
        this.leftShoulder.rotation.z = 0.22;
        this.leftElbow.rotation.x = 0.55;

        this.rightShoulder.rotation.x = 0.15 - breathe;
        this.rightShoulder.rotation.z = -0.22;
        this.rightElbow.rotation.x = 0.55;
      }
    } else {
      // Mid-Air Acrobatic Carving / Vault / Strafe Pose!
      // Lead knee tucks high while trailing leg extends dynamically like a cyber-skater / parkour air-strafer
      const airBlend = Math.min(1, dt * 14);
      const strafeLeft = smove < 0 || (smove === 0 && lookDiff > 0);

      const leadHipTarget = 0.85 + this.dashPulse * 0.35;
      const leadKneeTarget = -1.25;
      const trailHipTarget = -0.58 - this.dashPulse * 0.45;
      const trailKneeTarget = -0.38;

      if (strafeLeft) {
        this.leftHip.rotation.x += (leadHipTarget - this.leftHip.rotation.x) * airBlend;
        this.leftKnee.rotation.x += (leadKneeTarget - this.leftKnee.rotation.x) * airBlend;
        this.rightHip.rotation.x += (trailHipTarget - this.rightHip.rotation.x) * airBlend;
        this.rightKnee.rotation.x += (trailKneeTarget - this.rightKnee.rotation.x) * airBlend;

        // Outstretched balance arms during air-strafe carve
        this.leftShoulder.rotation.x += (-0.55 - this.leftShoulder.rotation.x) * airBlend;
        this.leftShoulder.rotation.z += (0.68 - this.leftShoulder.rotation.z) * airBlend;
        this.leftElbow.rotation.x += (0.45 - this.leftElbow.rotation.x) * airBlend;

        this.rightShoulder.rotation.x += (0.48 - this.rightShoulder.rotation.x) * airBlend;
        this.rightShoulder.rotation.z += (-0.58 - this.rightShoulder.rotation.z) * airBlend;
        this.rightElbow.rotation.x += (0.85 - this.rightElbow.rotation.x) * airBlend;
      } else {
        this.rightHip.rotation.x += (leadHipTarget - this.rightHip.rotation.x) * airBlend;
        this.rightKnee.rotation.x += (leadKneeTarget - this.rightKnee.rotation.x) * airBlend;
        this.leftHip.rotation.x += (trailHipTarget - this.leftHip.rotation.x) * airBlend;
        this.leftKnee.rotation.x += (trailKneeTarget - this.leftKnee.rotation.x) * airBlend;

        this.rightShoulder.rotation.x += (-0.55 - this.rightShoulder.rotation.x) * airBlend;
        this.rightShoulder.rotation.z += (-0.68 - this.rightShoulder.rotation.z) * airBlend;
        this.rightElbow.rotation.x += (0.45 - this.rightElbow.rotation.x) * airBlend;

        this.leftShoulder.rotation.x += (0.48 - this.leftShoulder.rotation.x) * airBlend;
        this.leftShoulder.rotation.z += (0.58 - this.leftShoulder.rotation.z) * airBlend;
        this.leftElbow.rotation.x += (0.85 - this.leftElbow.rotation.x) * airBlend;
      }
    }

    // Update ribbon trail from upper back
    if (this.history.length === 0) {
      this.resetTrail(pos.x, pos.y, pos.z, this.smoothHeadingYaw);
    } else {
      this.history.unshift({
        x: pos.x,
        y: pos.y + 24,
        z: pos.z + 6,
        yaw: this.smoothHeadingYaw,
      });
      if (this.history.length > TRAIL_SEGMENTS) {
        this.history.pop();
      }
      this.updateTrailBuffer();
    }
  }

  private updateTrailBuffer(): void {
    for (let i = 0; i < TRAIL_SEGMENTS; i++) {
      const sample = this.history[Math.min(i, this.history.length - 1)];
      const fade = 1 - i / TRAIL_SEGMENTS;
      const halfW = TRAIL_HALF_WIDTH * fade;
      const rx = Math.cos(sample.yaw) * halfW;
      const rz = -Math.sin(sample.yaw) * halfW;

      const idx = i * 6;
      this.trailPositions[idx] = sample.x - rx;
      this.trailPositions[idx + 1] = sample.y;
      this.trailPositions[idx + 2] = sample.z - rz;

      this.trailPositions[idx + 3] = sample.x + rx;
      this.trailPositions[idx + 4] = sample.y;
      this.trailPositions[idx + 5] = sample.z + rz;
    }
    this.trailGeometry.attributes.position.needsUpdate = true;
    this.trailGeometry.computeBoundingSphere();
  }
}
