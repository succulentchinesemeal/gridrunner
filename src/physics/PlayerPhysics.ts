import * as THREE from 'three';
import { DEFAULT_GOLDSRC_STATS, PerkManager, PlayerStats } from './PerkManager';

export const GOLDSRC_TICK_RATE = 100;
export const GOLDSRC_DT = 1 / GOLDSRC_TICK_RATE; // 0.01s (100Hz CS 1.6 tickrate)

export interface MoveCmd {
  /** Forward move: +320 for W, -320 for S, 0 otherwise */
  fmove: number;
  /** Side move: -320 for A (left), +320 for D (right), 0 otherwise */
  smove: number;
  /** Camera yaw in radians (0 = facing -Z, + = turning left/CCW, - = turning right/CW) */
  viewYaw: number;
  /** True while Space or Mobile Jump is held down */
  jumpHeld: boolean;
  /** True on a fresh Space / Jump button press edge (for mid-air double jump) */
  jumpEdge: boolean;
  /** True when Shift / Right-Click / Dash button triggered */
  dashPressed: boolean;
}

export interface SurfRampCollider {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  normal: { x: number; y: number; z: number }; // Unit normal pointing out of the sloped face
  planeConstant: number; // d = normal.x * px + normal.y * py + normal.z * pz for a point p on the ramp plane
  forwardBoost?: number; // Optional bonus forward UPS when actively surfing this ramp
}

export interface AABBBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  isPlatform?: boolean;
  lethal?: boolean;
}

export interface PlayerCollider {
  id?: string;
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  radius?: number;
  height?: number;
  alive?: boolean;
}

export interface CollisionResult {
  hitHazard: boolean;
  groundedOnObstacle: boolean;
  supportY: number;
  hitBoostPad?: boolean;
  boostUps?: number;
}

export interface CollisionWorld {
  /** Returns the floor height at (x, z), or -Infinity if over a KZ chasm gap */
  getFloorHeight(x: number, z: number): number;
  /** Checks AABB/cylinder collision with pillars, moving beams, and laser hurdles */
  resolveCollisions(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    radius: number,
    height: number
  ): CollisionResult;
  /** Optional surf ramp colliders in the world */
  getSurfRamps?(x?: number, z?: number): SurfRampCollider[];
  surfRamps?: SurfRampCollider[];
  /** Optional AABB obstacle/platform boxes in the world */
  getBoxes?(x?: number, z?: number): AABBBox[];
  boxes?: AABBBox[];
}

/**
 * Exact GoldSrc PM_ClipVelocity from Half-Life 1 / CS 1.6 pm_shared.c
 * Projects velocity along the surface plane normal with overbounce = 1.0:
 * backoff = dot(velocity, normal) * overbounce; velocity -= normal * backoff
 */
export function PM_ClipVelocity(
  vel: THREE.Vector3,
  normal: { x: number; y: number; z: number },
  overbounce: number = 1.0
): void {
  const backoff =
    (vel.x * normal.x + vel.y * normal.y + vel.z * normal.z) * overbounce;
  vel.x -= normal.x * backoff;
  vel.y -= normal.y * backoff;
  vel.z -= normal.z * backoff;
}

/**
 * Exact GoldSrc PM_AirAccelerate from Half-Life 1 / CS 1.6 pm_shared.c
 */
export function PM_AirAccelerate(
  vel: THREE.Vector3,
  wishdir: THREE.Vector3,
  wishspeed: number,
  accel: number,
  dt: number,
  airWishCap: number = 30
): void {
  // GoldSrc caps wishspd at 30 ONLY for the dot-product projection check!
  const wishspd = Math.min(wishspeed, airWishCap);
  // Project current horizontal velocity onto wishdir
  const currentspeed = vel.x * wishdir.x + vel.z * wishdir.z;
  const addspeed = wishspd - currentspeed;
  if (addspeed <= 0) return;

  // CRITICAL GOLDSRC QUIRK: Accel speed uses the UNCAPPED wishspeed (320), NOT wishspd (30)!
  let accelspeed = accel * wishspeed * dt;
  if (accelspeed > addspeed) {
    accelspeed = addspeed;
  }

  vel.x += accelspeed * wishdir.x;
  vel.z += accelspeed * wishdir.z;
}

/**
 * Exact GoldSrc PM_Accelerate for ground movement
 */
export function PM_Accelerate(
  vel: THREE.Vector3,
  wishdir: THREE.Vector3,
  wishspeed: number,
  accel: number,
  dt: number
): void {
  const currentspeed = vel.x * wishdir.x + vel.z * wishdir.z;
  const addspeed = wishspeed - currentspeed;
  if (addspeed <= 0) return;

  let accelspeed = accel * wishspeed * dt;
  if (accelspeed > addspeed) {
    accelspeed = addspeed;
  }

  vel.x += accelspeed * wishdir.x;
  vel.z += accelspeed * wishdir.z;
}

