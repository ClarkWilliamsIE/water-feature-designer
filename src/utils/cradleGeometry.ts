import * as THREE from 'three';
import { Obstacle } from '../types';
import { extractAccurateSilhouette } from './importers';

export interface CradleData {
  depthGrid: number[]; // 1D row-major array of size gridRes x gridRes
  gridRes: number;
  bbox: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    minY: number;
    maxY: number;
  };
  waterlineContour: [number, number][]; // normalized 2D points [-1, 1] relative to radius
  maxPenetration: number; // how deep below Y=0 the lowest point goes
  hasSurfaceContact?: boolean; // true if any part of the 3D model intersects/penetrates the sand bed surface
}

export function isImportedRockObstacle(obs: Obstacle): boolean {
  return (
    obs.shape === 'custom_3d' ||
    Boolean(obs.customMeshData?.positions?.length) ||
    obs.sourceFormat === 'stl' ||
    obs.sourceFormat === 'obj'
  );
}

/**
 * Transform 3D mesh vertices by obstacle's scale, 3-axis rotation, flips, and elevation
 */
function getTransformedMeshVertices(obs: Obstacle): {
  vertices: Float32Array;
  trianglesCount: number;
  minY: number;
  maxY: number;
} | null {
  if (!obs.customMeshData || !obs.customMeshData.positions || obs.customMeshData.positions.length === 0) {
    return null;
  }

  const raw = obs.customMeshData.positions;
  const count = Math.floor(raw.length / 3);
  const transformed = new Float32Array(raw.length);

  const bbox = obs.customMeshData.bbox;
  let scaleX = 1.0;
  let scaleY = 1.0;
  let scaleZ = 1.0;

  if (bbox) {
    const maxHoriz = Math.max(0.1, Math.max(bbox.maxX - bbox.minX, bbox.maxZ - bbox.minZ));
    const targetScale = (obs.radius * 2) / maxHoriz;
    const origH = Math.max(0.1, bbox.maxY - bbox.minY);

    let sy = 1.0;
    if (obs.lockAspectRatio !== false) {
      sy = obs.scaleY || 1.0;
    } else {
      if (obs.scaleY !== undefined) {
        sy = obs.scaleY;
      } else if (obs.height) {
        sy = obs.height / (origH * targetScale);
      }
    }

    scaleX = targetScale * (obs.scaleX || 1.0);
    scaleY = targetScale * sy;
    scaleZ = targetScale * (obs.scaleZ || 1.0);
  }

  // Apply mirror flips
  if (obs.flipX) scaleX = -scaleX;
  if (obs.flipZ) scaleZ = -scaleZ;

  const rotX = ((obs.rotationX || 0) * Math.PI) / 180;
  const rotY = -((obs.rotation || obs.rotationY || 0) * Math.PI) / 180;
  const rotZ = ((obs.rotationZ || 0) * Math.PI) / 180;

  const euler = new THREE.Euler(rotX, rotY, rotZ, 'YXZ');
  const rotMatrix = new THREE.Matrix4().makeRotationFromEuler(euler);

  // For imported 3D rocks, elevation strictly defines the model position.
  // We skip beddingDepth and verticalExtrusion from flat-bottom stone settings so it follows the true rock contour.
  const isImported = isImportedRockObstacle(obs);
  const elev = (obs.elevation !== undefined ? obs.elevation : 0) + (isImported ? 0 : ((obs.beddingDepth || 0) + (obs.verticalExtrusion || 0)));

  let minY = Infinity;
  let maxY = -Infinity;

  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const idx = i * 3;
    v.set(raw[idx] * scaleX, raw[idx + 1] * scaleY, raw[idx + 2] * scaleZ);
    v.applyMatrix4(rotMatrix);

    const wy = v.y + elev;
    transformed[idx] = v.x;
    transformed[idx + 1] = wy;
    transformed[idx + 2] = v.z;

    if (wy < minY) minY = wy;
    if (wy > maxY) maxY = wy;
  }

  return {
    vertices: transformed,
    trianglesCount: Math.floor(count / 3),
    minY,
    maxY,
  };
}

