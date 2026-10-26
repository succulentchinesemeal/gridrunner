import {
  MatchState,
  PlayerInputTelemetry,
  RemotePlayerSnapshot,
} from '../network/NetworkClient';
import { BUILTIN_PERKS, PerkManager } from '../physics/PerkManager';
import { PlayerPhysics } from '../physics/PlayerPhysics';

export interface SpectatorHudState {
  active: boolean;
  target: RemotePlayerSnapshot | null;
  targetIndex: number;
  aliveCount: number;
  smoothedMouseDx: number;
  smoothedMouseDy: number;
}

export class HudController {
  private upsValueEl: HTMLElement | null;
  private upsUnitEl: HTMLElement | null;
  private syncFillEl: HTMLElement | null;
  private syncTextEl: HTMLElement | null;
  private bhopChainEl: HTMLElement | null;
  private dashStatusEl: HTMLElement | null;
  private djumpStatusEl: HTMLElement | null;
  private distanceTextEl: HTMLElement | null;
  private wallDistTextEl: HTMLElement | null;
  private raceTrackBarEl: HTMLElement | null;
  private lobbyPanelEl: HTMLElement | null;
  private lobbyPlayersEl: HTMLElement | null;
  private countdownOverlayEl: HTMLElement | null;
  private podiumPanelEl: HTMLElement | null;
  private podiumRowsEl: HTMLElement | null;
  private dangerVignetteEl: HTMLElement | null;
  private actionPromptBannerEl: HTMLElement | null;
  private camModeEl: HTMLElement | null;
  private collisionToggleEl: HTMLElement | null;
  private lobbyModeToggleBtn: HTMLElement | null;
  private promptTimer: number | null = null;

  // Spectator & Input/Cursor Telemetry HUD Elements
  private spectatorPanelEl: HTMLElement | null;
  private spectatorTargetNameEl: HTMLElement | null;
  private spectatorSubHintEl: HTMLElement | null;
  private inputOwnerEl: HTMLElement | null;
  private cursorDeltaEl: HTMLElement | null;
  private cursorDotEl: HTMLElement | null;
  private cursorDirLeftEl: HTMLElement | null;
  private cursorDirRightEl: HTMLElement | null;
  private keyWEl: HTMLElement | null;
  private keyAEl: HTMLElement | null;
  private keySEl: HTMLElement | null;
  private keyDEl: HTMLElement | null;
  private keyJumpEl: HTMLElement | null;
  private keyDashEl: HTMLElement | null;

