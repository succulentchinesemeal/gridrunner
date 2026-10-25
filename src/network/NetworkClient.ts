import * as THREE from 'three';
import { PlayerRig } from '../renderer/PlayerRig';

export type MatchState = 'LOBBY' | 'COUNTDOWN' | 'ACTIVE' | 'PODIUM';

export interface RemotePlayerSnapshot {
  id: string;
  name: string;
  color: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  state: 'grounded' | 'airborne' | 'dashing' | 'dead';
  ups: number;
  topUps: number;
  strafeSync: number;
  alive: boolean;
  distance: number;
}

interface RemotePlayerEntity {
  snapshot: RemotePlayerSnapshot;
  renderPos: THREE.Vector3;
  renderVel: THREE.Vector3;
  renderYaw: number;
  rig: PlayerRig;
}

export interface RoomUpdateCallbacks {
  onMatchSeedChanged?: (seed: number, spawnX: number) => void;
  onMatchStateChanged?: (
    prevState: MatchState,
    newState: MatchState,
    seed: number
  ) => void;
  onRoomStateUpdated?: () => void;
}

export class NetworkClient {
  private ws: WebSocket | null = null;
  private scene: THREE.Scene;
  private callbacks: RoomUpdateCallbacks;

  public localPlayerId = 'local_runner';
  public localColor = 0x00f3ff;
  public roomId = 'default';
  public matchState: MatchState = 'LOBBY';
  public matchSeed = 1337420;
  public countdownRemaining = 0;
  public matchElapsedSec = 0;
  public connected = false;

  private remotePlayers = new Map<string, RemotePlayerEntity>();
  public allRoomPlayers: RemotePlayerSnapshot[] = [];

  private sendAccumulator = 0;
  private static readonly SEND_INTERVAL = 1 / 25; // 25Hz sync

  private reconnectTimer: number | null = null;

  constructor(scene: THREE.Scene, callbacks: RoomUpdateCallbacks = {}) {
    this.scene = scene;
    this.callbacks = callbacks;
  }

  public connect(customUrl?: string): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const params = new URLSearchParams(window.location.search);
    this.roomId = params.get('room') || 'default';

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const isViteDev = window.location.port === '5173';
    const hostWithPort = isViteDev
      ? `${window.location.hostname || 'localhost'}:3001`
      : window.location.host || 'localhost:3001';

    const envWsUrl = (import.meta as unknown as { env?: Record<string, string> })
      .env?.VITE_WS_URL;
    const baseWsUrl = customUrl || envWsUrl || `${protocol}//${hostWithPort}/`;
    const separator = baseWsUrl.includes('?') ? '&' : '?';
    const wsUrl = customUrl
      ? customUrl
      : `${baseWsUrl}${separator}room=${encodeURIComponent(this.roomId)}`;

    try {
      this.ws = new WebSocket(wsUrl);
    } catch {
      return;
    }

    this.ws.addEventListener('open', () => {
      this.connected = true;
    });