/**
 * Precompute the 2D cradle underside depth map and waterline intersection contour
 * for any obstacle (imported 3D mesh or procedural stone)
 */
export function generateObstacleCradleData(
  obs: Obstacle,
  requestedGridRes: number = 64
): CradleData {
  const isImported = isImportedRockObstacle(obs);
  const gridRes = isImported ? Math.max(requestedGridRes, 128) : requestedGridRes;
  const elev = (obs.elevation !== undefined ? obs.elevation : 0) + (isImported ? 0 : ((obs.beddingDepth || 0) + (obs.verticalExtrusion || 0)));
  const sx = Math.max(0.05, obs.scaleX || 1.0);
  const sz = Math.max(0.05, obs.scaleZ || 1.0);
  const halfExtentX = obs.radius * sx * 1.35;
  const halfExtentZ = obs.radius * sz * 1.35;

  let bbox = {
    minX: -halfExtentX,
    maxX: halfExtentX,
    minZ: -halfExtentZ,
    maxZ: halfExtentZ,
    minY: elev - obs.height * 1.5,
    maxY: elev + obs.height * 1.5,
  };

  const depthGrid = new Array(gridRes * gridRes).fill(Infinity);
  let maxPenetration = 0;
  let waterlineContour: [number, number][] = [];

  // ── CASE A: Custom 3D Mesh (STL / OBJ) ──
  if (obs.shape === 'custom_3d' && obs.customMeshData?.positions) {
    const meshInfo = getTransformedMeshVertices(obs);
    if (meshInfo) {
      const { vertices, trianglesCount } = meshInfo;

      // Tight bounding box fitted to the transformed 3D mesh
      let mx0 = Infinity, mx1 = -Infinity, mz0 = Infinity, mz1 = -Infinity;
      for (let i = 0; i < vertices.length; i += 3) {
        const vx = vertices[i];
        const vz = vertices[i + 2];
        if (vx < mx0) mx0 = vx;
        if (vx > mx1) mx1 = vx;
        if (vz < mz0) mz0 = vz;
        if (vz > mz1) mz1 = vz;
      }
      if (mx0 !== Infinity) {
        const padX = Math.max(8, (mx1 - mx0) * 0.12);
        const padZ = Math.max(8, (mz1 - mz0) * 0.12);
        bbox.minX = mx0 - padX;
        bbox.maxX = mx1 + padX;
        bbox.minZ = mz0 - padZ;
        bbox.maxZ = mz1 + padZ;
      }

      const stepX = (bbox.maxX - bbox.minX) / (gridRes - 1);
      const stepZ = (bbox.maxZ - bbox.minZ) / (gridRes - 1);

      // Rasterize triangles onto depthGrid (finding minimum Y per cell)
      const p0 = new THREE.Vector3();
      const p1 = new THREE.Vector3();
      const p2 = new THREE.Vector3();

      for (let t = 0; t < trianglesCount; t++) {
        const i0 = t * 9;
        p0.set(vertices[i0], vertices[i0 + 1], vertices[i0 + 2]);
        p1.set(vertices[i0 + 3], vertices[i0 + 4], vertices[i0 + 5]);
        p2.set(vertices[i0 + 6], vertices[i0 + 7], vertices[i0 + 8]);

        // Optimization: Triangles completely above maximum possible sand bed reach cannot form the cradle pocket
        const maxPlaneReach = Math.max(300, elev + 120);
        if (p0.y > maxPlaneReach && p1.y > maxPlaneReach && p2.y > maxPlaneReach) {
          continue;
        }

        // Triangle horizontal 2D AABB
        const tMinX = Math.min(p0.x, p1.x, p2.x);
        const tMaxX = Math.max(p0.x, p1.x, p2.x);
        const tMinZ = Math.min(p0.z, p1.z, p2.z);
        const tMaxZ = Math.max(p0.z, p1.z, p2.z);

        if (tMaxX < bbox.minX || tMinX > bbox.maxX || tMaxZ < bbox.minZ || tMinZ > bbox.maxZ) {
          continue;
        }

        const colMin = Math.max(0, Math.floor((tMinX - bbox.minX) / stepX));
        const colMax = Math.min(gridRes - 1, Math.ceil((tMaxX - bbox.minX) / stepX));
        const rowMin = Math.max(0, Math.floor((tMinZ - bbox.minZ) / stepZ));
        const rowMax = Math.min(gridRes - 1, Math.ceil((tMaxZ - bbox.minZ) / stepZ));

        // Edge vectors for 2D barycentric testing
        const v0x = p2.x - p0.x;
        const v0z = p2.z - p0.z;
        const v1x = p1.x - p0.x;
        const v1z = p1.z - p0.z;
        const det = v0x * v1z - v0z * v1x;
        if (Math.abs(det) < 1e-7) continue;
        const invDet = 1.0 / det;

        for (let r = rowMin; r <= rowMax; r++) {
          const pz = bbox.minZ + r * stepZ;
          for (let c = colMin; c <= colMax; c++) {
            const px = bbox.minX + c * stepX;

            const v2x = px - p0.x;
            const v2z = pz - p0.z;

            const u = (v2x * v1z - v2z * v1x) * invDet;
            const v = (v0x * v2z - v0z * v2x) * invDet;

            if (u >= -0.01 && v >= -0.01 && u + v <= 1.01) {
              const y = p0.y + u * (p2.y - p0.y) + v * (p1.y - p0.y);
              const gridIdx = r * gridRes + c;
              if (y < depthGrid[gridIdx]) {
                depthGrid[gridIdx] = y;
                if (-y > maxPenetration) {
                  maxPenetration = -y;
                }
              }
            }
          }
        }
      }

      // Contact waterline will be extracted strictly from depthGrid cells intersecting the sand plane (Y <= 0.2mm)
    }
  }

  // ── CASE B: Analytical Shapes (Sphere, Pebble, Boulder, Box, Cylinder) ──
  else {
    const rx = obs.radius * sx;
    const rz = obs.radius * sz;
    const ry = obs.height;
    const stepX = (bbox.maxX - bbox.minX) / (gridRes - 1);
    const stepZ = (bbox.maxZ - bbox.minZ) / (gridRes - 1);

    const rotX = ((obs.rotationX || 0) * Math.PI) / 180;
    const rotY = -((obs.rotation || obs.rotationY || 0) * Math.PI) / 180;
    const rotZ = ((obs.rotationZ || 0) * Math.PI) / 180;
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);

    for (let r = 0; r < gridRes; r++) {
      const z = bbox.minZ + r * stepZ;
      for (let c = 0; c < gridRes; c++) {
        const x = bbox.minX + c * stepX;
        // Unrotate by ground Yaw
        const unx = x * cosY - z * sinY;
        const unz = x * sinY + z * cosY;

        let undersideY = Infinity;

        if (obs.shape === 'stone_sphere') {
          const d2 = (unx * unx) / (rx * rx) + (unz * unz) / (rz * rz);
          if (d2 <= 1.0) {
            const sag = Math.sqrt(Math.max(0, 1.0 - d2)) * (ry * 0.5);
            undersideY = elev - sag;
          }
        } else if (obs.shape === 'stone_boulder' || obs.shape === 'organic_pebble') {
          const angle = Math.atan2(unz, unx);
          const bump =
            obs.shape === 'stone_boulder'
              ? 0.94 + 0.08 * Math.cos(5 * angle) + 0.04 * Math.sin(7 * angle)
              : 0.96 + 0.06 * Math.cos(3 * angle);
          const effectiveRx = rx * bump;
          const effectiveRz = rz * bump;
          const d2 = (unx * unx) / (effectiveRx * effectiveRx) + (unz * unz) / (effectiveRz * effectiveRz);
          if (d2 <= 1.0) {
            const sag = Math.sqrt(Math.max(0, 1.0 - d2)) * (ry * 0.52);
            undersideY = elev - sag;
          }
        } else if (obs.shape === 'box') {
          if (Math.abs(unx) <= rx && Math.abs(unz) <= rz) {
            undersideY = elev - ry * 0.5;
          }
        } else {
          // cylinder
          const d = Math.sqrt((unx * unx) / (rx * rx) + (unz * unz) / (rz * rz));
          if (d <= 1.0) {
            undersideY = elev - ry * 0.5;
          }
        }

        if (undersideY !== Infinity) {
          depthGrid[r * gridRes + c] = undersideY;
          if (-undersideY > maxPenetration) {
            maxPenetration = -undersideY;
          }
        }
      }
    }

    waterlineContour = extractWaterlinePolygon(depthGrid, gridRes, bbox, obs.radius, 0.2);
  }

  // ── Identify anomalies & flatten off spikes / penetrations / raster holes ──
  cleanAndFlattenCradleGrid(depthGrid, gridRes, obs);

  let hasSurfaceContact = true;

  // For custom 3D mesh stones, extract exact contact waterline where stone cuts sand surface (Y <= 0.2mm)
  if (obs.shape === 'custom_3d') {
    const safeRadius = Math.max(1, obs.radius);
    const exactWl = extractWaterlinePolygon(depthGrid, gridRes, bbox, safeRadius, 0.2);
    if (exactWl.length >= 6) {
      waterlineContour = exactWl;
      hasSurfaceContact = true;
    } else {
      waterlineContour = [];
      hasSurfaceContact = false;
    }
  } else {
    hasSurfaceContact = waterlineContour.length >= 6;
  }

  return {
    depthGrid,
    gridRes,
    bbox,
    waterlineContour,
    maxPenetration: Math.max(0, maxPenetration),
    hasSurfaceContact,
  };
}

