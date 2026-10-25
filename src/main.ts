import * as THREE from 'three';
import { SynthAudio } from './audio/SynthAudio';
import { InputManager } from './input/InputManager';
import { MatchState, NetworkClient, RemotePlayerSnapshot } from './network/NetworkClient';
import { DEFAULT_GOLDSRC_STATS, PerkManager } from './physics/PerkManager';
import { GOLDSRC_DT, MoveCmd, PlayerPhysics } from './physics/PlayerPhysics';
import { PlayerRig } from './renderer/PlayerRig';
import { CameraMode, TronRenderer } from './renderer/TronRenderer';
import { HudController } from './ui/HudController';
import { TrackGenerator } from './world/TrackGenerator';

export interface ExposedGameState {
  fps: number;
  cameraMode: CameraMode;
  localPlayer: {
    pos: { x: number; y: number; z: number };
    vel: { x: number; y: number; z: number };
    ups: number;
    topUps: number;
    viewYaw: number;
    viewPitch: number;
    grounded: boolean;
    strafeSync: number;
    alive: boolean;
    distance: number;
    bhopChain: number;
  };
  remotePlayersCount: number;
  remotePlayers: RemotePlayerSnapshot[];
  matchState: MatchState;
  matchSeed: number;
  trackStats: {
    activeChunks: number;
    totalSpawnedChunks: number;
    totalDespawnedChunks: number;
    wallZ: number;
    wallSpeedUps: number;
    archetypes: string[];
  };
  audioStats: {
    lastPlayedBhopFreq: number;
    bhopTickCount: number;
  };
}

declare global {
  interface Window {
    __GAME_STATE__: ExposedGameState;
    __GAME_CONTROLS__: {
      resetPlayer: (flatTestMode?: boolean) => void;
      setMoveOverride: (cmd: Partial<MoveCmd> | null) => void;
      stepPhysicsTicks: (ticks: number, cmd: MoveCmd) => void;
      startMatch: (instant?: boolean, seed?: number) => void;
      triggerScrollJump: () => void;
      cycleCameraMode: () => CameraMode;
      setCameraMode: (mode: CameraMode) => void;
    };
  }
}

