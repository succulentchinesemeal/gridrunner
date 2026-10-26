# GridRunner Agent Development Constitution (`AGENTS.md`)

All AI coding agents (Antigravity, Gemini Flash, Gemini Argon, subagents) working in this repository **MUST** follow these rules on every task.

---

## 1. Git, Branching & Rollback Rules (CRITICAL)

1. **Check Git Status First**:
   - At the beginning of every task, run `git status` and `git branch --show-current`.
   - If there are uncommitted changes from a previous session, **do not overwrite them**. Commit or stash them first, or ask the user.
2. **Work on Feature Branches — Never Directly on `master`**:
   - Before editing code for a new feature, graphic pass, or physics tweak, create or switch to a descriptive branch:
     - `git checkout -b feat/<short-name>`
     - `git checkout -b fix/<short-name>`
     - `git checkout -b refactor/<short-name>`
3. **Windows Sandbox Git Rule (`BypassSandbox: true`)**:
   - On Windows, `.git/index.lock` creation is blocked inside the standard sandbox. Whenever running **write** git commands (`git add`, `git commit`, `git checkout -b`, `git tag`, `git merge`, `git push`), set `BypassSandbox: true` in `run_command`.
4. **Atomic Commits After Every Working Step**:
   - Do not accumulate thousands of uncommitted lines across 10 files.
   - As soon as a logical sub-step compiles (`npm run build`) and passes physics checks (`npm run test:physics`), make an atomic commit (`git commit -m "feat(scope): summary"`).
5. **NEVER Auto-Merge to `master` or Auto-Push to `origin/master`**:
   - **Do NOT merge your feature branch into `master`** unless the user explicitly instructs you to `"merge to master"` or `"lock this in"`.
   - **NEVER run `git push origin master`** unless explicitly asked—`origin/master` is connected to the live Render production relic! Push new work to `origin/v2` or feature branches instead.
   - Finish your task on the feature branch, run `npm run snapshot`, and report the branch name and commit hash so the user can test and roll back at any time.

---

## 2. Visual & Mechanical Breadcrumb Trail (`docs/PROGRESSION.md`)

To preserve a complete history of how graphics and mechanics evolve over time:

1. **Fast Physics & Track Check (< 2 seconds)**:
   ```powershell
   npm run test:physics
   ```
   Verifies 100Hz GoldSrc ground acceleration (320 UPS), air-strafe acceleration (> 500 UPS over 4 hops), and deterministic chunk spawning/despawning.
2. **Milestone Snapshot (`npm run snapshot`)**:
   Whenever you complete a visual or gameplay milestone (and after committing your changes), run:
   ```powershell
   npm run snapshot -- "Brief summary of visual/mechanical change"
   ```
   *(Note: Run with `BypassSandbox: true` if Playwright needs local port binding for screenshot capture, or `npx tsx scripts/snapshot.ts --no-browser "Summary"` for instant headless telemetry logging).*
   This appends a timestamped entry with the Git commit SHA, rollback command, physics table, and screenshots (`docs/progression/<date>_<sha>/`) to [docs/PROGRESSION.md](file:///c:/Users/david/.gemini/antigravity/scratch/gridrunner/docs/PROGRESSION.md).

---

## 3. AI-Friendly Architecture & File Size Guardrails

Smaller models (like **Gemini Flash 3.8**) perform dramatically better when editing small, single-responsibility files (150–400 lines) rather than 1,500-line monoliths.

### Repository Map
- [src/config/GameConfig.ts](file:///c:/Users/david/.gemini/antigravity/scratch/gridrunner/src/config/GameConfig.ts) — Central visual palette (`VISUAL_THEME`), default seed, and URL launch parameter parser (`parseLaunchConfig`). **Put new tuning constants here.**
- [src/main.ts](file:///c:/Users/david/.gemini/antigravity/scratch/gridrunner/src/main.ts) — Bootstrap, main game loop, and `window.__GAME_STATE__` / `window.__GAME_CONTROLS__` automation hooks.
- [src/physics/PerkManager.ts](file:///c:/Users/david/.gemini/antigravity/scratch/gridrunner/src/physics/PerkManager.ts) — GoldSrc physics constants (`DEFAULT_GOLDSRC_STATS`) and perk modifiers.
- [src/physics/PlayerPhysics.ts](file:///c:/Users/david/.gemini/antigravity/scratch/gridrunner/src/physics/PlayerPhysics.ts) — 100Hz fixed-tick GoldSrc movement, surfing, boosting, and collision resolution.
- [src/world/TrackGenerator.ts](file:///c:/Users/david/.gemini/antigravity/scratch/gridrunner/src/world/TrackGenerator.ts) — Deterministic procedural track chunks, archetypes, surf ramps, and obstacles.
- [src/renderer/TronRenderer.ts](file:///c:/Users/david/.gemini/antigravity/scratch/gridrunner/src/renderer/TronRenderer.ts) — Three.js scene, camera modes (`CHASE` / `FIRST_PERSON`), sky dome, and synthwave lighting.
- [src/renderer/PlayerRig.ts](file:///c:/Users/david/.gemini/antigravity/scratch/gridrunner/src/renderer/PlayerRig.ts) — Procedural cyber-acrobat character mesh, animations, and ribbon trails.
- [src/renderer/TextureGenerator.ts](file:///c:/Users/david/.gemini/antigravity/scratch/gridrunner/src/renderer/TextureGenerator.ts) — Procedural canvas textures.
- [src/audio/SynthAudio.ts](file:///c:/Users/david/.gemini/antigravity/scratch/gridrunner/src/audio/SynthAudio.ts) — WebAudio procedural synth SFX.
- [src/ui/HudController.ts](file:///c:/Users/david/.gemini/antigravity/scratch/gridrunner/src/ui/HudController.ts) — DOM HUD updates, telemetry overlay, and mode banners.

### Modularity Rules
1. **No New Monoliths**: Keep new `.ts` files under **400 lines**.
2. **Stop Growing the 4 Large Files**:
   - When adding a **new track obstacle or archetype**, create a helper file under `src/world/archetypes/` or `src/world/obstacles/` and call it from `TrackGenerator.ts`.
   - When adding **new visual effects, shaders, or environment props**, create a module under `src/renderer/effects/` and call it from `TronRenderer.ts`.
   - When adding **new player abilities or movement mechanics**, create a module under `src/physics/abilities/` and call it from `PlayerPhysics.ts`.

---

## 4. Deterministic URL Flags & Automation Hooks

Never waste tokens clicking through menus to test a scenario. Use URL query parameters and `window.__GAME_CONTROLS__`:

- **URL Launch Parameters**:
  - `/?mode=FLOW` or `/?mode=COMPETITIVE`
  - `/?seed=1337420` (deterministic procedural track seed)
  - `/?cam=CHASE` or `/?cam=FIRST_PERSON`
  - `/?autostart=1` (skips lobby wait and launches directly into an active run)
  - `/?flat=1` (spawns flat test runway for pure movement/physics testing)
- **Playwright / Console Hooks**:
  - `window.__GAME_STATE__` — Full live telemetry (FPS, UPS, pos, vel, bhopChain, strafeSync, active archetypes).
  - `window.__GAME_CONTROLS__.stepPhysicsTicks(ticks, cmd)` — Deterministically advance the 100Hz physics engine by `ticks` steps.
  - `window.__GAME_CONTROLS__.setCameraMode('CHASE' | 'FIRST_PERSON')`
  - `window.__GAME_CONTROLS__.setTrackMode('FLOW' | 'COMPETITIVE')`
