import { RippleLayer, RippleMode, BlendMode, BrushMode } from '../types';

export const MASK_RES = 256;

export function createDefaultMask(initialVal = 1.0): Float32Array {
  const data = new Float32Array(MASK_RES * MASK_RES);
  data.fill(initialVal);
  return data;
}

/**
 * Apply brush stroke to 2D mask in UV space
 */
export function applyBrushToMask(
  mask: Float32Array,
  w: number,
  h: number,
  centerU: number,
  centerV: number,
  radiusU: number,
  radiusV: number,
  hardness: number,
  opacity: number,
  mode: BrushMode
): Float32Array {
  const newMask = new Float32Array(mask);

  const minX = Math.max(0, Math.floor((centerU - radiusU) * w));
  const maxX = Math.min(w - 1, Math.ceil((centerU + radiusU) * w));
  const minY = Math.max(0, Math.floor((centerV - radiusV) * h));
  const maxY = Math.min(h - 1, Math.ceil((centerV + radiusV) * h));

  for (let y = minY; y <= maxY; y++) {
    const v = y / (h - 1);
    const dv = (v - centerV) / Math.max(0.0001, radiusV);

    for (let x = minX; x <= maxX; x++) {
      const u = x / (w - 1);
      const du = (u - centerU) / Math.max(0.0001, radiusU);

      const distSq = du * du + dv * dv;
      if (distSq > 1.0) continue;

      const dist = Math.sqrt(distSq);

      // Compute falloff
      let falloff = 0;
      if (hardness >= 0.99) {
        falloff = 1.0;
      } else {
        const edge0 = hardness;
        const edge1 = 1.0;
        const t = Math.max(0, Math.min(1, (dist - edge0) / (edge1 - edge0)));
        falloff = 1.0 - t * t * (3 - 2 * t);
      }

      const factor = falloff * opacity;
      const idx = y * w + x;
      const current = newMask[idx];

      if (mode === 'paint') {
        newMask[idx] = Math.min(1.0, current + factor * (1.0 - current));
      } else if (mode === 'erase') {
        newMask[idx] = Math.max(0.0, current - factor * current);
      } else if (mode === 'smooth') {
        // Simple local smoothing
        let sum = current;
        let cnt = 1;
        if (x > 0) { sum += newMask[idx - 1]; cnt++; }
        if (x < w - 1) { sum += newMask[idx + 1]; cnt++; }
        if (y > 0) { sum += newMask[idx - w]; cnt++; }
        if (y < h - 1) { sum += newMask[idx + w]; cnt++; }
        const avg = sum / cnt;
        newMask[idx] = current + (avg - current) * factor;
      }
    }
  }

  return newMask;
}

export function invertMask(mask: Float32Array): Float32Array {
  const result = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    result[i] = 1.0 - mask[i];
  }
  return result;
}

export function clearMask(mask: Float32Array, val = 0.0): Float32Array {
  const result = new Float32Array(mask.length);
  result.fill(val);
  return result;
}

export function fillMask(mask: Float32Array): Float32Array {
  const result = new Float32Array(mask.length);
  result.fill(1.0);
  return result;
}

let layerIdCounter = 1;

export function createNewLayer(
  name?: string,
  mode: RippleMode = 'warped_perlin',
  initialMaskVal = 1.0
): RippleLayer {
  const id = `layer-${Date.now()}-${layerIdCounter++}`;
  const colorTags = ['#f59e0b', '#06b6d4', '#10b981', '#ec4899', '#8b5cf6', '#f97316'];
  const colorTag = colorTags[(layerIdCounter) % colorTags.length];

  return {
    id,
    name: name || `Dune Layer #${layerIdCounter}`,
    visible: true,
    opacity: 1.0,
    blendMode: 'add',
    colorTag,
    maskWidth: MASK_RES,
    maskHeight: MASK_RES,
    maskData: createDefaultMask(initialMaskVal),

    mode,
    primaryDir: 15,
    amplitude: 8,
    spacing: 35,

    invert: false,
    liftMode: 'positive_lift',

    stretchRatio: 12.0, // High anisotropic elongation
    stretchAngle: 0,
    duneAsymmetry: 0.45, // realistic stoss/lee slope
    sharpness: 0.35,
    crestFlattening: 0.0,

    warpIntensity: 0.65,
    warpScale: 0.9,
    noiseOctaves: 4,
    noiseSeed: (layerIdCounter * 127) % 9999 + 1,

    microRipples: 0.15,
    microSpacing: 7,
    noiseOverlay: 0.1,
  };
}

export function getDefaultLayers(): RippleLayer[] {
  // 1. Primary Sweeping Long Dunes (Starts completely dead flat, ready to paint!)
  const layer1: RippleLayer = {
    id: 'layer-primary-dunes',
    name: 'Long Sweeping Dunes',
    visible: true,
    opacity: 1.0,
    blendMode: 'add',
    colorTag: '#f59e0b', // amber
    maskWidth: MASK_RES,
    maskHeight: MASK_RES,
    maskData: createDefaultMask(0.0), // Starts dead flat

    mode: 'warped_perlin',
    primaryDir: 10,
    amplitude: 10,
    spacing: 38,

    invert: false,
    liftMode: 'positive_lift',

    stretchRatio: 18.0, // High 18x stretched Perlin for long sweeping desert dunes
    stretchAngle: 10,
    duneAsymmetry: 0.48, // steep slip face
    sharpness: 0.38,
    crestFlattening: 0.0,

    warpIntensity: 0.7,
    warpScale: 0.85,
    noiseOctaves: 4,
    noiseSeed: 42,

    microRipples: 0.18,
    microSpacing: 6,
    noiseOverlay: 0.12,
  };

  // 2. Secondary Painted Cross-Drift / Micro-Ridges (Also starts dead flat)
  const layer2: RippleLayer = {
    id: 'layer-cross-drift',
    name: 'Painted Cross-Drift',
    visible: true,
    opacity: 0.85,
    blendMode: 'add',
    colorTag: '#06b6d4', // cyan
    maskWidth: MASK_RES,
    maskHeight: MASK_RES,
    maskData: createDefaultMask(0.0), // Starts dead flat

    mode: 'ridged_crests',
    primaryDir: 75,
    amplitude: 6,
    spacing: 20,

    invert: false,
    liftMode: 'positive_lift',

    stretchRatio: 10.0,
    stretchAngle: 75,
    duneAsymmetry: 0.3,
    sharpness: 0.6,
    crestFlattening: 0.0,

    warpIntensity: 0.4,
    warpScale: 1.2,
    noiseOctaves: 4,
    noiseSeed: 199,

    microRipples: 0.25,
    microSpacing: 4,
    noiseOverlay: 0.15,
  };

  return [layer1, layer2];
}