/**
 * Identifies height spikes, upward penetrations, and void anomalies in the cradle depth grid,
 * and flattens them off to create a smooth, clean pocket that never penetrates the 3D model.
 */
export function cleanAndFlattenCradleGrid(
  depthGrid: number[],
  gridRes: number,
  obs: Obstacle
): void {
  const flattenAnomalies = obs.flattenCradleAnomalies !== false;
  if (!flattenAnomalies) return;

  const maxCeiling = obs.cradleCeilingClamp !== undefined ? obs.cradleCeilingClamp : 0.0;
  const outlierThreshold = 3.0; // mm: max allowable height jump above local neighbor floor

  // Pass 1: Hole Inpainting (Fill raster gaps where triangles were missing, steep or vertical)
  for (let pass = 0; pass < 2; pass++) {
    for (let r = 1; r < gridRes - 1; r++) {
      for (let c = 1; c < gridRes - 1; c++) {
        const idx = r * gridRes + c;
        if (depthGrid[idx] === Infinity) {
          const validNeighbors: number[] = [];
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const v = depthGrid[(r + dr) * gridRes + (c + dc)];
              if (v !== Infinity) validNeighbors.push(v);
            }
          }
          // For custom 3D models, strictly only heal interior pinholes with full 8-neighbor coverage.
          // Never dilate or expand perimeter boundary cells into the surrounding sand.
          const minNeighbors = obs.shape === 'custom_3d' ? 8 : 4;
          if (validNeighbors.length >= minNeighbors) {
            validNeighbors.sort((a, b) => a - b);
            depthGrid[idx] = validNeighbors[Math.floor(validNeighbors.length / 2)];
          }
        }
      }
    }
  }

  // Pass 2: Detect Outlier Spikes (where cradle shoots up into the 3D model) & Flatten them
  const clone = [...depthGrid];
  for (let r = 1; r < gridRes - 1; r++) {
    for (let c = 1; c < gridRes - 1; c++) {
      const idx = r * gridRes + c;
      const val = clone[idx];
      if (val === Infinity) continue;

      const neighbors: number[] = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const v = clone[(r + dr) * gridRes + (c + dc)];
          if (v !== Infinity) neighbors.push(v);
        }
      }

      if (neighbors.length >= 3) {
        neighbors.sort((a, b) => a - b);
        const median = neighbors[Math.floor(neighbors.length / 2)];
        // If this cell spikes upward above its local neighbors by more than outlierThreshold,
        // it's an anomaly blasting through the model -> flatten it to the neighbor median
        if (val > median + outlierThreshold) {
          depthGrid[idx] = median;
        }
      }

      // Ceiling clamp: For analytical shapes, flatten off heights exceeding maxCeiling.
      // For custom 3D models, do NOT clamp overhangs (> 0) down to maxCeiling in the grid.
      // Keeping their true height (Y > 0) is what allows us to identify that they hang in the air
      // and do NOT intersect the sand surface. Clamping is handled inside the submerged cavity at sample time.
      if (obs.shape !== 'custom_3d' && depthGrid[idx] > maxCeiling) {
        depthGrid[idx] = maxCeiling;
      }
    }
  }

  // Pass 3: Gentle smoothing to ensure the cradle surface is CNC-clean and free of faceting spikes
  const smoothed = [...depthGrid];
  for (let r = 1; r < gridRes - 1; r++) {
    for (let c = 1; c < gridRes - 1; c++) {
      const idx = r * gridRes + c;
      if (smoothed[idx] === Infinity) continue;

      let sum = smoothed[idx] * 2;
      let count = 2;
      const nIndices = [
        (r - 1) * gridRes + c,
        (r + 1) * gridRes + c,
        r * gridRes + (c - 1),
        r * gridRes + (c + 1),
      ];
      for (const ni of nIndices) {
        if (smoothed[ni] !== Infinity) {
          sum += smoothed[ni];
          count++;
        }
      }
      if (count >= 4) {
        depthGrid[idx] = obs.shape === 'custom_3d' ? (sum / count) : Math.min(maxCeiling, sum / count);
      }
    }
  }
}

