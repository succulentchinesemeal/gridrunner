import * as THREE from 'three';

/**
 * High-Performance Procedural Texture Generator for Gridrunner
 * Generates distinct, high-contrast textures for:
 * - Highway road deck (sleek composite tiles, bright cyan lane guides, speed chevrons)
 * - Obstacle pillars (high-contrast industrial amber/black hazard striping & rivet plating)
 * - Frogger moving beams (neon-magenta lethal hazard striping & laser warning hashes)
 * - Surf ramps & launch wedges (cobalt brushed metal with glowing acceleration chevrons)
 * - Substructure bridge piers (industrial concrete formwork & tie-rods)
 */

interface PbrTextureSet {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

let cachedDeckTextures: PbrTextureSet | null = null;
let cachedPillarHazardTexture: THREE.CanvasTexture | null = null;
let cachedFroggerHazardTexture: THREE.CanvasTexture | null = null;
let cachedRampTextures: PbrTextureSet | null = null;
let cachedSubstructureTexture: THREE.CanvasTexture | null = null;

function createCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

/**
 * 1. HIGHWAY ROAD DECK TEXTURE:
 * Distinct dark obsidian carbon-composite tiles with bright illuminated cyan
 * racing lane runners, speed chevrons, and contrasting shoulder hash borders.
 */
export function getHighwayDeckTextures(): PbrTextureSet | null {
  if (cachedDeckTextures) return cachedDeckTextures;
  if (typeof document === 'undefined') return null;

  const size = 512;
  const diffuseCanvas = createCanvas(size, size);
  const roughCanvas = createCanvas(256, 256);
  if (!diffuseCanvas || !roughCanvas) return null;

  const ctxD = diffuseCanvas.getContext('2d')!;
  const ctxR = roughCanvas.getContext('2d')!;

  // Dark obsidian composite asphalt base
  ctxD.fillStyle = '#0b0f19';
  ctxD.fillRect(0, 0, size, size);

  ctxR.fillStyle = '#b0b0b0'; // Matte road roughness (~0.69)
  ctxR.fillRect(0, 0, 256, 256);

  // Micro-aggregate carbon noise
  ctxD.fillStyle = 'rgba(255, 255, 255, 0.035)';
  for (let i = 0; i < 500; i++) {
    const rx = Math.random() * size;
    const ry = Math.random() * size;
    ctxD.fillRect(rx, ry, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  // Interlocking modular paving tiles with dark recessed seams
  const tileSize = 64;
  ctxD.strokeStyle = '#03050a';
  ctxD.lineWidth = 3;

  for (let x = 0; x <= size; x += tileSize) {
    ctxD.beginPath();
    ctxD.moveTo(x, 0);
    ctxD.lineTo(x, size);
    ctxD.stroke();
  }
  for (let y = 0; y <= size; y += tileSize) {
    ctxD.beginPath();
    ctxD.moveTo(0, y);
    ctxD.lineTo(size, y);
    ctxD.stroke();
  }

  // Expansion joint lines on roughness map
  ctxR.strokeStyle = '#e8e8e8';
  ctxR.lineWidth = 2;
  for (let x = 0; x <= 256; x += 32) {
    ctxR.beginPath();
    ctxR.moveTo(x, 0);
    ctxR.lineTo(x, 256);
    ctxR.stroke();
    ctxR.beginPath();
    ctxR.moveTo(0, x);
    ctxR.lineTo(256, x);
    ctxR.stroke();
  }

  // BRIGHT ILLUMINATED HIGHWAY LANE MARKINGS (Punchy, High Contrast)
  const centerX = size / 2;

  // Central racing dashed runner (electric cyan #00f3ff)
  ctxD.fillStyle = '#00f3ff';
  ctxD.shadowColor = '#00f3ff';
  ctxD.shadowBlur = 8;
  const dashLen = 36;
  const dashGap = 28;
  for (let y = 0; y < size; y += dashLen + dashGap) {
    ctxD.fillRect(centerX - 4, y + 4, 8, dashLen);
  }

  // Directional acceleration arrows in central lane
  ctxD.strokeStyle = '#00f3ff';
  ctxD.lineWidth = 4;
  ctxD.lineCap = 'round';
  ctxD.lineJoin = 'round';
  for (let y = 20; y < size; y += 128) {
    ctxD.beginPath();
    ctxD.moveTo(centerX - 24, y + 20);
    ctxD.lineTo(centerX, y);
    ctxD.lineTo(centerX + 24, y + 20);
    ctxD.stroke();
  }

  // Flank runner guide lines (solid bright electric blue #00b4d8)
  ctxD.fillStyle = '#00b4d8';
  ctxD.shadowBlur = 5;
  ctxD.fillRect(centerX - 130, 0, 4, size);
  ctxD.fillRect(centerX + 130 - 4, 0, 4, size);

  // Outer shoulder hazard dashes along boundaries (alternating cyan & charcoal hashes)
  ctxD.fillStyle = '#00f3ff';
  for (let y = 0; y < size; y += 32) {
    ctxD.fillRect(16, y, 12, 14);
    ctxD.fillRect(size - 28, y, 12, 14);
  }
  ctxD.shadowBlur = 0;

  // Slightly smoother worn tire track zones on roughness map (~0.52)
  ctxR.fillStyle = 'rgba(130, 130, 130, 0.35)';
  ctxR.fillRect(128 - 70, 0, 40, 256);
  ctxR.fillRect(128 + 30, 0, 40, 256);

  const map = new THREE.CanvasTexture(diffuseCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(6, 6);

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(6, 6);

  cachedDeckTextures = { map, roughnessMap };
  return cachedDeckTextures;
}

/**
 * 2. OBSTACLE PILLAR TEXTURE:
 * High-contrast industrial warning hazard stripes:
 * Bold alternating 45° stripes of dark carbon gunmetal (#10141e) and
 * vibrant industrial caution amber-gold (#ffaa00) with rivet plates and wear.
 * Instantly distinguishable from the road from 1000+ units away!
 */
export function getObstaclePillarTexture(): THREE.CanvasTexture | null {
  if (cachedPillarHazardTexture) return cachedPillarHazardTexture;
  if (typeof document === 'undefined') return null;

  const size = 256;
  const canvas = createCanvas(size, size);
  if (!canvas) return null;

  const ctx = canvas.getContext('2d')!;

  // Base industrial gunmetal
  ctx.fillStyle = '#121622';
  ctx.fillRect(0, 0, size, size);

  // 45-degree bold hazard stripes
  const stripeW = 32;
  const total = (size * 2) / stripeW;

  ctx.fillStyle = '#ffaa00'; // Vibrant industrial amber
  for (let i = 0; i < total; i += 2) {
    ctx.beginPath();
    ctx.moveTo(i * stripeW - size, 0);
    ctx.lineTo((i + 1) * stripeW - size, 0);
    ctx.lineTo((i + 1) * stripeW, size);
    ctx.lineTo(i * stripeW, size);
    ctx.closePath();
    ctx.fill();
  }

  // Steel plate frame border with corner rivets
  ctx.strokeStyle = '#080a10';
  ctx.lineWidth = 6;
  ctx.strokeRect(0, 0, size, size);

  // Rivets at plate corners and edges
  ctx.fillStyle = '#2a344a';
  const rivetStep = 32;
  for (let i = 16; i < size; i += rivetStep) {
    ctx.beginPath();
    ctx.arc(i, 8, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(i, size - 8, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Center vertical illuminated neon status bar
  ctx.fillStyle = '#00f3ff';
  ctx.shadowColor = '#00f3ff';
  ctx.shadowBlur = 6;
  ctx.fillRect(size / 2 - 3, 0, 6, size);
  ctx.shadowBlur = 0;

  cachedPillarHazardTexture = new THREE.CanvasTexture(canvas);
  cachedPillarHazardTexture.wrapS = THREE.RepeatWrapping;
  cachedPillarHazardTexture.wrapT = THREE.RepeatWrapping;
  return cachedPillarHazardTexture;
}

/**
 * 3. FROGGER MOVING BEAM TEXTURE:
 * Lethal high-voltage hazard warning stripes:
 * Bold alternating diagonal stripes of dark obsidian and hot neon-magenta (#ff0066)
 * with pulsing electrical hazard hashes.
 */
export function getFroggerHazardTexture(): THREE.CanvasTexture | null {
  if (cachedFroggerHazardTexture) return cachedFroggerHazardTexture;
  if (typeof document === 'undefined') return null;

  const size = 256;
  const canvas = createCanvas(size, size);
  if (!canvas) return null;

  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#180410';
  ctx.fillRect(0, 0, size, size);

  const stripeW = 28;
  const total = (size * 2) / stripeW;

  ctx.fillStyle = '#ff0066'; // Hot neon magenta
  for (let i = 0; i < total; i += 2) {
    ctx.beginPath();
    ctx.moveTo(i * stripeW - size, 0);
    ctx.lineTo((i + 1) * stripeW - size, 0);
    ctx.lineTo((i + 1) * stripeW, size);
    ctx.lineTo(i * stripeW, size);
    ctx.closePath();
    ctx.fill();
  }

  // Heavy magnetic confinement border
  ctx.strokeStyle = '#0a0208';
  ctx.lineWidth = 6;
  ctx.strokeRect(0, 0, size, size);

  // Center horizontal pulsing laser conduit
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ff007f';
  ctx.shadowBlur = 10;
  ctx.fillRect(0, size / 2 - 4, size, 8);
  ctx.shadowBlur = 0;

  cachedFroggerHazardTexture = new THREE.CanvasTexture(canvas);
  cachedFroggerHazardTexture.wrapS = THREE.RepeatWrapping;
  cachedFroggerHazardTexture.wrapT = THREE.RepeatWrapping;
  return cachedFroggerHazardTexture;
}

/**
 * 4. SURF RAMP & CARVE WAVE TEXTURE:
 * Cobalt-blue brushed titanium tread with glowing acceleration arrows.
 * Instantly communicates "This is an interactive surf/launch surface!"
 */
export function getRampTextures(): PbrTextureSet | null {
  if (cachedRampTextures) return cachedRampTextures;
  if (typeof document === 'undefined') return null;

  const size = 256;
  const diffuseCanvas = createCanvas(size, size);
  const roughCanvas = createCanvas(128, 128);
  if (!diffuseCanvas || !roughCanvas) return null;

  const ctxD = diffuseCanvas.getContext('2d')!;
  const ctxR = roughCanvas.getContext('2d')!;

  // Cobalt titanium base
  ctxD.fillStyle = '#0f1c30';
  ctxD.fillRect(0, 0, size, size);

  ctxR.fillStyle = '#888888'; // Grippy metallic satin (~0.53)
  ctxR.fillRect(0, 0, 128, 128);

  // Perforated metal tread pattern
  ctxD.fillStyle = '#162742';
  const dotStep = 16;
  for (let y = 8; y < size; y += dotStep) {
    for (let x = 8; x < size; x += dotStep) {
      ctxD.beginPath();
      ctxD.arc(x, y, 3, 0, Math.PI * 2);
      ctxD.fill();
    }
  }

  // Radiant forward launch arrows pointing up the ramp
  ctxD.strokeStyle = '#00ffaa'; // Radiant neon spring-cyan
  ctxD.lineWidth = 5;
  ctxD.lineCap = 'round';
  ctxD.lineJoin = 'round';
  ctxD.shadowColor = '#00ffaa';
  ctxD.shadowBlur = 8;

  for (let y = 32; y < size; y += 64) {
    ctxD.beginPath();
    ctxD.moveTo(size / 2 - 28, y + 20);
    ctxD.lineTo(size / 2, y);
    ctxD.lineTo(size / 2 + 28, y + 20);
    ctxD.stroke();
  }
  ctxD.shadowBlur = 0;

  // Outer reinforcement side rails
  ctxD.fillStyle = '#00e5ff';
  ctxD.fillRect(0, 0, 8, size);
  ctxD.fillRect(size - 8, 0, 8, size);

  const map = new THREE.CanvasTexture(diffuseCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2, 4);

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(2, 4);

  cachedRampTextures = { map, roughnessMap };
  return cachedRampTextures;
}

/**
 * 5. HIGHWAY SUBSTRUCTURE TEXTURE:
 * Industrial concrete formwork with tie-rod marks and steel seams.
 */
export function getSubstructureTexture(): THREE.CanvasTexture | null {
  if (cachedSubstructureTexture) return cachedSubstructureTexture;
  if (typeof document === 'undefined') return null;

  const size = 256;
  const dCanvas = createCanvas(size, size);
  if (!dCanvas) return null;

  const ctxD = dCanvas.getContext('2d')!;
  ctxD.fillStyle = '#0e1420';
  ctxD.fillRect(0, 0, size, size);

  const panelH = 32;
  ctxD.strokeStyle = '#05070c';
  ctxD.lineWidth = 2;

  for (let y = 0; y <= size; y += panelH) {
    ctxD.beginPath();
    ctxD.moveTo(0, y);
    ctxD.lineTo(size, y);
    ctxD.stroke();

    for (let x = 16; x < size; x += 32) {
      ctxD.fillStyle = '#05070c';
      ctxD.beginPath();
      ctxD.arc(x, y + panelH / 2, 2, 0, Math.PI * 2);
      ctxD.fill();
    }
  }

  // Cyan vertical power bus line
  ctxD.fillStyle = '#00f3ff';
  ctxD.shadowColor = '#00f3ff';
  ctxD.shadowBlur = 6;
  ctxD.fillRect(size / 2 - 2, 0, 4, size);
  ctxD.shadowBlur = 0;

  cachedSubstructureTexture = new THREE.CanvasTexture(dCanvas);
  cachedSubstructureTexture.wrapS = THREE.RepeatWrapping;
  cachedSubstructureTexture.wrapT = THREE.RepeatWrapping;
  return cachedSubstructureTexture;
}
