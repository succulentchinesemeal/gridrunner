import { PlayerInputTelemetry } from '../network/NetworkClient';
import { MoveCmd } from '../physics/PlayerPhysics';

export class InputManager {
  private keys = new Set<string>();
  public viewYaw = 0;
  public viewPitch = 0;
  private jumpEdgePending = false;
  private dashPending = false;
  private scrollJumpCallback?: () => void;
  private toggleCameraCallback?: () => void;
  private cycleSpectatorCallback?: (dir: 1 | -1) => void;
  private isSpectatingCheck?: () => boolean;

  // Cursor / Mouse telemetry tracking
  private accumMouseDx = 0;
  private accumMouseDy = 0;
  private lastClientX: number | null = null;
  private lastClientY: number | null = null;
  private prevTelemetryYaw = 0;
  private prevTelemetryPitch = 0;
  public smoothedMouseDx = 0;
  public smoothedMouseDy = 0;
  private jumpLatchTimer = 0;
  private dashLatchTimer = 0;

  // Mobile Touch state
  private touchJoyX = 0; // -1..1
  private touchJoyY = 0; // -1..1 (positive = forward W)
  private touchJumpHeld = false;
  private lookTouchId: number | null = null;
  private lastLookTouchX = 0;
  private lastLookTouchY = 0;
  private joyTouchId: number | null = null;
  private joyOriginX = 0;
  private joyOriginY = 0;

