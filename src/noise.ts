/**
 * High-performance Perlin noise, Anisotropic Stretching, FBM, and Dune Geomorphology
 */

export class NoiseEngine {
  private p: Uint8Array;
  private gx: Float32Array;
  private gy: Float32Array;

  constructor(seed: number = 42) {
    this.p = new Uint8Array(512);
    this.gx = new Float32Array(512);
    this.gy = new Float32Array(512);
    this.reseed(seed);
  }

  reseed(s: number) {
    const grads: [number, number][] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      grads.push([Math.cos(a), Math.sin(a)]);
    }

    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;

    let rng = ((s | 0) * 1664525 + 1013904223) | 0;
    for (let i = 255; i > 0; i--) {
      rng = (rng * 1664525 + 1013904223) | 0;
      const j = (rng >>> 0) % (i + 1);
      const tmp = perm[i];
      perm[i] = perm[j];
      perm[j] = tmp;
    }

    for (let i = 0; i < 512; i++) {
      const pi = perm[i & 255];
      this.p[i] = pi;
      const g = grads[pi % 16];
      this.gx[i] = g[0];
      this.gy[i] = g[1];
    }
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  sample2D(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = this.fade(xf);
    const v = this.fade(yf);

    const aa = this.p[this.p[X] + Y];
    const ab = this.p[this.p[X] + Y + 1];
    const ba = this.p[this.p[X + 1] + Y];
    const bb = this.p[this.p[X + 1] + Y + 1];

    const dot = (i: number, dx: number, dy: number) =>
      this.gx[i] * dx + this.gy[i] * dy;

    const x1 = this.lerp(dot(aa, xf, yf), dot(ba, xf - 1, yf), u);
    const x2 = this.lerp(dot(ab, xf, yf - 1), dot(bb, xf - 1, yf - 1), u);
    return this.lerp(x1, x2, v);
  }

  // Multi-octave Fractal Brownian Motion
  fbm(x: number, y: number, octaves = 4, persistence = 0.5, lacunarity = 2.0): number {
    let total = 0;
    let amp = 1.0;
    let freq = 1.0;
    let max = 0;

    for (let i = 0; i < octaves; i++) {
      total += this.sample2D(x * freq, y * freq) * amp;
      max += amp;
      amp *= persistence;
      freq *= lacunarity;
    }
    return max > 0 ? total / max : 0;
  }

  // Anisotropic FBM along an arbitrary stretch vector
  stretchedFbm(
    x: number,
    y: number,
    stretchRatio = 1.0,
    angleRad = 0,
    octaves = 4
  ): number {
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    // Scale along major stretch axis
    const rx = (x * cosA + y * sinA) / Math.max(0.1, stretchRatio);
    const ry = -x * sinA + y * cosA;
    return this.fbm(rx, ry, octaves);
  }

  // Domain Warped Stretched FBM (Sweeping S-curves of natural beach/desert dunes)
  warpedStretchedFbm(
    x: number,
    y: number,
    stretchRatio = 1.0,
    angleRad = 0,
    warpIntensity = 1.0,
    warpScale = 1.0,
    octaves = 4
  ): number {
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    const rx = (x * cosA + y * sinA) / Math.max(0.1, stretchRatio);
    const ry = -x * sinA + y * cosA;

    if (warpIntensity < 0.001) {
      return this.fbm(rx, ry, octaves);
    }

    const ws = warpScale * 0.8;
    const qx = this.fbm(rx * ws + 1.23, ry * ws + 3.45, 2);
    const qy = this.fbm(rx * ws + 7.89, ry * ws + 5.12, 2);

    return this.fbm(
      rx + warpIntensity * qx * 1.5,
      ry + warpIntensity * qy * 0.5, // keep cross-stretch coherent
      octaves
    );
  }

  // Ridged FBM for sharp windswept sand crests
  ridgedStretchedFbm(
    x: number,
    y: number,
    stretchRatio = 1.0,
    angleRad = 0,
    sharpness = 0.5,
    octaves = 4
  ): number {
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    const rx = (x * cosA + y * sinA) / Math.max(0.1, stretchRatio);
    const ry = -x * sinA + y * cosA;

    let total = 0;
    let amp = 1.0;
    let freq = 1.0;
    let max = 0;

    for (let i = 0; i < octaves; i++) {
      let n = Math.abs(this.sample2D(rx * freq, ry * freq));
      n = 1.0 - n; // invert to create crests
      n = Math.pow(n, 1.0 + sharpness * 2.0); // sharpen peaks
      total += n * amp;
      max += amp;
      amp *= 0.5;
      freq *= 2.0;
    }

    return (total / max) * 2.0 - 1.0;
  }