/**
 * Trace the exact perimeter boundary contour of the 3D model footprint where it intersects the sand surface.
 * Uses Moore-Neighbor boundary tracing around cells that penetrate or touch the sand surface plane (val <= surfaceThreshold),
 * strictly capturing only the parts of the shape that intersect the surface and excluding overhead overhangs or aerial cantilevers.
 */
function extractWaterlinePolygon(
  depthGrid: number[],
  gridRes: number,
  bbox: { minX: number; maxX: number; minZ: number; maxZ: number },
  refRadius: number,
  surfaceThreshold: number = 0.2
): [number, number][] {
  const stepX = (bbox.maxX - bbox.minX) / (gridRes - 1);
  const stepZ = (bbox.maxZ - bbox.minZ) / (gridRes - 1);

  const isContact = (c: number, r: number) => {
    if (c < 0 || c >= gridRes || r < 0 || r >= gridRes) return false;
    const v = depthGrid[r * gridRes + c];
    return v !== Infinity && v <= surfaceThreshold;
  };

  // 1. Find the first surface-intersecting boundary cell (scanning top-to-bottom, left-to-right)
  let startC = -1;
  let startR = -1;

  for (let r = 0; r < gridRes; r++) {
    for (let c = 0; c < gridRes; c++) {
      if (isContact(c, r)) {
        startC = c;
        startR = r;
        break;
      }
    }
    if (startC !== -1) break;
  }

  // If no cells penetrate or intersect the surface plane (e.g. stone is elevated completely in the air)
  if (startC === -1) {
    return [];
  }

  // 8-neighborhood directions clockwise starting from Up (0)
  // 0: Up, 1: Up-Right, 2: Right, 3: Down-Right, 4: Down, 5: Down-Left, 6: Left, 7: Up-Left
  const dCols = [0, 1, 1, 1, 0, -1, -1, -1];
  const dRows = [-1, -1, 0, 1, 1, 1, 0, -1];

  const rawBoundary: [number, number][] = [];
  let curC = startC;
  let curR = startR;
  let backtrackDir = 6; // Came from Left

  rawBoundary.push([curC, curR]);

  const maxSteps = gridRes * 8;
  for (let step = 0; step < maxSteps; step++) {
    let nextC = -1;
    let nextR = -1;
    let nextBacktrack = -1;

    for (let i = 0; i < 8; i++) {
      const dir = (backtrackDir + 1 + i) % 8;
      const nc = curC + dCols[dir];
      const nr = curR + dRows[dir];

      if (isContact(nc, nr)) {
        nextC = nc;
        nextR = nr;
        nextBacktrack = (dir + 4) % 8;
        break;
      }
    }

    if (nextC === -1 || (nextC === startC && nextR === startR && rawBoundary.length >= 8)) {
      break;
    }

    rawBoundary.push([nextC, nextR]);
    curC = nextC;
    curR = nextR;
    backtrackDir = nextBacktrack;
  }

  // Subsample to 96 clean vertices for fast, smooth SDF calculation
  const targetCount = 96;
  const stride = Math.max(1, Math.floor(rawBoundary.length / targetCount));
  const points: [number, number][] = [];

  for (let i = 0; i < rawBoundary.length; i += stride) {
    const [c, r] = rawBoundary[i];
    const px = bbox.minX + c * stepX;
    const pz = bbox.minZ + r * stepZ;
    points.push([px / refRadius, pz / refRadius]);
  }

  if (points.length >= 6) {
    return points;
  }

  return [];
}

