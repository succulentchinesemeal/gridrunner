import { MoveCmd } from '../physics/PlayerPhysics';

export class InputManager {
  private keys = new Set<string>();
  public viewYaw = 0;
  private jumpEdgePending = false;
  private dashPending = false;
  private scrollJumpCallback?: () => void;

  // Mobile Touch state
  private touchJoyX = 0; // -1..1
  private touchJoyY = 0; // -1..1 (positive = forward W)
  private touchJumpHeld = false;
  private lookTouchId: number | null = null;
  private lastLookTouchX = 0;
  private joyTouchId: number | null = null;
  private joyOriginX = 0;
  private joyOriginY = 0;

  // Optional programmatic override for automated Playwright physics tests
  public testOverride: Partial<MoveCmd> | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    onScrollJump?: () => void,
    onAudioUnlock?: () => void
  ) {
    this.scrollJumpCallback = onScrollJump;

    window.addEventListener('keydown', (e) => {
      const code = e.code;
      if (!this.keys.has(code)) {
        if (code === 'Space') {
          this.jumpEdgePending = true;
        }
        if (code === 'ShiftLeft' || code === 'ShiftRight') {
          this.dashPending = true;
        }
      }
      this.keys.add(code);
      onAudioUnlock?.();
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    // PointerLock Mouse Look on Canvas Click
    canvas.addEventListener('click', () => {
      onAudioUnlock?.();
      if (document.pointerLockElement !== canvas && canvas.requestPointerLock) {
        try {
          canvas.requestPointerLock();
        } catch {
          // Ignore in headless environments where pointer lock is unsupported
        }
      }
    });

    // Right-click Impulse Dash
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
    canvas.addEventListener('mousedown', (e) => {
      onAudioUnlock?.();
      if (e.button === 2) {
        this.dashPending = true;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) {
        const sensitivity = 0.0024;
        // Moving mouse left (movementX < 0) increases viewYaw (turns left/CCW)
        this.viewYaw -= e.movementX * sensitivity;
      }
    });

    // CS 1.6 Scroll-Wheel Bhop (MWheelUp / MWheelDown buffers 3-tick +jump pulse)
    window.addEventListener(
      'wheel',
      (e) => {
        if (e.deltaY !== 0) {
          this.jumpEdgePending = true;
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
              this.lastLookTouchX = t.clientX;
              this.viewYaw -= dx * 0.0055;
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
        },
        { passive: false }
      );
      dashBtn.addEventListener('mousedown', () => {
        this.dashPending = true;
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
}
