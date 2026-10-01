/**
 * Utility for parsing and rasterizing custom shapes (SVG / Alpha images / Polygons)
 * into high-speed 2D Signed Distance Fields (SDF) for real-time CNC displacement
 */

// Presets normalized to [-1, 1] range centered at (0,0)
export const PRESET_SHAPES: Record<
  string,
  { name: string; description: string; points: [number, number][] }
> = {
  organic_pebble: {
    name: 'Zen River Pebble',
    description: 'Smooth asymmetric Japanese garden river stone',
    points: generateOrganicPebblePoints(36),
  },
  lotus_leaf: {
    name: 'Organic Leaf Silhouette',
    description: 'Natural teardrop leaf contour',
    points: generateTeardropPoints(36),
  },
  yin_yang: {
    name: 'Flowing S-Curve Island',
    description: 'Harmonic balanced contour',
    points: generateSCurvePoints(36),
  },
  bonsai_island: {
    name: 'Bonsai Island Plan',
    description: 'Lobed organic stone island',
    points: generateLobedPoints(40),
  },
  faceted_crystal: {
    name: 'Faceted Rock / Hexagon',
    description: 'Geometric faceted stone slab',
    points: generatePolygonPoints(6, 0.88),
  },
};

function generateOrganicPebblePoints(numSegments: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < numSegments; i++) {
    const angle = (i / numSegments) * Math.PI * 2;
    // Harmonic modulation for smooth natural river pebble
    const r =
      0.88 +
      0.18 * Math.cos(2 * angle) +
      0.08 * Math.sin(3 * angle) -
      0.05 * Math.cos(4 * angle) +
      0.03 * Math.sin(5 * angle);
    pts.push([Math.cos(angle) * r, Math.sin(angle) * r]);
  }
  return pts;
}

function generateTeardropPoints(numSegments: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < numSegments; i++) {
    const t = (i / numSegments) * Math.PI * 2;
    const x = Math.sin(t) * Math.pow(Math.sin(t / 2), 0.8) * 1.3;
    const y = -Math.cos(t) * 0.95;
    pts.push([x, y]);
  }
  return pts;
}

function generateSCurvePoints(numSegments: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < numSegments; i++) {
    const t = (i / numSegments) * Math.PI * 2;
    const r = 0.85 + 0.22 * Math.sin(2 * t) + 0.1 * Math.cos(3 * t);
    pts.push([Math.cos(t) * r * 1.1, Math.sin(t) * r * 0.8]);
  }
  return pts;
}

function generateLobedPoints(numSegments: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < numSegments; i++) {
    const t = (i / numSegments) * Math.PI * 2;
    const r = 0.75 + 0.18 * Math.cos(3 * t) + 0.12 * Math.sin(2 * t);
    pts.push([Math.cos(t) * r * 1.15, Math.sin(t) * r * 0.85]);
  }
  return pts;
}

function generatePolygonPoints(sides: number, radius = 0.9): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2;
    pts.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return pts;
}

/**
 * Compute 2D Signed Distance to arbitrary polygon outline
 * Negative inside, positive outside
 */
export function pointToPolygonSDF(
  px: number,
  pz: number,
  poly: [number, number][]
): number {
  let inside = false;
  let minSqDist = Infinity;
  const n = poly.length;

  for (let i = 0; i < n; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];

    // Ray casting for inside/outside test
    if (
      p1[1] > pz !== p2[1] > pz &&
      px < ((p2[0] - p1[0]) * (pz - p1[1])) / (p2[1] - p1[1]) + p1[0]
    ) {
      inside = !inside;
    }

    // Distance to line segment
    const dx = p2[0] - p1[0];
    const dz = p2[1] - p1[1];
    const l2 = dx * dx + dz * dz;

    let t = 0;
    if (l2 > 0.000001) {
      t = Math.max(0, Math.min(1, ((px - p1[0]) * dx + (pz - p1[1]) * dz) / l2));
    }
    const projX = p1[0] + t * dx;
    const projZ = p1[1] + t * dz;
    const sqDist = (px - projX) * (px - projX) + (pz - projZ) * (pz - projZ);
    if (sqDist < minSqDist) minSqDist = sqDist;
  }

  const d = Math.sqrt(minSqDist);
  return inside ? -d : d;
}

/**
 * Precompute a 2D Signed Distance Field (SDF) grid for fast evaluation
 */
export function generateSdfGridFromPolygon(
  poly: [number, number][],
  res = 64
): number[] {
  const grid = new Array(res * res);
  for (let j = 0; j < res; j++) {
    const z = (j / (res - 1) - 0.5) * 2.5; // [-1.25, 1.25]
    for (let i = 0; i < res; i++) {
      const x = (i / (res - 1) - 0.5) * 2.5;
      grid[j * res + i] = pointToPolygonSDF(x, z, poly);
    }
  }
  return grid;
}

