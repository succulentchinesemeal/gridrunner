# GridRunner Visual & Mechanical Progression Log

This breadcrumb log is automatically updated by `npm run snapshot`. Each entry records the exact Git commit, deterministic GoldSrc 100Hz physics metrics, track archetype stats, and screenshots so you can roll back to any checkpoint with `git checkout <commit>`.

---

## [2026-10-26T01:37:55Z] Commit `6ece65c` (`master`) — v0.5 Baseline: Outrun visuals, Flow vs Competitive collisions, and AI workflow foundation

- **Git Rollback Command**: `git checkout 6ece65c`
- **Commit Message**: feat(renderer): add procedural textures, synthwave environment, and upgraded acrobat rig
- **Milestone Note**: v0.5 Baseline: Outrun visuals, Flow vs Competitive collisions, and AI workflow foundation

| Metric | Value | Target / Invariant |
| :--- | :--- | :--- |
| Ground Run Speed | **320.00 UPS** | 320.00 UPS |
| Air Hold-W Turn Speed | **323.84 UPS** | 315–350 UPS |
| 4-Hop Air-Strafe Speed | **577.76 UPS** | > 500 UPS |
| Strafe Sync / Bhop Chain | **83% / 5 hops** | >= 75% |
| Derezz Wall Speed (7.5k Z) | **226.5 UPS** | Progressive ramp |
| Active Track Archetypes | `HALFPIPE_CARVE`, `SKY_ARCHIPELAGO`, `RUNWAY`, `CANYON_WAVE`, `SPLIT_ELEVATION`, `HALFPIPE_CARVE` | Deterministic seed `1337420` |

*(Run `npm run snapshot` with browser access to attach Playwright screenshots)*

---