/**
 * Bilinear sampling of precomputed cradle underside depth at relative coordinates (relX, relZ)
 */
export function sampleCradleUndersideHeight(
  relX: number,
  relZ: number,
  cradle: CradleData
): number | null {
  const { depthGrid, gridRes, bbox } = cradle;

  if (
    relX < bbox.minX ||
    relX > bbox.maxX ||
    relZ < bbox.minZ ||
    relZ > bbox.maxZ
  ) {
    return null;
  }

  const u = (relX - bbox.minX) / (bbox.maxX - bbox.minX);
  const v = (relZ - bbox.minZ) / (bbox.maxZ - bbox.minZ);

  const colFloat = u * (gridRes - 1);
  const rowFloat = v * (gridRes - 1);

  const c0 = Math.floor(colFloat);
  const r0 = Math.floor(rowFloat);
  const c1 = Math.min(gridRes - 1, c0 + 1);
  const r1 = Math.min(gridRes - 1, r0 + 1);

  const fracX = colFloat - c0;
  const fracZ = rowFloat - r0;

  const v00 = depthGrid[r0 * gridRes + c0];
  const v10 = depthGrid[r0 * gridRes + c1];
  const v01 = depthGrid[r1 * gridRes + c0];
  const v11 = depthGrid[r1 * gridRes + c1];

  let sum = 0;
  let weight = 0;

  if (v00 !== Infinity) {
    const w = (1 - fracX) * (1 - fracZ);
    sum += v00 * w;
    weight += w;
  }
  if (v10 !== Infinity) {
    const w = fracX * (1 - fracZ);
    sum += v10 * w;
    weight += w;
  }
  if (v01 !== Infinity) {
    const w = (1 - fracX) * fracZ;
    sum += v01 * w;
    weight += w;
  }
  if (v11 !== Infinity) {
    const w = fracX * fracZ;
    sum += v11 * w;
    weight += w;
  }

  if (weight <= 0.001) {
    return null;
  }
  return sum / weight;
}

/**
 * Ensures an obstacle has valid cradle depth grid, bounding box, and waterline contour
 */
export function ensureObstacleCradle(obs: Obstacle): Obstacle {
  const cradle = generateObstacleCradleData(obs, 64);
  const hasContact = cradle.hasSurfaceContact !== false && Boolean(cradle.waterlineContour && cradle.waterlineContour.length >= 3);
  return {
    ...obs,
    cradleEnabled: obs.cradleEnabled !== false,
    flattenCradleAnomalies: obs.flattenCradleAnomalies !== false,
    cradleCeilingClamp: obs.cradleCeilingClamp ?? 0.0,
    cradleClearance: obs.cradleClearance ?? 0.2,
    cradleBlendMargin: obs.cradleBlendMargin ?? 2.5,
    cradleDepthGrid: cradle.depthGrid,
    cradleGridRes: cradle.gridRes,
    cradleBBox: cradle.bbox,
    cradleWaterlineContour: cradle.waterlineContour,
    hasSurfaceContact: hasContact,
    customPolygonPoints:
      hasContact && cradle.waterlineContour && cradle.waterlineContour.length >= 3
        ? cradle.waterlineContour
        : obs.shape === 'custom_3d'
        ? []
        : obs.customPolygonPoints,
  };
}