/**
 * Bilinear sample precomputed SDF grid
 */
export function sampleSdfGrid(
  normX: number,
  normZ: number,
  grid: number[],
  res: number
): number {
  // Map [-1.25, 1.25] to [0, res-1]
  const gx = ((normX / 2.5) + 0.5) * (res - 1);
  const gz = ((normZ / 2.5) + 0.5) * (res - 1);

  if (gx <= 0 || gx >= res - 1 || gz <= 0 || gz >= res - 1) {
    // Outside grid - smooth radial distance fallback
    const r = Math.sqrt(normX * normX + normZ * normZ);
    return Math.max(0.2, r - 0.85);
  }

  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const x1 = x0 + 1;
  const z1 = z0 + 1;

  const fx = gx - x0;
  const fz = gz - z0;

  const v00 = grid[z0 * res + x0];
  const v10 = grid[z0 * res + x1];
  const v01 = grid[z1 * res + x0];
  const v11 = grid[z1 * res + x1];

  const top = v00 * (1 - fx) + v10 * fx;
  const bot = v01 * (1 - fx) + v11 * fx;

  return top * (1 - fz) + bot * fz;
}

/**
 * Parse an SVG path 'd' attribute or SVG string into a 2D polygon
 */
export function parseSvgToPolygon(svgStr: string, numSamples = 64): [number, number][] {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgStr, 'image/svg+xml');
    const pathElem = doc.querySelector('path');
    let pathObj: SVGPathElement | null = pathElem;

    if (!pathObj) {
      // Create offscreen path to parse d attribute
      const dMatch = svgStr.match(/d\s*=\s*["']([^"']+)["']/i);
      if (dMatch) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        pathObj = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathObj.setAttribute('d', dMatch[1]);
        svg.appendChild(pathObj);
        document.body.appendChild(svg);
      }
    }

    if (pathObj && typeof pathObj.getTotalLength === 'function') {
      const totalLen = pathObj.getTotalLength();
      if (totalLen > 0) {
        const rawPts: [number, number][] = [];
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;

        for (let i = 0; i < numSamples; i++) {
          const pt = pathObj.getPointAtLength((i / numSamples) * totalLen);
          rawPts.push([pt.x, pt.y]);
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.y > maxY) maxY = pt.y;
        }

        if (pathObj.ownerSVGElement && pathObj.ownerSVGElement.parentNode === document.body) {
          document.body.removeChild(pathObj.ownerSVGElement);
        }

        const spanX = Math.max(0.001, maxX - minX);
        const spanY = Math.max(0.001, maxY - minY);
        const maxSpan = Math.max(spanX, spanY);
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;

        // Center and normalize to [-0.9, 0.9]
        return rawPts.map(([x, y]) => [
          ((x - midX) / maxSpan) * 1.8,
          ((y - midY) / maxSpan) * 1.8,
        ]);
      }
    }
  } catch (e) {
    console.error('Error parsing SVG:', e);
  }

  // Fallback to organic pebble
  return generateOrganicPebblePoints(numSamples);
}

/**
 * Convert an uploaded image (PNG/JPG) into a high-speed 2D SDF polygon contour
 */
export function imageToPolygon(
  img: HTMLImageElement,
  threshold = 128,
  numPoints = 48
): [number, number][] {
  const canvas = document.createElement('canvas');
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return generateOrganicPebblePoints(numPoints);

  ctx.drawImage(img, 0, 0, size, size);
  const imgData = ctx.getImageData(0, 0, size, size);
  const data = imgData.data;

  // Find center of mass / alpha mask
  const binary = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];

    // Dark foreground or non-transparent silhouette
    const brightness = (r + g + b) / 3;
    const isSolid = a > 50 && brightness < threshold;
    binary[i] = isSolid ? 1 : 0;
  }

  // Radial ray sampling from center to find perimeter
  const cx = size / 2;
  const cy = size / 2;
  const pts: [number, number][] = [];

  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * Math.PI * 2;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    let maxDist = 0;
    for (let r = 2; r < size * 0.48; r += 1) {
      const sampleX = Math.round(cx + cosA * r);
      const sampleY = Math.round(cy + sinA * r);
      if (sampleX < 0 || sampleX >= size || sampleY < 0 || sampleY >= size) break;
      if (binary[sampleY * size + sampleX] === 1) {
        maxDist = r;
      }
    }

    if (maxDist < 4) maxDist = size * 0.28; // Fallback radius

    const normR = (maxDist / (size * 0.5)) * 0.95;
    pts.push([cosA * normR, sinA * normR]);
  }

  return pts;
}
