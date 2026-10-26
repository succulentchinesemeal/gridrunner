import { execSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chromium } from '@playwright/test';
import * as THREE from 'three';
import { DEFAULT_GOLDSRC_STATS, PerkManager } from '../src/physics/PerkManager';
import { PlayerPhysics } from '../src/physics/PlayerPhysics';
import { TrackGenerator } from '../src/world/TrackGenerator';

interface PhysicsTelemetry {
  groundUps: number;
  airHoldWUps: number;
  fourHopBhopUps: number;
  topUps: number;
  strafeSync: number;
  bhopChain: number;
  spawnedChunks: number;
  despawnedChunks: number;
  wallSpeedUps: number;
  archetypesSample: string[];
}

function runPhysicsTelemetry(): PhysicsTelemetry {
  // Test A: Ground accel + W in air
  const physicsA = new PlayerPhysics(new PerkManager(DEFAULT_GOLDSRC_STATS));
  for (let t = 0; t < 60; t++) {
    physicsA.stepTick({
      fmove: 320,
      smove: 0,
      viewYaw: 0,
      jumpHeld: false,
      jumpEdge: false,
      dashPressed: false,
    });
  }
  const groundUps = physicsA.ups;

  let yawA = 0;
  for (let t = 0; t < 260; t++) {
    const dir = Math.floor(t / 65) % 2 === 0 ? 1 : -1;
    yawA += dir * 0.025;
    physicsA.stepTick({
      fmove: 320,
      smove: 0,
      viewYaw: yawA,
      jumpHeld: true,
      jumpEdge: t === 0,
      dashPressed: false,
    });
  }
  const airHoldWUps = physicsA.ups;

  // Test B: 4-hop GoldSrc air-strafe chain
  const physicsB = new PlayerPhysics(new PerkManager(DEFAULT_GOLDSRC_STATS));
  for (let t = 0; t < 60; t++) {
    physicsB.stepTick({
      fmove: 320,
      smove: 0,
      viewYaw: 0,
      jumpHeld: false,
      jumpEdge: false,
      dashPressed: false,
    });
  }

  let yawB = 0;
  const hopTicks = 68;
  for (let t = 0; t < hopTicks * 4; t++) {
    const hopIdx = Math.floor(t / hopTicks);
    const left = hopIdx % 2 === 0;
    yawB += left ? 0.028 : -0.028;
    physicsB.stepTick({
      fmove: 0,
      smove: left ? -320 : 320,
      viewYaw: yawB,
      jumpHeld: true,
      jumpEdge: t === 0,
      dashPressed: false,
    });
  }

  // Track generation sample
  const scene = new THREE.Scene();
  const track = new TrackGenerator(scene, 1337420, 'FLOW');
  let elapsed = 0;
  for (let z = 0; z >= -7500; z -= 150) {
    elapsed += 0.25;
    track.updateAroundPlayerZ(z, elapsed, 0.25);
  }

  return {
    groundUps,
    airHoldWUps,
    fourHopBhopUps: physicsB.ups,
    topUps: physicsB.topUps,
    strafeSync: physicsB.strafeSync,
    bhopChain: physicsB.bhopChain,
    spawnedChunks: track.totalSpawnedChunks,
    despawnedChunks: track.totalDespawnedChunks,
    wallSpeedUps: track.wallSpeedUps,
    archetypesSample: track.getActiveArchetypes().slice(0, 6),
  };
}

function safeGit(cmd: string, fallback: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return fallback;
  }
}

