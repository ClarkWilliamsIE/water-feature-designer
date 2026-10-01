import * as THREE from 'three';
import {
  NoiseEngine,
  getNoiseEngine,
  applyDuneAsymmetry,
  applyCrestSculpt,
} from '../noise';
import {
  RippleLayer,
  SurfaceConfig,
  Obstacle,
  ExportConfig,
} from '../types';
import { pointToPolygonSDF } from './customShape';
import { sampleCradleUndersideHeight } from './cradleGeometry';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/**
 * Bilinear sampling from a 2D float mask array (0.0 to 1.0)
 */
export function sampleMask(
  maskData: Float32Array,
  w: number,
  h: number,
  u: number,
  v: number
): number {
  const cu = Math.max(0, Math.min(1, u)) * (w - 1);
  const cv = Math.max(0, Math.min(1, v)) * (h - 1);

  const x0 = Math.floor(cu);
  const y0 = Math.floor(cv);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);

  const fu = cu - x0;
  const fv = cv - y0;

  const i00 = y0 * w + x0;
  const i10 = y0 * w + x1;
  const i01 = y1 * w + x0;
  const i11 = y1 * w + x1;

  const top = maskData[i00] * (1 - fu) + maskData[i10] * fu;
  const bot = maskData[i01] * (1 - fu) + maskData[i11] * fu;

  return top * (1 - fv) + bot * fv;
}

/**
 * Check if a 2D coordinate (x, z) is inside the physical filleted canvas
 */
export function isInsideFillet(
  x: number,
  z: number,
  width: number,
  length: number,
  cornerRadius: number
): boolean {
  const hw = width / 2;
  const hl = length / 2;
  const r = Math.max(0, Math.min(cornerRadius, hw, hl));
  if (r <= 0) {
    return Math.abs(x) <= hw && Math.abs(z) <= hl;
  }

  const cx = hw - r;
  const cz = hl - r;
  const dx = Math.abs(x) - cx;
  const dz = Math.abs(z) - cz;

  if (dx <= 0 || dz <= 0) {
    return Math.abs(x) <= hw && Math.abs(z) <= hl;
  }

  return dx * dx + dz * dz <= r * r;
}

/**
 * Calculate signed distance to filleted rectangle boundary
 * Negative inside, positive outside
 */
