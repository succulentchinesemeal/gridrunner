export interface PlayerStats {
  sv_gravity: number;
  sv_maxspeed: number;
  sv_accelerate: number;
  sv_airaccelerate: number;
  sv_friction: number;
  sv_stopspeed: number;
  jumpImpulse: number;
  airWishCap: number;
  maxBhopSpeed: number;
  dashImpulse: number;
  dashVerticalMin: number;
  dashCooldown: number;
  extraJumps: number;
}

export interface PerkModifier {
  id: string;
  name: string;
  description: string;
  apply(stats: PlayerStats): PlayerStats;
}

export const DEFAULT_GOLDSRC_STATS: PlayerStats = {
  sv_gravity: 800,
  sv_maxspeed: 320,
  sv_accelerate: 10,
  sv_airaccelerate: 15, // Crisp TFC/CS bhop default (tunable 10-100)
  sv_friction: 4.0,
  sv_stopspeed: 100,
  jumpImpulse: Math.sqrt(2 * 800 * 45), // ~268.328157 units/s
  airWishCap: 30, // Legendary GoldSrc 30-unit air wishspeed cap
  maxBhopSpeed: 900, // 2.8x base speed ceiling
  dashImpulse: 280,
  dashVerticalMin: 120,
  dashCooldown: 2.0,
  extraJumps: 1, // 1 mid-air double jump charge
};

export const BUILTIN_PERKS: PerkModifier[] = [
  {
    id: 'kz_surfer',
    name: 'Kreedz Air Tensor',
    description: 'Increases sv_airaccelerate to 35 for razor-sharp air carving.',
    apply: (s) => ({ ...s, sv_airaccelerate: s.sv_airaccelerate + 20 }),
  },
  {
    id: 'conc_overclock',
    name: 'TFC Conc Overclock',
    description: 'Reduces Impulse Dash cooldown by 30% and adds +60 dash boost.',
    apply: (s) => ({
      ...s,
      dashCooldown: s.dashCooldown * 0.7,
      dashImpulse: s.dashImpulse + 60,
    }),
  },
  {
    id: 'sky_walker',
    name: 'Sky-Grid Thruster',
    description: 'Grants +1 additional mid-air jump charge preserving 100% bhop momentum.',
    apply: (s) => ({ ...s, extraJumps: s.extraJumps + 1 }),
  },
  {
    id: 'overdrive_cap',
    name: 'Uncapped 1.3 Core',
    description: 'Raises airWishCap to 36 and maxBhopSpeed to 1050 UPS.',
    apply: (s) => ({ ...s, airWishCap: 36, maxBhopSpeed: 1050 }),
  },
];

export class PerkManager {
  private activePerks: PerkModifier[] = [];
  private baseStats: PlayerStats;

  constructor(baseStats: PlayerStats = DEFAULT_GOLDSRC_STATS) {
    this.baseStats = { ...baseStats };
  }

  public addPerk(perk: PerkModifier): void {
    if (!this.activePerks.some((p) => p.id === perk.id)) {
      this.activePerks.push(perk);
    }
  }

  public clearPerks(): void {
    this.activePerks = [];
  }

  public getActivePerks(): ReadonlyArray<PerkModifier> {
    return this.activePerks;
  }

  public setBaseStat<K extends keyof PlayerStats>(key: K, value: PlayerStats[K]): void {
    this.baseStats[key] = value;
  }

  public computeStats(): PlayerStats {
    return this.activePerks.reduce((acc, perk) => perk.apply(acc), { ...this.baseStats });
  }
}