  // Optional programmatic override for automated Playwright physics tests
  public testOverride: Partial<MoveCmd> | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    onScrollJump?: () => void,
    onAudioUnlock?: () => void,
    onToggleCameraMode?: () => void,
    onCycleSpectator?: (dir: 1 | -1) => void,
    isSpectatingCheck?: () => boolean
  ) {
    this.scrollJumpCallback = onScrollJump;
    this.toggleCameraCallback = onToggleCameraMode;
    this.cycleSpectatorCallback = onCycleSpectator;
    this.isSpectatingCheck = isSpectatingCheck;

    window.addEventListener('keydown', (e) => {
      const code = e.code;
      if (this.isSpectatingCheck?.()) {
        if (
          code === 'ArrowRight' ||
          code === 'KeyD' ||
          code === 'KeyE' ||
          code === 'BracketRight' ||
          code === 'Tab'
        ) {
          if (code === 'Tab') e.preventDefault();
          this.cycleSpectatorCallback?.(1);
        } else if (
          code === 'ArrowLeft' ||
          code === 'KeyA' ||
          code === 'KeyQ' ||
          code === 'BracketLeft'
        ) {
          this.cycleSpectatorCallback?.(-1);
        }
      }

      if (!this.keys.has(code)) {
        if (code === 'Space') {
          this.jumpEdgePending = true;
          this.jumpLatchTimer = 0.12;
        }
        if (code === 'ShiftLeft' || code === 'ShiftRight') {
          this.dashPending = true;
          this.dashLatchTimer = 0.16;
        }
        if (code === 'KeyV' || code === 'KeyC') {
          this.toggleCameraCallback?.();
        }
      }
      this.keys.add(code);
      onAudioUnlock?.();
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    // PointerLock Mouse Look on Canvas Click (or cycle spectator target if spectating)
    canvas.addEventListener('click', () => {
      onAudioUnlock?.();
      if (this.isSpectatingCheck?.()) {
        this.cycleSpectatorCallback?.(1);
        return;
      }
      if (document.pointerLockElement !== canvas && canvas.requestPointerLock) {
        try {
          canvas.requestPointerLock();
        } catch {
          // Ignore in headless environments where pointer lock is unsupported
        }
      }
    });

    // Right-click Impulse Dash (or cycle previous spectator target if spectating)
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
    canvas.addEventListener('mousedown', (e) => {
      onAudioUnlock?.();
      if (this.isSpectatingCheck?.()) {
        if (e.button === 2) {
          this.cycleSpectatorCallback?.(-1);
        }
        return;
      }
      if (e.button === 2) {
        this.dashPending = true;
        this.dashLatchTimer = 0.16;
      }
    });

    window.addEventListener('mousemove', (e) => {
      const dx =
        e.movementX ||
        (this.lastClientX !== null ? e.clientX - this.lastClientX : 0);
      const dy =
        e.movementY ||
        (this.lastClientY !== null ? e.clientY - this.lastClientY : 0);
      this.lastClientX = e.clientX;
      this.lastClientY = e.clientY;
      this.accumMouseDx += dx;
      this.accumMouseDy += dy;

      if (document.pointerLockElement === canvas) {
        const yawSensitivity = 0.0022;
        const pitchSensitivity = 0.0017;
        // Moving mouse left (movementX < 0) increases viewYaw (turns left/CCW)
        this.viewYaw -= e.movementX * yawSensitivity;
        // Moving mouse up (movementY < 0) increases viewPitch (looks up)
        this.viewPitch = Math.max(
          -0.65,
          Math.min(0.55, this.viewPitch - e.movementY * pitchSensitivity)
        );
      }
    });

    // CS 1.6 Scroll-Wheel Bhop (MWheelUp / MWheelDown buffers 3-tick +jump pulse)
    window.addEventListener(
      'wheel',
      (e) => {
        if (e.deltaY !== 0) {
          this.jumpEdgePending = true;
          this.jumpLatchTimer = 0.12;
          this.scrollJumpCallback?.();
        }
      },
      { passive: true }
    );

    this.initTouchControls(onAudioUnlock);
  }

  private initTouchControls(onAudioUnlock?: () => void): void {
    const joyZone = document.getElementById('touch-joystick-zone');
    const joyKnob = document.getElementById('touch-joystick-knob');
    const lookZone = document.getElementById('touch-look-zone');
    const jumpBtn = document.getElementById('touch-jump-btn');
    const dashBtn = document.getElementById('touch-dash-btn');

    if (joyZone) {
      joyZone.addEventListener(
        'touchstart',
        (e) => {
          onAudioUnlock?.();
          const t = e.changedTouches[0];
          this.joyTouchId = t.identifier;
          const rect = joyZone.getBoundingClientRect();
          this.joyOriginX = rect.left + rect.width * 0.5;
          this.joyOriginY = rect.top + rect.height * 0.5;
          this.updateJoystickFromTouch(t.clientX, t.clientY, joyKnob);
        },
        { passive: true }
      );

      joyZone.addEventListener(
        'touchmove',
        (e) => {
          for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.identifier === this.joyTouchId) {
              this.updateJoystickFromTouch(t.clientX, t.clientY, joyKnob);
            }
          }
        },
        { passive: true }
      );

      const endJoy = (e: TouchEvent) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === this.joyTouchId) {
            this.joyTouchId = null;
            this.touchJoyX = 0;
            this.touchJoyY = 0;
            if (joyKnob) {
              joyKnob.style.transform = `translate(-50%, -50%)`;
            }
          }
        }
      };
      joyZone.addEventListener('touchend', endJoy, { passive: true });
      joyZone.addEventListener('touchcancel', endJoy, { passive: true });
    }

    if (lookZone) {
      lookZone.addEventListener(
        'touchstart',
        (e) => {
          onAudioUnlock?.();
          const t = e.changedTouches[0];
          this.lookTouchId = t.identifier;
          this.lastLookTouchX = t.clientX;
          this.lastLookTouchY = t.clientY;
        },
        { passive: true }
      );

      lookZone.addEventListener(
        'touchmove',
        (e) => {
          for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.identifier === this.lookTouchId) {
              const dx = t.clientX - this.lastLookTouchX;
              const dy = t.clientY - this.lastLookTouchY;
              this.lastLookTouchX = t.clientX;
              this.lastLookTouchY = t.clientY;
              this.accumMouseDx += dx * 2.2;
              this.accumMouseDy += dy * 2.2;
              this.viewYaw -= dx * 0.0052;
              this.viewPitch = Math.max(
                -0.65,
                Math.min(0.55, this.viewPitch - dy * 0.0038)
              );
            }
          }
        },
        { passive: true }
      );

      const endLook = (e: TouchEvent) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === this.lookTouchId) {
            this.lookTouchId = null;
          }
        }
      };
      lookZone.addEventListener('touchend', endLook, { passive: true });
      lookZone.addEventListener('touchcancel', endLook, { passive: true });
    }

    if (jumpBtn) {
      jumpBtn.addEventListener(
        'touchstart',
        (e) => {
          e.preventDefault();
          onAudioUnlock?.();
          this.touchJumpHeld = true;
          this.jumpEdgePending = true;
          this.jumpLatchTimer = 0.12;
        },
        { passive: false }
      );
      const releaseJump = () => {
        this.touchJumpHeld = false;
      };
      jumpBtn.addEventListener('touchend', releaseJump);
      jumpBtn.addEventListener('touchcancel', releaseJump);
      jumpBtn.addEventListener('mousedown', () => {
        this.touchJumpHeld = true;
        this.jumpEdgePending = true;
        this.jumpLatchTimer = 0.12;
      });
      jumpBtn.addEventListener('mouseup', releaseJump);
    }

    if (dashBtn) {
      dashBtn.addEventListener(
        'touchstart',
        (e) => {
          e.preventDefault();
          onAudioUnlock?.();
          this.dashPending = true;
          this.dashLatchTimer = 0.16;
        },
        { passive: false }
      );
      dashBtn.addEventListener('mousedown', () => {
        this.dashPending = true;
        this.dashLatchTimer = 0.16;
      });
    }
  }

  private updateJoystickFromTouch(
    clientX: number,
    clientY: number,
    knobEl: HTMLElement | null
  ): void {
    const maxR = 48;
    const dx = clientX - this.joyOriginX;
    const dy = clientY - this.joyOriginY;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(dist, maxR);
    const angle = Math.atan2(dy, dx);
    const kx = Math.cos(angle) * clampedDist;
    const ky = Math.sin(angle) * clampedDist;

    this.touchJoyX = kx / maxR;
    this.touchJoyY = -ky / maxR; // Up on screen is +fmove (W)

    if (knobEl) {
      knobEl.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;
    }
  }

  public sampleMoveCmd(maxSpeed = 320): MoveCmd {
    let fmove = 0;
    let smove = 0;

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fmove += maxSpeed;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fmove -= maxSpeed;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) smove -= maxSpeed;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) smove += maxSpeed;

    // Touch joystick contribution (Left/Right pure strafe when pushed sideways)
    if (Math.abs(this.touchJoyY) > 0.35) {
      fmove = Math.sign(this.touchJoyY) * maxSpeed;
    }
    if (Math.abs(this.touchJoyX) > 0.25) {
      smove = Math.sign(this.touchJoyX) * maxSpeed;
      // When air-strafing sideways on mobile stick, avoid accidental W unless pushed strongly up
      if (Math.abs(this.touchJoyX) > 0.55 && this.touchJoyY < 0.65) {
        fmove = 0;
      }
    }

    const jumpHeld = this.keys.has('Space') || this.touchJumpHeld;
    const jumpEdge = this.jumpEdgePending;
    const dashPressed = this.dashPending;

    this.jumpEdgePending = false;
    this.dashPending = false;

    if (this.testOverride) {
      if (this.testOverride.viewYaw !== undefined) {
        this.viewYaw = this.testOverride.viewYaw;
      }
      return {
        fmove: this.testOverride.fmove ?? fmove,
        smove: this.testOverride.smove ?? smove,
        viewYaw: this.viewYaw,
        jumpHeld: this.testOverride.jumpHeld ?? jumpHeld,
        jumpEdge: this.testOverride.jumpEdge ?? jumpEdge,
        dashPressed: this.testOverride.dashPressed ?? dashPressed,
      };
    }

    return {
      fmove,
      smove,
      viewYaw: this.viewYaw,
      jumpHeld,
      jumpEdge,
      dashPressed,
    };
  }

  public getInputTelemetry(
    cmd: MoveCmd,
    dt: number,
    isDashing = false
  ): PlayerInputTelemetry {
    if (cmd.jumpEdge || cmd.jumpHeld) {
      this.jumpLatchTimer = Math.max(this.jumpLatchTimer, cmd.jumpHeld ? 0.04 : 0.12);
    } else {
      this.jumpLatchTimer = Math.max(0, this.jumpLatchTimer - dt);
    }

    if (cmd.dashPressed || isDashing) {
      this.dashLatchTimer = Math.max(this.dashLatchTimer, 0.16);
    } else {
      this.dashLatchTimer = Math.max(0, this.dashLatchTimer - dt);
    }

    const yawDelta = cmd.viewYaw - this.prevTelemetryYaw;
    const pitchDelta = this.viewPitch - this.prevTelemetryPitch;
    this.prevTelemetryYaw = cmd.viewYaw;
    this.prevTelemetryPitch = this.viewPitch;

    // Convert yaw/pitch delta to equivalent mouse movement if raw mousemove wasn't fired (e.g. automated tests / touch)
    const yawEquivalentDx = -yawDelta / 0.0022;
    const pitchEquivalentDy = -pitchDelta / 0.0017;

    const frameDx =
      Math.abs(this.accumMouseDx) > 0.01 ? this.accumMouseDx : yawEquivalentDx;
    const frameDy =
      Math.abs(this.accumMouseDy) > 0.01 ? this.accumMouseDy : pitchEquivalentDy;

    this.accumMouseDx = 0;
    this.accumMouseDy = 0;

    // Normalize cursor velocity into a responsive visual range (-100..+100)
    const safeDt = Math.max(0.004, Math.min(0.1, dt));
    const targetDx = Math.max(-100, Math.min(100, (frameDx / safeDt) * 0.065));
    const targetDy = Math.max(-100, Math.min(100, (frameDy / safeDt) * 0.065));

    const blendX =
      Math.abs(targetDx) >= Math.abs(this.smoothedMouseDx)
        ? Math.min(1, safeDt * 28)
        : Math.min(1, safeDt * 4.5);
    const blendY =
      Math.abs(targetDy) >= Math.abs(this.smoothedMouseDy)
        ? Math.min(1, safeDt * 28)
        : Math.min(1, safeDt * 4.5);
    this.smoothedMouseDx += (targetDx - this.smoothedMouseDx) * blendX;
    this.smoothedMouseDy += (targetDy - this.smoothedMouseDy) * blendY;

    if (Math.abs(this.smoothedMouseDx) < 0.2) this.smoothedMouseDx = 0;
    if (Math.abs(this.smoothedMouseDy) < 0.2) this.smoothedMouseDy = 0;

    return {
      w: cmd.fmove > 0,
      s: cmd.fmove < 0,
      a: cmd.smove < 0,
      d: cmd.smove > 0,
      jump: cmd.jumpHeld || cmd.jumpEdge || this.jumpLatchTimer > 0,
      dash: cmd.dashPressed || isDashing || this.dashLatchTimer > 0,
      mouseDx: Math.round(this.smoothedMouseDx * 10) / 10,
      mouseDy: Math.round(this.smoothedMouseDy * 10) / 10,
    };
  }

  public resetTelemetry(yaw = 0, pitch = 0): void {
    this.prevTelemetryYaw = yaw;
    this.prevTelemetryPitch = pitch;
    this.accumMouseDx = 0;
    this.accumMouseDy = 0;
    this.smoothedMouseDx = 0;
    this.smoothedMouseDy = 0;
    this.jumpLatchTimer = 0;
    this.dashLatchTimer = 0;
  }
}