export function sdfFilletedRect(
  x: number,
  z: number,
  width: number,
  length: number,
  cornerRadius: number
): number {
  const hw = width / 2;
  const hl = length / 2;
  const r = Math.max(0, Math.min(cornerRadius, hw * 0.99, hl * 0.99));
  const dx = Math.abs(x) - (hw - r);
  const dz = Math.abs(z) - (hl - r);
  const qx = Math.max(dx, 0);
  const qz = Math.max(dz, 0);
  return Math.sqrt(qx * qx + qz * qz) + Math.min(Math.max(dx, dz), 0) - r;
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

/**
 * Compute exact Signed Distance Function (SDF) to obstacle boundary in mm
 * Negative = Inside the obstacle footprint
 * 0.0 = On the exact perimeter
 * Positive = Outside the obstacle
 */
export function getObstacleSignedDistance(
  x: number,
  z: number,
  obs: Obstacle
): number {
  // ── 0. If shape has an active 3D transformed waterline contour (from rotated mesh or 3D cradle) ──
  // Note: cradleWaterlineContour is pre-transformed in world orientation relative to (obs.x, obs.z)
  // and normalized by obs.radius. Evaluating in world space ensures 3-axis rotation, flips, and scaling
  // are 100% physically aligned without double-rotation artifacts.
  if (obs.cradleWaterlineContour && obs.cradleWaterlineContour.length >= 3) {
    const worldDx = x - obs.x;
    const worldDz = z - obs.z;
    const normPx = worldDx / obs.radius;
    const normPz = worldDz / obs.radius;
    const normDist = pointToPolygonSDF(normPx, normPz, obs.cradleWaterlineContour);
    return normDist * obs.radius;
  }

  // If a 3D imported model has no parts intersecting the sand bed surface, it has infinite distance (no contact)
  if (obs.shape === 'custom_3d') {
    if (obs.hasSurfaceContact === false || !obs.cradleWaterlineContour || obs.cradleWaterlineContour.length < 3) {
      return Infinity;
    }
  }

  // Apply obstacle position
  let dx = x - obs.x;
  let dz = z - obs.z;

  // Apply rotation (Yaw on ground plane)
  const rotDeg = obs.rotation || obs.rotationY || 0;
  if (rotDeg !== 0) {
    const rotRad = -rotDeg * DEG;
    const cosR = Math.cos(rotRad);
    const sinR = Math.sin(rotRad);
    const rx = dx * cosR - dz * sinR;
    const rz = dx * sinR + dz * cosR;
    dx = rx;
    dz = rz;
  }

  // Apply mirror flips if enabled
  if (obs.flipX) dx = -dx;
  if (obs.flipZ) dz = -dz;

  // Apply non-uniform scale
  const sx = Math.max(0.1, obs.scaleX || 1.0);
  const sz = Math.max(0.1, obs.scaleZ || 1.0);
  const scaledDx = dx / sx;
  const scaledDz = dz / sz;

  switch (obs.shape) {
    case 'box': {
      const qx = Math.abs(scaledDx) - obs.radius;
      const qz = Math.abs(scaledDz) - obs.radius;
      const outside = Math.sqrt(Math.max(0, qx) ** 2 + Math.max(0, qz) ** 2);
      const inside = Math.min(Math.max(qx, qz), 0);
      return (outside + inside) * Math.min(sx, sz);
    }

    case 'organic_pebble': {
      if (obs.customPolygonPoints && obs.customPolygonPoints.length >= 3) {
        const normPx = scaledDx / obs.radius;
        const normPz = scaledDz / obs.radius;
        const normDist = pointToPolygonSDF(normPx, normPz, obs.customPolygonPoints);
        return normDist * obs.radius * Math.min(sx, sz);
      }
      const dist = Math.sqrt(scaledDx * scaledDx + scaledDz * scaledDz);
      const angle = Math.atan2(scaledDz, scaledDx);
      const pebbleR =
        obs.radius *
        (0.92 +
          0.16 * Math.cos(2 * angle) +
          0.08 * Math.sin(3 * angle) -
          0.05 * Math.cos(4 * angle));
      return (dist - pebbleR) * Math.min(sx, sz);
    }

    case 'custom_svg':
    case 'custom_dxf':
    case 'custom_3d':
    case 'custom_mask': {
      if (obs.customPolygonPoints && obs.customPolygonPoints.length >= 3) {
        const normPx = scaledDx / obs.radius;
        const normPz = scaledDz / obs.radius;
        // Pure analytical Euclidean distance to 2D polygon - zero square bounding box artifacts
        const normDist = pointToPolygonSDF(normPx, normPz, obs.customPolygonPoints);
        return normDist * obs.radius * Math.min(sx, sz);
      }
      // Fallback smooth circular
      const dist = Math.sqrt(scaledDx * scaledDx + scaledDz * scaledDz);
      return (dist - obs.radius) * Math.min(sx, sz);
    }

    case 'stone_boulder': {
      if (obs.customPolygonPoints && obs.customPolygonPoints.length >= 3) {
        const normPx = scaledDx / obs.radius;
        const normPz = scaledDz / obs.radius;
        const normDist = pointToPolygonSDF(normPx, normPz, obs.customPolygonPoints);
        return normDist * obs.radius * Math.min(sx, sz);
      }
      const dist = Math.sqrt(scaledDx * scaledDx + scaledDz * scaledDz);
      const angle = Math.atan2(scaledDz, scaledDx);
      const facetedR =
        obs.radius * (0.94 + 0.08 * Math.cos(5 * angle) + 0.04 * Math.sin(7 * angle));
      return (dist - facetedR) * Math.min(sx, sz);
    }

    case 'stone_sphere':
    case 'cylinder':
    default: {
      const dist = Math.sqrt(scaledDx * scaledDx + scaledDz * scaledDz);
      return (dist - obs.radius) * Math.min(sx, sz);
    }
  }
}

/**
 * Physical Obstacle Wake, Sand Mass Displacement Rim, Interference,
 * and Parametric Vertical Extrusion (Pillars / Raised Plateaus / CNC Bedding)
 */
function applyObstacleInterference(
  baseH: number,
  x: number,
  z: number,
  obs: Obstacle,
  primaryDirDeg: number
): number {
  const isImported3d =
    obs.shape === 'custom_3d' ||
    Boolean(obs.customMeshData?.positions?.length) ||
    obs.sourceFormat === 'stl' ||
    obs.sourceFormat === 'obj';

  const sdfDist = getObstacleSignedDistance(x, z, obs);

  // ── 1. IMPORTED 3D STONE: VACUUM-MOULDED CONFORMAL IMPRINT & SURFACE-INTERSECTING FOOTPRINT ──
  if (isImported3d) {
    // If the 3D model does not intersect the sand bed surface, it produces no imprint or wake disturbance
    if (obs.hasSurfaceContact === false || (obs.cradleWaterlineContour && obs.cradleWaterlineContour.length < 3)) {
      return baseH;
    }

    let undersideH: number | null = null;
    if (obs.cradleEnabled !== false && obs.cradleDepthGrid && obs.cradleBBox) {
      const relX = x - obs.x;
      const relZ = z - obs.z;
      undersideH = sampleCradleUndersideHeight(relX, relZ, {
        depthGrid: obs.cradleDepthGrid,
        gridRes: obs.cradleGridRes || 128,
        bbox: obs.cradleBBox,
        waterlineContour: obs.cradleWaterlineContour || [],
        maxPenetration: 0,
      });
    }

    // A point belongs to the surface contact footprint if it physically penetrates the surface (undersideH <= 0.2)
    // or lies inside the surface-intersecting waterline polygon (sdfDist <= 0)
    const isContactPoint = (undersideH !== null && undersideH <= 0.2) || sdfDist <= 0;

    if (isContactPoint) {
      if (undersideH !== null) {
        const clearance = obs.cradleClearance || 0;
        let cradleH = undersideH + clearance;

        if (obs.flattenCradleAnomalies !== false) {
          const maxCeiling = obs.cradleCeilingClamp !== undefined ? obs.cradleCeilingClamp : 0.0;
          if (cradleH > maxCeiling) {
            cradleH = maxCeiling;
          }
        }

        // Exact physical underside imprint when penetrating the sand bed:
        if (cradleH < 0.0) {
          return cradleH;
        }
      }

      // Flush sand plane inside contact footprint when stone is at or above sand level:
      // Absolutely zero ripples, mounds, or wake waves penetrate the contact footprint!
      return 0.0;
    }
  }

  // ── 1B. PARAMETRIC PROCEDURAL STONES: CONFORMAL CRADLE ──
  if (obs.cradleEnabled !== false && obs.cradleDepthGrid && obs.cradleBBox) {
    const relX = x - obs.x;
    const relZ = z - obs.z;
    const undersideH = sampleCradleUndersideHeight(relX, relZ, {
      depthGrid: obs.cradleDepthGrid,
      gridRes: obs.cradleGridRes || 64,
      bbox: obs.cradleBBox,
      waterlineContour: obs.cradleWaterlineContour || [],
      maxPenetration: 0,
    });

    if (undersideH !== null) {
      const clearance = obs.cradleClearance || 0;
      let cradleH = undersideH + clearance;

      if (obs.flattenCradleAnomalies !== false) {
        const maxCeiling = obs.cradleCeilingClamp !== undefined ? obs.cradleCeilingClamp : 0.0;
        if (cradleH > maxCeiling) {
          cradleH = maxCeiling;
        }
      }

      if (cradleH < 0.0) {
        const blendMargin = Math.max(0.5, obs.cradleBlendMargin !== undefined ? obs.cradleBlendMargin : 2.5);
        const depthDelta = -cradleH;
        if (depthDelta >= blendMargin) {
          return cradleH;
        } else {
          // Smooth Hermite fillet at the waterline perimeter for parametric stones
          const t = depthDelta / blendMargin;
          const smoothT = t * t * (3 - 2 * t);
          return 0.0 * (1 - smoothT) + cradleH * smoothT;
        }
      } else if (sdfDist <= 0) {
        return 0.0;
      }
    }
  }

  // ── 2. VERTICAL EXTRUSION & BEDDING POCKET (Parametric stones only) ──
  const beddingH = isImported3d ? 0 : (obs.beddingDepth || 0);
  const isFlattenEnabled = !isImported3d && obs.flattenUnderFootprint !== false;
  const verticalExtrude = isImported3d ? 0 : Math.max(0, obs.verticalExtrusion || 0);

  if (sdfDist <= 0 && !isImported3d) {
    if (verticalExtrude > 0) {
      // Calculate top cap elevation profile for raised monolithic pillar / plateau
      let capHeight = beddingH + verticalExtrude;
      const normInside = Math.min(1, Math.max(0, -sdfDist / obs.radius));

      const profile = obs.extrusionCapProfile || 'flat';
      if (profile === 'dome') {
        capHeight = beddingH + verticalExtrude * (0.65 + 0.35 * Math.cos(normInside * Math.PI * 0.5));
      } else if (profile === 'pyramid') {
        capHeight = beddingH + verticalExtrude * (0.3 + 0.7 * (1 - normInside));
      } else if (profile === 'stepped') {
        const step = Math.min(3, Math.floor((1 - normInside) * 3));
        capHeight = beddingH + (verticalExtrude / 3) * (step + 1);
      }

      // If deep inside the top cap (beyond top bevel radius)
      const bevel = Math.max(0.5, obs.extrusionBevel || 2.0);
      if (sdfDist <= -bevel) {
        return capHeight;
      }

      // Smooth fillet at the top plateau perimeter edge (-bevel < sdfDist <= 0)
      const topBevelT = (-sdfDist) / bevel;
      const smoothTop = topBevelT * topBevelT * (3 - 2 * topBevelT);
      const edgeH = beddingH + verticalExtrude * 0.95;
      return edgeH * (1 - smoothTop) + capHeight * smoothTop;
    }

    // Flat bedding pocket for parametric stones
    if (isFlattenEnabled) {
      const blendMargin = 5.0; // 5mm smooth transition margin
      if (sdfDist <= -blendMargin) {
        return beddingH;
      }
      const t = (-sdfDist) / blendMargin;
      const smoothT = t * t * (3 - 2 * t);
      return 0.0 * (1 - smoothT) + beddingH * smoothT;
    }

    return 0.0;
  }

  // ── 3. EXTERNAL SAND DISTURBANCE & WAKE DYNAMICS ──
  // For imported stones outside their imprint, start smoothly at baseH with wake ripples around that
  const distFromObs = Math.max(0, sdfDist);
  const massScale = obs.mass / 50; // 50kg standard reference

  let h = baseH;

  // Mass Displacement Ridge (sand pushed outward around stone boundary)
  // For imported 3D stones: COMPLETELY ELIMINATE THE DISPLACEMENT WALL AROUND THE STONE!
  if (!isImported3d) {
    const rimWidth = obs.radius * 0.45 + 8;
    const rimPeakDist = rimWidth * 0.35;
    const rimDelta = Math.abs(distFromObs - rimPeakDist);
    const rimHeight =
      10 *
      obs.displacedSand *
      massScale *
      Math.exp(-(rimDelta * rimDelta) / (rimWidth * rimWidth));
    h += rimHeight;
  }

  const waveDirRad = primaryDirDeg * DEG;
  const dx = x - obs.x;
  const dz = z - obs.z;

  // Decompose into downstream and cross-stream relative coordinates for smooth wavefronts
  const sDown = dx * Math.cos(waveDirRad) + dz * Math.sin(waveDirRad);
  const sCross = -dx * Math.sin(waveDirRad) + dz * Math.cos(waveDirRad);

  const vertAngle = Math.atan2(dz, dx);
  const flowAngle = vertAngle - waveDirRad;
  const normFlow = normalizeAngle(flowAngle);

  const generalDisturbRange = Math.max(10, obs.disturbanceRadius - obs.radius);

  // ── 4. UPSTREAM BOW MOUND & ACCUMULATION ──
  // For imported stones, eliminate the artificial upstream wall/ridge as well
  if (!isImported3d) {
    const upstreamFac = Math.max(0, -Math.cos(normFlow));
    const bowRange = obs.bowMoundDistance || Math.max(20, generalDisturbRange * 0.55);

    if (upstreamFac > 0 && distFromObs < bowRange) {
      const bowDist = distFromObs / Math.max(5, bowRange);
      const bowFade = 0.5 * (1 + Math.cos(Math.min(1, bowDist) * Math.PI));
      const bowAmp = obs.bowMoundHeight !== undefined ? obs.bowMoundHeight : 8.0;
      h +=
        bowAmp *
        obs.displacedSand *
        massScale *
        Math.pow(upstreamFac, 1.4) *
        bowFade;
    }
  }

  // ── 5. KELVIN WAKE RIPPLES (Continuous Transverse & Divergent Wavefield with Smooth Seam Blending) ──
  const wakeSpreadRad = (obs.wakeAngle || 25) * DEG;
  const wakeLen = Math.max(20, obs.wakeLength || 250);
  const wakeSoftening = obs.wakeSoftening !== undefined ? obs.wakeSoftening : 0.75;
  const maxWakeAngle = wakeSpreadRad * (1.2 + 0.5 * wakeSoftening);

  // Angle off the downstream flow axis
  const wakeAngleOff = Math.abs(Math.atan2(Math.abs(sCross), Math.max(0.1, sDown)));

  if (sDown > 0 && distFromObs < wakeLen && wakeAngleOff < maxWakeAngle) {
    // 1. Angular Window / Feathering (Smooth cosine window ensures 0 amplitude & 0 derivative at wake boundaries)
    const angleRatio = Math.min(1, wakeAngleOff / maxWakeAngle);
    const angleWindow = 0.5 * (1 + Math.cos(angleRatio * Math.PI));

    // 2. Lateral Bell Envelope and V-arm crest
    const lateralNorm = wakeAngleOff / (wakeSpreadRad * 1.08);
    const lateralEnvelope = Math.exp(-lateralNorm * lateralNorm * (1.5 - 0.5 * wakeSoftening));

    const armDelta = Math.abs(wakeAngleOff - wakeSpreadRad);
    const armSpread = 0.035 + 0.045 * wakeSoftening;
    const armPeak = Math.exp(-(armDelta * armDelta) / armSpread) * 0.45;

    // 3. Longitudinal Decay & Near-Field Smooth Onset (eliminates seam at stone perimeter & far end)
    const distNorm = Math.min(1, distFromObs / wakeLen);
    const farFade = 0.5 * (1 + Math.cos(distNorm * Math.PI));
    const decayExp = obs.wakeDecayRate !== undefined ? obs.wakeDecayRate : 1.0;
    const decayFactor = Math.pow(farFade, decayExp);

    // Onset feathering: smoothly ramp in wake as we move away from stone boundary
    const onsetDist = Math.max(8, (obs.radius * 0.35 + 10) * (0.5 + 0.5 * wakeSoftening));
    const nearT = Math.min(1, Math.max(0, distFromObs / onsetDist));
    const onsetFactor = nearT * nearT * (3 - 2 * nearT);

    const wakeStrength =
      (lateralEnvelope * 0.75 + armPeak) * angleWindow * decayFactor * onsetFactor;

    if (wakeStrength > 0.001) {
      const wavelength = Math.max(8, obs.wakeWavelength || 28);
      const k = TAU / wavelength;

      // Continuous C-infinity parabolic wavefronts (eliminates medial axis seam on faceted/irregular stones)
      const focalRadius = Math.max(30, obs.radius * 2.2 + 20);
      const parabolicPhase = sDown - (sCross * sCross) / (2 * focalRadius);
      let wakeWave = Math.sin(k * parabolicPhase - primaryDirDeg * DEG);

      // Add secondary turbulence/eddy shedding if enabled
      const turb = obs.wakeTurbulence || 0;
      if (turb > 0) {
        const eddy = Math.sin(k * 1.7 * x * 0.05 + k * 1.3 * z * 0.05);
        wakeWave = wakeWave * (1 - turb * 0.4) + eddy * turb * 0.4;
      }

      const wakeAmp = obs.wakeAmplitude !== undefined ? obs.wakeAmplitude : 8.0;
      h +=
        wakeAmp *
        wakeStrength *
        wakeWave *
        obs.disturbanceIntensity *
        massScale;
    }

    // ── 5. OPTIONAL SCOUR DEPTH & VERTICAL LIFT ──
    const scourAmp = obs.wakeScourDepth || 0;
    if (scourAmp > 0) {
      const centerFactor = Math.max(0, 1 - wakeAngleOff / wakeSpreadRad) * angleWindow;
      const scourDepth =
        scourAmp *
        centerFactor *
        onsetFactor *
        obs.disturbanceIntensity *
        massScale *
        decayFactor;
      h -= scourDepth;
    }

    // Vertical sand ramp/lift along leeward slipstream
    const lift = obs.wakeVerticalLift || 0;
    if (lift !== 0) {
      const downstreamFac = Math.max(0, Math.cos(normFlow));
      h += lift * downstreamFac * onsetFactor * decayFactor * angleWindow;
    }
  }

  // ── 6. RADIAL RING DIFFRACTION & FLUID DISTORTIONS ──
  const ringIntensity = obs.diffractionRings !== undefined ? obs.diffractionRings : 0.5;
  if (ringIntensity > 0 && distFromObs < generalDisturbRange * 0.85) {
    const ringRange = generalDisturbRange * 0.85;
    const ringT = 0.5 * (1 + Math.cos(Math.min(1, distFromObs / ringRange) * Math.PI));
    const ringSpacing = Math.max(8, obs.diffractionSpacing || 30);
    const k = TAU / ringSpacing;

    const angleToPoint = Math.atan2(dz, dx);

    let effectiveDist = distFromObs;

    // ── Distortion A: Anisotropic Current Stretch (Elliptical Elongation) ──
    const stretch = Math.max(0.2, Math.min(4.0, obs.diffractionStretch !== undefined ? obs.diffractionStretch : 1.0));
    if (Math.abs(stretch - 1.0) > 0.02) {
      const stretchAngleDeg = obs.diffractionStretchAngle !== undefined ? obs.diffractionStretchAngle : (primaryDirDeg || 0);
      const stretchAngleRad = stretchAngleDeg * DEG;
      const rotX = dx * Math.cos(stretchAngleRad) + dz * Math.sin(stretchAngleRad);
      const rotZ = -dx * Math.sin(stretchAngleRad) + dz * Math.cos(stretchAngleRad);
      const ellipR = Math.sqrt(rotX * rotX + (rotZ * stretch) * (rotZ * stretch));
      effectiveDist = Math.max(0, ellipR - obs.radius);
    }

    // ── Distortion B: Backdraft / Directional Pinch ──
    // Compresses & cusps the diffraction rings where water backdraft / flow rushes around the stone
    const pinch = obs.diffractionPinch || 0; // -1.0 to 1.0 (positive = downstream wake pinch)
    if (Math.abs(pinch) > 0.01) {
      const pinchAngleDeg = obs.diffractionPinchAngle !== undefined ? obs.diffractionPinchAngle : (primaryDirDeg || 0);
      const pinchAngleRad = pinchAngleDeg * DEG;
      const relPinchAngle = normalizeAngle(angleToPoint - pinchAngleRad);
      const cosA = Math.cos(relPinchAngle);

      // Asymmetric backdraft teardrop cusp: peak constriction on downstream lee side (cosA > 0)
      const teardrop = Math.pow(Math.max(0, (1 + cosA) * 0.5), 1.5);
      const distDecay = Math.exp(-distFromObs / (obs.radius * 2.2 + 25));
      const pinchFactor = 1.0 + pinch * (teardrop * 1.8 - 0.25) * (0.35 + 0.65 * distDecay);
      effectiveDist = effectiveDist * Math.max(0.15, pinchFactor);
    }

    // ── Distortion C: Spiral Vortex Swirl / Eddy Twist ──
    const swirl = obs.diffractionSwirl || 0; // -2.0 to 2.0
    let phaseOffset = Math.PI * 0.25;
    if (Math.abs(swirl) > 0.01) {
      const swirlDecay = Math.exp(-distFromObs / (obs.radius * 2.5 + 30));
      phaseOffset += swirl * angleToPoint * 2.5 * swirlDecay;
    }

    // ── Distortion D: Organic Water Flutter / Fluid Turbulence ──
    const flutter = obs.diffractionFlutter || 0; // 0 to 1.0
    if (flutter > 0.01) {
      const noise = getNoiseEngine();
      const flutterOffset = noise.sample2D(x * 0.04, z * 0.04) * 16.0 * flutter;
      effectiveDist += flutterOffset;
    }

    // Compute waveform with distorted metric
    const radWave = Math.sin(k * effectiveDist + phaseOffset);

    // Natural crest sharpening so sand diffraction ripples rise crisply
    const sharpenedWave = Math.sign(radWave) * Math.pow(Math.abs(radWave), 0.85);

    // Natural smooth envelope across the ring range (avoiding double-squared attenuation)
    const ringMassFactor = Math.max(0.85, massScale);
    const ringDisturbFactor = Math.max(0.85, obs.disturbanceIntensity ?? 0.85);
    h +=
      5.0 *
      ringIntensity *
      sharpenedWave *
      ringT *
      ringDisturbFactor *
      ringMassFactor;
  }

  // ── 7. SIDEWALL DRAFT TRANSITION & PERIMETER BLEND ──
  if (isFlattenEnabled) {
    if (verticalExtrude > 0) {
      // Extruded vertical wall with draft angle
      const draftAngle = obs.extrusionDraftAngle !== undefined ? obs.extrusionDraftAngle : 20;
      const wallSlopeWidth = Math.max(
        1.5,
        verticalExtrude * Math.tan(draftAngle * DEG) + (obs.extrusionBevel || 1.5)
      );

      if (sdfDist >= 0 && sdfDist < wallSlopeWidth) {
        // Hermite smooth drop down the sidewall
        const wallT = sdfDist / wallSlopeWidth; // 0.0 (top) to 1.0 (base sand)
        const wallSmooth = 1 - wallT * wallT * (3 - 2 * wallT);
        const topEdgeH = beddingH + verticalExtrude * 0.95;
        return topEdgeH * wallSmooth + h * (1 - wallSmooth);
      }
    } else {
      // Flat Bedding Pocket perimeter blend
      const blendMargin = 5.0;
      if (sdfDist < blendMargin) {
        const normBlend = (sdfDist + blendMargin) / (2 * blendMargin); // 0.0 to 1.0
        const smoothBlend = normBlend * normBlend * (3 - 2 * normBlend);
        return beddingH * (1 - smoothBlend) + h * smoothBlend;
      }
    }
  }

  return h;
}

/**
 * Evaluate single layer height at world coordinate (x, z)
 */
export function computeLayerHeight(
  x: number,
  z: number,
  layer: RippleLayer,
  surface: SurfaceConfig
): number {
  if (!layer.visible || layer.opacity <= 0.001) return 0;

  // Normalized UV for painted mask
  const u = (x + surface.width / 2) / surface.width;
  const v = (z + surface.length / 2) / surface.length;
  const maskWeight = sampleMask(
    layer.maskData,
    layer.maskWidth,
    layer.maskHeight,
    u,
    v
  );

  if (maskWeight <= 0.001) return 0;

  const noise = getNoiseEngine(layer.noiseSeed || 42);
  const freq = 1 / Math.max(layer.spacing, 2);
  const theta = layer.primaryDir * DEG;
  const stretchAng = (layer.stretchAngle || 0) * DEG;

  let raw = 0;

  switch (layer.mode) {
    case 'warped_perlin': {
      // Long sweeping dunes with gentle S-curves
      raw = noise.warpedStretchedFbm(
        x * freq * 0.85,
        z * freq * 0.85,
        layer.stretchRatio,
        stretchAng,
        layer.warpIntensity * 1.5,
        layer.warpScale,
        layer.noiseOctaves || 4
      );
      break;
    }
    case 'stretched_perlin': {
      // Direct anisotropic elongated dunes
      raw = noise.stretchedFbm(
        x * freq * 0.85,
        z * freq * 0.85,
        layer.stretchRatio,
        stretchAng,
        layer.noiseOctaves || 4
      );
      break;
    }
    case 'ridged_crests': {
      // Windswept sharp knife-edge dunes
      raw = noise.ridgedStretchedFbm(
        x * freq * 0.85,
        z * freq * 0.85,
        layer.stretchRatio,
        stretchAng,
        layer.sharpness,
        layer.noiseOctaves || 4
      );
      break;
    }
    case 'windblown_drift': {
      // Aerodynamic windblown sand drift tongues & streaks lifting upward
      const ws = freq * 0.3;
      const wx = noise.sample2D(x * ws, z * ws) * layer.warpIntensity * 1.8;
      const wz = noise.sample2D(x * ws + 5.7, z * ws + 3.2) * layer.warpIntensity * 1.8;
      const rx = (x + wx * layer.spacing) * Math.cos(theta) + (z + wz * layer.spacing) * Math.sin(theta);
      const ry = -(x + wx * layer.spacing) * Math.sin(theta) + (z + wz * layer.spacing) * Math.cos(theta);
      
      // Ridged streak crests that rise upward in the wind stream
      const s1 = noise.ridgedStretchedFbm(rx * freq * 0.85, ry * freq * 3.2, layer.stretchRatio, 0, layer.sharpness || 0.45, layer.noiseOctaves || 3);
      const s2 = noise.stretchedFbm(rx * freq * 2.0, ry * freq * 5.5, layer.stretchRatio * 0.7, 0, 2);
      raw = s1 * 0.75 + s2 * 0.25;
      break;
    }
    case 'concentric': {
      // Organic elliptical ripple rings lifting upward
      const rx = x * Math.cos(stretchAng) + z * Math.sin(stretchAng);
      const rz = (-x * Math.sin(stretchAng) + z * Math.cos(stretchAng)) / Math.max(1, layer.stretchRatio * 0.3);
      const dist = Math.sqrt(rx * rx + rz * rz);
      const ring = Math.cos(TAU * freq * dist);
      const crestRing = Math.pow((ring + 1) * 0.5, 1.2) * 2.0 - 1.0;
      raw = crestRing * Math.exp(-dist / (surface.width * 0.85));
      break;
    }
    case 'tidal_flats': {
      // Braided tidal sand bars: interwoven elevated sand shoals rising out of shallow channels
      const f1 = noise.ridgedStretchedFbm(x * freq * 0.5, z * freq * 0.5, layer.stretchRatio * 1.2, stretchAng, 0.4, layer.noiseOctaves || 3);
      const f2 = noise.warpedStretchedFbm(x * freq * 1.1, z * freq * 1.1, layer.stretchRatio * 0.75, stretchAng + Math.PI * 0.22, 0.85, 1.0, 3);
      raw = f1 * 0.7 + f2 * 0.3;
      break;
    }
    case 'rolling_ripples': {
      // Rolling ocean swell & organic randomized seabed ripples
      // Smooth sinusoidal/trochoidal multi-harmonic wave superposition with continuous domain meander
      const flowAng = theta + stretchAng;
      const ws = freq * (layer.warpScale || 0.8) * 0.35;
      const w1 = noise.sample2D(x * ws, z * ws) * (layer.warpIntensity ?? 0.65) * 1.6;
      const w2 = noise.sample2D(x * ws + 4.19, z * ws + 2.87) * (layer.warpIntensity ?? 0.65) * 1.6;

      // Coordinate frames aligned with dominant swell direction
      const rx1 = (x + w1 * layer.spacing) * Math.cos(flowAng) + (z + w2 * layer.spacing) * Math.sin(flowAng);
      const ry1 = -(x + w1 * layer.spacing) * Math.sin(flowAng) + (z + w2 * layer.spacing) * Math.cos(flowAng);

      // Primary rolling wave
      const k1 = TAU * freq;
      const sRatio = Math.max(1.0, (layer.stretchRatio || 8.0) * 0.5);
      const crossMod = Math.sin(TAU * (freq / sRatio) * ry1) * 0.15;
      const wave1 = Math.sin(k1 * rx1 + crossMod);

      // Secondary angled harmonic swell (creates organic swell modulation & natural breaks)
      const ang2 = flowAng + 0.28; // ~16 deg offset
      const rx2 = (x + w2 * layer.spacing) * Math.cos(ang2) + (z + w1 * layer.spacing) * Math.sin(ang2);
      const wave2 = Math.sin(TAU * (freq * 1.12) * rx2 + 1.34);

      // Tertiary gentle counter-harmonic
      const ang3 = flowAng - 0.22; // ~-12.6 deg offset
      const rx3 = (x - w1 * layer.spacing * 0.5) * Math.cos(ang3) + (z + w2 * layer.spacing * 0.5) * Math.sin(ang3);
      const wave3 = Math.sin(TAU * (freq * 0.89) * rx3 + 2.71);

      // Superpose harmonics for organic rolling wave interference
      const combinedWaves = wave1 * 0.62 + wave2 * 0.26 + wave3 * 0.12;

      // Gentle smooth rolling curve
      const rollShape = Math.sign(combinedWaves) * Math.pow(Math.abs(combinedWaves), 0.88);

      // Natural swell envelope modulation across terrain (prevents synthetic mechanical repetition)
      const envNoise = noise.fbm(x * freq * 0.2 + 6.3, z * freq * 0.2 + 8.1, layer.noiseOctaves || 3, 0.45);
      const envelope = 0.78 + 0.36 * (envNoise * 0.5 + 0.5);

      // Subtle rolling undulation
      const gentleUndulation = noise.sample2D(x * freq * 0.07 + 14.2, z * freq * 0.07 + 21.6) * 0.18;

      raw = Math.max(-1, Math.min(1, rollShape * envelope + gentleUndulation));
      break;
    }
    case 'sand_hummocks': {
      // Aeolian Sand Hummocks: discrete, well-separated organic sand lumps and smooth mounds
      const flowAng = theta + stretchAng;
      const ws = freq * (layer.warpScale || 0.85) * 0.32;
      const wx = noise.sample2D(x * ws, z * ws) * (layer.warpIntensity ?? 0.5) * 1.2;
      const wz = noise.sample2D(x * ws + 6.31, z * ws + 4.87) * (layer.warpIntensity ?? 0.5) * 1.2;

      const xw = x + wx * layer.spacing * 0.5;
      const zw = z + wz * layer.spacing * 0.5;

      // Aerodynamic elongation ratio along the wind direction
      const elongation = Math.max(1.0, (layer.stretchRatio || 1.0) * 0.35);

      // Scaled frequency for distinct, substantial sand mounds
      const f1 = freq * 0.62;
      const density = 0.5 - Math.min(0.2, (layer.crestFlattening || 0) * 0.2);

      // Evaluate separated sand mounds
      const moundHeight = noise.cellularHummocks2D(
        xw * f1,
        zw * f1,
        elongation,
        flowAng,
        layer.duneAsymmetry || 0.2,
        density
      );

      // Subtle broad desert terrain roll between mounds
      const basinRoll = noise.sample2D(x * f1 * 0.25 + 3.1, z * f1 * 0.25 + 7.8) * 0.08;

      // Clean mapping to [-1, 1] range: 0 mound height leaves flat sand valleys (raw = -1)
      raw = Math.max(-1, Math.min(1, moundHeight * 2.0 - 1.0 + basinRoll));
      break;
    }
  }

  // Handle user elevation inversion (flips crests and troughs)
  if (layer.invert) {
    raw = -raw;
  }

  // Apply natural dune asymmetry (stoss / lee slope)
  raw = applyDuneAsymmetry(raw, layer.duneAsymmetry);

  // Apply crest sharpness & plateau flattening
  raw = applyCrestSculpt(raw, layer.sharpness, layer.crestFlattening);

  // Elevation Lift Mode (default: positive_lift so dunes rise up and out of the model)
  const liftMode = layer.liftMode || 'positive_lift';
  let h = 0;

  if (liftMode === 'positive_lift') {
    // True Positive Relief: Shapes lift up and out of the stock model (0 to +amplitude mm)
    const norm = Math.max(0, Math.min(1, (raw + 1) * 0.5));
    const lifted = Math.pow(norm, 1.1);
    h = layer.amplitude * 2.2 * lifted;
  } else if (liftMode === 'carved_groove') {
    // Carved downwards into the model (-amplitude to 0 mm)
    const norm = Math.max(0, Math.min(1, (raw + 1) * 0.5));
    const carved = Math.pow(1.0 - norm, 1.1);
    h = -layer.amplitude * 2.2 * carved;
  } else {
    // 'centered': Bi-directional oscillation around baseline (-amplitude to +amplitude mm)
    h = layer.amplitude * 1.8 * raw;
  }

  // Secondary micro-ripples / saltation grain
  if (layer.microRipples > 0.01) {
    const mSpacing = Math.max(layer.microSpacing || 8, 2);
    const mFreq = 1 / mSpacing;
    const mAngle = theta + Math.PI * 0.35;
    const mDist = x * Math.cos(mAngle) + z * Math.sin(mAngle);
    h += layer.amplitude * layer.microRipples * 0.3 * Math.sin(TAU * mFreq * mDist);
  }

  // Organic noise grain overlay
  if (layer.noiseOverlay > 0.01) {
    const ns = freq * 0.6;
    h +=
      layer.amplitude *
      layer.noiseOverlay *
      0.35 *
      noise.stretchedFbm(x, z, 1.0, 0, 3);
  }

  return h * layer.opacity * maskWeight;
}

/**
 * Compute gentle basin / concave edge dish elevation offset at (x, z).
 * Raises the perimeter edges so the center of the surface is the low collection point.
 */
export function computeBasinElevation(
  x: number,
  z: number,
  surface: SurfaceConfig
): number {
  const lift = surface.basinLift ?? 0;
  if (lift <= 0) return 0;

  const W = surface.width;
  const L = surface.length;
  const hw = W / 2;
  const hl = L / 2;
  const maxCenterDist = Math.min(hw, hl);

  const profile = surface.basinProfile || 'conformal';
  const margin = surface.basinMargin ?? 0; // 0 = full surface dish spanning to center
  const effectiveMargin = margin > 0 ? Math.min(margin, maxCenterDist) : maxCenterDist;

  let normDistFromEdge = 0; // 0 at the outer rim edge, 1 at interior floor

  if (profile === 'radial') {
    // Elliptical bowl (proportioned to canvas aspect ratio)
    const u = x / hw;
    const v = z / hl;
    const rNorm = Math.min(1.0, Math.sqrt(u * u + v * v));
    if (margin > 0 && margin < maxCenterDist) {
      const innerRatio = Math.max(0, 1.0 - margin / maxCenterDist);
      if (rNorm <= innerRatio) {
        return 0;
      }
      normDistFromEdge = 1.0 - Math.min(1, (rNorm - innerRatio) / Math.max(0.001, 1.0 - innerRatio));
    } else {
      normDistFromEdge = 1.0 - rNorm;
    }
  } else {
    // Conformal boundary (conforms smoothly to rectangle and true physical corner fillets)
    const ax = Math.abs(x);
    const az = Math.abs(z);
    const r = Math.max(0, Math.min(surface.cornerRadius, hw * 0.99, hl * 0.99));
    let dEdge = 0;

    if (r > 0) {
      const cx = hw - r;
      const cz = hl - r;
      const dx = ax - cx;
      const dz = az - cz;
      if (dx > 0 && dz > 0) {
        const cornerDist = Math.sqrt(dx * dx + dz * dz);
        dEdge = Math.max(0, r - cornerDist);
      } else {
        dEdge = Math.max(0, Math.min(hw - ax, hl - az));
      }
    } else {
      dEdge = Math.max(0, Math.min(hw - ax, hl - az));
    }

    if (dEdge >= effectiveMargin) {
      return 0; // Interior flat floor
    }
    normDistFromEdge = dEdge / effectiveMargin;
  }

  // Curvature profiling:
  // normDistFromEdge = 0 at the outer rim edge => lift is at maximum (+basinLift)
  // normDistFromEdge = 1 at the interior basin floor => lift is 0
  const curvature = surface.basinCurvature ?? 2;
  let factor = 0;

  if (curvature === 1) {
    // Linear slope
    factor = 1.0 - normDistFromEdge;
  } else if (curvature === 3) {
    // Soft bowl (gentle parabolic dish: (1 - u^2))
    const u = 1.0 - normDistFromEdge;
    factor = u * u;
  } else {
    // Smooth C^2 cosine curve (0 derivative at both rim lip and inner floor)
    factor = 0.5 * (1.0 + Math.cos(normDistFromEdge * Math.PI));
  }

  return lift * Math.max(0, Math.min(1, factor));
}

/**
 * Compute effective basin elevation taking obstacles into account.
 * For obstacles with a physical cradle (especially imported 3D stones), the cradle
 * must remain a completely rigid, unwarped negative imprint matching the undeformed 3D stone mesh.
 * Therefore, inside the stone's contact footprint, the basin elevation offset is held
 * strictly constant at the stone center's basin elevation (obsElev).
 * Outside the stone boundary, it smoothly blends back to the open curved basin elevation
 * over a transition fillet margin, preventing steps or seams while ensuring a 100% perfect cradle fit.
 */
export function computeEffectiveBasinElevation(
  x: number,
  z: number,
  surface: SurfaceConfig,
  obstacles: Obstacle[] = []
): number {
  const lift = surface.basinLift ?? 0;
  if (lift <= 0) return 0;

  const rawBasinElev = computeBasinElevation(x, z, surface);
  if (!obstacles || obstacles.length === 0) return rawBasinElev;

  let maxWeight = 0;
  let weightedElev = 0;
  let totalWeight = 0;

  for (let i = 0; i < obstacles.length; i++) {
    const obs = obstacles[i];
    if (obs.enabled === false) continue;

    const isImported3d =
      obs.shape === 'custom_3d' ||
      Boolean(obs.customMeshData?.positions?.length) ||
      obs.sourceFormat === 'stl' ||
      obs.sourceFormat === 'obj';

    // If obstacle has cradle disabled or custom_3d has no contact with sand bed, skip
    if (obs.cradleEnabled === false) continue;
    if (isImported3d && obs.hasSurfaceContact === false) continue;

    const obsElev = computeBasinElevation(obs.x, obs.z, surface);
    const sdfDist = getObstacleSignedDistance(x, z, obs);

    // If infinite distance (e.g. stone floating in the air without contact), skip
    if (!isFinite(sdfDist)) continue;

    // Transition blend distance outside the stone perimeter (12-35mm)
    const blendDist = Math.max(12, Math.min(35, obs.radius * 0.45));

    // Check if point is inside the cradle contact footprint
    let isCradleContact = sdfDist <= 0;
    if (!isCradleContact && obs.cradleDepthGrid && obs.cradleBBox) {
      const relX = x - obs.x;
      const relZ = z - obs.z;
      const uH = sampleCradleUndersideHeight(relX, relZ, {
        depthGrid: obs.cradleDepthGrid,
        gridRes: obs.cradleGridRes || 128,
        bbox: obs.cradleBBox,
        waterlineContour: obs.cradleWaterlineContour || [],
        maxPenetration: 0,
      });
      if (uH !== null && uH <= 0.2) {
        isCradleContact = true;
      }
    }

    if (isCradleContact) {
      // Inside contact footprint / cradle: 100% rigid elevation offset (zero basin bending)
      maxWeight = Math.max(maxWeight, 1.0);
      totalWeight += 1.0;
      weightedElev += obsElev;
    } else if (sdfDist < blendDist) {
      // Smooth Hermite blend in the transition margin outside the stone
      const t = sdfDist / blendDist;
      const smoothT = t * t * (3 - 2 * t);
      const w = 1.0 - smoothT;
      if (w > maxWeight) maxWeight = w;
      totalWeight += w;
      weightedElev += w * obsElev;
    }
  }

  if (maxWeight <= 0 || totalWeight <= 0) {
    return rawBasinElev;
  }

  const targetObsElev = weightedElev / totalWeight;
  return (1.0 - maxWeight) * rawBasinElev + maxWeight * targetObsElev;
}

/**
 * Composite full surface height from all layers and obstacles at point (x, z)
 */
export function computeTotalHeight(
  x: number,
  z: number,
  layers: RippleLayer[],
  surface: SurfaceConfig,
  obstacles: Obstacle[] = []
): number {
  let totalH = 0;
  let primaryDirDeg = 0;

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (!layer.visible) continue;
    if (i === 0) primaryDirDeg = layer.primaryDir;

    const layerH = computeLayerHeight(x, z, layer, surface);

    switch (layer.blendMode) {
      case 'add':
        totalH += layerH;
        break;
      case 'max':
        totalH = Math.max(totalH, layerH);
        break;
      case 'multiply':
        totalH = totalH * (1 + layerH / Math.max(layer.amplitude, 1));
        break;
      case 'replace': {
        const u = (x + surface.width / 2) / surface.width;
        const v = (z + surface.length / 2) / surface.length;
        const w = sampleMask(
          layer.maskData,
          layer.maskWidth,
          layer.maskHeight,
          u,
          v
        ) * layer.opacity;
        totalH = totalH * (1 - w) + layerH * w;
        break;
      }
    }
  }

  // Apply obstacles (calculates physical mass displacement & wake effects)
  for (const obs of obstacles) {
    if (obs.enabled !== false) {
      totalH = applyObstacleInterference(totalH, x, z, obs, primaryDirDeg);
    }
  }

  // Apply gentle basin edge bowing (raises perimeter edges so water pools in middle)
  // Maintains 100% rigid, unwarped cradles under stones even as basin curvature increases
  if (surface.basinLift && surface.basinLift > 0) {
    totalH += computeEffectiveBasinElevation(x, z, surface, obstacles);
  }

  return totalH;
}