  constructor(
    perkManager: PerkManager,
    onStartMatchClick: () => void,
    onRematchClick: () => void,
    onToggleCameraMode?: () => void,
    onCycleSpectator?: (dir: 1 | -1) => void,
    onToggleCollisions?: () => void
  ) {
    this.upsValueEl = document.getElementById('hud-ups-value');
    this.upsUnitEl = document.getElementById('hud-ups-unit');
    this.syncFillEl = document.getElementById('hud-sync-fill');
    this.syncTextEl = document.getElementById('hud-sync-text');
    this.bhopChainEl = document.getElementById('hud-bhop-chain');
    this.dashStatusEl = document.getElementById('hud-dash-status');
    this.djumpStatusEl = document.getElementById('hud-djump-status');
    this.distanceTextEl = document.getElementById('hud-distance-val');
    this.wallDistTextEl = document.getElementById('hud-wall-val');
    this.raceTrackBarEl = document.getElementById('hud-race-markers');
    this.lobbyPanelEl = document.getElementById('lobby-panel');
    this.lobbyPlayersEl = document.getElementById('lobby-players-list');
    this.countdownOverlayEl = document.getElementById('countdown-overlay');
    this.podiumPanelEl = document.getElementById('podium-panel');
    this.podiumRowsEl = document.getElementById('podium-rows');
    this.dangerVignetteEl = document.getElementById('laser-danger-vignette');
    this.actionPromptBannerEl = document.getElementById('action-prompt-banner');
    this.camModeEl = document.getElementById('hud-cam-mode');
    this.collisionToggleEl = document.getElementById('hud-collision-toggle');
    this.lobbyModeToggleBtn = document.getElementById('lobby-mode-toggle');

    this.spectatorPanelEl = document.getElementById('spectator-panel');
    this.spectatorTargetNameEl = document.getElementById(
      'spectator-target-name'
    );
    this.spectatorSubHintEl = document.getElementById('spectator-sub-hint');
    this.inputOwnerEl = document.getElementById('hud-input-owner');
    this.cursorDeltaEl = document.getElementById('hud-cursor-delta');
    this.cursorDotEl = document.getElementById('hud-cursor-dot');
    this.cursorDirLeftEl = document.getElementById('hud-cursor-dir-left');
    this.cursorDirRightEl = document.getElementById('hud-cursor-dir-right');
    this.keyWEl = document.getElementById('hud-key-w');
    this.keyAEl = document.getElementById('hud-key-a');
    this.keySEl = document.getElementById('hud-key-s');
    this.keyDEl = document.getElementById('hud-key-d');
    this.keyJumpEl = document.getElementById('hud-key-jump');
    this.keyDashEl = document.getElementById('hud-key-dash');

    const prevSpecBtn = document.getElementById('spec-prev-btn');
    prevSpecBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      onCycleSpectator?.(-1);
    });

    const nextSpecBtn = document.getElementById('spec-next-btn');
    nextSpecBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      onCycleSpectator?.(1);
    });

    this.camModeEl?.addEventListener('click', (e) => {
      e.stopPropagation();
      onToggleCameraMode?.();
    });

    this.collisionToggleEl?.addEventListener('click', (e) => {
      e.stopPropagation();
      onToggleCollisions?.();
    });

    this.lobbyModeToggleBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      onToggleCollisions?.();
    });

    const startBtn = document.getElementById('start-match-btn');
    startBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      onStartMatchClick();
    });

    const rematchBtn = document.getElementById('rematch-btn');
    rematchBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      onRematchClick();
    });

    const roomCodeEl = document.getElementById('lobby-room-code');
    const currentRoom =
      new URLSearchParams(window.location.search).get('room') || 'default';
    if (roomCodeEl) {
      roomCodeEl.textContent = currentRoom.toUpperCase();
    }

    const copyInviteBtn = document.getElementById('copy-invite-btn');
    copyInviteBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = new URL(window.location.href);
      url.searchParams.set('room', currentRoom);
      navigator.clipboard?.writeText(url.toString()).catch(() => {});
      if (copyInviteBtn) {
        copyInviteBtn.textContent = 'COPIED!';
        window.setTimeout(() => {
          copyInviteBtn.textContent = 'COPY INVITE';
        }, 1800);
      }
    });

    const newRoomBtn = document.getElementById('new-room-btn');
    newRoomBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const code = `grid-${Math.random().toString(36).slice(2, 6)}`;
      const url = new URL(window.location.href);
      url.searchParams.set('room', code);
      window.location.href = url.toString();
    });

    // Populate Roguelike Perk Selector cards
    const perkContainer = document.getElementById('perk-cards-container');
    if (perkContainer) {
      perkContainer.innerHTML = '';
      for (const perk of BUILTIN_PERKS) {
        const btn = document.createElement('button');
        btn.className = 'perk-card';
        btn.dataset.perkId = perk.id;
        btn.innerHTML = `<strong>${perk.name}</strong><span>${perk.description}</span>`;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const alreadyActive = perkManager
            .getActivePerks()
            .some((p) => p.id === perk.id);
          if (alreadyActive) {
            perkManager.clearPerks();
            perkContainer
              .querySelectorAll('.perk-card')
              .forEach((el) => el.classList.remove('active'));
          } else {
            perkManager.clearPerks();
            perkManager.addPerk(perk);
            perkContainer
              .querySelectorAll('.perk-card')
              .forEach((el) => el.classList.remove('active'));
            btn.classList.add('active');
          }
        });
        perkContainer.appendChild(btn);
      }
    }
  }

  public setCameraModeLabel(mode: string): void {
    if (this.camModeEl) {
      const label = mode === 'FIRST_PERSON' ? '1ST PERSON' : mode;
      this.camModeEl.textContent = `CAM [V]: ${label}`;
    }
  }

  public setCollisionsLabel(enabled: boolean, mode?: string): void {
    const isComp = mode === 'COMPETITIVE' || enabled;
    if (this.collisionToggleEl) {
      this.collisionToggleEl.textContent = isComp
        ? 'COLLISIONS [C]: SOLID'
        : 'COLLISIONS [C]: FLOW';
      if (isComp) {
        this.collisionToggleEl.classList.add('comp-active');
      } else {
        this.collisionToggleEl.classList.remove('comp-active');
      }
    }
    if (this.lobbyModeToggleBtn) {
      this.lobbyModeToggleBtn.textContent = isComp
        ? 'MODE: COMPETITIVE (SOLID COLLISIONS)'
        : 'MODE: FLOW (FORGIVING)';
      if (isComp) {
        this.lobbyModeToggleBtn.style.borderColor = 'var(--neon-magenta)';
        this.lobbyModeToggleBtn.style.color = 'var(--neon-magenta)';
        this.lobbyModeToggleBtn.style.background = 'rgba(255, 0, 127, 0.15)';
      } else {
        this.lobbyModeToggleBtn.style.borderColor = 'var(--neon-cyan)';
        this.lobbyModeToggleBtn.style.color = 'var(--neon-cyan)';
        this.lobbyModeToggleBtn.style.background = 'rgba(0, 243, 255, 0.12)';
      }
    }
  }

  public showActionBanner(text: string, durationMs = 2800): void {
    if (!this.actionPromptBannerEl) return;
    this.actionPromptBannerEl.textContent = text;
    this.actionPromptBannerEl.style.opacity = '1';
    this.actionPromptBannerEl.style.transform = 'translateX(-50%) translateY(0)';
    if (this.promptTimer !== null) {
      window.clearTimeout(this.promptTimer);
    }
    this.promptTimer = window.setTimeout(() => {
      if (this.actionPromptBannerEl) {
        this.actionPromptBannerEl.style.opacity = '0.9';
        this.actionPromptBannerEl.textContent =
          '⚡ HOLD [W] TO SPRINT — [SPACE] + STRAFE [A/D] TO BHOP — [C] TOGGLE SOLID COLLISIONS';
      }
    }, durationMs);
  }

  public update(
    physics: PlayerPhysics,
    matchState: MatchState,
    countdownRemaining: number,
    wallZ: number,
    localPlayerId: string,
    allPlayers: RemotePlayerSnapshot[],
    localInputTelemetry?: PlayerInputTelemetry,
    spectatorState?: SpectatorHudState
  ): void {
    const specTarget =
      spectatorState?.active && spectatorState.target
        ? spectatorState.target
        : null;

    const ups = Math.round(specTarget ? specTarget.ups : physics.ups);
    const topUps = Math.round(specTarget ? specTarget.topUps : physics.topUps);
    const sync = Math.round(
      specTarget ? specTarget.strafeSync : physics.strafeSync
    );
    const bhopChain = specTarget
      ? specTarget.bhopChain ?? 0
      : physics.bhopChain;
    const activeDistance = specTarget ? specTarget.distance : physics.distance;
    const activePosZ = specTarget ? specTarget.z : physics.pos.z;

    // 1. Live UPS Speedometer with CS/KZ tier color styling
    if (this.upsValueEl) {
      this.upsValueEl.textContent = String(ups);
      this.upsValueEl.classList.remove('tier-base', 'tier-cyan', 'tier-magenta');
      if (ups >= 700) {
        this.upsValueEl.classList.add('tier-magenta');
      } else if (ups >= 500) {
        this.upsValueEl.classList.add('tier-cyan');
      } else {
        this.upsValueEl.classList.add('tier-base');
      }
    }
    if (this.upsUnitEl) {
      this.upsUnitEl.textContent = specTarget
        ? `${specTarget.name} UPS (TOP ${topUps})`
        : `UPS (TOP ${topUps})`;
    }

    // 2. Strafe Sync HUD Indicator
    if (this.syncFillEl) {
      this.syncFillEl.style.width = `${Math.min(100, Math.max(0, sync))}%`;
    }
    if (this.syncTextEl) {
      this.syncTextEl.textContent = `STRAFE SYNC ${sync}%`;
    }
    if (this.bhopChainEl) {
      this.bhopChainEl.textContent =
        bhopChain > 1 ? `BHOP CHAIN x${bhopChain}` : 'BHOP READY';
    }

    // 3. Dash & Double Jump Charge Indicators
    if (this.dashStatusEl) {
      if (specTarget) {
        const isDashing = Boolean(specTarget.inputs?.dash);
        this.dashStatusEl.textContent = isDashing
          ? 'CONC DASH [ACTIVE]'
          : 'CONC DASH [READY]';
        this.dashStatusEl.classList.add('ready');
      } else if (physics.dashCooldownTimer <= 0) {
        this.dashStatusEl.textContent = 'CONC DASH [READY]';
        this.dashStatusEl.classList.add('ready');
      } else {
        this.dashStatusEl.textContent = `CONC DASH [${physics.dashCooldownTimer.toFixed(1)}s]`;
        this.dashStatusEl.classList.remove('ready');
      }
    }
    if (this.djumpStatusEl) {
      if (specTarget) {
        this.djumpStatusEl.textContent = `SPEC CHASE CAM`;
        this.djumpStatusEl.classList.add('ready');
      } else {
        this.djumpStatusEl.textContent = `AIR JUMP [${physics.remainingAirJumps}]`;
        if (physics.remainingAirJumps > 0) {
          this.djumpStatusEl.classList.add('ready');
        } else {
          this.djumpStatusEl.classList.remove('ready');
        }
      }
    }

    // 4. Distance & Derezzing Wall Proximity + Danger Vignette & Intuitive Prompts
    const distMeters = Math.round(activeDistance / 32);
    if (this.distanceTextEl) {
      this.distanceTextEl.textContent = `${distMeters}m (${Math.round(activeDistance)}u)`;
    }
    const gapUnits = Math.max(0, Math.round(wallZ - activePosZ));
    const gapMeters = Math.round(gapUnits / 32);
    if (this.wallDistTextEl) {
      this.wallDistTextEl.textContent = `${gapMeters}m`;
    }

    if (this.dangerVignetteEl) {
      if (matchState === 'ACTIVE' && gapUnits < 720) {
        const dangerAlpha = Math.min(0.95, Math.max(0.15, 1 - gapUnits / 720));
        this.dangerVignetteEl.style.opacity = dangerAlpha.toFixed(2);
      } else {
        this.dangerVignetteEl.style.opacity = '0';
      }
    }

    // Spectator Chase Cam Panel & Action Prompt Banner
    if (this.spectatorPanelEl) {
      if (spectatorState?.active && specTarget) {
        this.spectatorPanelEl.style.display = 'flex';
        const hex = `#${(specTarget.color || 0x00f3ff).toString(16).padStart(6, '0')}`;
        this.spectatorPanelEl.style.borderColor = hex;
        if (this.spectatorTargetNameEl) {
          this.spectatorTargetNameEl.textContent = `${specTarget.name} (${spectatorState.targetIndex + 1}/${spectatorState.aliveCount})`;
          this.spectatorTargetNameEl.style.color = hex;
        }
        if (this.spectatorSubHintEl) {
          this.spectatorSubHintEl.textContent =
            spectatorState.aliveCount > 1
              ? 'CLICK OR PRESS [A / D / ← / → / TAB] TO CYCLE REMAINING PLAYERS'
              : 'FOLLOWING LAST REMAINING RUNNER ON THE GRID';
        }
      } else {
        this.spectatorPanelEl.style.display = 'none';
      }
    }

    // Live Button Movements & Cursor Movements HUD (shows spectated player's inputs when spectating, or local player's when alive)
    const activeInputs: PlayerInputTelemetry = specTarget?.inputs
      ? {
          ...specTarget.inputs,
          mouseDx: spectatorState?.smoothedMouseDx ?? specTarget.inputs.mouseDx,
          mouseDy: spectatorState?.smoothedMouseDy ?? specTarget.inputs.mouseDy,
        }
      : localInputTelemetry ?? {
          w: false,
          a: false,
          s: false,
          d: false,
          jump: false,
          dash: false,
          mouseDx: 0,
          mouseDy: 0,
        };

    if (this.inputOwnerEl) {
      if (specTarget) {
        const hex = `#${(specTarget.color || 0x00f3ff).toString(16).padStart(6, '0')}`;
        this.inputOwnerEl.textContent = `SPECTATING // ${specTarget.name}`;
        this.inputOwnerEl.style.color = hex;
      } else {
        this.inputOwnerEl.textContent = 'INPUT TELEMETRY // YOU';
        this.inputOwnerEl.style.color = 'var(--neon-cyan)';
      }
    }

    this.keyWEl?.classList.toggle('active', Boolean(activeInputs.w));
    this.keyAEl?.classList.toggle('active', Boolean(activeInputs.a));
    this.keySEl?.classList.toggle('active', Boolean(activeInputs.s));
    this.keyDEl?.classList.toggle('active', Boolean(activeInputs.d));
    this.keyJumpEl?.classList.toggle('active', Boolean(activeInputs.jump));
    this.keyDashEl?.classList.toggle('active', Boolean(activeInputs.dash));

    const dx = activeInputs.mouseDx || 0;
    const dy = activeInputs.mouseDy || 0;
    const maxPadOffset = 26;
    const offsetX = Math.max(
      -maxPadOffset,
      Math.min(maxPadOffset, (dx / 100) * maxPadOffset)
    );
    const offsetY = Math.max(
      -maxPadOffset,
      Math.min(maxPadOffset, (dy / 100) * maxPadOffset)
    );

    if (this.cursorDotEl) {
      this.cursorDotEl.style.transform = `translate(calc(-50% + ${offsetX.toFixed(1)}px), calc(-50% + ${offsetY.toFixed(1)}px))`;
    }
    if (this.cursorDeltaEl) {
      this.cursorDeltaEl.textContent = `AIM Δ ${Math.round(dx)}, ${Math.round(dy)}`;
    }
    this.cursorDirLeftEl?.classList.toggle('active', dx < -1.5);
    this.cursorDirRightEl?.classList.toggle('active', dx > 1.5);

    if (this.actionPromptBannerEl) {
      if (!physics.alive) {
        this.actionPromptBannerEl.style.opacity = '1';
        this.actionPromptBannerEl.classList.add('danger');
        this.actionPromptBannerEl.textContent = specTarget
          ? `⚠ DEREZZED — SPECTATING ${specTarget.name} (CHASE CAM)`
          : '⚠ DEREZZED BY LASER HAZARD — AWAITING NEXT ROUND...';
      } else if (matchState === 'ACTIVE' && gapUnits < 680) {
        this.actionPromptBannerEl.style.opacity = '1';
        this.actionPromptBannerEl.classList.add('danger');
        this.actionPromptBannerEl.textContent = `⚠ LASER WALL ${gapMeters}m BEHIND YOU — HOLD [W] OR PRESS [SHIFT] TO DASH AHEAD!`;
      } else if (ups < 180 && physics.distance < 600) {
        this.actionPromptBannerEl.style.opacity = '1';
        this.actionPromptBannerEl.classList.remove('danger');
        this.actionPromptBannerEl.textContent =
          '⚡ HOLD [W] TO SPRINT FORWARD — THEN HOLD [SPACE] + [A/D] TO BHOP!';
      } else if (ups >= 300 && physics.bhopChain <= 1 && physics.distance < 1500) {
        this.actionPromptBannerEl.style.opacity = '0.9';
        this.actionPromptBannerEl.classList.remove('danger');
        this.actionPromptBannerEl.textContent =
          '💡 TIP: JUMP [SPACE], RELEASE [W], AND STRAFE [A/D] + MOUSE TURN TO GAIN 500+ UPS!';
      } else {
        this.actionPromptBannerEl.style.opacity = '0';
      }
    }

    // 5. Top 6-Player Race Progress Bar
    const roster: RemotePlayerSnapshot[] =
      allPlayers.length > 0
        ? allPlayers
        : [
            {
              id: localPlayerId,
              name: 'YOU',
              color: 0x00f3ff,
              x: physics.pos.x,
              y: physics.pos.y,
              z: physics.pos.z,
              vx: physics.vel.x,
              vy: physics.vel.y,
              vz: physics.vel.z,
              yaw: physics.viewYaw,
              state: physics.grounded ? 'grounded' : 'airborne',
              ups,
              topUps: Math.round(physics.topUps),
              strafeSync: sync,
              alive: physics.alive,
              distance: Math.round(physics.distance),
            },
          ];

    if (this.raceTrackBarEl) {
      const maxDist = Math.max(
        4000,
        ...roster.map((p) =>
          p.id === localPlayerId ? physics.distance : p.distance
        )
      );
      this.raceTrackBarEl.innerHTML = roster
        .map((p) => {
          const d = p.id === localPlayerId ? physics.distance : p.distance;
          const pct = Math.min(96, Math.max(2, (d / maxDist) * 94));
          const hex = `#${(p.color || 0x00f3ff).toString(16).padStart(6, '0')}`;
          const label = p.id === localPlayerId ? 'YOU' : p.name;
          return `<div class="race-pip" style="left:${pct.toFixed(1)}%; border-color:${hex}; color:${hex};">
            <span class="pip-dot" style="background:${hex}"></span>
            <span class="pip-label">${label} (${Math.round(p.id === localPlayerId ? ups : p.ups)} UPS)</span>
          </div>`;
        })
        .join('');
    }

    // 6. Session Lifecycle Panels (LOBBY / COUNTDOWN / ACTIVE / PODIUM)
    if (this.lobbyPanelEl) {
      this.lobbyPanelEl.style.display =
        matchState === 'LOBBY' ? 'flex' : 'none';
      if (matchState === 'LOBBY' && this.lobbyPlayersEl) {
        this.lobbyPlayersEl.innerHTML = roster
          .map((p) => {
            const hex = `#${(p.color || 0x00f3ff).toString(16).padStart(6, '0')}`;
            return `<div class="lobby-player-chip" style="border-color:${hex}">
              <span class="chip-dot" style="background:${hex}"></span>
              <span>${p.id === localPlayerId ? `${p.name} (YOU)` : p.name}</span>
              <span class="chip-ups">${Math.round(p.id === localPlayerId ? ups : p.ups)} UPS</span>
            </div>`;
          })
          .join('');
      }
    }

    if (this.countdownOverlayEl) {
      if (matchState === 'COUNTDOWN') {
        this.countdownOverlayEl.style.display = 'flex';
        const sec = Math.ceil(Math.max(1, countdownRemaining));
        this.countdownOverlayEl.textContent = String(sec);
      } else {
        this.countdownOverlayEl.style.display = 'none';
      }
    }

    if (this.podiumPanelEl) {
      this.podiumPanelEl.style.display =
        matchState === 'PODIUM' ? 'flex' : 'none';
      if (matchState === 'PODIUM' && this.podiumRowsEl) {
        const sorted = [...roster].sort((a, b) => b.distance - a.distance);
        this.podiumRowsEl.innerHTML = sorted
          .map((p, idx) => {
            const isSelf = p.id === localPlayerId;
            const d = isSelf ? Math.round(physics.distance) : Math.round(p.distance);
            const top = isSelf ? Math.round(physics.topUps) : Math.round(p.topUps);
            const s = isSelf ? physics.strafeSync : Math.round(p.strafeSync);
            return `<tr>
              <td>#${idx + 1}</td>
              <td>${isSelf ? `${p.name} (YOU)` : p.name}</td>
              <td>${Math.round(d / 32)}m (${d}u)</td>
              <td>${top} UPS</td>
              <td>${s}%</td>
            </tr>`;
          })
          .join('');
      }
    }
  }
}