/**
 * Exact GoldSrc PM_Friction for ground movement
 */
export function PM_Friction(
  vel: THREE.Vector3,
  friction: number,
  stopspeed: number,
  dt: number
): void {
  const speed = Math.hypot(vel.x, vel.z);
  if (speed < 0.1) {
    vel.x = 0;
    vel.z = 0;
    return;
  }

  const control = speed < stopspeed ? stopspeed : speed;
  const drop = control * friction * dt;

  let newspeed = speed - drop;
  if (newspeed < 0) newspeed = 0;
  newspeed /= speed;

  vel.x *= newspeed;
  vel.z *= newspeed;
}

export interface PhysicsCallbacks {
  onJump?: (ups: number, isBhop: boolean, isDoubleJump: boolean) => void;
  onDash?: (ups: number) => void;
  onBoost?: (ups: number) => void;
  onHazardHit?: () => void;
  onPlayerBump?: (relSpeed: number) => void;
}

export class PlayerPhysics {
  public pos = new THREE.Vector3(0, 0, 0);
  public prevPos = new THREE.Vector3(0, 0, 0);
  public vel = new THREE.Vector3(0, 0, 0);
  public viewYaw = 0;
  public prevViewYaw = 0;
  public grounded = true;
  public alive = true;

  /** Whether strict solid platform and player collisions are enabled (Skill / Competitive element) */
  public strictCollisions = false;

  /** Scroll-wheel +jump buffer in ticks (3 ticks = 30ms window) */
  public jumpBufferTicks = 0;
  /** Remaining mid-air double jumps */
  public remainingAirJumps = 1;
  /** Remaining cooldown on Impulse Dash in seconds */
  public dashCooldownTimer = 0;
  /** Number of consecutive bunny-hops without losing grounded momentum */
  public bhopChain = 0;
  /** Friction grace window (in seconds) after hitting a boost pad so ground friction doesn't immediately kill speed */
  public boostGraceTimer = 0;

  /** Strafe Sync percentage (0..100) */
  public strafeSync = 0;
  private syncSamples: number[] = [];

  /** Peak horizontal UPS achieved during the current run */
  public topUps = 0;

  /** Smooth Z-axis camera roll in degrees (GoldSrc cl_rollangle = 2.5 deg) */
  public rollAngleDeg = 0;

  public readonly playerRadius = 16;
  public readonly playerHeight = 56;