/**
 * Build 2D contour polygon of the true cut filleted canvas
 * (4 corners filleted with smooth circular arcs)
 */
export function generateFilletContour(
  width: number,
  length: number,
  cornerRadius: number,
  arcSegments: number = 16
): THREE.Vector2[] {
  const hw = width / 2;
  const hl = length / 2;
  const r = Math.max(0, Math.min(cornerRadius, hw * 0.999, hl * 0.999));

  if (r <= 0.1) {
    return [
      new THREE.Vector2(-hw, -hl),
      new THREE.Vector2(hw, -hl),
      new THREE.Vector2(hw, hl),
      new THREE.Vector2(-hw, hl),
    ];
  }

  const points: THREE.Vector2[] = [];
  const cx = hw - r;
  const cz = hl - r;

  // Corner 1: Top-Right (+X, +Z)
  for (let i = 0; i <= arcSegments; i++) {
    const a = 0 + (i / arcSegments) * (Math.PI / 2);
    points.push(new THREE.Vector2(cx + Math.cos(a) * r, cz + Math.sin(a) * r));
  }

  // Corner 2: Top-Left (-X, +Z)
  for (let i = 0; i <= arcSegments; i++) {
    const a = Math.PI / 2 + (i / arcSegments) * (Math.PI / 2);
    points.push(new THREE.Vector2(-cx + Math.cos(a) * r, cz + Math.sin(a) * r));
  }

  // Corner 3: Bottom-Left (-X, -Z)
  for (let i = 0; i <= arcSegments; i++) {
    const a = Math.PI + (i / arcSegments) * (Math.PI / 2);
    points.push(new THREE.Vector2(-cx + Math.cos(a) * r, -cz + Math.sin(a) * r));
  }

  // Corner 4: Bottom-Right (+X, -Z)
  for (let i = 0; i <= arcSegments; i++) {
    const a = (Math.PI * 3) / 2 + (i / arcSegments) * (Math.PI / 2);
    points.push(new THREE.Vector2(cx + Math.cos(a) * r, -cz + Math.sin(a) * r));
  }

  return points;
}

