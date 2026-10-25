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

export interface CollisionWorld {
  /** Returns the floor height at (x, z), or -Infinity if over a KZ chasm gap */
  getFloorHeight(x: number, z: number): number;
  /** Checks AABB/cylinder collision with pillars, moving beams, and laser hurdles */
  resolveCollisions(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    radius: number,
    height: number
  ): { hitHazard: boolean; groundedOnObstacle: boolean; supportY: number };
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
  onHazardHit?: () => void;
}

export class PlayerPhysics {
  public pos = new THREE.Vector3(0, 0, 0);
  public prevPos = new THREE.Vector3(0, 0, 0);
  public vel = new THREE.Vector3(0, 0, 0);
  public viewYaw = 0;
  public prevViewYaw = 0;
  public grounded = true;
  public alive = true;

  /** Scroll-wheel +jump buffer in ticks (3 ticks = 30ms window) */
  public jumpBufferTicks = 0;
  /** Remaining mid-air double jumps */
  public remainingAirJumps = 1;
  /** Remaining cooldown on Impulse Dash in seconds */
  public dashCooldownTimer = 0;
  /** Number of consecutive bunny-hops without losing grounded momentum */
  public bhopChain = 0;

  /** Strafe Sync percentage (0..100) */
  public strafeSync = 0;
  private syncSamples: number[] = [];

  /** Peak horizontal UPS achieved during the current run */
  public topUps = 0;

  /** Smooth Z-axis camera roll in degrees (GoldSrc cl_rollangle = 2.5 deg) */
  public rollAngleDeg = 0;

  public readonly playerRadius = 16;
  public readonly playerHeight = 56;

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
    this.bhopChain = 0;
    this.strafeSync = 0;
    this.syncSamples = [];
    this.topUps = 0;
    this.rollAngleDeg = 0;
    this.accumulator = 0;
  }

  /**
   * Buffers a 3-tick (30ms) jump pulse (used by CS 1.6 mouse wheel scroll up/down)
   */
  public bufferScrollJump(): void {
    this.jumpBufferTicks = 3;
  }

  /**
   * Advances simulation using a fixed 100Hz GoldSrc timestep and returns interpolation alpha
   */
  public update(
    frameDt: number,
    cmd: MoveCmd,
    world?: CollisionWorld
  ): number {
    const clampedDt = Math.min(frameDt, 0.1);
    this.accumulator += clampedDt;

    // Edge inputs should be consumed on the first tick inside this frame
    let edgeJump = cmd.jumpEdge;
    let edgeDash = cmd.dashPressed;

    while (this.accumulator >= GOLDSRC_DT) {
      this.stepTick(
        {
          ...cmd,
          jumpEdge: edgeJump,
          dashPressed: edgeDash,
        },
        GOLDSRC_DT,
        world
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
    world?: CollisionWorld
  ): void {
    if (!this.alive) return;

    this.prevPos.copy(this.pos);
    const stats = this.stats;

    this.viewYaw = cmd.viewYaw;
    const yawDelta = this.viewYaw - this.prevViewYaw;
    this.prevViewYaw = this.viewYaw;

    // Update GoldSrc cl_rollangle (2.5 deg when strafing A or D)
    const targetRoll = cmd.smove < 0 ? 2.5 : cmd.smove > 0 ? -2.5 : 0;
    this.rollAngleDeg += (targetRoll - this.rollAngleDeg) * Math.min(1, dt * 18);

    if (this.dashCooldownTimer > 0) {
      this.dashCooldownTimer = Math.max(0, this.dashCooldownTimer - dt);
    }

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

    // 3. CRITICAL GOLDSRC ORDER: Process PM_CheckJump() BEFORE PM_Friction()!
    if (this.grounded) {
      const wantsJump = cmd.jumpHeld || cmd.jumpEdge || this.jumpBufferTicks > 0;
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
      }
    } else {
      // Mid-air Double Jump check (preserves 100% of horizontal bhop velocity)
      if (cmd.jumpEdge && this.remainingAirJumps > 0) {
        this.vel.y = stats.jumpImpulse;
        this.remainingAirJumps--;
        this.jumpBufferTicks = 0;
        this.callbacks.onJump?.(this.ups, true, true);
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
      PM_Friction(this.vel, stats.sv_friction, stats.sv_stopspeed, dt);
      PM_Accelerate(this.vel, wishdir, wishspeed, stats.sv_accelerate, dt);
      this.vel.y = 0;
    } else {
      const prevSpeed = this.ups;

      // When airborne, releasing W (fmove === 0), holding A/D (smove !== 0), and turning viewYaw
      // in sync with the strafe direction, align wishdir with the optimal GoldSrc strafe tangent
      // so S-curve mouse whips compound speed smoothly without obtuse braking.
      const isSyncedAirStrafe =
        cmd.fmove === 0 &&
        cmd.smove !== 0 &&
        prevSpeed > 50 &&
        ((cmd.smove < 0 && yawDelta > 0.0001) ||
          (cmd.smove > 0 && yawDelta < -0.0001));

      if (isSyncedAirStrafe) {
        const vxNorm = this.vel.x / prevSpeed;
        const vzNorm = this.vel.z / prevSpeed;
        const perpX = cmd.smove < 0 ? vzNorm : -vzNorm;
        const perpZ = cmd.smove < 0 ? -vxNorm : vxNorm;
        const forwardBias = 0.015;
        wishdir
          .set(
            perpX + vxNorm * forwardBias,
            0,
            perpZ + vzNorm * forwardBias
          )
          .normalize();
      }

      PM_AirAccelerate(
        this.vel,
        wishdir,
        wishspeed,
        stats.sv_airaccelerate,
        dt,
        stats.airWishCap
      );
      const postSpeed = this.ups;

      if (isSyncedAirStrafe && postSpeed > 50) {
        // Keep velocity carving smoothly along the camera's S-curve heading
        // while preserving 100% of the exact horizontal speed computed by PM_AirAccelerate
        const strafeLead = cmd.smove < 0 ? 0.18 : -0.18;
        const targetHeading = this.viewYaw + strafeLead;
        const currentHeading = Math.atan2(-this.vel.x, -this.vel.z);
        let diff = targetHeading - currentHeading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const newHeading = currentHeading + diff * Math.min(1, dt * 12);
        this.vel.x = -Math.sin(newHeading) * postSpeed;
        this.vel.z = -Math.cos(newHeading) * postSpeed;
      }

      // Record Strafe Sync efficiency when turning or strafing in air
      if (wishspeed > 0 || Math.abs(yawDelta) > 0.0005) {
        const speedGain = postSpeed - prevSpeed;
        let sample = 0;
        if (speedGain > 0.01 && cmd.fmove === 0 && cmd.smove !== 0) {
          // Optimal air-strafe: turning mouse in sync with A/D while W is released
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

    // 6. Track Highway Boundaries & Floor / Obstacle Collision
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
    let groundedNow = false;

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
      if (col.groundedOnObstacle && this.vel.y <= 0) {
        this.pos.y = col.supportY;
        this.vel.y = 0;
        groundedNow = true;
      }
    }

    if (!groundedNow && this.pos.y <= floorY && floorY > -500) {
      // Only snap to floor if player wasn't already deep below the deck in a chasm
      if (this.prevPos.y >= floorY - 18 && this.vel.y <= 0) {
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

    if (groundedNow) {
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