  /**
   * Cellular / Voronoi Sand Hummocks (Discrete, separated sand mounds & lumps)
   * Generates distinct, well-separated organic sand mounds with clean flat sand valleys between them.
   */
  cellularHummocks2D(
    x: number,
    y: number,
    elongation = 1.0,
    flowAngleRad = 0,
    asymmetry = 0.2,
    density = 0.52
  ): number {
    const cosA = Math.cos(flowAngleRad);
    const sinA = Math.sin(flowAngleRad);
    const u = x * cosA + y * sinA;
    const v = -x * sinA + y * cosA;

    const ix = Math.floor(u);
    const iy = Math.floor(v);

    let maxMound = 0;

    // Search 3x3 surrounding grid cells
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx;
        const cy = iy + dy;

        // Deterministic integer hashes for cell properties
        const h1 = ((cx * 374761393 + cy * 668265263) ^ 0x5bf03635) >>> 0;
        const h2 = ((cx * 1274126177 + cy * 843909503) ^ 0x4f1bbcd1) >>> 0;
        const h3 = ((cx * 982451653 + cy * 15485863) ^ 0x3d7b4c89) >>> 0;

        // Sparsity filter: only spawn a mound at ~50% of cell locations to keep them separated
        const spawnVal = (h1 % 1000) / 1000;
        if (spawnVal > density) continue;

        // Jitter within cell (-0.28 to +0.28)
        const jx = (((h2 % 1000) / 1000) - 0.5) * 0.56;
        const jy = (((h3 % 1000) / 1000) - 0.5) * 0.56;

        const px = cx + 0.5 + jx;
        const py = cy + 0.5 + jy;

        // Varied height and radius per mound
        const heightScale = 0.7 + (((h2 ^ h3) % 1000) / 1000) * 0.3;
        // Moderate radius (0.32 to 0.46 of cell spacing) ensures mounds remain cleanly separated
        const radius = 0.34 + (((h1 ^ h2) % 1000) / 1000) * 0.12;

        let du = u - px;
        const dv = v - py;

        // Apply windward / leeward slope asymmetry
        if (asymmetry > 0.01) {
          if (du < 0) {
            // Windward: gentler ramp
            du /= 1.0 + asymmetry * 0.75;
          } else {
            // Leeward: steeper slip face
            du /= Math.max(0.35, 1.0 - asymmetry * 0.5);
          }
        }

        // Aerodynamic elongation along flow axis
        const dist = Math.sqrt((du / Math.max(0.6, elongation)) ** 2 + dv ** 2);

        if (dist < radius) {
          const t = dist / radius; // [0, 1)
          // Smooth C^2 cosine-squared dome profile: zero height and zero slope at boundary
          const bell = Math.cos((t * Math.PI) * 0.5);
          const dome = bell * bell * (1.0 - t * 0.15); // gentle crown shape
          const moundHeight = dome * heightScale;
          if (moundHeight > maxMound) {
            maxMound = moundHeight;
          }
        }
      }
    }

    return Math.max(0, Math.min(1, maxMound));
  }
}

// Global noise cache
const noiseInstances = new Map<number, NoiseEngine>();
export function getNoiseEngine(seed: number = 42): NoiseEngine {
  if (!noiseInstances.has(seed)) {
    noiseInstances.set(seed, new NoiseEngine(seed));
  }
  return noiseInstances.get(seed)!;
}

/**
 * Natural Dune Profile Transformation (Stoss & Slip-Face Asymmetry)
 * In real dunes, sand has a shallow windward slope and a steep lee drop.
 */
export function applyDuneAsymmetry(raw: number, asymmetry: number): number {
  if (asymmetry < 0.01) return raw;
  // Convert -1..1 to 0..1
  let norm = Math.max(0, Math.min(1, (raw + 1) * 0.5));
  // Power transformation creates steep slip-face and shallow stoss slope
  const power = 1.0 + asymmetry * 2.5;
  norm = Math.pow(norm, power);
  return norm * 2.0 - 1.0;
}

/**
 * Crest Sharpness & Plateau Flattening
 */
export function applyCrestSculpt(raw: number, sharpness: number, flattening: number): number {
  let val = raw;
  if (sharpness > 0.01) {
    if (val > 0) {
      val = Math.pow(Math.min(val, 1), 1.0 - sharpness * 0.7);
    } else {
      val = -Math.pow(Math.min(-val, 1), 1.0 + sharpness * 1.2);
    }
  }
  if (flattening > 0.01) {
    // Flatten the top ridge like a plateau/mesa
    const threshold = 1.0 - flattening * 0.4;
    if (val > threshold) {
      const excess = val - threshold;
      val = threshold + excess * 0.2;
    }
  }
  return val;
}