    this.ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'welcome') {
          this.localPlayerId = msg.playerId;
          this.localColor = msg.color;
          this.roomId = msg.roomId;
          this.matchSeed = msg.matchSeed;
        } else if (msg.type === 'room_state') {
          const prevState = this.matchState;
          const prevSeed = this.matchSeed;

          this.matchState = msg.matchState;
          this.matchSeed = msg.matchSeed;
          this.countdownRemaining = msg.countdownRemaining || 0;
          this.matchElapsedSec = msg.matchElapsedSec || 0;
          this.allRoomPlayers = msg.players || [];

          if (
            prevSeed !== this.matchSeed ||
            (prevState !== 'COUNTDOWN' &&
              prevState !== 'ACTIVE' &&
              (this.matchState === 'COUNTDOWN' || this.matchState === 'ACTIVE'))
          ) {
            const selfData = this.allRoomPlayers.find(
              (p) => p.id === this.localPlayerId
            );
            this.callbacks.onMatchSeedChanged?.(
              this.matchSeed,
              selfData ? selfData.x : 0
            );
          }

          if (prevState !== this.matchState) {
            this.callbacks.onMatchStateChanged?.(
              prevState,
              this.matchState,
              this.matchSeed
            );
          }

          this.syncRemoteEntities(this.allRoomPlayers);
          this.callbacks.onRoomStateUpdated?.();
        }
      } catch {
        // Ignore parse error
      }
    });

    this.ws.addEventListener('close', () => {
      this.connected = false;
      this.reconnectTimer = window.setTimeout(() => {
        this.connect(customUrl);
      }, 2500);
    });

    this.ws.addEventListener('error', () => {
      // Allows silent fallback to solo mode when offline
    });
  }

  private syncRemoteEntities(players: RemotePlayerSnapshot[]): void {
    const activeIds = new Set<string>();

    for (const p of players) {
      if (p.id === this.localPlayerId) continue;
      activeIds.add(p.id);

      let entity = this.remotePlayers.get(p.id);
      if (!entity) {
        const rig = new PlayerRig(p.color || 0xff007f);
        rig.attachToScene(this.scene);
        rig.resetTrail(p.x, p.y, p.z, p.yaw);
        entity = {
          snapshot: p,
          renderPos: new THREE.Vector3(p.x, p.y, p.z),
          renderVel: new THREE.Vector3(p.vx, p.vy, p.vz),
          renderYaw: p.yaw,
          rig,
        };
        this.remotePlayers.set(p.id, entity);
      } else {
        entity.snapshot = p;
      }
    }

    for (const [id, entity] of this.remotePlayers.entries()) {
      if (!activeIds.has(id)) {
        entity.rig.detachFromScene(this.scene);
        this.remotePlayers.delete(id);
      }
    }
  }

  public updateAndSend(
    dt: number,
    localState: Omit<RemotePlayerSnapshot, 'id' | 'name' | 'color'>
  ): void {
    // Smoothly interpolate all remote players in 3D space
    for (const entity of this.remotePlayers.values()) {
      const s = entity.snapshot;
      const targetPos = new THREE.Vector3(s.x, s.y, s.z);
      // Dead-reckoning assist + smooth lerp
      targetPos.x += s.vx * 0.02;
      targetPos.z += s.vz * 0.02;

      if (entity.renderPos.distanceTo(targetPos) > 400) {
        entity.renderPos.copy(targetPos);
        entity.rig.resetTrail(targetPos.x, targetPos.y, targetPos.z, s.yaw);
      } else {
        entity.renderPos.lerp(targetPos, Math.min(1, dt * 16));
      }

      entity.renderVel.set(s.vx, s.vy, s.vz);
      entity.renderYaw += (s.yaw - entity.renderYaw) * Math.min(1, dt * 16);

      entity.rig.updateTransform(
        entity.renderPos,
        entity.renderVel,
        entity.renderYaw,
        dt,
        {
          grounded: s.state === 'grounded',
          ups: s.ups,
          vel: entity.renderVel,
          viewYaw: entity.renderYaw,
          smove: 0,
          fmove: s.ups > 20 ? 320 : 0,
          isDashing: s.state === 'dashing',
        }
      );
    }

    // 25Hz client-authoritative position & UPS broadcast
    this.sendAccumulator += dt;
    if (this.sendAccumulator >= NetworkClient.SEND_INTERVAL) {
      this.sendAccumulator = 0;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(
          JSON.stringify({
            type: 'player_update',
            ...localState,
          })
        );
      }
    }
  }

  public requestStartMatch(instant = false, seed?: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'start_match',
          instant,
          seed,
        })
      );
    } else {
      // Offline / Solo fallback
      const newSeed = seed ?? (((Date.now() ^ 0x5f3759df) >>> 0) || 1337420);
      this.matchSeed = newSeed;
      this.matchElapsedSec = 0;
      this.callbacks.onMatchSeedChanged?.(newSeed, 0);
      const prev = this.matchState;
      this.matchState = instant ? 'ACTIVE' : 'COUNTDOWN';
      this.countdownRemaining = instant ? 0 : 3.0;
      this.callbacks.onMatchStateChanged?.(prev, this.matchState, newSeed);
    }
  }

  public getRemotePlayersCount(): number {
    return this.remotePlayers.size;
  }

  public getRemoteSnapshots(): RemotePlayerSnapshot[] {
    return Array.from(this.remotePlayers.values()).map((e) => e.snapshot);
  }
}
