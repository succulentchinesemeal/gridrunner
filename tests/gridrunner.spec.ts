import { test, expect } from '@playwright/test';

test.describe('GRIDRUNNER — GoldSrc 100Hz Cyber-Bhop Verification Suite', () => {
  test('Milestone 1 — Test A (Holding W in air fails to accelerate) & Test B (True GoldSrc Air-Strafe compounds to 500+ UPS)', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/?room=m1_physics');
    await page.waitForFunction(() => Boolean(window.__GAME_STATE__));

    // Allow a brief warmup for smoothed FPS measurement
    await page.waitForTimeout(350);

    // --- TEST A: Accelerate on ground to 320 UPS, jump, hold W while rotating viewYaw -> verify horizontal UPS stays near ~320-350 UPS ---
    const testAResult = await page.evaluate(() => {
      const ctrl = window.__GAME_CONTROLS__;
      ctrl.resetPlayer(true); // flat test runway

      let yaw = 0;
      // 1. Accelerate on ground holding W (fmove = 320) for 60 ticks (0.6s) to reach 320 UPS
      ctrl.stepPhysicsTicks(60, {
        fmove: 320,
        smove: 0,
        viewYaw: 0,
        jumpHeld: false,
        jumpEdge: false,
        dashPressed: false,
      });
      const groundUps = window.__GAME_STATE__.localPlayer.ups;

      // 2. Jump and keep holding W while smoothly rotating viewYaw across 4 hops (260 ticks = 2.6s)
      for (let t = 0; t < 260; t++) {
        // Rotate yaw left and right while stubbornly holding W (fmove: 320, smove: 0)
        const dir = Math.floor(t / 65) % 2 === 0 ? 1 : -1;
        yaw += dir * 0.025;
        ctrl.stepPhysicsTicks(1, {
          fmove: 320,
          smove: 0,
          viewYaw: yaw,
          jumpHeld: true,
          jumpEdge: t === 0,
          dashPressed: false,
        });
      }

      return {
        groundUps,
        airHoldWUps: window.__GAME_STATE__.localPlayer.ups,
      };
    });

    expect(testAResult.groundUps).toBeGreaterThanOrEqual(319);
    expect(testAResult.groundUps).toBeLessThanOrEqual(321);
    expect(testAResult.airHoldWUps).toBeGreaterThanOrEqual(315);
    expect(testAResult.airHoldWUps).toBeLessThan(350);

    // --- TEST B: Accelerate on ground to 320 UPS, jump, RELEASE W, alternate A + positive viewYaw and D + negative viewYaw across 4 consecutive hops -> verify UPS > 500 and FPS > 50 ---
    const testBResult = await page.evaluate(() => {
      const ctrl = window.__GAME_CONTROLS__;
      ctrl.resetPlayer(true);

      // 1. Ground run holding W to 320 UPS
      ctrl.stepPhysicsTicks(60, {
        fmove: 320,
        smove: 0,
        viewYaw: 0,
        jumpHeld: false,
        jumpEdge: false,
        dashPressed: false,
      });

      let yaw = 0;
      const hopDurationTicks = 68; // 1 full GoldSrc jump arc is ~67 ticks (2 * 268.32 / 800 = 0.67s)
      const totalTicks = hopDurationTicks * 4; // 4 consecutive bhop jumps

      for (let t = 0; t < totalTicks; t++) {
        const hopIndex = Math.floor(t / hopDurationTicks);
        const strafeLeft = hopIndex % 2 === 0;
        // Release W (fmove = 0)! Hold A (-320) with +yaw rotation or D (+320) with -yaw rotation
        const smove = strafeLeft ? -320 : 320;
        const yawRatePerTick = strafeLeft ? 0.028 : -0.028;
        yaw += yawRatePerTick;

        ctrl.stepPhysicsTicks(1, {
          fmove: 0,
          smove,
          viewYaw: yaw,
          jumpHeld: true, // Pre-friction PM_CheckJump chains each hop with zero friction loss
          jumpEdge: t === 0,
          dashPressed: false,
        });
      }

      return {
        finalUps: window.__GAME_STATE__.localPlayer.ups,
        topUps: window.__GAME_STATE__.localPlayer.topUps,
        strafeSync: window.__GAME_STATE__.localPlayer.strafeSync,
        bhopChain: window.__GAME_STATE__.localPlayer.bhopChain,
        fps: window.__GAME_STATE__.fps,
      };
    });

    expect(testBResult.finalUps).toBeGreaterThan(500);
    expect(testBResult.strafeSync).toBeGreaterThan(70);
    expect(testBResult.bhopChain).toBeGreaterThanOrEqual(4);
    expect(testBResult.fps).toBeGreaterThan(50);
    expect(errors).toEqual([]);
  });

  test('Milestone 2 — Deterministic Procedural Track, 4 Bhop Archetypes, KZ Chasms & Derezzing Wall', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/?room=m2_track');
    await page.waitForFunction(() => Boolean(window.__GAME_STATE__));

    // Wait briefly for initial WS welcome/room_state to settle
    await page.waitForTimeout(200);

    const trackVerification = await page.evaluate(() => {
      const ctrl = window.__GAME_CONTROLS__;
      ctrl.resetPlayer(false); // Enable full procedural obstacles & chasms

      const initialArchetypes = [
        ...window.__GAME_STATE__.trackStats.archetypes,
      ];

      // Carve down the highway past z = -5000 using high-speed bhop + air-strafes
      let yaw = 0;
      for (let t = 0; t < 850; t++) {
        const strafeLeft = Math.floor(t / 34) % 2 === 0;
        if (t >= 50) {
          yaw += strafeLeft ? 0.008 : -0.008;
        }
        ctrl.stepPhysicsTicks(1, {
          fmove: t < 50 ? 320 : 0,
          smove: t < 50 ? 0 : strafeLeft ? -320 : 320,
          viewYaw: yaw,
          jumpHeld: t >= 50,
          jumpEdge: t === 50 || (t > 50 && t % 25 === 0), // Frequent double-jumps over KZ chasms & hurdles
          dashPressed: t >= 50 && t % 205 === 55, // Periodic Conc Dash boost
        });
      }

      return {
        distance: window.__GAME_STATE__.localPlayer.distance,
        activeChunks: window.__GAME_STATE__.trackStats.activeChunks,
        totalSpawned: window.__GAME_STATE__.trackStats.totalSpawnedChunks,
        totalDespawned: window.__GAME_STATE__.trackStats.totalDespawnedChunks,
        initialArchetypes,
      };
    });

    expect(trackVerification.initialArchetypes).toEqual(
      expect.arrayContaining(['SLALOM', 'FROGGER', 'KZ_CHASM', 'LASER_HURDLES'])
    );
    expect(trackVerification.distance).toBeGreaterThan(3500);
    expect(trackVerification.totalSpawned).toBeGreaterThan(8);
    expect(trackVerification.totalDespawned).toBeGreaterThan(2);
    expect(errors).toEqual([]);
  });

  test('Milestone 3 — Real-Time WebSocket Multiplayer (2 Parallel Clients Syncing Room, Match Seed, Position & UPS)', async ({
    browser,
  }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const roomName = `e2e_sync_${Date.now()}`;
    await Promise.all([
      page1.goto(`/?room=${roomName}`),
      page2.goto(`/?room=${roomName}`),
    ]);

    // Wait for both clients to see each other in the WebSocket room
    await page1.waitForFunction(
      () => window.__GAME_STATE__?.remotePlayersCount === 1,
      null,
      { timeout: 10000 }
    );
    await page2.waitForFunction(
      () => window.__GAME_STATE__?.remotePlayersCount === 1,
      null,
      { timeout: 10000 }
    );

    // Player 1 starts the match (instant active mode with deterministic seed 777888)
    await page1.evaluate(() => {
      window.__GAME_CONTROLS__.startMatch(true, 777888);
    });

    // Verify both clients transition to ACTIVE with identical matchSeed
    await page1.waitForFunction(
      () => window.__GAME_STATE__?.matchState === 'ACTIVE'
    );
    await page2.waitForFunction(
      () =>
        window.__GAME_STATE__?.matchState === 'ACTIVE' &&
        window.__GAME_STATE__?.matchSeed === 777888
    );

    // Player 1 performs high-speed GoldSrc bunny-hopping down -Z and streams at 25Hz
    await page1.evaluate(() => {
      window.__GAME_CONTROLS__.resetPlayer(true);
      const ctrl = window.__GAME_CONTROLS__;
      ctrl.stepPhysicsTicks(60, {
        fmove: 320,
        smove: 0,
        viewYaw: 0,
        jumpHeld: false,
        jumpEdge: false,
        dashPressed: false,
      });
      let yaw = 0;
      for (let t = 0; t < 200; t++) {
        const left = Math.floor(t / 34) % 2 === 0;
        yaw += left ? 0.01 : -0.01;
        ctrl.stepPhysicsTicks(1, {
          fmove: 0,
          smove: left ? -320 : 320,
          viewYaw: yaw,
          jumpHeld: true,
          jumpEdge: t === 0,
          dashPressed: false,
        });
      }
      // Keep jumpHeld active so subsequent rAF ticks preserve bhop speed
      ctrl.setMoveOverride({
        fmove: 0,
        smove: -320,
        viewYaw: yaw,
        jumpHeld: true,
      });
    });

    // Wait for Player 2 to receive Player 1's live position & high UPS over WebSockets
    await page2.waitForFunction(
      () => {
        const remotes = window.__GAME_STATE__?.remotePlayers || [];
        return (
          remotes.length === 1 &&
          remotes[0].distance > 300 &&
          remotes[0].ups > 400
        );
      },
      null,
      { timeout: 10000 }
    );

    const syncedRemote = await page2.evaluate(
      () => window.__GAME_STATE__.remotePlayers[0]
    );
    expect(syncedRemote.distance).toBeGreaterThan(300);
    expect(syncedRemote.ups).toBeGreaterThan(400);

    await context1.close();
    await context2.close();
  });

  test('Milestone 4 — UPS Speedometer Tiers, Strafe Sync HUD, Cross-Play Touch Controls & Pitch-Ascending Synth Audio', async ({
    page,
  }) => {
    await page.goto('/?room=m4_hud_audio');
    await page.waitForFunction(() => Boolean(window.__GAME_STATE__));

    // Verify HUD elements & Mobile Touch Controls are rendered
    await expect(page.locator('#hud-ups-value')).toBeVisible();
    await expect(page.locator('#hud-sync-text')).toBeVisible();
    await expect(page.locator('#touch-joystick-zone')).toBeVisible();
    await expect(page.locator('#touch-jump-btn')).toBeVisible();
    await expect(page.locator('#touch-dash-btn')).toBeVisible();

    // Perform bhop chain to > 520 UPS and verify Synth Audio pitch ascends + HUD switches to tier-cyan
    const hudAndAudio = await page.evaluate(() => {
      const ctrl = window.__GAME_CONTROLS__;
      ctrl.resetPlayer(true);

      // First jump at ~320 UPS
      ctrl.stepPhysicsTicks(60, {
        fmove: 320,
        smove: 0,
        viewYaw: 0,
        jumpHeld: false,
        jumpEdge: false,
        dashPressed: false,
      });
      ctrl.stepPhysicsTicks(1, {
        fmove: 0,
        smove: -320,
        viewYaw: 0.015,
        jumpHeld: true,
        jumpEdge: true,
        dashPressed: false,
      });
      const firstHopFreq = window.__GAME_STATE__.audioStats.lastPlayedBhopFreq;

      // Chain 4 air-strafe hops to exceed 520+ UPS
      let yaw = 0.015;
      for (let t = 0; t < 270; t++) {
        const left = Math.floor(t / 34) % 2 === 0;
        yaw += left ? 0.012 : -0.012;
        ctrl.stepPhysicsTicks(1, {
          fmove: 0,
          smove: left ? -320 : 320,
          viewYaw: yaw,
          jumpHeld: true,
          jumpEdge: false,
          dashPressed: false,
        });
      }
      const highSpeedFreq = window.__GAME_STATE__.audioStats.lastPlayedBhopFreq;
      const bhopTickCount = window.__GAME_STATE__.audioStats.bhopTickCount;

      return {
        firstHopFreq,
        highSpeedFreq,
        bhopTickCount,
        finalUps: window.__GAME_STATE__.localPlayer.ups,
      };
    });

    expect(hudAndAudio.finalUps).toBeGreaterThan(500);
    expect(hudAndAudio.bhopTickCount).toBeGreaterThanOrEqual(4);
    expect(hudAndAudio.highSpeedFreq).toBeGreaterThan(hudAndAudio.firstHopFreq);

    // Wait 1 animation frame for HUD DOM update and check cyan tier class & sync bar fill
    await page.waitForTimeout(50);
    await expect(page.locator('#hud-sync-fill')).toBeVisible();
    await expect(page.locator('#hud-ups-value')).toHaveClass(/tier-cyan|tier-magenta/);
  });
});