function bootstrap(): void {
  const container =
    document.getElementById('app-canvas-container') || document.body;

  const renderer = new TronRenderer(container);
  const audio = new SynthAudio();
  const perkManager = new PerkManager(DEFAULT_GOLDSRC_STATS);
  const track = new TrackGenerator(renderer.scene, 1337420);

  const localRig = new PlayerRig(0x00f3ff);
  localRig.attachToScene(renderer.scene);

  const physics = new PlayerPhysics(perkManager, {
    onJump: (ups, _isBhop, isDoubleJump) => {
      audio.playBhopTick(ups, isDoubleJump);
      localRig.triggerJumpAnim(isDoubleJump);
    },
    onDash: () => {
      audio.playDash();
      localRig.triggerDashAnim();
    },
    onHazardHit: () => {
      audio.playDerezz();
    },
  });

  const applyCameraMode = (mode: CameraMode) => {
    renderer.setCameraMode(mode);
    localRig.setVisible(mode !== 'FIRST_PERSON');
    hud.setCameraModeLabel(mode);
  };

  const toggleCameraMode = (): CameraMode => {
    const next = renderer.cycleCameraMode();
    localRig.setVisible(next !== 'FIRST_PERSON');
    hud.setCameraModeLabel(next);
    return next;
  };

  const input = new InputManager(
    renderer.domElement,
    () => physics.bufferScrollJump(),
    () => audio.unlock(),
    () => toggleCameraMode()
  );

  const network = new NetworkClient(renderer.scene, {
    onMatchSeedChanged: (seed, spawnX) => {
      track.resetWithSeed(seed);
      physics.reset(spawnX, 0, 0);
      input.viewYaw = 0;
      input.viewPitch = 0;
      localRig.resetTrail(spawnX, 0, 0, 0);
      renderer.resetCameraSnap(physics.pos, 0);
    },
    onMatchStateChanged: (_prev, nextState) => {
      if (nextState === 'ACTIVE') {
        physics.alive = true;
        // Intuitive opening launch boost at "GO!" so the acrobat starts sprinting forward immediately
        if (physics.ups < 180 && physics.distance < 50) {
          physics.vel.z = -260;
        }
      }
    },
    onRoomStateUpdated: () => {
      syncWindowState();
    },
  });
  network.connect();

  const hud = new HudController(
    perkManager,
    () => network.requestStartMatch(false),
    () => network.requestStartMatch(false),
    () => toggleCameraMode()
  );

  // FPS counter smoothing
  let smoothedFps = 60;
  let lastFrameTime = performance.now();
  let localMatchElapsed = 0;
  const interpPos = new THREE.Vector3();

  const syncWindowState = () => {
    window.__GAME_STATE__ = {
      fps: Math.round(smoothedFps),
      cameraMode: renderer.cameraMode,
      localPlayer: {
        pos: {
          x: physics.pos.x,
          y: physics.pos.y,
          z: physics.pos.z,
        },
        vel: {
          x: physics.vel.x,
          y: physics.vel.y,
          z: physics.vel.z,
        },
        ups: physics.ups,
        topUps: physics.topUps,
        viewYaw: physics.viewYaw,
        viewPitch: input.viewPitch,
        grounded: physics.grounded,
        strafeSync: physics.strafeSync,
        alive: physics.alive,
        distance: physics.distance,
        bhopChain: physics.bhopChain,
      },
      remotePlayersCount: network.getRemotePlayersCount(),
      remotePlayers: network.getRemoteSnapshots(),
      matchState: network.matchState,
      matchSeed: track.getSeed(),
      trackStats: {
        activeChunks: track.getActiveChunkCount(),
        totalSpawnedChunks: track.totalSpawnedChunks,
        totalDespawnedChunks: track.totalDespawnedChunks,
        wallZ: track.wallZ,
        wallSpeedUps: track.wallSpeedUps,
        archetypes: track.getActiveArchetypes(),
      },
      audioStats: {
        lastPlayedBhopFreq: audio.lastPlayedBhopFreq,
        bhopTickCount: audio.bhopTickCount,
      },
    };
  };

  window.__GAME_CONTROLS__ = {
    resetPlayer: (flatTestMode = false) => {
      track.flatTestMode = flatTestMode;
      track.resetWithSeed(track.getSeed());
      physics.reset(0, 0, 0);
      input.viewYaw = 0;
      input.viewPitch = 0;
      input.testOverride = null;
      localMatchElapsed = 0;
      localRig.resetTrail(0, 0, 0, 0);
      renderer.resetCameraSnap(physics.pos, 0);
      syncWindowState();
    },
    setMoveOverride: (cmd) => {
      input.testOverride = cmd;
      if (cmd && cmd.viewYaw !== undefined) {
        input.viewYaw = cmd.viewYaw;
      }
    },
    stepPhysicsTicks: (ticks, cmd) => {
      for (let i = 0; i < ticks; i++) {
        physics.stepTick(cmd, GOLDSRC_DT, track);
        localMatchElapsed += GOLDSRC_DT;
        track.updateAroundPlayerZ(physics.pos.z, localMatchElapsed, GOLDSRC_DT);
      }
      input.viewYaw = cmd.viewYaw;
      network.updateAndSend(0.05, {
        x: physics.pos.x,
        y: physics.pos.y,
        z: physics.pos.z,
        vx: physics.vel.x,
        vy: physics.vel.y,
        vz: physics.vel.z,
        yaw: physics.viewYaw,
        state: !physics.alive
          ? 'dead'
          : physics.grounded
          ? 'grounded'
          : 'airborne',
        ups: physics.ups,
        topUps: physics.topUps,
        strafeSync: physics.strafeSync,
        alive: physics.alive,
        distance: physics.distance,
      });
      syncWindowState();
    },
    startMatch: (instant = false, seed?: number) => {
      network.requestStartMatch(instant, seed);
      syncWindowState();
    },
    triggerScrollJump: () => {
      physics.bufferScrollJump();
    },
    cycleCameraMode: () => {
      const m = toggleCameraMode();
      syncWindowState();
      return m;
    },
    setCameraMode: (mode: CameraMode) => {
      applyCameraMode(mode);
      syncWindowState();
    },
  };

  // Initialize state immediately before first animation frame
  syncWindowState();

  function animate(now: number): void {
    requestAnimationFrame(animate);

    const rawDt = Math.max(0.001, (now - lastFrameTime) / 1000);
    lastFrameTime = now;

    const currentFps = 1 / Math.min(rawDt, 0.25);
    smoothedFps = smoothedFps * 0.9 + currentFps * 0.1;

    // Handle offline countdown progression if not connected to WS server
    if (!network.connected) {
      if (network.matchState === 'COUNTDOWN') {
        network.countdownRemaining = Math.max(
          0,
          network.countdownRemaining - rawDt
        );
        if (network.countdownRemaining <= 0) {
          network.matchState = 'ACTIVE';
        }
      } else if (network.matchState === 'ACTIVE') {
        network.matchElapsedSec += rawDt;
      }
    }

    const canMove =
      network.matchState === 'ACTIVE' || network.matchState === 'LOBBY';

    let alpha = 1;
    let lastCmd = {
      fmove: 0,
      smove: 0,
      viewYaw: physics.viewYaw,
      jumpHeld: false,
      jumpEdge: false,
      dashPressed: false,
    };
    if (canMove && physics.alive) {
      lastCmd = input.sampleMoveCmd(physics.stats.sv_maxspeed);
      alpha = physics.update(rawDt, lastCmd, track);
      localMatchElapsed += rawDt;
    } else if (!physics.alive && network.matchState === 'LOBBY') {
      // Auto-respawn in Lobby practice mode if player falls in a chasm
      physics.reset(0, 0, 0);
      track.resetWithSeed(track.getSeed());
      localRig.resetTrail(0, 0, 0, 0);
      renderer.resetCameraSnap(physics.pos, 0);
    }

    const wallTime =
      network.matchState === 'ACTIVE'
        ? Math.max(localMatchElapsed, network.matchElapsedSec)
        : 0;
    const advanceWall = network.matchState === 'ACTIVE';
    track.wallEnabled = advanceWall;
    track.updateAroundPlayerZ(
      physics.pos.z,
      wallTime,
      advanceWall ? rawDt : 0
    );

    physics.getInterpolatedPosition(alpha, interpPos);
    localRig.updateTransform(
      interpPos,
      physics.vel,
      physics.viewYaw,
      rawDt,
      {
        grounded: physics.grounded,
        ups: physics.ups,
        vel: physics.vel,
        viewYaw: physics.viewYaw,
        smove: lastCmd.smove,
        fmove: lastCmd.fmove,
        isDashing: physics.dashCooldownTimer > physics.stats.dashCooldown - 0.3,
      }
    );
    renderer.updateCamera(
      interpPos,
      physics.viewYaw,
      physics.rollAngleDeg,
      physics.ups,
      rawDt,
      input.viewPitch,
      physics.vel,
      physics.grounded
    );

    network.updateAndSend(rawDt, {
      x: physics.pos.x,
      y: physics.pos.y,
      z: physics.pos.z,
      vx: physics.vel.x,
      vy: physics.vel.y,
      vz: physics.vel.z,
      yaw: physics.viewYaw,
      state: !physics.alive
        ? 'dead'
        : physics.grounded
        ? 'grounded'
        : 'airborne',
      ups: physics.ups,
      topUps: physics.topUps,
      strafeSync: physics.strafeSync,
      alive: physics.alive,
      distance: physics.distance,
    });

    hud.update(
      physics,
      network.matchState,
      network.countdownRemaining,
      track.wallZ,
      network.localPlayerId,
      network.allRoomPlayers
    );

    renderer.render();
    syncWindowState();
  }

  requestAnimationFrame(animate);
}

bootstrap();
