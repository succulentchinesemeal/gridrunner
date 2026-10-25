import * as THREE from 'three';
import { SynthAudio } from './audio/SynthAudio';
import { InputManager } from './input/InputManager';
import {
  MatchState,
  NetworkClient,
  PlayerInputTelemetry,
  RemotePlayerEntity,
  RemotePlayerSnapshot,
} from './network/NetworkClient';
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
    inputs: PlayerInputTelemetry;
  };
  spectator: {
    active: boolean;
    targetPlayerId: string | null;
    targetPlayerName: string | null;
    aliveSpectatableCount: number;
    targetInputs: PlayerInputTelemetry | null;
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
      killLocalPlayer: () => void;
      cycleSpectatorTarget: (dir?: 1 | -1) => string | null;
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

  let spectatedPlayerId: string | null = null;
  let lastLocalTelemetry: PlayerInputTelemetry = {
    w: false,
    a: false,
    s: false,
    d: false,
    jump: false,
    dash: false,
    mouseDx: 0,
    mouseDy: 0,
  };

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
    localRig.setVisible(physics.alive && mode !== 'FIRST_PERSON');
    hud.setCameraModeLabel(mode);
  };

  const toggleCameraMode = (): CameraMode => {
    if (!physics.alive && spectatedPlayerId !== null) {
      // Spectator mode enforces Chase Cam
      applyCameraMode('CHASE');
      return 'CHASE';
    }
    const next = renderer.cycleCameraMode();
    localRig.setVisible(physics.alive && next !== 'FIRST_PERSON');
    hud.setCameraModeLabel(next);
    return next;
  };

  const resolveSpectatorState = (): {
    active: boolean;
    entity: RemotePlayerEntity | null;
    index: number;
    aliveCount: number;
  } => {
    const aliveRemotes = network.getAliveRemoteEntities();
    if (physics.alive || aliveRemotes.length === 0) {
      spectatedPlayerId = null;
      return {
        active: false,
        entity: null,
        index: -1,
        aliveCount: aliveRemotes.length,
      };
    }

    let idx = aliveRemotes.findIndex(
      (e) => e.snapshot.id === spectatedPlayerId
    );
    if (idx === -1) {
      idx = 0;
      const chosen = aliveRemotes[0];
      spectatedPlayerId = chosen.snapshot.id;
      applyCameraMode('CHASE');
      renderer.resetCameraSnap(chosen.renderPos, chosen.renderYaw);
    }

    return {
      active: true,
      entity: aliveRemotes[idx],
      index: idx,
      aliveCount: aliveRemotes.length,
    };
  };

  const cycleSpectatorTarget = (dir: 1 | -1 = 1): string | null => {
    const aliveRemotes = network.getAliveRemoteEntities();
    if (physics.alive || aliveRemotes.length === 0) {
      spectatedPlayerId = null;
      return null;
    }

    const currentIdx = aliveRemotes.findIndex(
      (e) => e.snapshot.id === spectatedPlayerId
    );
    const nextIdx =
      currentIdx === -1
        ? 0
        : (currentIdx + dir + aliveRemotes.length) % aliveRemotes.length;
    const chosen = aliveRemotes[nextIdx];
    spectatedPlayerId = chosen.snapshot.id;
    applyCameraMode('CHASE');
    renderer.resetCameraSnap(chosen.renderPos, chosen.renderYaw);
    syncWindowState();
    return spectatedPlayerId;
  };

  const input = new InputManager(
    renderer.domElement,
    () => physics.bufferScrollJump(),
    () => audio.unlock(),
    () => toggleCameraMode(),
    (dir) => cycleSpectatorTarget(dir),
    () => !physics.alive && network.getAliveRemoteEntities().length > 0
  );

  const network = new NetworkClient(renderer.scene, {
    onMatchSeedChanged: (seed, spawnX) => {
      spectatedPlayerId = null;
      track.resetWithSeed(seed);
      physics.reset(spawnX, 0, 0);
      input.viewYaw = 0;
      input.viewPitch = 0;
      input.resetTelemetry(0, 0);
      localRig.setVisible(renderer.cameraMode !== 'FIRST_PERSON');
      localRig.resetTrail(spawnX, 0, 0, 0);
      renderer.resetCameraSnap(physics.pos, 0);
    },
    onMatchStateChanged: (_prev, nextState) => {
      if (nextState === 'ACTIVE') {
        spectatedPlayerId = null;
        physics.alive = true;
        localRig.setVisible(renderer.cameraMode !== 'FIRST_PERSON');
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
    () => toggleCameraMode(),
    (dir) => cycleSpectatorTarget(dir)
  );

  // FPS counter smoothing
  let smoothedFps = 60;
  let lastFrameTime = performance.now();
  let localMatchElapsed = 0;
  let wasAliveLastFrame = true;
  const interpPos = new THREE.Vector3();

  const buildLocalNetPayload = () => {
    const isDashing =
      physics.dashCooldownTimer > physics.stats.dashCooldown - 0.3;
    return {
      x: physics.pos.x,
      y: physics.pos.y,
      z: physics.pos.z,
      vx: physics.vel.x,
      vy: physics.vel.y,
      vz: physics.vel.z,
      yaw: physics.viewYaw,
      pitch: input.viewPitch,
      state: (!physics.alive
        ? 'dead'
        : isDashing
        ? 'dashing'
        : physics.grounded
        ? 'grounded'
        : 'airborne') as 'grounded' | 'airborne' | 'dashing' | 'dead',
      ups: physics.ups,
      topUps: physics.topUps,
      strafeSync: physics.strafeSync,
      alive: physics.alive,
      distance: physics.distance,
      bhopChain: physics.bhopChain,
      inputs: lastLocalTelemetry,
    };
  };

  const syncWindowState = () => {
    const spec = resolveSpectatorState();
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
        inputs: lastLocalTelemetry,
      },
      spectator: {
        active: spec.active,
        targetPlayerId: spec.entity ? spec.entity.snapshot.id : null,
        targetPlayerName: spec.entity ? spec.entity.snapshot.name : null,
        aliveSpectatableCount: spec.aliveCount,
        targetInputs: spec.entity?.snapshot.inputs
          ? {
              ...spec.entity.snapshot.inputs,
              mouseDx: spec.entity.smoothedMouseDx,
              mouseDy: spec.entity.smoothedMouseDy,
            }
          : null,
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
      spectatedPlayerId = null;
      track.flatTestMode = flatTestMode;
      track.resetWithSeed(track.getSeed());
      physics.reset(0, 0, 0);
      input.viewYaw = 0;
      input.viewPitch = 0;
      input.resetTelemetry(0, 0);
      input.testOverride = null;
      localMatchElapsed = 0;
      wasAliveLastFrame = true;
      localRig.setVisible(renderer.cameraMode !== 'FIRST_PERSON');
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
      const isDashing =
        physics.dashCooldownTimer > physics.stats.dashCooldown - 0.3;
      lastLocalTelemetry = input.getInputTelemetry(
        cmd,
        Math.max(GOLDSRC_DT, ticks * GOLDSRC_DT),
        isDashing
      );
      network.updateAndSend(0.05, buildLocalNetPayload(), true);
      syncWindowState();
    },
    startMatch: (instant = false, seed?: number) => {
      spectatedPlayerId = null;
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
    killLocalPlayer: () => {
      physics.alive = false;
      localRig.setVisible(false);
      audio.playDerezz();
      lastLocalTelemetry = {
        w: false,
        a: false,
        s: false,
        d: false,
        jump: false,
        dash: false,
        mouseDx: 0,
        mouseDy: 0,
      };
      network.updateAndSend(0.05, buildLocalNetPayload(), true);
      resolveSpectatorState();
      syncWindowState();
    },
    cycleSpectatorTarget: (dir: 1 | -1 = 1) => {
      return cycleSpectatorTarget(dir);
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
      const isDashing =
        physics.dashCooldownTimer > physics.stats.dashCooldown - 0.3;
      lastLocalTelemetry = input.getInputTelemetry(lastCmd, rawDt, isDashing);
    } else if (
      !physics.alive &&
      network.matchState === 'LOBBY' &&
      network.getAliveRemoteEntities().length === 0
    ) {
      // Auto-respawn in solo Lobby practice mode if player falls in a chasm
      physics.reset(0, 0, 0);
      track.resetWithSeed(track.getSeed());
      input.resetTelemetry(0, 0);
      localRig.setVisible(renderer.cameraMode !== 'FIRST_PERSON');
      localRig.resetTrail(0, 0, 0, 0);
      renderer.resetCameraSnap(physics.pos, 0);
    } else if (!physics.alive) {
      lastLocalTelemetry = {
        w: false,
        a: false,
        s: false,
        d: false,
        jump: false,
        dash: false,
        mouseDx: 0,
        mouseDy: 0,
      };
    }

    const justDied = wasAliveLastFrame && !physics.alive;
    wasAliveLastFrame = physics.alive;

    network.updateAndSend(rawDt, buildLocalNetPayload(), justDied);

    const spec = resolveSpectatorState();

    const wallTime =
      network.matchState === 'ACTIVE'
        ? Math.max(localMatchElapsed, network.matchElapsedSec)
        : 0;
    const advanceWall = network.matchState === 'ACTIVE';
    track.wallEnabled = advanceWall;

    if (spec.active && spec.entity) {
      // Spectator Chase Cam following the selected alive remote player
      localRig.setVisible(false);
      if (renderer.cameraMode !== 'CHASE') {
        applyCameraMode('CHASE');
      }
      const targetEntity = spec.entity;
      track.updateAroundPlayerZ(
        targetEntity.renderPos.z,
        wallTime,
        advanceWall ? rawDt : 0
      );

      const specRoll = targetEntity.snapshot.inputs?.a
        ? 2.5
        : targetEntity.snapshot.inputs?.d
        ? -2.5
        : 0;
      renderer.updateCamera(
        targetEntity.renderPos,
        targetEntity.renderYaw,
        specRoll,
        targetEntity.snapshot.ups,
        rawDt,
        targetEntity.renderPitch,
        targetEntity.renderVel,
        targetEntity.snapshot.state === 'grounded'
      );
    } else {
      localRig.setVisible(
        physics.alive && renderer.cameraMode !== 'FIRST_PERSON'
      );
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
          isDashing:
            physics.dashCooldownTimer > physics.stats.dashCooldown - 0.3,
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
    }

    hud.update(
      physics,
      network.matchState,
      network.countdownRemaining,
      track.wallZ,
      network.localPlayerId,
      network.allRoomPlayers,
      lastLocalTelemetry,
      {
        active: spec.active,
        target: spec.entity ? spec.entity.snapshot : null,
        targetIndex: spec.index,
        aliveCount: spec.aliveCount,
        smoothedMouseDx: spec.entity ? spec.entity.smoothedMouseDx : 0,
        smoothedMouseDy: spec.entity ? spec.entity.smoothedMouseDy : 0,
      }
    );

    renderer.render();
    syncWindowState();
  }

  requestAnimationFrame(animate);
}

bootstrap();