/**
 * Generate 3D Surface BufferGeometry with TRUE Cut Fillet Canvas
 * Clamps / trims points outside the corner fillet to produce an exact physical rounded perimeter!
 */
export function buildSurfaceGeometry(
  surface: SurfaceConfig,
  layers: RippleLayer[],
  obstacles: Obstacle[] = []
): THREE.BufferGeometry {
  const { width: W, length: L, cornerRadius: R, resolution } = surface;
  const resX = resolution;
  const resZ = Math.max(16, Math.round((resolution * L) / W));

  const count = (resX + 1) * (resZ + 1);
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const colors = new Float32Array(count * 3);

  const hw = W / 2;
  const hl = L / 2;
  const r = Math.max(0, Math.min(R, hw * 0.99, hl * 0.99));

  // Compute grid vertices with true filleted boundary clipping / snapping
  for (let j = 0; j <= resZ; j++) {
    for (let i = 0; i <= resX; i++) {
      const idx = j * (resX + 1) + i;
      let x = (i / resX - 0.5) * W;
      let z = (j / resZ - 0.5) * L;

      // Snap points that are outside the corner fillet to the exact fillet arc
      if (r > 0) {
        const cx = hw - r;
        const cz = hl - r;
        const sgnX = Math.sign(x) || 1;
        const sgnZ = Math.sign(z) || 1;
        const dx = Math.abs(x) - cx;
        const dz = Math.abs(z) - cz;

        if (dx > 0 && dz > 0) {
          const cornerDist = Math.sqrt(dx * dx + dz * dz);
          if (cornerDist > r) {
            // Project onto the exact fillet arc
            const normX = dx / cornerDist;
            const normZ = dz / cornerDist;
            x = (cx + normX * r) * sgnX;
            z = (cz + normZ * r) * sgnZ;
          }
        }
      }

      const y = computeTotalHeight(x, z, layers, surface, obstacles);

      pos[idx * 3] = x;
      pos[idx * 3 + 1] = y;
      pos[idx * 3 + 2] = z;

      uv[idx * 2] = i / resX;
      uv[idx * 2 + 1] = j / resZ;

      // Base color attribute
      colors[idx * 3] = 0.85;
      colors[idx * 3 + 1] = 0.72;
      colors[idx * 3 + 2] = 0.52;
    }
  }

  // Construct index triangles
  const indices: number[] = [];
  for (let j = 0; j < resZ; j++) {
    for (let i = 0; i < resX; i++) {
      const a = j * (resX + 1) + i;
      const b = a + 1;
      const c = a + (resX + 1);
      const d = c + 1;

      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  return geo;
}

/**
 * Update existing surface geometry positions in-place for smooth real-time brush painting
 */
export function updateSurfacePositions(
  geo: THREE.BufferGeometry,
  surface: SurfaceConfig,
  layers: RippleLayer[],
  obstacles: Obstacle[] = []
): void {
  const { width: W, length: L, cornerRadius: R, resolution } = surface;
  const resX = resolution;
  const resZ = Math.max(16, Math.round((resolution * L) / W));

  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const hw = W / 2;
  const hl = L / 2;
  const r = Math.max(0, Math.min(R, hw * 0.99, hl * 0.99));

  for (let j = 0; j <= resZ; j++) {
    for (let i = 0; i <= resX; i++) {
      const idx = j * (resX + 1) + i;
      let x = (i / resX - 0.5) * W;
      let z = (j / resZ - 0.5) * L;

      if (r > 0) {
        const cx = hw - r;
        const cz = hl - r;
        const sgnX = Math.sign(x) || 1;
        const sgnZ = Math.sign(z) || 1;
        const dx = Math.abs(x) - cx;
        const dz = Math.abs(z) - cz;

        if (dx > 0 && dz > 0) {
          const cornerDist = Math.sqrt(dx * dx + dz * dz);
          if (cornerDist > r) {
            const normX = dx / cornerDist;
            const normZ = dz / cornerDist;
            x = (cx + normX * r) * sgnX;
            z = (cz + normZ * r) * sgnZ;
          }
        }
      }

      const y = computeTotalHeight(x, z, layers, surface, obstacles);
      posAttr.setXYZ(idx, x, y, z);
    }
  }

  posAttr.needsUpdate = true;
  geo.computeVertexNormals();
}