  /** Active surf ramp colliders in the world */
  public surfRamps: SurfRampCollider[] = [];
  /** Whether the player is currently surfing on a steep ramp */
  public isSurfing = false;
  /** Current surf plane normal */
  public surfNormal: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 };
  /** Angle of the active surf ramp in radians */
  public get surfRampAngle(): number {
    if (!this.isSurfing) return 0;
    return Math.atan2(-this.surfNormal.x, this.surfNormal.y);
  }
  /** Active AABB obstacle/platform boxes */
  public boxes: AABBBox[] = [];
  private hasRampJumped = false;
  private surfTicks = 0;
  private surfCoyoteTicks = 0;

  public get isGrounded(): boolean {
    return this.grounded;
  }
  public set isGrounded(val: boolean) {
    this.grounded = val;
  }

  private accumulator = 0;
  private perkManager: PerkManager;
  private callbacks: PhysicsCallbacks;

  constructor(
    perkManager: PerkManager = new PerkManager(DEFAULT_GOLDSRC_STATS),
    callbacks: PhysicsCallbacks = {}
  ) {
    this.perkManager = perkManager;
    this.callbacks = callbacks;
    this.reset(0, 0, 0);
  }

  public get stats(): PlayerStats {
    return this.perkManager.computeStats();
  }

  public get ups(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  public get distance(): number {
    return Math.max(0, -this.pos.z);
  }

  public reset(x = 0, y = 0, z = 0): void {
    this.pos.set(x, y, z);
    this.prevPos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.viewYaw = 0;
    this.prevViewYaw = 0;
    this.grounded = true;
    this.alive = true;
    this.jumpBufferTicks = 0;
    this.remainingAirJumps = this.stats.extraJumps;
    this.dashCooldownTimer = 0;
    this.boostGraceTimer = 0;
    this.bhopChain = 0;
    this.bhopChain = 0;
    this.strafeSync = 0;
    this.syncSamples = [];
    this.topUps = 0;
    this.rollAngleDeg = 0;
    this.accumulator = 0;
    this.isSurfing = false;
    this.surfNormal = { x: 0, y: 1, z: 0 };
    this.hasRampJumped = false;
    this.surfTicks = 0;
    this.surfCoyoteTicks = 0;
  }

  public addSurfRamp(ramp: SurfRampCollider): void {
    this.surfRamps.push(ramp);
  }

  public clearSurfRamps(): void {
    this.surfRamps = [];
  }

  public addBox(box: AABBBox): void {
    this.boxes.push(box);
  }

  public clearBoxes(): void {
    this.boxes = [];
  }

  /**
   * Executes a smooth, rhythmic dismount jump off a surf ramp:
   * Uses standard jumpImpulse vertically so bhop timing stays consistent,
   * pushes gently away from the bank normal, and adds forward flow along heading.
   */
  public executeRampJump(): void {
    const stats = this.stats;
    this.grounded = false;
    this.vel.y = Math.max(this.vel.y, stats.jumpImpulse);
    this.vel.x += this.surfNormal.x * 55;

    const forwardX = -Math.sin(this.viewYaw);
    const forwardZ = -Math.cos(this.viewYaw);
    this.vel.x += forwardX * 42;
    this.vel.z += forwardZ * 42;

    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (hSpeed > stats.maxBhopSpeed) {
      const scale = stats.maxBhopSpeed / hSpeed;
      this.vel.x *= scale;
      this.vel.z *= scale;
    }

    this.jumpBufferTicks = 0;
    this.remainingAirJumps = Math.max(
      1,
      Math.min(stats.extraJumps, this.remainingAirJumps + 1)
    );
    const currentUps = this.ups;
    const isBhop = currentUps > stats.sv_maxspeed * 0.95;
    if (isBhop) {
      this.bhopChain++;
    } else {
      this.bhopChain = 1;
    }
    this.callbacks.onJump?.(currentUps, isBhop, false);
    this.isSurfing = false;
    this.surfTicks = 0;
    this.surfCoyoteTicks = 0;
  }

  /**
   * Checks if player hull is actively in contact with any surf ramp slope
   */
  public isNearSurfRamp(ramps: SurfRampCollider[]): boolean {
    const SURF_CONTACT_DIST = 4.0;
    for (const ramp of ramps) {
      const rMinX = Math.min(ramp.minX, ramp.maxX);
      const rMaxX = Math.max(ramp.minX, ramp.maxX);
      const rMinY = Math.min(ramp.minY, ramp.maxY);
      const rMaxY = Math.max(ramp.minY, ramp.maxY);
      const rMinZ = Math.min(ramp.minZ, ramp.maxZ);
      const rMaxZ = Math.max(ramp.minZ, ramp.maxZ);

      if (
        this.pos.x < rMinX - 8 ||
        this.pos.x > rMaxX + 8 ||
        this.pos.y + this.playerHeight < rMinY ||
        this.pos.y > rMaxY + 4 ||
        this.pos.z < rMinZ - 8 ||
        this.pos.z > rMaxZ + 8
      ) {
        continue;
      }

      const nLen = Math.hypot(ramp.normal.x, ramp.normal.y, ramp.normal.z);
      const nx = nLen > 0 ? ramp.normal.x / nLen : 0;
      const ny = nLen > 0 ? ramp.normal.y / nLen : 1;
      const nz = nLen > 0 ? ramp.normal.z / nLen : 0;

      const dist =
        this.pos.x * nx + this.pos.y * ny + this.pos.z * nz - ramp.planeConstant;
      if (dist >= -14 && dist <= SURF_CONTACT_DIST) {
        // Do not yank a player off the flat floor before they actually reach the slope
        if (this.pos.y <= 0.5 && dist > 1.2) {
          continue;
        }
        if (ny < 0.75) {
          this.surfNormal = { x: nx, y: ny, z: nz };
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Auto-Step-Up Lip Forgiveness (sv_stepsize = 20) & One-Way Platform Support:
   * - Smoothly steps the player up onto any box/platform within 20 units of their feet
   *   while keeping 100% of horizontal bhop velocity intact.
   * - Elevated platforms (box.isPlatform === true) act as one-way top surfaces so
   *   players bhopping underneath or alongside them are never blocked horizontally.
   */
  public resolveAABBCollisions(boxes: AABBBox[]): {
    groundedOnBox: boolean;
    supportY: number;
  } {
    const radius = this.playerRadius;
    const height = this.playerHeight;
    let groundedOnBox = false;
    let supportY = 0;

    for (const box of boxes) {
      const bMinX = Math.min(box.minX, box.maxX);
      const bMaxX = Math.max(box.minX, box.maxX);
      const bMinY = Math.min(box.minY, box.maxY);
      const bMaxY = Math.max(box.minY, box.maxY);
      const bMinZ = Math.min(box.minZ, box.maxZ);
      const bMaxZ = Math.max(box.minZ, box.maxZ);

      const expandedMinX = bMinX - radius;
      const expandedMaxX = bMaxX + radius;
      const expandedMinZ = bMinZ - radius;
      const expandedMaxZ = bMaxZ + radius;

      // Check if player hull overlaps horizontally and vertically (inclusive of standing on top)
      if (
        this.pos.x > expandedMinX &&
        this.pos.x < expandedMaxX &&
        this.pos.z > expandedMinZ &&
        this.pos.z < expandedMaxZ &&
        this.pos.y + height > bMinY &&
        this.pos.y <= bMaxY + 0.5
      ) {
        if (box.lethal) {
          this.alive = false;
          this.callbacks.onHazardHit?.();
          return { groundedOnBox: false, supportY: 0 };
        }

        const playerBottomY = this.pos.y;
        const stepDiff = bMaxY - playerBottomY;

        // Auto-Step-Up Lip Forgiveness (sv_stepsize = 20)
        if (stepDiff >= -0.5 && stepDiff <= 20 && this.vel.y <= 35) {
          this.pos.y = bMaxY;
          if (this.vel.y < 0) {
            this.vel.y = 0;
          }
          this.grounded = true;
          this.remainingAirJumps = this.stats.extraJumps;
          groundedOnBox = true;
          supportY = Math.max(supportY, bMaxY);
          continue;
        }

        // In forgiving mode, elevated flow platforms are one-way from above: never snag or block horizontal bhop lines
        if (box.isPlatform && !this.strictCollisions) {
          continue;
        }

        // Push out along shallowest horizontal axis for solid non-platform blockers
        const overlapLeft = this.pos.x - expandedMinX;
        const overlapRight = expandedMaxX - this.pos.x;
        const overlapBack = expandedMaxZ - this.pos.z;
        const overlapFront = this.pos.z - expandedMinZ;

        const minOverlap = Math.min(
          overlapLeft,
          overlapRight,
          overlapBack,
          overlapFront
        );

        if (minOverlap === overlapLeft) {
          this.pos.x = expandedMinX;
          if (this.vel.x > 0) this.vel.x = 0;
        } else if (minOverlap === overlapRight) {
          this.pos.x = expandedMaxX;
          if (this.vel.x < 0) this.vel.x = 0;
        } else if (minOverlap === overlapBack) {
          this.pos.z = expandedMaxZ;
          if (this.vel.z < 0) this.vel.z = 0;
        } else {
          this.pos.z = expandedMinZ;
          if (this.vel.z > 0) this.vel.z = 0;
        }
      }
    }

    return { groundedOnBox, supportY };
  }

  /**
   * Buffers a 3-tick (30ms) jump pulse (used by CS 1.6 mouse wheel scroll up/down)
   */
  public bufferScrollJump(): void {
    this.jumpBufferTicks = 3;
  }

  /**
   * Advances simulation using a fixed 100Hz GoldSrc timestep and returns interpolation alpha.
   * Linearly interpolates viewYaw across sub-ticks so yawDelta never drops to 0 on multi-tick frames.
   */
  public update(
    frameDt: number,
    cmd: MoveCmd,
    world?: CollisionWorld,
    surfRamps?: SurfRampCollider[],
    boxes?: AABBBox[],
    otherPlayers?: PlayerCollider[]
  ): number {
    const clampedDt = Math.min(frameDt, 0.1);
    this.accumulator += clampedDt;

    const totalTicks = Math.floor(this.accumulator / GOLDSRC_DT);
    if (totalTicks <= 0) {
      return this.accumulator / GOLDSRC_DT;
    }

    const startYaw = this.viewYaw;
    let totalYawDiff = cmd.viewYaw - startYaw;
    while (totalYawDiff > Math.PI) totalYawDiff -= Math.PI * 2;
    while (totalYawDiff < -Math.PI) totalYawDiff += Math.PI * 2;

    // Edge inputs should be consumed on the first tick inside this frame
    let edgeJump = cmd.jumpEdge;
    let edgeDash = cmd.dashPressed;

    for (let i = 1; i <= totalTicks; i++) {
      const tickYaw = startYaw + totalYawDiff * (i / totalTicks);
      this.stepTick(
        {
          ...cmd,
          viewYaw: tickYaw,
          jumpEdge: edgeJump,
          dashPressed: edgeDash,
        },
        GOLDSRC_DT,
        world,
        surfRamps,
        boxes,
        otherPlayers
      );
      edgeJump = false;
      edgeDash = false;
      this.accumulator -= GOLDSRC_DT;
    }

    return this.accumulator / GOLDSRC_DT;
  }

  /**
   * Executes exactly one 100Hz (dt = 0.01s) GoldSrc physics tick
   */
  public stepTick(
    cmd: MoveCmd,
    dt: number = GOLDSRC_DT,
    world?: CollisionWorld,
    surfRamps?: SurfRampCollider[],
    boxes?: AABBBox[],
    otherPlayers?: PlayerCollider[]
  ): void {
    if (!this.alive) return;

    this.prevPos.copy(this.pos);
    const stats = this.stats;

    this.viewYaw = cmd.viewYaw;
    let yawDelta = this.viewYaw - this.prevViewYaw;
    while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
    while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
    this.prevViewYaw = this.viewYaw;

    // Update GoldSrc cl_rollangle (2.5 deg when strafing A or D)
    const targetRoll = cmd.smove < 0 ? 2.5 : cmd.smove > 0 ? -2.5 : 0;
    this.rollAngleDeg += (targetRoll - this.rollAngleDeg) * Math.min(1, dt * 18);

    if (this.dashCooldownTimer > 0) {
      this.dashCooldownTimer = Math.max(0, this.dashCooldownTimer - dt);
    }

    // Collect all active surf ramps
    const activeRamps: SurfRampCollider[] = [
      ...this.surfRamps,
      ...(surfRamps ?? []),
      ...(world?.surfRamps ?? []),
      ...(world && !surfRamps && world.getSurfRamps
        ? world.getSurfRamps(this.pos.x, this.pos.z)
        : []),
      ...((world as any)?.getRamps ? (world as any).getRamps(this.pos.x, this.pos.z) : []),
      ...((world as any)?.ramps ?? []),
    ];

    // Collect custom AABB boxes (world obstacles are resolved via world.resolveCollisions)
    const activeBoxes: AABBBox[] = [
      ...this.boxes,
      ...(boxes ?? []),
      ...(world?.boxes ?? []),
      ...(!world?.resolveCollisions && world?.getBoxes
        ? world.getBoxes(this.pos.x, this.pos.z)
        : []),
    ];

    // 1. Construct horizontal forward and right unit vectors from Camera Yaw (viewYaw)
    // viewYaw = 0 points along -Z: forward = (0, 0, -1), right = (1, 0, 0)
    // Positive viewYaw rotates left (counter-clockwise in XZ plane)
    const forward = new THREE.Vector3(
      -Math.sin(this.viewYaw),
      0,
      -Math.cos(this.viewYaw)
    ).normalize();
    const right = new THREE.Vector3(
      Math.cos(this.viewYaw),
      0,
      -Math.sin(this.viewYaw)
    ).normalize();

    const wishvel = new THREE.Vector3(
      forward.x * cmd.fmove + right.x * cmd.smove,
      0,
      forward.z * cmd.fmove + right.z * cmd.smove
    );

    const rawWishSpeed = wishvel.length();
    const wishdir =
      rawWishSpeed > 0.0001
        ? wishvel.clone().divideScalar(rawWishSpeed)
        : new THREE.Vector3(0, 0, 0);
    const wishspeed = Math.min(rawWishSpeed, stats.sv_maxspeed);

    // 2. Check Impulse Dash (TFC Conc-style boost)
    if (cmd.dashPressed && this.dashCooldownTimer <= 0) {
      const dashDir =
        rawWishSpeed > 0.0001 ? wishdir.clone() : forward.clone();
      this.vel.x += dashDir.x * stats.dashImpulse;
      this.vel.z += dashDir.z * stats.dashImpulse;
      this.vel.y = Math.max(this.vel.y, stats.dashVerticalMin);
      this.grounded = false;
      this.dashCooldownTimer = stats.dashCooldown;
      this.callbacks.onDash?.(this.ups);
    }

    const wantsJump = cmd.jumpHeld || cmd.jumpEdge || this.jumpBufferTicks > 0;
    let jumpedThisTick = false;
    const isSurfingNow =
      this.isSurfing ||
      this.surfCoyoteTicks > 0 ||
      this.isNearSurfRamp(activeRamps);

    // Deliberate surf dismount jump:
    // - Fresh jump press (jumpEdge) or scroll wheel (jumpBufferTicks > 0) after latching onto ramp, OR
    // - Holding Space while steering away from the ramp after surfing for at least 14 ticks
    const steeringAwayFromSurf =
      (this.surfNormal.x > 0.2 && cmd.smove > 0) ||
      (this.surfNormal.x < -0.2 && cmd.smove < 0);
    const wantsSurfDismount =
      cmd.jumpEdge ||
      (this.jumpBufferTicks > 0 && this.surfTicks >= 2) ||
      (cmd.jumpHeld &&
        !this.hasRampJumped &&
        this.surfTicks >= 14 &&
        steeringAwayFromSurf);

    // 3. CRITICAL GOLDSRC ORDER: Process PM_CheckJump() BEFORE PM_Friction()!
    if (isSurfingNow && wantsSurfDismount) {
      this.executeRampJump();
      jumpedThisTick = true;
      this.hasRampJumped = true;
    } else if (this.grounded) {
      if (wantsJump) {
        this.grounded = false;
        this.vel.y = stats.jumpImpulse;
        this.jumpBufferTicks = 0;
        this.remainingAirJumps = stats.extraJumps;
        const currentUps = this.ups;
        const isBhop = currentUps > stats.sv_maxspeed * 0.95;
        if (isBhop) {
          this.bhopChain++;
        } else {
          this.bhopChain = 1;
        }
        this.callbacks.onJump?.(currentUps, isBhop, false);
        jumpedThisTick = true;
      }
    } else if (!isSurfingNow) {
      // Mid-air Double Jump check (preserves 100% of horizontal bhop velocity)
      if (cmd.jumpEdge && this.remainingAirJumps > 0) {
        this.vel.y = stats.jumpImpulse;
        this.remainingAirJumps--;
        this.jumpBufferTicks = 0;
        this.callbacks.onJump?.(this.ups, true, true);
        jumpedThisTick = true;
      }
    }

    if (this.jumpBufferTicks > 0) {
      this.jumpBufferTicks--;
    }

    // 4. Execute Ground Move or Air Move
    if (this.grounded) {
      // Only reached if the player did NOT jump on this landing tick
      if (this.ups < stats.sv_maxspeed * 0.9) {
        this.bhopChain = 0;
      }
      if (this.boostGraceTimer > 0) {
        // Friction grace during boost pad burst so speed isn't instantly choked by ground friction
        this.boostGraceTimer = Math.max(0, this.boostGraceTimer - dt);
      } else {
        PM_Friction(this.vel, stats.sv_friction, stats.sv_stopspeed, dt);
      }
      PM_Accelerate(this.vel, wishdir, wishspeed, stats.sv_accelerate, dt);
      this.vel.y = 0;
    } else {
      const prevSpeed = this.ups;

      // When airborne and pressing A or D (smove !== 0), decouple forward W from locking out
      // PM_AirAccelerate's 30 UPS dot-product cap so players can steer/carve smoothly even if W is held.
      const airWishDir = wishdir.clone();
      let airWishSpeed = wishspeed;
      if (cmd.smove !== 0 && cmd.fmove !== 0) {
        airWishDir
          .set(
            right.x * Math.sign(cmd.smove) + forward.x * 0.12 * Math.sign(cmd.fmove),
            0,
            right.z * Math.sign(cmd.smove) + forward.z * 0.12 * Math.sign(cmd.fmove)
          )
          .normalize();
        airWishSpeed = stats.sv_maxspeed;
      }

      // When airborne, holding A/D (smove !== 0), and turning viewYaw in sync with the strafe direction,
      // align wishdir with the optimal GoldSrc strafe tangent so S-curve mouse turns compound speed smoothly.
      const isSyncedAirStrafe =
        cmd.smove !== 0 &&
        prevSpeed > 50 &&
        ((cmd.smove < 0 && yawDelta > 0.00005) ||
          (cmd.smove > 0 && yawDelta < -0.00005));

      if (isSyncedAirStrafe) {
        const vxNorm = this.vel.x / prevSpeed;
        const vzNorm = this.vel.z / prevSpeed;
        const perpX = cmd.smove < 0 ? vzNorm : -vzNorm;
        const perpZ = cmd.smove < 0 ? -vxNorm : vxNorm;
        const forwardBias = cmd.fmove === 0 ? 0.015 : 0.009;
        airWishDir
          .set(
            perpX + vxNorm * forwardBias,
            0,
            perpZ + vzNorm * forwardBias
          )
          .normalize();
      }

      PM_AirAccelerate(
        this.vel,
        airWishDir,
        airWishSpeed,
        stats.sv_airaccelerate,
        dt,
        stats.airWishCap
      );
      const postSpeed = this.ups;

      if (isSyncedAirStrafe && postSpeed > 50 && !this.isSurfing) {
        // Smoothly carve velocity toward camera viewYaw without any artificial left/right lead offset
        // so switching from A to D never whips the velocity vector.
        const currentHeading = Math.atan2(-this.vel.x, -this.vel.z);
        let diff = this.viewYaw - currentHeading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const newHeading = currentHeading + diff * Math.min(1, dt * 10);
        this.vel.x = -Math.sin(newHeading) * postSpeed;
        this.vel.z = -Math.cos(newHeading) * postSpeed;
      }

      // Record Strafe Sync efficiency when turning or strafing in air
      if (airWishSpeed > 0 || Math.abs(yawDelta) > 0.0005) {
        const speedGain = postSpeed - prevSpeed;
        let sample = 0;
        if (speedGain > 0.01 && cmd.smove !== 0) {
          const alignedTurn =
            (cmd.smove < 0 && yawDelta > 0) || (cmd.smove > 0 && yawDelta < 0);
          sample = alignedTurn ? Math.min(100, 78 + speedGain * 6.5) : 45;
        } else if (speedGain > 0.01) {
          sample = Math.min(75, speedGain * 4.0);
        } else {
          sample = 0;
        }
        this.syncSamples.push(sample);
        if (this.syncSamples.length > 60) {
          this.syncSamples.shift();
        }
        const sum = this.syncSamples.reduce((a, b) => a + b, 0);
        this.strafeSync = Math.round(sum / this.syncSamples.length);
      }

      // Apply optional uncapped bhop ceiling (MAX_BHOP_SPEED = 900 UPS)
      if (postSpeed > stats.maxBhopSpeed) {
        const scale = stats.maxBhopSpeed / postSpeed;
        this.vel.x *= scale;
        this.vel.z *= scale;
      }

      // GoldSrc Gravity
      this.vel.y -= stats.sv_gravity * dt;
    }

    // 5. Integrate position
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    // 6. Check active SurfRampCollider volumes (Smooth GoldSrc PM_ClipVelocity Supplementary Surfing)
    const SURF_CONTACT_DIST = 4.0;
    let onSteepSurfRamp = false;
    for (const ramp of activeRamps) {
      const rMinX = Math.min(ramp.minX, ramp.maxX);
      const rMaxX = Math.max(ramp.minX, ramp.maxX);
      const rMinY = Math.min(ramp.minY, ramp.maxY);
      const rMaxY = Math.max(ramp.minY, ramp.maxY);
      const rMinZ = Math.min(ramp.minZ, ramp.maxZ);
      const rMaxZ = Math.max(ramp.minZ, ramp.maxZ);

      if (
        this.pos.x < rMinX - 8 ||
        this.pos.x > rMaxX + 8 ||
        this.pos.y + this.playerHeight < rMinY ||
        this.pos.y > rMaxY + 4 ||
        this.pos.z < rMinZ - 8 ||
        this.pos.z > rMaxZ + 8
      ) {
        continue;
      }

      const nLen = Math.hypot(ramp.normal.x, ramp.normal.y, ramp.normal.z);
      const nx = nLen > 0 ? ramp.normal.x / nLen : 0;
      const ny = nLen > 0 ? ramp.normal.y / nLen : 1;
      const nz = nLen > 0 ? ramp.normal.z / nLen : 0;

      const dist =
        this.pos.x * nx + this.pos.y * ny + this.pos.z * nz - ramp.planeConstant;

      if (dist >= -16 && dist <= SURF_CONTACT_DIST) {
        // Avoid grabbing players walking on the flat deck before they actually hit the slope
        if (this.pos.y <= 0.5 && dist > 1.2 && !this.isSurfing) {
          continue;
        }

        const velDotN = this.vel.x * nx + this.vel.y * ny + this.vel.z * nz;
        // If moving decisively away from the ramp, let the player leave cleanly
        if (velDotN > 35) {
          continue;
        }

        if (dist < SURF_CONTACT_DIST) {
          const pushDist = SURF_CONTACT_DIST - dist;
          this.pos.x += nx * pushDist;
          this.pos.y += ny * pushDist;
          this.pos.z += nz * pushDist;
        }

        // Downslope Speed Slingshot: convert steep downward air drop into smooth forward momentum
        if (this.vel.y < -120) {
          const boost = Math.abs(this.vel.y) * 0.32;
          const forwardX = -Math.sin(this.viewYaw);
          const forwardZ = -Math.cos(this.viewYaw);
          this.vel.x += forwardX * boost;
          this.vel.z += forwardZ * boost;

          const hSpeed = Math.hypot(this.vel.x, this.vel.z);
          if (hSpeed > stats.maxBhopSpeed) {
            const scale = stats.maxBhopSpeed / hSpeed;
            this.vel.x *= scale;
            this.vel.z *= scale;
          }
        }

        // Velocity Projection (PM_ClipVelocity) along the ramp surface:
        // Convert inward bank pressure into forward flow and keep vertical elevation stable on side banks
        if (velDotN < 0) {
          if (Math.abs(nx) > 0.35) {
            const inwardSpeed = Math.abs(this.vel.x * nx);
            const forwardX = -Math.sin(this.viewYaw);
            const forwardZ = -Math.cos(this.viewYaw);
            this.vel.x += forwardX * inwardSpeed * 0.25;
            this.vel.z += forwardZ * inwardSpeed * 0.25;
          }
          PM_ClipVelocity(this.vel, { x: nx, y: ny, z: nz }, 1.0);
        }

        // Smooth vertical glide stabilization on side surf banks so surfing stays in the sweet spot
        // without rocketing off the top lip or sliding down into the floor
        if (Math.abs(nx) > 0.35) {
          if (this.vel.y > 20 && !jumpedThisTick) {
            this.vel.y *= 0.72;
          } else if (this.vel.y < -12) {
            this.vel.y *= 0.82;
          }
          // Keep player within the bank's active vertical band
          const maxBankY = rMaxY - 18;
          if (this.pos.y > maxBankY && this.vel.y > 0 && !jumpedThisTick) {
            this.pos.y = maxBankY;
            this.vel.y = 0;
          }
        }

        // Apply optional forwardBoost along player heading
        if (ramp.forwardBoost && ramp.forwardBoost > 0) {
          const forwardX = -Math.sin(this.viewYaw);
          const forwardZ = -Math.cos(this.viewYaw);
          this.vel.x += forwardX * ramp.forwardBoost * dt;
          this.vel.z += forwardZ * ramp.forwardBoost * dt;
        }

        if (ny < 0.75) {
          this.grounded = false;
          onSteepSurfRamp = true;
          this.surfNormal = { x: nx, y: ny, z: nz };
          this.remainingAirJumps = Math.max(1, this.remainingAirJumps);
        }
      }
    }

    this.isSurfing = onSteepSurfRamp;
    if (onSteepSurfRamp) {
      this.surfTicks++;
      this.surfCoyoteTicks = 8;
      if (!cmd.jumpHeld) {
        this.hasRampJumped = false;
      }
    } else {
      this.surfTicks = 0;
      if (this.surfCoyoteTicks > 0) {
        this.surfCoyoteTicks--;
      } else {
        this.hasRampJumped = false;
      }
    }

    // 7. Auto-Step-Up Lip Forgiveness (sv_stepsize = 20) & Custom AABB Box Collision
    let groundedNow = false;
    if (activeBoxes.length > 0) {
      const boxCol = this.resolveAABBCollisions(activeBoxes);
      if (!this.alive) return;
      if (boxCol.groundedOnBox) {
        groundedNow = true;
      }
    }

    // 7b. Player-to-Player Dynamic Cyber-Bumping (Active when strictCollisions is enabled)
    if (this.strictCollisions && otherPlayers && otherPlayers.length > 0) {
      for (const other of otherPlayers) {
        if (!other || other.alive === false) continue;
        const oRadius = other.radius ?? this.playerRadius;
        const oHeight = other.height ?? this.playerHeight;
        const combinedRadius = this.playerRadius + oRadius;

        // Vertical overlap check
        if (
          this.pos.y + this.playerHeight > other.y &&
          this.pos.y < other.y + oHeight
        ) {
          const dx = this.pos.x - other.x;
          const dz = this.pos.z - other.z;
          const distSq = dx * dx + dz * dz;

          if (distSq < combinedRadius * combinedRadius && distSq > 0.0001) {
            const dist = Math.sqrt(distSq);
            const overlap = combinedRadius - dist;
            const nx = dx / dist;
            const nz = dz / dist;

            // Separate local player along collision normal
            this.pos.x += nx * overlap;
            this.pos.z += nz * overlap;

            // Elastic deflection
            const relVx = this.vel.x - (other.vx ?? 0);
            const relVz = this.vel.z - (other.vz ?? 0);
            const normVel = relVx * nx + relVz * nz;

            if (normVel < 0) {
              const impulse = -1.35 * normVel;
              this.vel.x += nx * impulse;
              this.vel.z += nz * impulse;
              this.callbacks.onPlayerBump?.(Math.abs(normVel));
            }
          }
        }
      }
    }

    // 8. Track Highway Boundaries & Floor / Obstacle Collision
    const enforceWalls = world && !(world as { flatTestMode?: boolean }).flatTestMode;
    if (enforceWalls) {
      const HIGHWAY_HALF_WIDTH = 600; // 1200 GoldSrc units wide total
      if (this.pos.x < -HIGHWAY_HALF_WIDTH + this.playerRadius) {
        this.pos.x = -HIGHWAY_HALF_WIDTH + this.playerRadius;
        if (this.vel.x < 0) this.vel.x *= -0.2;
      } else if (this.pos.x > HIGHWAY_HALF_WIDTH - this.playerRadius) {
        this.pos.x = HIGHWAY_HALF_WIDTH - this.playerRadius;
        if (this.vel.x > 0) this.vel.x *= -0.2;
      }
    }

    const floorY = world ? world.getFloorHeight(this.pos.x, this.pos.z) : 0;

    if (world) {
      const col = world.resolveCollisions(
        this.pos,
        this.vel,
        this.playerRadius,
        this.playerHeight
      );
      if (col.hitHazard) {
        this.alive = false;
        this.callbacks.onHazardHit?.();
        return;
      }
      if (col.hitBoostPad) {
        this.boostGraceTimer = 0.5; // 0.5s friction grace window to preserve catapult velocity
        this.remainingAirJumps = Math.max(this.remainingAirJumps, 1);
        this.callbacks.onBoost?.(this.ups);
      }
      if (col.groundedOnObstacle && this.vel.y <= 35) {
        this.pos.y = col.supportY;
        if (this.vel.y < 0) this.vel.y = 0;
        groundedNow = true;
      }
    }

    if (!onSteepSurfRamp && !groundedNow && this.pos.y <= floorY && floorY > -500) {
      // Only snap to floor if player wasn't already deep below the deck in a chasm
      if (this.prevPos.y >= floorY - 20 && this.vel.y <= 0) {
        this.pos.y = floorY;
        this.vel.y = 0;
        groundedNow = true;
      }
    }

    // Check chasm fall-out
    if (this.pos.y < -220) {
      this.alive = false;
      this.callbacks.onHazardHit?.();
      return;
    }

    if (onSteepSurfRamp) {
      this.grounded = false;
    } else if (groundedNow) {
      this.grounded = true;
      this.remainingAirJumps = stats.extraJumps;
    } else if (this.pos.y > floorY + 0.5 || floorY <= -500) {
      this.grounded = false;
    }

    if (this.ups > this.topUps) {
      this.topUps = this.ups;
    }
  }

  public getInterpolatedPosition(alpha: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.lerpVectors(this.prevPos, this.pos, Math.max(0, Math.min(1, alpha)));
  }
}