async function captureScreenshots(outDir: string): Promise<string[]> {
  if (process.argv.includes('--no-browser')) {
    return [];
  }

  const port = 5179;
  const baseUrl = `http://127.0.0.1:${port}`;
  const viteProc = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--port', String(port), '--host', '127.0.0.1'],
    { stdio: 'ignore', shell: process.platform === 'win32' }
  );

  const captured: string[] = [];
  try {
    // Wait up to 6s for Vite to respond
    let ready = false;
    for (let i = 0; i < 24; i++) {
      try {
        const res = await fetch(baseUrl);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    if (!ready) {
      console.warn('[snapshot] Vite server did not respond in time; skipping screenshots.');
      return [];
    }

    fs.mkdirSync(outDir, { recursive: true });
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

      // 1. Flow Mode Chase Cam after stepping 90 ticks into the track
      await page.goto(`${baseUrl}/?mode=FLOW&seed=1337420&cam=CHASE&autostart=1`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(() => Boolean(window.__GAME_CONTROLS__ && window.__GAME_STATE__));
      await page.evaluate(() => {
        window.__GAME_CONTROLS__.stepPhysicsTicks(95, {
          fmove: 320,
          smove: 180,
          viewYaw: 0.12,
          jumpHeld: true,
          jumpEdge: true,
          dashPressed: false,
        });
      });
      await page.waitForTimeout(200);
      const file1 = path.join(outDir, '01-chase-flow.png');
      await page.screenshot({ path: file1 });
      captured.push('01-chase-flow.png');

      // 2. First-Person View
      await page.evaluate(() => {
        window.__GAME_CONTROLS__.setCameraMode('FIRST_PERSON');
      });
      await page.waitForTimeout(150);
      const file2 = path.join(outDir, '02-first-person.png');
      await page.screenshot({ path: file2 });
      captured.push('02-first-person.png');

      // 3. Competitive Mode Chase Cam
      await page.goto(`${baseUrl}/?mode=COMPETITIVE&seed=1337420&cam=CHASE&autostart=1`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(() => Boolean(window.__GAME_CONTROLS__ && window.__GAME_STATE__));
      await page.evaluate(() => {
        window.__GAME_CONTROLS__.stepPhysicsTicks(140, {
          fmove: 320,
          smove: -160,
          viewYaw: -0.08,
          jumpHeld: true,
          jumpEdge: false,
          dashPressed: true,
        });
      });
      await page.waitForTimeout(200);
      const file3 = path.join(outDir, '03-competitive-solid.png');
      await page.screenshot({ path: file3 });
      captured.push('03-competitive-solid.png');
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.warn('[snapshot] Browser screenshot capture skipped:', (err as Error).message);
  } finally {
    viteProc.kill();
  }

  return captured;
}

async function main() {
  const noteArgs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const customNote = noteArgs.join(' ').trim();

  const sha = safeGit('git rev-parse --short HEAD', 'uncommitted');
  const branch = safeGit('git branch --show-current', 'master');
  const commitSubject = safeGit('git log -1 --pretty=%s', 'Working tree state');
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  console.log(`[snapshot] Running deterministic physics & track verification (${sha} on ${branch})...`);
  const telemetry = runPhysicsTelemetry();

  const folderName = `${timestamp.slice(0, 10)}_${sha}`;
  const outDir = path.resolve(process.cwd(), 'docs', 'progression', folderName);
  const screenshots = await captureScreenshots(outDir);

  const docsDir = path.resolve(process.cwd(), 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const progressionFile = path.join(docsDir, 'PROGRESSION.md');

  if (!fs.existsSync(progressionFile)) {
    fs.writeFileSync(
      progressionFile,
      `# GridRunner Visual & Mechanical Progression Log\n\n` +
        `This breadcrumb log is automatically updated by \`npm run snapshot\`. Each entry records the exact Git commit, deterministic GoldSrc 100Hz physics metrics, track archetype stats, and screenshots so you can roll back to any checkpoint with \`git checkout <commit>\`.\n\n---\n`,
      'utf8'
    );
  }

  const screenshotMd =
    screenshots.length > 0
      ? `\n**Visual Snapshots (\`docs/progression/${folderName}/\`):**\n` +
        screenshots.map((f) => `- ![${f}](./progression/${folderName}/${f})`).join('\n') +
        '\n'
      : `\n*(Run \`npm run snapshot\` with browser access to attach Playwright screenshots)*\n`;

  const entry =
    `\n## [${timestamp}] Commit \`${sha}\` (\`${branch}\`) — ${customNote || commitSubject}\n\n` +
    `- **Git Rollback Command**: \`git checkout ${sha}\`\n` +
    `- **Commit Message**: ${commitSubject}\n` +
    (customNote ? `- **Milestone Note**: ${customNote}\n` : '') +
    `\n| Metric | Value | Target / Invariant |\n` +
    `| :--- | :--- | :--- |\n` +
    `| Ground Run Speed | **${telemetry.groundUps.toFixed(2)} UPS** | 320.00 UPS |\n` +
    `| Air Hold-W Turn Speed | **${telemetry.airHoldWUps.toFixed(2)} UPS** | 315–350 UPS |\n` +
    `| 4-Hop Air-Strafe Speed | **${telemetry.fourHopBhopUps.toFixed(2)} UPS** | > 500 UPS |\n` +
    `| Strafe Sync / Bhop Chain | **${telemetry.strafeSync}% / ${telemetry.bhopChain} hops** | >= 75% |\n` +
    `| Derezz Wall Speed (7.5k Z) | **${telemetry.wallSpeedUps.toFixed(1)} UPS** | Progressive ramp |\n` +
    `| Active Track Archetypes | \`${telemetry.archetypesSample.join('`, `')}\` | Deterministic seed \`1337420\` |\n` +
    screenshotMd +
    `\n---\n`;

  fs.appendFileSync(progressionFile, entry, 'utf8');
  console.log(`[snapshot] Recorded entry in docs/PROGRESSION.md for commit ${sha}`);
}

main().catch((err) => {
  console.error('[snapshot] Failed:', err);
  process.exit(1);
});
