import { MatchState, RemotePlayerSnapshot } from '../network/NetworkClient';
import { BUILTIN_PERKS, PerkManager } from '../physics/PerkManager';
import { PlayerPhysics } from '../physics/PlayerPhysics';

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

  constructor(
    perkManager: PerkManager,
    onStartMatchClick: () => void,
    onRematchClick: () => void
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

  public update(
    physics: PlayerPhysics,
    matchState: MatchState,
    countdownRemaining: number,
    wallZ: number,
    localPlayerId: string,
    allPlayers: RemotePlayerSnapshot[]
  ): void {
    const ups = Math.round(physics.ups);

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
      this.upsUnitEl.textContent = `UPS (TOP ${Math.round(physics.topUps)})`;
    }

    // 2. Strafe Sync HUD Indicator
    const sync = physics.strafeSync;
    if (this.syncFillEl) {
      this.syncFillEl.style.width = `${Math.min(100, Math.max(0, sync))}%`;
    }
    if (this.syncTextEl) {
      this.syncTextEl.textContent = `STRAFE SYNC ${sync}%`;
    }
    if (this.bhopChainEl) {
      this.bhopChainEl.textContent =
        physics.bhopChain > 1 ? `BHOP CHAIN x${physics.bhopChain}` : 'BHOP READY';
    }

    // 3. Dash & Double Jump Charge Indicators
    if (this.dashStatusEl) {
      if (physics.dashCooldownTimer <= 0) {
        this.dashStatusEl.textContent = 'CONC DASH [READY]';
        this.dashStatusEl.classList.add('ready');
      } else {
        this.dashStatusEl.textContent = `CONC DASH [${physics.dashCooldownTimer.toFixed(1)}s]`;
        this.dashStatusEl.classList.remove('ready');
      }
    }
    if (this.djumpStatusEl) {
      this.djumpStatusEl.textContent = `AIR JUMP [${physics.remainingAirJumps}]`;
      if (physics.remainingAirJumps > 0) {
        this.djumpStatusEl.classList.add('ready');
      } else {
        this.djumpStatusEl.classList.remove('ready');
      }
    }

    // 4. Distance & Derezzing Wall Proximity + Danger Vignette & Intuitive Prompts
    const distMeters = Math.round(physics.distance / 32);
    if (this.distanceTextEl) {
      this.distanceTextEl.textContent = `${distMeters}m (${Math.round(physics.distance)}u)`;
    }
    const gapUnits = Math.max(0, Math.round(wallZ - physics.pos.z));
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

    if (this.actionPromptBannerEl) {
      if (!physics.alive) {
        this.actionPromptBannerEl.style.opacity = '1';
        this.actionPromptBannerEl.classList.add('danger');
        this.actionPromptBannerEl.textContent =
          '⚠ DEREZZED BY LASER HAZARD — RESPAWNING ON GRID...';
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
